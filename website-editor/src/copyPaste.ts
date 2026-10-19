// Copy, paste and duplicate in the page editor.
//
// Ctrl+C keeps the selected elements in the extension (see DesignerPanel),
// not in the page: the page is drawn again after every edit and on every
// page switch, and a copy must still be there on another page of the site.
// What is kept for each element is read from the page file when it is
// copied (src/pageEdit.ts copyElement): its markup byte for byte, where its
// names and addresses are in it, and its rules - the ones Draw2Code wrote
// for it and the ones the page's own stylesheets have for its id (a page
// made in Draw2Code has its first look in the shared stylesheet, under
// ":where(.page-index) #rect-3"). Rules are read for anything inside it
// that has a name too: a video's frame, a part of a section.
//
// Ctrl+V and Ctrl+D add the copies placed freely, as "Place freely" does:
// each gets a new id nobody on that page has (a rect is rect-7 if rect-1 to
// rect-6 are there), its rules under that id, and its place as it was
// shown, so copies keep where they were to each other. A paste lands where
// the elements were copied from, and 16px further down and right for each
// paste of the same copy on that page, so it never hides exactly behind
// what is already there; the page it was copied from counts as pasted on
// once. Ctrl+D is a copy pasted at once, 16px down and right, and leaves
// what Ctrl+C kept as it is. Files the elements show (a picture, a video)
// are already in the site, so the copies use the same ones, their
// addresses written for the page they land on.
//
// On a page made in Draw2Code the copies are kept inside its column, as a
// drag keeps them (src/placement.ts): a paste that would land past a side
// is moved in, all of them together, and one wider than the column is made
// as wide as it. Full-width ones stretch across the window anyway.
//
// What is not taken along: the rules of a page's own classes (another page
// of the same site usually links the same stylesheet, which still has
// them), rules inside @media blocks, and anything a rule says through the
// element's place in the page ("header h1").
//
// Pure: plain data in and out, so test/copyPaste.test.js runs it.

import * as path from 'path';
import { CopiedMarkup, Declarations, FULL_WIDTH_CLASS, idSelector, OWN_RULE_SUFFIX, Overrides, Span } from './pageEdit';
import { pageHref } from './links';
import { boxesInColumn } from './placement';

/** How far each paste of the same copy, and each duplicate, moves down and right, in px. */
export const PASTE_STEP = 16;

/** A box as the overlay measures it, in the page's coordinates (see pageShell's pageBox). */
export interface SeenBox { x: number; y: number; w: number; h: number }

/** Where a page's wrapper starts, in the page's coordinates, as the overlay measures it, and how wide it is (its column). */
export interface Origin { x: number; y: number; width?: number }

/** One element as Ctrl+C keeps it. */
export interface CopiedElement extends CopiedMarkup {
    /** For each of its names (CopiedMarkup.names), its rules by what follows the selector: "" its own, "::placeholder", " > *". */
    rules: Array<Record<string, Declarations>>;
    /** Its box as it was shown. */
    box: SeenBox;
    /** It was full width: its left and width stay as its rule has them. */
    full: boolean;
    /** Its rules in the page's phone layout, as `rules` has them; absent when that page has none. */
    phoneRules?: Array<Record<string, Declarations>>;
}

/** What Ctrl+C keeps: the elements, in the page's order, and where they came from. */
export interface Clip {
    /** The page they were copied from, site-relative. */
    page: string;
    /** Where that page's wrapper started, when it has one: the boxes are measured from it. */
    wrapper?: Origin;
    /** The folder of that page's Draw2Code stylesheet: the rules' addresses are written from it. */
    overridesDir: string;
    items: CopiedElement[];
    /**
     * Copied in the phone view of a page with a phone layout: the boxes are
     * the phone's, so a paste at desktop width places each copy from its
     * own desktop rule instead (Pasted.desktop).
     */
    view?: 'phone';
    /** How many times this copy has been pasted on each page (see PASTE_STEP). */
    pasted: Record<string, number>;
}

/** One rule of a stylesheet: its selectors (one per comma) and its declarations. */
export interface CssRule { selectors: string[]; declarations: Declarations }

/** Where the next of these characters is in `text` from `from`, outside quotes and brackets; -1 when none. */
function nextOutside(text: string, from: number, chars: string): number {
    let quote = '';
    let depth = 0;
    for (let i = from; i < text.length; i++) {
        const c = text[i];
        if (quote) {
            if (c === '\\') i++;
            else if (c === quote) quote = '';
        } else if (c === '"' || c === '\'') {
            quote = c;
        } else if (c === '(' || c === '[') {
            depth++;
        } else if ((c === ')' || c === ']') && depth > 0) {
            depth--;
        } else if (depth === 0 && chars.includes(c)) {
            return i;
        }
    }
    return -1;
}

/** `text` cut at each `sep` outside quotes and brackets. */
function splitOutside(text: string, sep: string): string[] {
    const parts: string[] = [];
    let from = 0;
    for (let at = nextOutside(text, 0, sep); at !== -1; at = nextOutside(text, from, sep)) {
        parts.push(text.slice(from, at));
        from = at + 1;
    }
    parts.push(text.slice(from));
    return parts;
}

/** "color: red; --gap: 4px" -> { color: "red", "--gap": "4px" }; a later one of a name wins, as in a browser. */
export function cssDeclarations(text: string): Declarations {
    const out: Declarations = {};
    for (const part of splitOutside(text, ';')) {
        const colon = part.indexOf(':');
        if (colon === -1) continue;
        const raw = part.slice(0, colon).trim();
        const value = part.slice(colon + 1).trim();
        if (!raw || !value) continue;
        out[raw.startsWith('--') ? raw : raw.toLowerCase()] = value;
    }
    return out;
}

/**
 * A stylesheet's rules, in order: only those at its top level. An @import
 * or @charset is passed over, and so is a block (@media, @font-face): what
 * is inside one applies only sometimes, or is not an element's rule.
 */
export function cssRules(css: string): CssRule[] {
    const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const out: CssRule[] = [];
    let at = 0;
    while (at < text.length) {
        const open = nextOutside(text, at, '{;');
        if (open === -1) break;
        if (text[open] === ';') { at = open + 1; continue; }
        // The block's end: its braces counted, so a nested block is passed over whole.
        let depth = 1;
        let close = open + 1;
        while (depth > 0) {
            const next = nextOutside(text, close, '{}');
            if (next === -1) { close = text.length; break; }
            depth += text[next] === '{' ? 1 : -1;
            close = next + 1;
        }
        const prelude = text.slice(at, open).trim();
        if (prelude && !prelude.startsWith('@')) {
            out.push({ selectors: splitOutside(prelude, ',').map(tidySelector).filter(Boolean), declarations: cssDeclarations(text.slice(open + 1, close - 1)) });
        }
        at = close;
    }
    return out;
}

/** A selector written the one way Draw2Code writes it: single spaces, " > " between parts. */
function tidySelector(selector: string): string {
    return selector.trim().replace(/\s*>\s*/g, ' > ').replace(/\s+/g, ' ');
}

/**
 * What follows one of an element's own selectors in a rule that is only
 * that element's ('#rect-3::placeholder' -> "::placeholder", '#rect-3' ->
 * ""), or undefined for any other rule. A rule of a page made in Draw2Code
 * is scoped to its page (":where(.page-index) #rect-3"); `scopes` are the
 * classes of the copied element's page, so another page's rect-3 is not it.
 */
export function ownSuffix(selector: string, own: string[], scopes: string[]): string | undefined {
    let rest = tidySelector(selector);
    for (const scope of scopes) {
        for (const prefix of [`:where(.${scope}) `, `.${scope} `]) {
            if (rest.startsWith(prefix)) rest = rest.slice(prefix.length);
        }
    }
    for (const selector of own) {
        if (rest.startsWith(selector) && OWN_RULE_SUFFIX.test(rest.slice(selector.length))) return rest.slice(selector.length);
    }
    return undefined;
}

/**
 * An address written from one folder, written from another: "../img/a.png"
 * from "css" is "img/a.png" from "" (the site's root). A web address, a
 * data: address, one from the site's root ("/x.png"), a section ("#top")
 * and one outside the site stay as they are.
 */
export function rebaseUrl(value: string, fromDir: string, toDir: string): string {
    const raw = value.trim();
    const from = fromDir === '.' ? '' : fromDir;
    const to = toDir === '.' ? '' : toDir;
    if (!raw || from === to || /^[a-z][a-z0-9+.-]*:/i.test(raw) || /^[/\\#?]/.test(raw)) return value;
    const at = raw.search(/[?#]/);
    const file = at === -1 ? raw : raw.slice(0, at);
    const suffix = at === -1 ? '' : raw.slice(at);
    const joined = path.posix.normalize(path.posix.join(from, file));
    if (joined === '..' || joined.startsWith('../')) return value;
    return path.posix.relative(to, joined) + suffix;
}

/** Every url(...) in a declaration's value, rebased (see rebaseUrl). */
function rebaseCss(value: string, fromDir: string, toDir: string): string {
    return value.replace(/url\(\s*(["']?)([^)"']+)\1\s*\)/gi, (m, quote: string, url: string) => `url(${quote}${rebaseUrl(url, fromDir, toDir)}${quote})`);
}

function rebaseRules(rules: Record<string, Declarations>, fromDir: string, toDir: string): Record<string, Declarations> {
    return Object.fromEntries(Object.entries(rules).map(([suffix, declarations]) =>
        [suffix, Object.fromEntries(Object.entries(declarations).map(([prop, value]) => [prop, rebaseCss(value, fromDir, toDir)]))]));
}

/**
 * The page's styles as a copy reads them: each stylesheet's text and the
 * folder its addresses are written from, in the order a browser reads them,
 * then Draw2Code's own rules for the page (which come last, and win), and
 * the classes on the page's <body>.
 */
export interface PageStyles {
    sheets: Array<{ dir: string; css: string }>;
    overrides: Overrides;
    /** The folder of the page's Draw2Code stylesheet, which a copy's rules are written from. */
    overridesDir: string;
    scopes: string[];
}

/**
 * The rules of each of a copied element's names, merged as a browser
 * would: each stylesheet in turn, then Draw2Code's own rules. Their
 * addresses are written from the page's Draw2Code stylesheet, where a paste
 * writes them.
 */
export function copiedRules(markup: CopiedMarkup, styles: PageStyles): Array<Record<string, Declarations>> {
    const parsed = styles.sheets.map((sheet) => ({ dir: sheet.dir, rules: cssRules(sheet.css) }));
    return markup.names.map((name) => {
        const out: Record<string, Declarations> = {};
        const take = (selector: string, declarations: Declarations, dir: string): void => {
            const suffix = ownSuffix(selector, name.selectors, styles.scopes);
            if (suffix === undefined) return;
            out[suffix] = { ...(out[suffix] ?? {}), ...rebaseRules({ s: declarations }, dir, styles.overridesDir).s };
        };
        if (name.selectors.length === 0) return out;
        for (const sheet of parsed) {
            for (const rule of sheet.rules) for (const selector of rule.selectors) take(selector, rule.declarations, sheet.dir);
        }
        // Written by Draw2Code for no other selector than the element's: never scoped.
        for (const [selector, declarations] of Object.entries(styles.overrides)) take(selector, declarations, styles.overridesDir);
        return out;
    });
}

/**
 * A new id for a pasted element that nobody in `taken` has: a numbered one
 * takes the first free number of its kind ("rect-3" -> "rect-1" on a page
 * without one, "rect-7" on a page with rect-1 to rect-6), any other keeps
 * its name while it is free ("title"), and is numbered from 2 once it is
 * not ("title-2").
 */
export function freshId(base: string, taken: ReadonlySet<string>): string {
    const numbered = /^(.+)-\d+$/.exec(base);
    if (numbered) {
        let n = 1;
        while (taken.has(`${numbered[1]}-${n}`)) n++;
        return `${numbered[1]}-${n}`;
    }
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n++;
    return `${base}-${n}`;
}

/** How much further down and right the next paste of this copy on `page` goes (see PASTE_STEP). */
export function pasteOffset(clip: Clip, page: string): number {
    return PASTE_STEP * ((clip.pasted[page] ?? 0) + (page === clip.page ? 1 : 0));
}

/**
 * Where a pasted element goes, as its left and top: its box as it was
 * shown, moved by `offset`. Both pages with a wrapper, it keeps its place in
 * the wrapper; otherwise its place on the page, measured from the wrapper
 * it lands in when there is one.
 */
export function pastedAt(box: SeenBox, from: Origin | undefined, to: Origin | undefined, offset: number): { x: number; y: number } {
    let x = box.x, y = box.y;
    if (!from || !to) {
        if (from) { x += from.x; y += from.y; }
        if (to) { x -= to.x; y -= to.y; }
    }
    return { x: Math.round(x + offset), y: Math.round(y + offset) };
}

/**
 * Where pasted elements go once kept in a column `width` px wide whose left
 * side is 0 (the wrapper's coordinates): moved in together, or each on its
 * own when they do not fit side by side, and none wider than the column
 * (placement.ts boxesInColumn). w is the width of one made narrower. A
 * full-width one stays where it is put, and with no column (a page not
 * made in Draw2Code, or no width measured) so do all.
 */
export function pastedInColumn(items: Array<{ box: SeenBox; full: boolean }>, ats: Array<{ x: number; y: number }>, width: number | undefined): Array<{ x: number; y: number; w?: number }> {
    const out: Array<{ x: number; y: number; w?: number }> = ats.map((at) => ({ ...at }));
    if (!(Number(width) > 0)) return out;
    const kept = items.map((item, i) => i).filter((i) => !items[i].full);
    const boxes = kept.map((i) => ({ left: ats[i].x, top: ats[i].y, width: Math.round(items[i].box.w), height: Math.round(items[i].box.h) }));
    boxesInColumn(boxes, { left: 0, right: Number(width) }).forEach((box, k) => {
        const i = kept[k];
        out[i].x = Math.round(box.left);
        if (box.width < boxes[k].width) out[i].w = Math.round(box.width);
    });
    return out;
}

/**
 * The generator's rules for an element in a page's wrapper
 * (media/generators/html.js baseCss: ".page > *", ".page > svg" and
 * ".page > button"; a test holds them together). An element copied out of a
 * wrapper onto a page without one takes them with it, so it looks the same.
 */
export const WRAPPER_RULES: Readonly<Record<string, Declarations>> = Object.freeze({
    '*': { 'box-sizing': 'border-box', margin: '0', padding: '0', 'font-family': 'inherit', 'white-space': 'nowrap', overflow: 'hidden' },
    svg: { overflow: 'visible' },
    button: { cursor: 'pointer' },
});

/**
 * A pasted element's own rule: the one it had, placed freely (position:
 * absolute) at `at`. Full width, its left stays as its rule has it. A size
 * its rules did not give (an element in a page's flow) is the size it was
 * shown at. Copied out of a page's wrapper onto a page without one, it
 * takes the wrapper's rules for its children with it (WRAPPER_RULES); a
 * full-width one is no longer full width there (nothing on that page
 * stretches it), so it is placed and sized as it was shown, across the
 * window it was copied in.
 */
export function placedRule(rule: Declarations, item: { box: SeenBox; full: boolean; inWrapper: boolean; tag: string }, at: { x: number; y: number }, toWrapper: boolean): Declarations {
    const full = item.full && toWrapper;
    const out: Declarations = { ...rule, position: 'absolute', top: `${at.y}px` };
    if (!full) out.left = `${at.x}px`;
    if (item.full && !toWrapper) out.width = `${Math.round(item.box.w)}px`;
    const sized = rule.width === undefined || (rule.height === undefined && rule['min-height'] === undefined);
    if (rule.width === undefined && !full) out.width = `${Math.round(item.box.w)}px`;
    if (rule.height === undefined && rule['min-height'] === undefined) out.height = `${Math.round(item.box.h)}px`;
    // The size shown is the whole box, its border and padding included.
    if (sized && !toWrapper && out['box-sizing'] === undefined) out['box-sizing'] = 'border-box';
    if (item.inWrapper && !toWrapper) {
        for (const extra of [WRAPPER_RULES['*'], WRAPPER_RULES[item.tag] ?? {}]) {
            for (const [prop, value] of Object.entries(extra)) if (out[prop] === undefined) out[prop] = value;
        }
    }
    return out;
}

/** The page a copy lands on, as pasteElements needs it. */
export interface PasteTarget {
    page: string;
    /** Every id already on it. */
    taken: ReadonlySet<string>;
    /** What is placed freely on it goes in its wrapper (see pageEdit.placesInWrapper). */
    inWrapper: boolean;
    /** Where that wrapper starts, as the overlay measures it; its width is the column the copies are kept in. */
    wrapper?: Origin;
    /** The folder of its Draw2Code stylesheet. */
    overridesDir: string;
}

/** One pasted element: what the add edit writes. */
export interface Pasted {
    id: string;
    markup: string;
    declarations: Declarations;
    extraRules: Array<{ selector: string; declarations: Declarations }>;
    /** Made as wide as the column it lands in: a drawing is drawn again at that width (a style edit after the add). */
    narrowed: boolean;
    /** Its rules in the phone layout, under its new names (see EditOp.phoneRules). */
    phoneRules: Array<{ selector: string; declarations: Declarations }>;
    /**
     * Its rule at desktop width, when the box it was copied with was not a
     * desktop one or it lands in the phone view: `declarations` with the
     * original's own desktop place and size, moved by the paste's offset.
     * Absent when the original's rule has no place in px.
     */
    desktop?: Declarations;
}

/** What places and sizes an element in its own rule: what a desktop copy keeps of the original's. */
const PLACE = ['left', 'top', 'width', 'height', 'min-height'];

/**
 * A copy's own rule (its phone layout's, or its desktop place), moved by
 * `offset` as the paste moves it on the page: down and right, so it does
 * not hide the original.
 */
function offsetRule(rule: Declarations, offset: number): Declarations {
    const out = { ...rule };
    for (const prop of ['left', 'top']) {
        const px = /^(-?\d+(?:\.\d+)?)px$/.exec(out[prop] ?? '');
        if (px && offset) out[prop] = `${Math.round((Number(px[1]) + offset) * 100) / 100}px`;
    }
    return out;
}

function escapeAttr(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * The markup with a class taken off its outermost element (and its class
 * attribute, once that is empty): the full-width class of an element
 * pasted onto a page without a wrapper, where it would mean nothing, or a
 * class of that page's own.
 */
export function withoutClass(markup: string, name: string): string {
    const tag = /^<[A-Za-z][^\s/>]*/.exec(markup);
    if (!tag) return markup;
    // The start tag's attributes one by one, quoted values whole, from its name to its ">".
    const attr = /\s+([^\s"'>/=]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/y;
    attr.lastIndex = tag[0].length;
    for (let m = attr.exec(markup); m; m = attr.exec(markup)) {
        if (m[1].toLowerCase() !== 'class' || m[2] === undefined) continue;
        // The value as it is written, in its own quotes, so nothing in it is escaped twice.
        const quote = /^["']/.test(m[2]) ? m[2][0] : '"';
        const value = m[2][0] === quote ? m[2].slice(1, -1) : m[2];
        const classes = value.split(/\s+/).filter(Boolean);
        const kept = classes.filter((c) => c !== name);
        if (kept.length === classes.length) return markup;
        const text = kept.length ? ` class=${quote}${kept.join(' ')}${quote}` : '';
        return markup.slice(0, m.index) + text + markup.slice(m.index + m[0].length);
    }
    return markup;
}

/** Apply splices that do not overlap, the last first. */
function splice(text: string, edits: Array<Span & { text: string }>): string {
    let out = text;
    for (const e of [...edits].sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.text + out.slice(e.to);
    return out;
}

/**
 * The copies of a clip's elements for one page, in the clip's order (which
 * is the page's, so what was on top stays on top): their new ids, their
 * markup with those ids and with addresses written from that page, and
 * their rules under the new ids, placed `offset` px down and right.
 */
export function pasteElements(clip: Clip, target: PasteTarget, offset: number): Pasted[] {
    const taken = new Set(target.taken);
    const fromDir = path.posix.dirname(clip.page);
    const toDir = path.posix.dirname(target.page);
    const to = target.inWrapper ? target.wrapper ?? { x: 0, y: 0 } : undefined;
    const ats = pastedInColumn(clip.items.map((item) => ({ box: item.box, full: item.full && target.inWrapper })),
        clip.items.map((item) => pastedAt(item.box, clip.wrapper, to, offset)), to?.width);
    return clip.items.map((item, n) => {
        const ids = item.names.map((name) => {
            const id = freshId(name.base, taken);
            taken.add(id);
            return id;
        });
        const edits: Array<Span & { text: string }> = item.names.map((name, i) =>
            ({ ...name.at, text: name.at.from === name.at.to ? ` id="${escapeAttr(ids[i])}"` : `id="${escapeAttr(ids[i])}"` }));
        for (const span of item.drop) edits.push({ ...span, text: '' });
        for (const address of item.addresses) {
            // A section of the page it came from is on that page, wherever the link is now.
            const value = address.section ? (target.page === clip.page ? address.value : pageHref(target.page, clip.page) + address.value)
                : rebaseUrl(address.value, fromDir, toDir);
            if (value !== address.value) edits.push({ ...address.at, text: `${address.name}="${escapeAttr(value)}"` });
        }
        let markup = splice(item.markup, edits);
        if (item.full && !target.inWrapper) markup = withoutClass(markup, FULL_WIDTH_CLASS);
        const tag = (/^<([A-Za-z][A-Za-z0-9-]*)/.exec(item.markup)?.[1] ?? '').toLowerCase();
        const at = ats[n];
        const extraRules: Pasted['extraRules'] = [];
        let declarations: Declarations = {};
        item.rules.forEach((byName, i) => {
            const rules = rebaseRules(byName, clip.overridesDir, target.overridesDir);
            for (const [suffix, rule] of Object.entries(rules)) {
                if (i === 0 && suffix === '') continue;
                extraRules.push({ selector: idSelector(ids[i]) + suffix, declarations: rule });
            }
            if (i === 0) declarations = placedRule(rules[''] ?? {}, { box: item.box, full: item.full, inWrapper: item.inWrapper, tag }, at, target.inWrapper);
        });
        if (at.w !== undefined) declarations.width = `${at.w}px`;
        const phoneRules: Pasted['phoneRules'] = [];
        (item.phoneRules ?? []).forEach((byName, i) => {
            const rules = rebaseRules(byName, clip.overridesDir, target.overridesDir);
            for (const [suffix, rule] of Object.entries(rules)) {
                phoneRules.push({ selector: idSelector(ids[i]) + suffix, declarations: i === 0 && suffix === '' ? offsetRule(rule, offset) : rule });
            }
        });
        const own = item.rules[0]?.[''] ?? {};
        const placed = /^-?\d+(?:\.\d+)?px$/;
        const desktop = placed.test(own.left ?? '') && placed.test(own.top ?? '')
            ? { ...declarations, ...offsetRule(Object.fromEntries(PLACE.filter((prop) => own[prop] !== undefined).map((prop) => [prop, own[prop]])), offset) }
            : undefined;
        return { id: ids[0], markup, declarations, extraRules, narrowed: at.w !== undefined, phoneRules, ...(desktop ? { desktop } : {}) };
    });
}
