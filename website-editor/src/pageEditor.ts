// Applying one edit from the overlay to the development copy.
//
// Each edit names an element (its id, or its position in the page), and this
// turns that into: a stable selector, a rule in draw2code.css, and - for text
// and links - a small splice in the page itself. The page keeps its own
// structure, stylesheets and scripts; see src/pageEdit.ts for the splicing
// rules.
//
// CS50 citation: the name Draw2Code Web Editor was chosen with help from
// Claude (Anthropic AI), and at my direction Claude renamed
// the project from its earlier name, HardHat Designer, throughout this file.

import * as fs from 'fs';
import * as path from 'path';
import * as edit from './pageEdit';
import { checkImageSrc } from './images';
import { checkHref, checkSectionName, cleanLooks, linkedFile } from './links';
import { disk, FileAccess, HeldFiles } from './heldFiles';
import { ownPlayerLinks } from './videos';
import { PHONE_MAP_SUFFIX } from './siteFiles';

export interface EditOp {
    op: 'style' | 'text' | 'add' | 'remove' | 'revert' | 'revertPage' | 'title' | 'link' | 'fullWidth' | 'placeholder' | 'phoneLayout' | 'batch';
    ref: edit.ElementRef;
    declarations?: edit.Declarations;
    text?: string;
    markup?: string;
    /** add: the section to put it in; absent means the end of the page (see appendToPage). */
    into?: edit.ElementRef;
    /** add: further rules for the element (an input's ::placeholder, say). */
    extraRules?: Array<{ selector: string; declarations: edit.Declarations }>;
    /**
     * add: the element's rules in the phone layout (a paste of an element
     * that had some). Written only when the page has a phone layout: on a
     * page without one there is nowhere for them to show.
     */
    phoneRules?: Array<{ selector: string; declarations: edit.Declarations }>;
    /**
     * phoneLayout: the page's phone layout from now on, which gives the page
     * one (see edit.setPhoneLayout); null or absent takes it away, rules and all.
     */
    phone?: edit.Overrides | null;
    /**
     * style and add, made in the phone view of a page with a phone layout:
     * what moves or sizes the element goes into its phone rules, the rest
     * into its own (see PER_WIDTH). An element added there gets its place
     * in both, so it is on the page at desktop width too.
     */
    media?: 'phone';
    /**
     * add in the phone view: the element's rule at desktop width when it is
     * not `declarations` (a paste: the original's desktop place, moved).
     */
    desktopDeclarations?: edit.Declarations;
    /**
     * add: shared files the element needs linked in <head> - the video
     * player's stylesheet and script - written relative to this page.
     * Each must be a .css or .js inside the site.
     */
    head?: { stylesheets?: string[]; scripts?: string[] };
    /**
     * style: rules for the element's CHILDREN, written under "<selector> > *".
     * An inline <svg> is one drawing to the user, but its colour lives on
     * the shape inside it - and the overlay does not know the selector.
     */
    childDeclarations?: edit.Declarations;
    /**
     * link: where it goes - a page of the site, relative to this page
     * ("../index.html"), or a web address. Empty or absent takes the link
     * away. With it, `declarations` are the looks the overlay measured
     * (see LINK_LOOKS in links.ts).
     */
    href?: string;
    /**
     * link to a section of this page ("#prices"): the element it names,
     * when it has no id yet. It is given the href's name as its id in the
     * same edit, so making the link is one step to undo.
     */
    anchor?: edit.ElementRef;
    /** fullWidth: across the whole window (true), or back in the page's column. */
    full?: boolean;
    /**
     * batch: edits of several elements of the page, made one after the
     * other as ONE edit (one undo step): moving, removing or reverting
     * several selected elements, a paste. Removals name their elements in
     * reverse page order, so taking one out never moves the place of one
     * still to come. If one is refused, none is made.
     */
    ops?: EditOp[];
    /** batch: what the step is called in the Edit menu (see BATCH_LABELS). */
    label?: string;
}

/** What a batch may be called; anything else is "Edit elements". */
export const BATCH_LABELS: readonly string[] = ['Move elements', 'Remove elements', 'Revert elements', 'Paste', 'Duplicate'];

/**
 * What an element has once per width: whatever moves or sizes it, and
 * whether it is shown. Everything else - its colours, border, rounding,
 * weight, underline, link and words, and Full width - it has once, for
 * every width, and an edit in the phone view writes it as the desktop
 * view does.
 */
export const PER_WIDTH: readonly string[] = ['left', 'top', 'width', 'height', 'min-height', 'font-size', 'text-align', 'justify-content', 'display'];

/** Declarations split into what is per width and what is shared (see PER_WIDTH). */
export function byWidth(declarations: edit.Declarations): { perWidth: edit.Declarations; shared: edit.Declarations } {
    const perWidth: edit.Declarations = {};
    const shared: edit.Declarations = {};
    for (const [prop, value] of Object.entries(declarations)) (PER_WIDTH.includes(prop) ? perWidth : shared)[prop] = value;
    return { perWidth, shared };
}

/** An edit as the phone view makes it: its style and add edits, a batch's too, marked for the phone layout. */
export function inPhoneView(op: EditOp): EditOp {
    if (op.op === 'batch') return { ...op, ops: (op.ops ?? []).map(inPhoneView) };
    return op.op === 'style' || op.op === 'add' ? { ...op, media: 'phone' } : op;
}

/** The edits a batch may hold: those of an element. */
const BATCHABLE: readonly string[] = ['style', 'text', 'add', 'remove', 'revert', 'link', 'fullWidth', 'placeholder'];

/** The answer to an edit whose element is not in the page file. */
const GONE = 'that element is no longer in the page; the page is kept';

export interface EditResult {
    changed: string[];
    selector?: string;
    error?: string;
}

/**
 * Overrides live in the copy's .draw2code folder: never copied, never applied,
 * and thrown away with the copy when it is made again.
 */
export function overridesStore(siteWork: string): string {
    return path.join(siteWork, '.draw2code', 'overrides.json');
}

/**
 * Forget every override for a site. Called when the working copy is made
 * again: a fresh copy has no data-d2c markers, so numbering restarts at 1 and
 * an old rule would otherwise reattach itself to a different element.
 */
export function clearOverrides(siteWork: string): void {
    try {
        fs.rmSync(overridesStore(siteWork));
    } catch {
        /* nothing stored yet */
    }
}

/**
 * Where a page's phone layout is kept in the store, beside its own rules:
 * "index.html" -> "index.html@phone". It is one more map of the same shape,
 * so every function that changes a page's rules is called once per map. A
 * page with a phone layout has this entry, even with no rules in it yet.
 */
export function phoneKey(page: string): string {
    return page + PHONE_MAP_SUFFIX;
}

/** Does any of the page's rules, its phone layout's included, say something? */
function hasRules(store: Record<string, edit.Overrides>, page: string): boolean {
    return [store[page], store[phoneKey(page)]].some((rules) => Object.values(rules ?? {}).some((one) => Object.keys(one).length > 0));
}

/** The page's stylesheet as the store has it: its rules, then its phone layout's. */
function pageCss(store: Record<string, edit.Overrides>, page: string): string {
    return edit.renderOverrides(store[page] ?? {}, store[phoneKey(page)]);
}

// ---- the editor's two views of a page --------------------------------
// The editor's page is a desktop window as wide as the panel, so the phone
// layout's @media block is out of play both ways: the editor shows the
// page's Draw2Code stylesheet as the view needs it instead of the file, and
// in the phone view lays the page out at the phone's width itself.

/**
 * The page's Draw2Code stylesheet as the editor shows it. Desktop: its own
 * rules, never the phone layout's, however narrow the panel. Phone: its
 * own rules, then the phone layout's, outside any @media block. An element
 * hidden on phones is shown faintly there instead, so it can still be
 * selected and shown again.
 */
export function viewStylesheet(store: Record<string, edit.Overrides>, page: string, view: 'desktop' | 'phone'): string {
    const own = edit.renderOverrides(store[page] ?? {});
    if (view === 'desktop') return own;
    const phone = Object.fromEntries(Object.entries(store[phoneKey(page)] ?? {}).map(([selector, declarations]) => {
        if (declarations.display !== 'none') return [selector, declarations];
        const { display, ...rest } = declarations;
        void display;
        return [selector, { ...rest, opacity: PHONE_HIDDEN_OPACITY }];
    }));
    const blocks = edit.ruleBlocks(phone);
    return blocks.length ? `${own}\n${blocks.join('\n\n')}\n` : own;
}

/** How faintly the phone view shows an element hidden on phones. */
export const PHONE_HIDDEN_OPACITY = '0.3';

/**
 * The phone view's own rules, after the page's: <html> as wide as a phone,
 * and under it what the shared stylesheet's phone block does in a phone's
 * window (media/generators/html.js baseCss), with a full-width element as
 * wide as the column, which is the window there.
 */
export function phoneViewCss(phoneWidth: number): string {
    return [
        `html { width: ${phoneWidth}px; }`,
        'html body { min-width: 0; }',
        'html .page { width: 100%; }',
        `html .page > .${edit.FULL_WIDTH_CLASS} { left: 0 !important; width: 100% !important; }`,
        'html .page > svg > * { vector-effect: non-scaling-stroke; }',
    ].join('\n');
}

/** The selectors hidden on phones in the page's phone layout ("Hide on phone"). */
export function phoneHidden(store: Record<string, edit.Overrides>, page: string): string[] {
    return Object.entries(store[phoneKey(page)] ?? {}).filter(([selector, declarations]) =>
        declarations.display === 'none' && !/[: ]/.test(selector.replace(/\[[^\]]*\]/g, ''))).map(([selector]) => selector);
}

// Every read and write below goes through `io`: the disk, or the held edits
// of an open project (src/heldFiles.ts), so unsaved edits build on each other.

function writeCss(siteWork: string, page: string, store: Record<string, edit.Overrides>, io: FileAccess): string {
    const file = path.join(siteWork, cssPathFor(page));
    io.write(file, pageCss(store, page));
    return file;
}

function writeStore(file: string, store: Record<string, edit.Overrides>, io: FileAccess): void {
    io.write(file, JSON.stringify(store, null, 2));
}

/** Every page's overrides in a development copy (page -> selector -> declarations). */
export function readOverrides(siteWork: string, io: FileAccess = disk): Record<string, edit.Overrides> {
    return readStore(overridesStore(siteWork), io);
}

function readStore(file: string, io: FileAccess): Record<string, edit.Overrides> {
    try {
        return JSON.parse(io.read(file)) as Record<string, edit.Overrides>;
    } catch {
        return {};
    }
}

/**
 * Everything Draw2Code can change about one page: the file and its overrides.
 * Undo is built on these, so it covers every kind of edit the same way -
 * a nudge, a resize, a retype, an added element, a revert - and any edit
 * added later, without knowing what the edit was.
 */
export interface PageSnapshot {
    page: string;
    html: string;
    overrides: edit.Overrides;
    /** Its phone layout's rules; absent when it has none. */
    phone?: edit.Overrides;
    /** The view the editor showed (the editor's, not the page's): undo shows it again. */
    view?: 'desktop' | 'phone';
    /** The page did not exist (before it was added): restoring removes it. */
    absent?: boolean;
}

/** A page before it existed, so adding a page is undoable like any edit. */
export function absentPage(page: string): PageSnapshot {
    return { page, html: '', overrides: {}, absent: true };
}

export function snapshotPage(siteWork: string, page: string, io: FileAccess = disk): PageSnapshot | null {
    try {
        const html = io.read(path.join(siteWork, page));
        const store = readStore(overridesStore(siteWork), io);
        const copy = (rules: edit.Overrides): edit.Overrides => JSON.parse(JSON.stringify(rules)) as edit.Overrides;
        const phone = store[phoneKey(page)];
        return { page, html, overrides: copy(store[page] ?? {}), ...(phone ? { phone: copy(phone) } : {}) };
    } catch {
        return null;
    }
}

/** Put a page back the way a snapshot has it. Returns the files written. */
export function restorePage(siteWork: string, snapshot: PageSnapshot, io: FileAccess = disk): string[] {
    const pageFile = path.join(siteWork, snapshot.page);
    const storeFile = overridesStore(siteWork);
    const store = readStore(storeFile, io);
    if (snapshot.absent) {
        const cssFile = path.join(siteWork, cssPathFor(snapshot.page));
        io.remove(pageFile);
        io.remove(cssFile);
        if (store[snapshot.page] || store[phoneKey(snapshot.page)]) {
            delete store[snapshot.page];
            delete store[phoneKey(snapshot.page)];
            writeStore(storeFile, store, io);
        }
        return [pageFile, storeFile, cssFile];
    }
    io.write(pageFile, snapshot.html);
    // A page with no rules had no entry, and maybe no files, before its first
    // edit: putting it back takes them away again, so an edit undone leaves
    // nothing different from what is saved.
    const cssFile = path.join(siteWork, cssPathFor(snapshot.page));
    if (Object.keys(snapshot.overrides).length > 0) store[snapshot.page] = snapshot.overrides;
    else delete store[snapshot.page];
    if (snapshot.phone) store[phoneKey(snapshot.page)] = snapshot.phone;
    else delete store[phoneKey(snapshot.page)];
    if (Object.keys(store).length === 0 && !disk.exists(storeFile)) io.remove(storeFile);
    else writeStore(storeFile, store, io);
    if (!hasRules(store, snapshot.page) && !disk.exists(cssFile)) io.remove(cssFile);
    else writeCss(siteWork, snapshot.page, store, io);
    return [pageFile, storeFile, cssFile];
}

/**
 * Each page gets its own stylesheet, mirroring its path:
 *   index.html       -> draw2code/index.css
 *   pages/about.html -> draw2code/pages/about.css
 * One shared file would not work: two pages can both use #title, and the
 * page being edited would overwrite the other page's rules.
 */
export function cssPathFor(page: string): string {
    return `draw2code/${page.replace(/\.html?$/i, '')}.css`;
}

/** The page's Draw2Code stylesheet, when its unsaved version differs from the file. */
export function heldStylesheet(work: string, page: string): Array<{ file: string; css: string }> {
    const held = HeldFiles.for(work);
    const file = path.join(work, cssPathFor(page));
    // One held as removed (a link taken away took its stylesheet with it) is
    // no longer linked from the page: there is nothing to put in its place.
    return held?.isHeld(file) && held.exists(file) ? [{ file, css: held.read(file) }] : [];
}

/**
 * The page a changed file belongs to: the page itself, or its Draw2Code
 * stylesheet. Anything else (an image, a shared stylesheet) is no page's.
 */
export function pageOfFile(siteWork: string, file: string, pages: string[]): string | undefined {
    const rel = path.relative(siteWork, file).split(path.sep).join('/');
    return pages.find((page) => page.toLowerCase() === rel.toLowerCase() || cssPathFor(page).toLowerCase() === rel.toLowerCase());
}

/**
 * The pages that still link to `page`, read through `io` so a link not yet
 * saved counts too: removing "about.html" while "index.html" and
 * "pages/contact.html" have <a href="about.html"> and
 * <a href="../about.html#team"> -> ["index.html", "pages/contact.html"].
 * Case does not matter, as with any page name; web addresses never count.
 */
export function pagesLinkingTo(siteWork: string, page: string, pages: string[], io: FileAccess = disk): string[] {
    const want = page.toLowerCase();
    return pages.filter((from) => {
        if (from.toLowerCase() === want) return false;
        let html = '';
        try {
            html = io.read(path.join(siteWork, from));
        } catch {
            return false;
        }
        return edit.linkHrefs(html).some((href) => linkedFile(href, from)?.toLowerCase() === want);
    });
}

/**
 * The ONE warning for a page taken away while other pages still link to it,
 * or undefined when none do: "about.html was removed. index.html and
 * contact.html still link to it; nothing is changed."
 */
export function removedPageWarning(page: string, linking: string[]): string | undefined {
    if (linking.length === 0) return undefined;
    // VS Code makes [label](command:...) in a notification a link it runs, and
    // these names come from inside the site: "[a](command:x).html" -> "[a] (command:x).html".
    const shown = (name: string): string => name.replace(/\]\(/g, '] (');
    const names = linking.map(shown);
    // "a.html", "a.html and b.html", "a.html, b.html and c.html"
    const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    const verb = names.length === 1 ? 'links' : 'link';
    return `${shown(page)} was removed. ${list} still ${verb} to it; nothing is changed.`;
}

/** Does this page have unsaved edits: its file, its stylesheet or its rules? */
export function pageIsHeld(siteWork: string, page: string, held: HeldFiles): boolean {
    if (held.isHeld(path.join(siteWork, page)) || held.isHeld(path.join(siteWork, cssPathFor(page)))) return true;
    const storeFile = overridesStore(siteWork);
    if (!held.isHeld(storeFile)) return false;
    const unsaved = readStore(storeFile, held);
    const saved = readStore(storeFile, disk);
    return [page, phoneKey(page)].some((key) => JSON.stringify(unsaved[key] ?? null) !== JSON.stringify(saved[key] ?? null));
}

/**
 * Take what is saved for one page instead of its unsaved edits - its file,
 * its stylesheet and its rules - leaving every other page's edits held.
 */
export function dropHeldPage(siteWork: string, page: string, held: HeldFiles): void {
    held.forget(path.join(siteWork, page));
    held.forget(path.join(siteWork, cssPathFor(page)));
    const storeFile = overridesStore(siteWork);
    if (!held.isHeld(storeFile)) return;
    const store = readStore(storeFile, held);
    const saved = readStore(storeFile, disk);
    for (const key of [page, phoneKey(page)]) {
        if (saved[key]) store[key] = saved[key];
        else delete store[key];
    }
    if (Object.keys(store).length === 0 && !disk.exists(storeFile)) held.forget(storeFile);
    else writeStore(storeFile, store, held);
}

/** The stylesheet's path as written in that page's <link>. */
export function hrefFromPage(page: string): string {
    const fromDir = path.posix.dirname(page);
    return path.posix.relative(fromDir === '.' ? '' : fromDir, cssPathFor(page));
}

/**
 * Apply one edit inside `siteWork` (the working copy) to `page`
 * (site-relative, e.g. "index.html" or "pages/about.html").
 */
export function applyEdit(siteWork: string, page: string, operation: EditOp, io: FileAccess = disk): EditResult {
    const pageFile = path.join(siteWork, page);
    let html: string;
    try {
        html = io.read(pageFile);
    } catch {
        return { changed: [], error: `cannot read ${page}` };
    }

    const changed = new Set<string>();
    const storeFile = overridesStore(siteWork);
    const store = readStore(storeFile, io);
    const pageOverrides = store[page] ?? {};
    const phone = phoneKey(page);

    if (operation.op === 'batch') return applyBatch(siteWork, page, operation.ops ?? [], io);

    // Retitling names no element either: it is the page's own <title>.
    if (operation.op === 'title') {
        const next = edit.setTitle(html, operation.text ?? '');
        if (!next.changed) return { changed: [] };
        io.write(pageFile, next.html);
        return { changed: [pageFile] };
    }

    // Full width is a class in the page, not a rule: its left and width
    // stay in its rules for when it is back in the page's column.
    if (operation.op === 'fullWidth') {
        const next = edit.setFullWidth(html, operation.ref, Boolean(operation.full));
        if ('problem' in next) return { changed: [], error: next.problem };
        if (!next.changed) return { changed: [] };
        io.write(pageFile, next.html);
        return { changed: [pageFile] };
    }

    // A placeholder is an attribute of the input, written in place: no rule.
    if (operation.op === 'placeholder') {
        const next = edit.setPlaceholder(html, operation.ref, operation.text ?? '');
        if ('problem' in next) return { changed: [], error: next.problem };
        if (!next.changed) return { changed: [] };
        io.write(pageFile, next.html);
        return { changed: [pageFile] };
    }

    // Reverting a whole page names no element, so it comes before the lookup.
    // Resized drawings are drawn at their own size again, as their rules go.
    // Its phone layout goes too: it was made in the editor like any rule.
    if (operation.op === 'revertPage') {
        delete store[page];
        delete store[phone];
        writeStore(storeFile, store, io);
        const cssFile = writeCss(siteWork, page, store, io);
        const restored = edit.restoreDrawings(html);
        const desktop = edit.setPhoneLayout(restored.html, false);
        if (!restored.changed && !desktop.changed) return { changed: [cssFile, storeFile] };
        io.write(pageFile, desktop.html);
        return { changed: [cssFile, storeFile, pageFile] };
    }

    // Giving the page a phone layout, or taking it away: its rules, the
    // class its <html> carries and the viewport, as one edit.
    if (operation.op === 'phoneLayout') {
        // The message is just data: a map of selectors to declarations, or nothing.
        const isMap = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
        if (operation.phone && !(isMap(operation.phone) && Object.values(operation.phone).every((rule) =>
            isMap(rule) && Object.values(rule).every((value) => typeof value === 'string')))) {
            return { changed: [], error: 'that is not a phone layout; the page is kept' };
        }
        const on = Boolean(operation.phone);
        if (operation.phone) store[phone] = operation.phone;
        else delete store[phone];
        let next = edit.setPhoneLayout(html, on).html;
        if (hasRules(store, page)) next = edit.ensureStylesheet(next, hrefFromPage(page)).html;
        const cssFile = writeCss(siteWork, page, store, io);
        writeStore(storeFile, store, io);
        io.write(pageFile, next);
        return { changed: [cssFile, storeFile, pageFile] };
    }

    // Removing is answered before the lookup below: ensureSelector would mark
    // an element only to throw it away, and an id would "find" an element
    // that is not there.
    if (operation.op === 'remove') {
        const tag = edit.tagOf(html, operation.ref);
        if (!tag) return { changed: [], error: GONE };
        if (edit.PAGE_FRAME.includes(tag)) {
            return { changed: [], error: `<${tag}> is the page itself and cannot be removed; the page is kept` };
        }
        const selectors = edit.selectorsWithin(html, operation.ref);
        const removed = edit.removeElement(html, operation.ref);
        if (!removed.changed) return { changed: [], error: GONE };
        let left = removed.html;
        // The last video on the page takes the player's stylesheet and script
        // with it; undo puts them back with the rest of the page.
        // Only the player Draw2Code put there: a site's own file of that name stays.
        if (edit.usesPlayer(html) && !edit.usesPlayer(left)) {
            const player = ownPlayerLinks(left, page, (file) => io.read(path.join(siteWork, file)));
            if (player.stylesheet !== undefined) left = edit.unlinkStylesheet(left, player.stylesheet).html;
            if (player.script !== undefined) left = edit.unlinkScript(left, player.script).html;
        }
        io.write(pageFile, left);
        changed.add(pageFile);
        // Its rules go with it: left behind, they would style the next element
        // given the same id or marker number.
        const rules = edit.dropRulesFor(pageOverrides, selectors, left);
        const phoneRules = store[phone] && edit.dropRulesFor(store[phone], selectors, left);
        if (rules !== pageOverrides || phoneRules !== store[phone]) {
            if (rules !== pageOverrides) store[page] = rules;
            if (phoneRules) store[phone] = phoneRules;
            changed.add(writeCss(siteWork, page, store, io));
            writeStore(storeFile, store, io);
            changed.add(storeFile);
        }
        return { changed: [...changed], selector: selectors[0] };
    }

    if (operation.op === 'link') return applyLink(siteWork, page, html, operation, io);

    if (operation.op === 'add' && operation.markup) {
        // Checked again here, as an <img src> is: the message is just text,
        // and a link in <head> runs or styles whatever it points at.
        const stylesheets = operation.head?.stylesheets ?? [];
        const scripts = operation.head?.scripts ?? [];
        for (const [href, ext] of [...stylesheets.map((h) => [h, '.css']), ...scripts.map((h) => [h, '.js'])]) {
            const checked = checkImageSrc(String(href), page);
            if ('problem' in checked || !checked.file.toLowerCase().endsWith(ext)) {
                return { changed: [], error: `${href} is not a ${ext === '.css' ? 'stylesheet' : 'script'} inside the site; nothing is added` };
            }
        }
        html = operation.into
            ? edit.appendInto(html, operation.into, operation.markup).html
            : edit.appendToPage(html, operation.markup).html;
        for (const href of stylesheets) html = edit.ensureStylesheet(html, href).html;
        for (const src of scripts) html = edit.ensureScript(html, src).html;
    }

    const selectorResult = edit.ensureSelector(html, operation.ref);
    if (!selectorResult.selector) {
        return { changed: [], error: 'that element is no longer in the page' };
    }
    html = selectorResult.html;
    const selector = selectorResult.selector;

    // Back as the page had it: in the phone layout too. Every rule of the
    // element goes, its ":hover" and " > *" with it. Its link stays.
    if (operation.op === 'revert') {
        for (const map of [pageOverrides, store[phone] ?? {}]) {
            for (const rule of Object.keys(map)) if (edit.isOwnRule(rule, selector)) delete map[rule];
        }
        store[page] = pageOverrides;
        html = edit.restoreDrawings(html, operation.ref).html;
    }

    if (operation.op === 'text' && operation.text !== undefined) {
        html = edit.setText(html, operation.ref, operation.text).html;
    }

    // In the phone view of a page with a phone layout (see EditOp.media).
    const phoneView = operation.media === 'phone' && Boolean(store[phone]);

    // A shape Draw2Code drew is drawn again at the size it is given, so it
    // fills its box: the rule and the drawing agree. Not at a phone's size:
    // there it is stretched to its box (edit.stretchDrawings).
    if (operation.op === 'style' && operation.declarations && !phoneView) {
        html = edit.redrawShape(html, operation.ref, operation.declarations).html;
    }
    // One added to a page with a phone layout is stretched like the rest.
    if (operation.op === 'add' && store[phone]) html = edit.stretchDrawings(html, true).html;

    if (operation.declarations && phoneView) {
        const { perWidth, shared } = byWidth(operation.declarations);
        store[page] = edit.mergeOverride(pageOverrides, selector, operation.op === 'add' ? operation.desktopDeclarations ?? operation.declarations : shared);
        store[phone] = edit.mergeOverride(store[phone], selector, perWidth);
    } else if (operation.declarations) {
        store[page] = edit.mergeOverride(pageOverrides, selector, operation.declarations);
    }
    if (!store[page]) store[page] = pageOverrides;
    for (const rule of operation.extraRules ?? []) {
        store[page] = edit.mergeOverride(store[page], rule.selector, rule.declarations);
    }
    if (operation.childDeclarations) {
        store[page] = edit.mergeOverride(store[page], `${selector} > *`, operation.childDeclarations);
    }
    if (store[phone]) {
        for (const rule of operation.phoneRules ?? []) store[phone] = edit.mergeOverride(store[phone], rule.selector, rule.declarations);
    }

    // The stylesheet is only linked once there is something to say.
    if (operation.op === 'revert' || hasRules(store, page)) {
        changed.add(writeCss(siteWork, page, store, io));
    }
    if (hasRules(store, page)) {
        html = edit.ensureStylesheet(html, hrefFromPage(page)).html;
    }

    io.write(pageFile, html);
    changed.add(pageFile);
    writeStore(storeFile, store, io);
    changed.add(storeFile); // so the preview does not reload on our own write

    return { changed: [...changed], selector };
}

/**
 * A batch (see EditOp.ops): each edit applied in turn, each building on the
 * last. A refused one puts the page back as it was before the first, and
 * says why: a paste half made, or some of the selection removed, would be
 * a step nobody asked for.
 */
function applyBatch(siteWork: string, page: string, ops: EditOp[], io: FileAccess): EditResult {
    const bad = ops.find((one) => !BATCHABLE.includes(one?.op));
    if (bad) return { changed: [], error: `a ${String(bad?.op)} edit cannot be one of several; the page is kept` };
    const before = snapshotPage(siteWork, page, io);
    if (!before) return { changed: [], error: `cannot read ${page}` };
    const changed = new Set<string>();
    let selector: string | undefined;
    for (const one of ops) {
        const result = applyEdit(siteWork, page, one, io);
        if (result.error) {
            const restored = restorePage(siteWork, before, io);
            return { changed: [...new Set([...changed, ...restored])], error: result.error };
        }
        for (const file of result.changed) changed.add(file);
        selector = selector ?? result.selector;
    }
    return { changed: [...changed], selector };
}

/**
 * The link op (see EditOp.href): make a button or text a link, point a link
 * somewhere else, or take a link away. The href is checked again here - the
 * overlay's message and the page are just text - and a page of the site
 * must really be there.
 */
function applyLink(siteWork: string, page: string, html: string, operation: EditOp, io: FileAccess): EditResult {
    const found = edit.linkInfo(html, operation.ref);
    if ('problem' in found) return { changed: [], error: found.problem };
    const href = operation.href ?? '';
    if (!href) return removeLink(siteWork, page, html, operation.ref, found, io);
    const checked = checkHref(href, page);
    if ('problem' in checked) return { changed: [], error: `${checked.problem}; the page is kept` };
    if (checked.page !== undefined && !io.exists(path.join(siteWork, checked.page))) {
        return { changed: [], error: `${checked.page} is not a page of this site; the page is kept` };
    }
    const storeFile = overridesStore(siteWork);
    const store = readStore(storeFile, io);
    let rules = store[page] ?? {};
    let phoneRules = store[phoneKey(page)];
    // A section of this page with no id yet is named first: the link and its
    // name are one edit. Its rules move to its id, which names it from now on.
    let named = false;
    if (operation.anchor) {
        const name = checked.fragment;
        if (name === undefined || checked.page !== undefined) return { changed: [], error: 'only a link to a section of this page can name one; the page is kept' };
        // A name in the page already is the section's own, or nameSection refuses it.
        const ids = edit.usedIds(html);
        const problem = ids.has(name) ? undefined : checkSectionName(name, ids);
        if (problem) return { changed: [], error: `${problem}; the page is kept` };
        const section = edit.nameSection(html, operation.anchor, name);
        if ('problem' in section) return { changed: [], error: section.problem };
        html = section.html;
        named = section.changed;
        const id = edit.ensureSelector(html, { id: name }).selector;
        if (section.marker && id) {
            rules = edit.renameRules(rules, section.marker, id);
            phoneRules = phoneRules && edit.renameRules(phoneRules, section.marker, id);
        }
    }
    // The section must really be there: on this page, or on the page linked.
    if (checked.fragment !== undefined) {
        let target = html;
        try {
            if (checked.page !== undefined && checked.page !== page) target = io.read(path.join(siteWork, checked.page));
        } catch {
            return { changed: [], error: `cannot read ${checked.page}; the page is kept` };
        }
        if (!edit.usedIds(target).has(checked.fragment)) {
            return { changed: [], error: `there is no #${checked.fragment} on ${checked.page ?? 'this page'}; the page is kept` };
        }
    }
    const pageFile = path.join(siteWork, page);
    const changed = new Set<string>([pageFile]);
    /** The rules as they are now, written when naming the section moved some. */
    const keepRules = (): void => {
        if (rules === (store[page] ?? {}) && phoneRules === store[phoneKey(page)]) return;
        store[page] = rules;
        if (phoneRules) store[phoneKey(page)] = phoneRules;
        writeStore(storeFile, store, io);
        changed.add(storeFile);
        changed.add(writeCss(siteWork, page, store, io));
    };
    if (found.tag === 'a') {
        const next = edit.setHref(html, operation.ref, href);
        if (!next.changed && !named) return { changed: [] };
        keepRules();
        io.write(pageFile, next.html);
        return { changed: [...changed], selector: found.selector ?? undefined };
    }

    // A look the element's own Draw2Code rule already sets is the user's:
    // the link neither changes it nor, later, takes it away.
    const own = found.selector ? rules[found.selector] ?? {} : {};
    const looks = Object.fromEntries(Object.entries(cleanLooks(operation.declarations)).filter(([prop]) => own[prop] === undefined));
    if (Object.keys(looks).length === 0) {
        const linked = edit.makeLink(html, operation.ref, href);
        if (!linked.changed) return { changed: [], error: GONE };
        keepRules();
        io.write(pageFile, linked.html);
        return { changed: [...changed], selector: found.selector ?? undefined };
    }
    const ensured = edit.ensureSelector(html, operation.ref);
    if (!ensured.selector) return { changed: [], error: GONE };
    const sheet = hrefFromPage(page);
    // The stylesheet link goes in <head>; the ref counts from <body>, so it still finds the element.
    const sheeted = edit.ensureStylesheet(ensured.html, sheet);
    const linked = edit.makeLink(sheeted.html, operation.ref, href, { looks, marker: ensured.changed, stylesheet: sheeted.changed });
    if (!linked.changed) return { changed: [], error: GONE };
    store[page] = edit.mergeOverride(rules, ensured.selector, looks);
    if (phoneRules) store[phoneKey(page)] = phoneRules;
    const cssFile = writeCss(siteWork, page, store, io);
    writeStore(storeFile, store, io);
    io.write(pageFile, linked.html);
    return { changed: [pageFile, cssFile, storeFile], selector: ensured.selector };
}

/**
 * Take a link away, and with it exactly what making it added: the looks it
 * wrote (only while they are still what it wrote - a colour picked since is
 * the user's), the marker and the stylesheet link when nothing else needs
 * them. A link Draw2Code made then reads byte for byte as it did before.
 */
function removeLink(siteWork: string, page: string, html: string, ref: edit.ElementRef, found: edit.LinkInfo, io: FileAccess): EditResult {
    if (found.tag !== 'a' || found.href === undefined) return { changed: [], error: `the <${found.tag}> is not a link; the page is kept` };
    const pageFile = path.join(siteWork, page);
    const storeFile = overridesStore(siteWork);
    const store = readStore(storeFile, io);
    const rules = store[page] ?? {};
    const selector = found.selector;
    let next = rules;
    if (selector) {
        const own = rules[selector] ?? {};
        const added = Object.keys(found.looks).filter((prop) => own[prop] === found.looks[prop]);
        if (added.length > 0) next = edit.mergeOverride(rules, selector, Object.fromEntries(added.map((prop) => [prop, ''])));
    }
    // A marker the link added goes too, unless a rule still needs it
    // (a colour picked for the link since, say). '[data-d2c="1"]' is not
    // the start of '[data-d2c="10"]': the quote ends it.
    const markerRule = found.was?.marker && selector?.startsWith(`[${edit.MARKER_ATTR}=`) ? selector : null;
    const dropMarker = Boolean(markerRule && !Object.keys(next).some((rule) => rule.startsWith(markerRule)));
    let out = edit.unlink(html, ref, dropMarker).html;
    const changed = [pageFile];
    const written = pageCss(store, page);
    const empty = Object.keys(next).length === 0;
    if (next !== rules) {
        if (empty) delete store[page];
        else store[page] = next;
        // As restorePage does: a store the link made goes with its last rule.
        if (Object.keys(store).length === 0 && !disk.exists(storeFile)) io.remove(storeFile);
        else writeStore(storeFile, store, io);
        changed.push(storeFile);
    }
    const cssFile = path.join(siteWork, cssPathFor(page));
    // The link brought the stylesheet, and nothing is left in it - only
    // while the file holds what the store says: rules copied in by a
    // Publish and forgotten by a Reset are still the page's.
    const ownCss = !io.exists(cssFile) || io.read(cssFile) === written;
    if (found.was?.stylesheet && !hasRules(store, page) && ownCss) {
        out = edit.unlinkStylesheet(out, hrefFromPage(page)).html;
        io.remove(cssFile);
        changed.push(cssFile);
    } else if (next !== rules) {
        changed.push(writeCss(siteWork, page, store, io));
    }
    io.write(pageFile, out);
    return { changed, selector: selector ?? undefined };
}
