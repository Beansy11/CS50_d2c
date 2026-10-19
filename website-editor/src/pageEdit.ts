// Editing an existing page without rewriting it.
//
// The rule for site mode: an imported page keeps its own structure,
// classes, stylesheets and scripts. So Draw2Code never re-serializes the file.
// It parses it for POSITIONS (parse5 source locations) and splices small
// changes into the exact bytes:
//
//   - give an element a stable selector: its own id/class when it has one,
//     otherwise a small data-d2c="N" marker added to that tag
//   - write what changed into a separate stylesheet (draw2code.css), linked
//     last in <head> so it wins over the page's own rules
//   - link a shared stylesheet or script a new element needs (the video
//     player's), and take it away again with the last element that used it
//   - change text in place, between an element's tags
//   - append new elements before </body> (or, on a page made in Draw2Code,
//     inside its <div class="page"> wrapper)
//   - take an element out, markup and all (never <html>, <head> or <body>)
//   - make an element a link and back: only its tag names and a few
//     attributes change, so removing the link gives back the same bytes
//   - draw a shape Draw2Code drew again at the size it is resized to: only
//     the numbers in its <svg> and its shape change
//   - make an element of a page made in Draw2Code full width and back: a
//     class on it (and, on a drawing, the attribute that stretches it)
//   - name an element as a section a link can go to: an id on it
//   - set an input's placeholder: the attribute, in place
//   - copy an element, markup and all, so it can be placed again on this
//     page or another one (src/copyPaste.ts gives it its new ids)
//
// Everything here is pure string in, string out, so it is unit-tested
// (test/pageEdit.test.js, and test/links.test.js for links) and never
// needs VS Code.
//
// CS50 citation: the name Draw2Code Web Editor was chosen with help from
// Claude (Anthropic AI), and at my direction Claude renamed
// the project from its earlier name, HardHat Designer, throughout this file.

import * as parse5 from 'parse5';
import { LINKABLE, linkableId, looksText, notLinkable, parseLooks, sectionName } from './links';
import { drawnShape, redrawn } from './redraw';
import { PHONE_BREAKPOINT, PHONE_LAYOUT_CLASS } from './pageWidth';

/** What an edit says when the element it names is not in the page file. */
const GONE_TEXT = 'that element is no longer in the page; the page is kept';

/** Attribute added only when an element has no usable id of its own. */
export const MARKER_ATTR = 'data-d2c';

/**
 * On a link Draw2Code made: what the element was, so removing the link puts
 * it back exactly - its tag as written, then what the link added besides the
 * href ("marker", "stylesheet"), then the type attribute it took away, as
 * written: data-d2c-was="button stylesheet type=&quot;button&quot;".
 */
export const LINK_WAS_ATTR = 'data-d2c-was';

/** On a link Draw2Code made: the declarations it wrote so the element keeps its look ("display: inline-flex; color: rgb(0, 0, 0)"). */
export const LINK_LOOKS_ATTR = 'data-d2c-looks';

/** The generated stylesheet, relative to the site root. */
export const OVERRIDES_FILE = 'draw2code.css';

/** How the overlay names an element: its id, or its position in the page. */
export interface ElementRef {
    id?: string;
    /** Indices among element children, from <body> down. */
    path?: number[];
    /** The <body> itself (a path cannot name it). */
    body?: boolean;
}

export type Declarations = Record<string, string>;
export type Overrides = Record<string, Declarations>;

type Node = {
    tagName?: string;
    nodeName: string;
    attrs?: { name: string; value: string }[];
    /** A comment's text. */
    data?: string;
    /** Where an element belongs: HTML, or SVG and MathML (foreign content). */
    namespaceURI?: string;
    childNodes?: Node[];
    /** The element it sits in; the document has none. */
    parentNode?: Node;
    sourceCodeLocation?: {
        startOffset: number;
        endOffset: number;
        startTag?: { startOffset: number; endOffset: number; attrs?: Record<string, { startOffset: number; endOffset: number }> };
        endTag?: { startOffset: number; endOffset: number };
        attrs?: Record<string, { startOffset: number; endOffset: number }>;
    };
};

/** parse5's namespace for plain HTML elements; SVG and MathML have their own. */
const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

function parse(html: string): Node {
    return parse5.parse(html, { sourceCodeLocationInfo: true }) as unknown as Node;
}

function elementChildren(node: Node): Node[] {
    return (node.childNodes ?? []).filter((child) => Boolean(child.tagName));
}

function findTag(node: Node, tagName: string): Node | null {
    if (node.tagName === tagName) return node;
    for (const child of node.childNodes ?? []) {
        const found = findTag(child, tagName);
        if (found) return found;
    }
    return null;
}

function attr(node: Node, name: string): string | undefined {
    return node.attrs?.find((a) => a.name === name)?.value;
}

function walkElements(node: Node, visit: (el: Node) => void): void {
    if (node.tagName) visit(node);
    for (const child of node.childNodes ?? []) walkElements(child, visit);
}

/** The element at `path`, counting only element children, starting at <body>. */
export function findByPath(html: string, path: number[]): Node | null {
    const body = findTag(parse(html), 'body');
    if (!body) return null;
    let node: Node = body;
    for (const index of path) {
        const children = elementChildren(node);
        if (index < 0 || index >= children.length) return null;
        node = children[index];
    }
    return node === body ? null : node;
}

/** One past the largest data-d2c marker already in the page. */
export function nextMarker(html: string): number {
    let max = 0;
    walkElements(parse(html), (el) => {
        const value = Number(attr(el, MARKER_ATTR));
        if (Number.isFinite(value)) max = Math.max(max, value);
    });
    return max + 1;
}

/**
 * A CSS selector that will still point at this element later, adding a
 * marker attribute to the page only when the element has no id of its own.
 */
export function ensureSelector(html: string, ref: ElementRef): { html: string; selector: string | null; changed: boolean } {
    if (ref.id) return { html, selector: `#${cssEscape(ref.id)}`, changed: false };

    const node = ref.path ? findByPath(html, ref.path) : null;
    if (!node || !node.sourceCodeLocation?.startTag) return { html, selector: null, changed: false };

    const existingId = attr(node, 'id');
    if (existingId) return { html, selector: `#${cssEscape(existingId)}`, changed: false };

    const existingMarker = attr(node, MARKER_ATTR);
    if (existingMarker) return { html, selector: `[${MARKER_ATTR}="${existingMarker}"]`, changed: false };

    const marker = String(nextMarker(html));
    const insertAt = attrsEnd(html, node.sourceCodeLocation.startTag);
    const spliced = `${html.slice(0, insertAt)} ${MARKER_ATTR}="${marker}"${html.slice(insertAt)}`;
    return { html: spliced, selector: `[${MARKER_ATTR}="${marker}"]`, changed: true };
}

/** Replace what is between an element's tags with plain text. Its line breaks stay real newlines. */
export function setText(html: string, ref: ElementRef, text: string): { html: string; changed: boolean } {
    const node = ref.id ? findById(html, ref.id) : ref.path ? findByPath(html, ref.path) : null;
    const location = node?.sourceCodeLocation;
    if (!node || !location?.startTag || !location.endTag) return { html, changed: false };
    const before = html.slice(0, location.startTag.endOffset);
    const after = html.slice(location.endTag.startOffset);
    // A browser drops the newline straight after <pre>, so text that starts
    // on a new line gets one more, or its empty first line would be lost.
    const lead = node.tagName === 'pre' && text.startsWith('\n') ? '\n' : '';
    const inner = lead + escapeText(text);
    if (html.slice(location.startTag.endOffset, location.endTag.startOffset) === inner) {
        return { html, changed: false };
    }
    return { html: before + inner + after, changed: true };
}

function findById(html: string, id: string): Node | null {
    let found: Node | null = null;
    walkElements(parse(html), (el) => {
        if (!found && attr(el, 'id') === id) found = el;
    });
    return found;
}

/** Link the overrides stylesheet last in <head>, so it wins over the page. */
export function ensureStylesheet(html: string, href: string): { html: string; changed: boolean } {
    const doc = parse(html);
    const head = findTag(doc, 'head');
    const link = `<link rel="stylesheet" href="${escapeAttr(href)}">`;

    let alreadyLinked = false;
    walkElements(doc, (el) => {
        if (el.tagName === 'link' && attr(el, 'href') === href) alreadyLinked = true;
    });
    if (alreadyLinked) return { html, changed: false };

    if (head?.sourceCodeLocation?.endTag) {
        const at = head.sourceCodeLocation.endTag.startOffset;
        return { html: `${html.slice(0, at)}    ${link}\n${html.slice(at)}`, changed: true };
    }
    const body = findTag(doc, 'body');
    const at = body?.sourceCodeLocation?.startTag?.startOffset ?? 0;
    return { html: `${html.slice(0, at)}${link}\n${html.slice(at)}`, changed: true };
}

/**
 * The viewport a page with a phone layout asks for: as wide as the phone.
 * Every page Draw2Code made before pages shrank to fit had it, so taking
 * the phone layout away leaves it for Publish to set the page width again
 * (pageWidth.ts setViewportWidth).
 */
export const PHONE_VIEWPORT = 'width=device-width, initial-scale=1.0';

/**
 * Give a page a phone layout, or take it away: PHONE_LAYOUT_CLASS on its
 * <html>, which the shared stylesheet's phone rules wait for, and with it
 * the viewport a phone lays the page out at its own width for.
 */
export function setPhoneLayout(html: string, on: boolean): { html: string; changed: boolean } {
    const doc = parse(html);
    const root = findTag(doc, 'html');
    if (!root?.sourceCodeLocation?.startTag) return { html, changed: false };
    const edits: Array<{ from: number; to: number; text: string }> = [];
    const classes = (attr(root, 'class') ?? '').split(/\s+/).filter(Boolean);
    if (classes.includes(PHONE_LAYOUT_CLASS) !== on) {
        const rest = classes.filter((name) => name !== PHONE_LAYOUT_CLASS);
        edits.push(...attrEdits(html, root, { class: on ? [...rest, PHONE_LAYOUT_CLASS].join(' ') : rest.length ? rest.join(' ') : null }));
    }
    if (on) {
        let meta: Node | null = null;
        walkElements(doc, (el) => {
            if (!meta && el.tagName === 'meta' && (attr(el, 'name') ?? '').toLowerCase() === 'viewport') meta = el;
        });
        const head = findTag(doc, 'head');
        if (meta) {
            if (attr(meta, 'content') !== PHONE_VIEWPORT) edits.push(...attrEdits(html, meta, { content: PHONE_VIEWPORT }));
        } else if (head?.sourceCodeLocation?.startTag) {
            const at = head.sourceCodeLocation.startTag.endOffset;
            edits.push({ from: at, to: at, text: `\n  <meta name="viewport" content="${PHONE_VIEWPORT}">` });
        }
    }
    const out = stretchDrawings(edits.length ? splice(html, edits) : html, on).html;
    return { html: out, changed: out !== html };
}

/**
 * Every drawing Draw2Code drew on the page stretched to its box, or no
 * longer. On a page with a phone layout an element has two boxes and its
 * drawing is drawn at the desktop one: there it fits exactly, and at the
 * phone's it is stretched to fit (a resize in the phone view does not draw
 * it again). A full-width drawing stays stretched either way.
 */
export function stretchDrawings(html: string, on: boolean): { html: string; changed: boolean } {
    const edits: Array<{ from: number; to: number; text: string }> = [];
    walkElements(parse(html), (el) => {
        const found = el.tagName === 'svg' ? drawingOf(el) : null;
        if (!found) return;
        const full = (attr(el, 'class') ?? '').split(/\s+/).includes(FULL_WIDTH_CLASS);
        const want = on || full ? 'none' : null;
        if ((attr(el, 'preserveAspectRatio') ?? null) !== want) edits.push(...attrEdits(html, el, { preserveAspectRatio: want }));
    });
    if (edits.length === 0) return { html, changed: false };
    return { html: splice(html, edits), changed: true };
}

/** The page without its phone layout's class: as the editor's desktop view shows it, in any panel. */
export function withoutPhoneClass(html: string): string {
    const root = findTag(parse(html), 'html');
    if (!root?.sourceCodeLocation?.startTag) return html;
    const classes = (attr(root, 'class') ?? '').split(/\s+/).filter(Boolean);
    if (!classes.includes(PHONE_LAYOUT_CLASS)) return html;
    const rest = classes.filter((name) => name !== PHONE_LAYOUT_CLASS);
    return splice(html, attrEdits(html, root, { class: rest.length ? rest.join(' ') : null }));
}

/** Does the page have a phone layout (PHONE_LAYOUT_CLASS on its <html>)? */
export function hasPhoneLayout(html: string): boolean {
    const root = findTag(parse(html), 'html');
    return Boolean(root && (attr(root, 'class') ?? '').split(/\s+/).includes(PHONE_LAYOUT_CLASS));
}

/** Link a script in <head>, once, deferred so it runs once the page is read: the video player's. */
export function ensureScript(html: string, src: string): { html: string; changed: boolean } {
    const doc = parse(html);
    let alreadyLinked = false;
    walkElements(doc, (el) => {
        if (el.tagName === 'script' && attr(el, 'src') === src) alreadyLinked = true;
    });
    if (alreadyLinked) return { html, changed: false };
    const tag = `<script src="${escapeAttr(src)}" defer></script>`;
    const head = findTag(doc, 'head');
    if (head?.sourceCodeLocation?.endTag) {
        const at = head.sourceCodeLocation.endTag.startOffset;
        return { html: `${html.slice(0, at)}    ${tag}\n${html.slice(at)}`, changed: true };
    }
    const body = findTag(doc, 'body');
    const at = body?.sourceCodeLocation?.startTag?.startOffset ?? 0;
    return { html: `${html.slice(0, at)}${tag}\n${html.slice(at)}`, changed: true };
}

/** The class a video file's box has: the site's video player is drawn in it (media/site/video-player.js). */
export const PLAYER_CLASS = 'video-player';

/** Does any element of the page hold a video file in the player: a <div class="video-player">? */
export function usesPlayer(html: string): boolean {
    let found = false;
    walkElements(parse(html), (el) => {
        if (!found && el.tagName === 'div' && (attr(el, 'class') ?? '').split(/\s+/).includes(PLAYER_CLASS)) found = true;
    });
    return found;
}

/**
 * The video player's stylesheet and script the page links already, as
 * written: "../css/video-player.css", "js/video-player-2.js". A video added
 * to the page uses those, so no page loads the player twice. `ours` says
 * whether a link of that name really is Draw2Code's player (see
 * ownPlayerLinks in src/videos.ts); without it, the name is enough.
 */
export function playerLinks(html: string, ours: (link: string) => boolean = () => true): { stylesheet?: string; script?: string } {
    const out: { stylesheet?: string; script?: string } = {};
    const named = (value: string | undefined, ext: string): boolean =>
        new RegExp(`(^|/)${PLAYER_CLASS}(-\\d+)?\\.${ext}$`, 'i').test((value ?? '').split(/[?#]/)[0]) && ours(value ?? '');
    walkElements(parse(html), (el) => {
        const rel = (attr(el, 'rel') ?? '').toLowerCase().split(/\s+/);
        if (el.tagName === 'link' && rel.includes('stylesheet') && out.stylesheet === undefined && named(attr(el, 'href'), 'css')) out.stylesheet = attr(el, 'href');
        if (el.tagName === 'script' && out.script === undefined && named(attr(el, 'src'), 'js')) out.script = attr(el, 'src');
    });
    return out;
}

/**
 * A new page that belongs to this site: the source page's <head> (its
 * stylesheets, fonts and meta) and its nav or header, with an empty body -
 * and, from a page made in Draw2Code, an empty page wrapper, so what is
 * placed freely on the new page goes in it too (see appendToPage).
 *
 * For `+`: a blank page that ignores the site's stylesheet
 * is a page you have to repair before you can use it. Draw2Code's OWN
 * stylesheet is left out - the new page has no overrides yet, and that file
 * belongs to the page it was written for.
 */
export function newPageFrom(html: string, title: string): string {
    const doc = parse(html);
    const head = findTag(doc, 'head');
    const body = findTag(doc, 'body');

    let headInner = '';
    if (head?.sourceCodeLocation?.startTag && head.sourceCodeLocation.endTag) {
        headInner = html.slice(head.sourceCodeLocation.startTag.endOffset, head.sourceCodeLocation.endTag.startOffset);
    }
    // Drop the old <title> (this page names itself) and Draw2Code's stylesheet.
    headInner = headInner
        .replace(/[ \t]*<title[^>]*>[\s\S]*?<\/title>[ \t]*\r?\n?/gi, '')
        .replace(/[ \t]*<link\b[^>]*href\s*=\s*(["'])[^"']*draw2code\/[^"']*\1[^>]*>[ \t]*\r?\n?/gi, '')
        .replace(/^\s*\n/, '')
        .replace(/\s+$/, '');

    // The site's own banner, if it has one, so the page is recognisable.
    let banner = '';
    const isBanner = (el: Node): boolean => {
        if (el.tagName === 'nav' || el.tagName === 'header') return true;
        const names = `${attr(el, 'class') ?? ''} ${attr(el, 'id') ?? ''}`.toLowerCase();
        return /\b(nav|navbar|header|masthead|topbar)\b/.test(names);
    };
    for (const child of elementChildren(body ?? { nodeName: 'body' })) {
        if (!isBanner(child) || !child.sourceCodeLocation) continue;
        banner = html.slice(child.sourceCodeLocation.startOffset, child.sourceCodeLocation.endOffset);
        break;
    }

    const wrapper = generatedWrapper(doc) ? ['  <div class="page">', '  </div>'] : [];

    const lang = attr(findTag(doc, 'html') ?? { nodeName: 'html' }, 'lang');
    return [
        '<!DOCTYPE html>',
        `<html${lang ? ` lang="${escapeAttr(lang)}"` : ''}>`,
        '<head>',
        `  <title>${escapeText(title)}</title>`,
        headInner,
        '</head>',
        '<body>',
        banner,
        ...wrapper,
        '</body>',
        '</html>',
        '',
    ].filter((line, i) => line !== '' || i > 7).join('\n');
}

/**
 * Set a page's <title> - what its tab shows. Only the text between the tags
 * changes; a page without a title gets one at the top of its <head>.
 */
export function setTitle(html: string, title: string): { html: string; changed: boolean } {
    const doc = parse(html);
    const text = escapeText(title);
    const el = findTag(doc, 'title');
    const loc = el?.sourceCodeLocation;
    if (loc?.startTag && loc.endTag) {
        const from = loc.startTag.endOffset;
        const to = loc.endTag.startOffset;
        if (html.slice(from, to) === text) return { html, changed: false };
        return { html: html.slice(0, from) + text + html.slice(to), changed: true };
    }
    const tag = `<title>${text}</title>`;
    // A <head> parse5 made up has no location: only a real one can be written into.
    const at = findTag(doc, 'head')?.sourceCodeLocation?.startTag?.endOffset;
    if (at !== undefined) return { html: `${html.slice(0, at)}\n    ${tag}${html.slice(at)}`, changed: true };
    return { html: `${tag}\n${html}`, changed: true };
}

/** A <link> to one of Draw2Code's own per-page stylesheets. */
function isDraw2CodeStylesheet(el: Node): boolean {
    return el.tagName === 'link' && /(^|\/)draw2code\/[^/]+(\/[^/]+)*\.css$/i.test((attr(el, 'href') ?? '').split(/[?#]/)[0]);
}

/**
 * The published page: Draw2Code taken out, the page otherwise byte
 * for byte what it was.
 *   - a data-d2c="N" marker becomes an ordinary id (ids-for maps N to it), so
 *     the rules written for that element still have something to point at
 *   - <link>s to draw2code/<page>.css go (their rules are moved into the
 *     site's own stylesheet)
 *   - the "Generated by Draw2Code Web Editor" comment goes
 *   - <body> carries the page's scope class, which the moved rules use
 *   - a link Draw2Code made keeps its href but not what it remembers
 *     (data-d2c-was, data-d2c-looks): published, it is just a link
 *   - a resized drawing keeps its new size but not the one it was drawn at
 *     (data-d2c-drawn)
 */
export function stripDraw2Code(html: string, scope: string): { html: string; idsFor: Record<string, string> } {
    const doc = parse(html);
    const taken = usedIds(html);
    const idsFor: Record<string, string> = {};
    const edits: Array<{ from: number; to: number; text: string }> = [];

    walkElements(doc, (el) => {
        const loc = el.sourceCodeLocation;
        if (!loc) return;
        const marker = attr(el, MARKER_ATTR);
        const markerLoc = loc.attrs?.[MARKER_ATTR] ?? loc.startTag?.attrs?.[MARKER_ATTR];
        if (marker !== undefined && markerLoc) {
            let id = attr(el, 'id');
            if (id) {
                // Already has an id: only the marker goes (with the space before it).
                edits.push({ from: markerLoc.startOffset - 1, to: markerLoc.endOffset, text: '' });
            } else {
                let n = Number(marker) || 1;
                do { id = `${el.tagName}-${n++}`; } while (taken.has(id));
                taken.add(id);
                edits.push({ from: markerLoc.startOffset, to: markerLoc.endOffset, text: `id="${escapeAttr(id)}"` });
            }
            idsFor[marker] = id;
        }
        for (const name of [LINK_WAS_ATTR, LINK_LOOKS_ATTR, DRAWN_ATTR]) {
            const at = loc.attrs?.[name] ?? loc.startTag?.attrs?.[name];
            if (at) edits.push({ from: /\s/.test(html[at.startOffset - 1]) ? at.startOffset - 1 : at.startOffset, to: at.endOffset, text: '' });
        }
        if (isDraw2CodeStylesheet(el)) {
            // The whole tag, and the indentation and line break around it.
            let from = loc.startOffset;
            while (from > 0 && (html[from - 1] === ' ' || html[from - 1] === '\t')) from--;
            let to = loc.endOffset;
            if (html[to] === '\r') to++;
            if (html[to] === '\n') to++;
            edits.push({ from, to, text: '' });
        }
        if (el.tagName === 'body' && loc.startTag) {
            const classLoc = loc.attrs?.class ?? loc.startTag.attrs?.class;
            const classes = (attr(el, 'class') ?? '').split(/\s+/).filter(Boolean);
            if (!classes.includes(scope)) {
                if (classLoc) {
                    edits.push({ from: classLoc.startOffset, to: classLoc.endOffset, text: `class="${escapeAttr([...classes, scope].join(' '))}"` });
                } else {
                    const at = loc.startTag.endOffset - 1; // before the ">"
                    edits.push({ from: at, to: at, text: ` class="${escapeAttr(scope)}"` });
                }
            }
        }
    });

    const out = splice(html, edits).replace(/[ \t]*<!--\s*Generated by Draw2Code Web Editor\s*-->[ \t]*\r?\n?/gi, '');
    return { html: out, idsFor };
}

/** Add markup just before </body>. */
export function appendToBody(html: string, markup: string): { html: string; changed: boolean } {
    const body = findTag(parse(html), 'body');
    const at = body?.sourceCodeLocation?.endTag?.startOffset;
    if (at === undefined) return { html: `${html}\n${markup}\n`, changed: true };
    return { html: `${html.slice(0, at)}    ${markup}\n${html.slice(at)}`, changed: true };
}

/**
 * The wrapper a page made in Draw2Code holds everything in: <body>'s first
 * element, <div class="page">, on a page that says it was generated. An
 * imported page with a <div class="page"> of its own is not one: its own
 * rules for it could move or centre what is put inside.
 */
function generatedWrapper(doc: Node): Node | null {
    let generated = false;
    const visit = (node: Node): void => {
        if (node.nodeName === '#comment' && node.data?.trim() === 'Generated by Draw2Code Web Editor') generated = true;
        for (const child of node.childNodes ?? []) if (!generated) visit(child);
    };
    visit(doc);
    const body = findTag(doc, 'body');
    const first = body ? elementChildren(body)[0] : undefined;
    if (!generated || first?.tagName !== 'div' || attr(first, 'class') !== 'page') return null;
    return first;
}

/**
 * Add an element placed freely. On a page made in Draw2Code it goes last
 * inside the page's wrapper, like everything the generator wrote, so the
 * generator's rules for the wrapper's children reach it too (the box that
 * includes its border, the page's font, no margin, a shape's border not cut
 * off). The wrapper is position: relative at the page's top-left, so left
 * and top mean the same inside it as on <body>. Any other page gets it
 * before </body>, as appendToBody does - and so does a page that already
 * has elements placed after the wrapper (by an older Draw2Code): the new
 * one has to come after those, or it would be drawn under them.
 */
export function appendToPage(html: string, markup: string): { html: string; changed: boolean } {
    const at = freeWrapper(parse(html))?.sourceCodeLocation?.endTag?.startOffset;
    if (at === undefined) return appendToBody(html, markup);
    // On a line of its own when the </div> is, indented like the generator's elements.
    const lineStart = html.lastIndexOf('\n', at - 1) + 1;
    if (/^[ \t]*$/.test(html.slice(lineStart, at))) {
        return { html: `${html.slice(0, lineStart)}    ${markup}\n${html.slice(lineStart)}`, changed: true };
    }
    return { html: `${html.slice(0, at)}${markup}${html.slice(at)}`, changed: true };
}

/** The wrapper appendToPage puts an element placed freely in, or null when it goes before </body>. */
function freeWrapper(doc: Node): Node | null {
    const wrapper = generatedWrapper(doc);
    const body = findTag(doc, 'body');
    const after = body ? elementChildren(body).slice(1).filter((el) => el.tagName !== 'script') : [];
    return after.length === 0 ? wrapper : null;
}

/**
 * Does an element placed freely on this page go inside its wrapper (see
 * appendToPage)? Then its left and top are measured from the wrapper's
 * top-left, which is centred in the window, not from the page's.
 */
export function placesInWrapper(html: string): boolean {
    return freeWrapper(parse(html)) !== null;
}

/** The class a full-width element has. The SAME as media/generators/html.js FULL_WIDTH (a test holds them together). */
export const FULL_WIDTH_CLASS = 'full-width';

/**
 * Make an element full width, or put it back in the page's column: on a
 * page made in Draw2Code, an element in its wrapper (see appendToPage)
 * gets the class the generator's rule stretches across the whole window,
 * and a drawing Draw2Code drew also the attribute that lets its picture
 * stretch with it. Its own left and width stay in its rule, so taking the
 * class away puts it back where it was. Anything else says why not.
 */
export function setFullWidth(html: string, ref: ElementRef, on: boolean): { html: string; changed: boolean } | { problem: string } {
    const node = findNode(html, ref);
    const loc = node?.sourceCodeLocation;
    if (!node?.tagName || !loc?.startTag) return { problem: GONE_TEXT };
    const wrapper = generatedWrapper(parse(html));
    if (!wrapper?.sourceCodeLocation || node.parentNode?.sourceCodeLocation?.startOffset !== wrapper.sourceCodeLocation.startOffset) {
        return { problem: 'only an element placed freely on a page made in Draw2Code can be full width; the page is kept' };
    }
    const classes = (attr(node, 'class') ?? '').split(/\s+/).filter(Boolean);
    if (classes.includes(FULL_WIDTH_CLASS) === on) return { html, changed: false };
    const rest = classes.filter((name) => name !== FULL_WIDTH_CLASS);
    const edits = attrEdits(html, node, { class: on ? [...classes, FULL_WIDTH_CLASS].join(' ') : rest.length ? rest.join(' ') : null });
    const drawing = drawingOf(node);
    // On a page with a phone layout every drawing is stretched already (stretchDrawings).
    if (drawing) edits.push(...attrEdits(html, drawing.svg, { preserveAspectRatio: on || hasPhoneLayout(html) ? 'none' : null }));
    return { html: splice(html, mergeEdits(edits)), changed: true };
}

/** Edits to one start tag: two that add attributes at the same place become one, in order. */
function mergeEdits(edits: Array<{ from: number; to: number; text: string }>): Array<{ from: number; to: number; text: string }> {
    const out: Array<{ from: number; to: number; text: string }> = [];
    for (const e of edits) {
        const same = out.find((o) => o.from === e.from && o.to === e.to && o.from === o.to);
        if (same && e.from === e.to) same.text += e.text;
        else out.push({ ...e });
    }
    return out;
}

/**
 * Add markup as the LAST CHILD of an element - "add to this section": the
 * new element takes its place in that section's flow, and the page lays it
 * out like anything else there. A tag that cannot hold children (an <img>,
 * an <input>) falls back to the end of <body>.
 */
export function appendInto(html: string, ref: ElementRef, markup: string): { html: string; changed: boolean } {
    if (ref.body) return appendToBody(html, markup);
    const node = ref.id ? findById(html, ref.id) : ref.path ? findByPath(html, ref.path) : null;
    const at = node?.sourceCodeLocation?.endTag?.startOffset;
    if (at === undefined) return appendToBody(html, markup);
    return { html: `${html.slice(0, at)}${markup}${html.slice(at)}`, changed: true };
}

/** Every id in the page, so a new element can be given one nobody has. */
export function usedIds(html: string): Set<string> {
    const ids = new Set<string>();
    walkElements(parse(html), (el) => {
        const id = attr(el, 'id');
        if (id) ids.add(id);
    });
    return ids;
}

/** Every link's href in the page, as the file has it: ["about.html", "#top", "https://example.com"]. */
export function linkHrefs(html: string): string[] {
    const hrefs: string[] = [];
    walkElements(parse(html), (el) => {
        const href = el.tagName === 'a' ? attr(el, 'href') : undefined;
        if (href !== undefined) hrefs.push(href);
    });
    return hrefs;
}

/** The tags that ARE the page: without one there is no page left to edit. */
export const PAGE_FRAME: readonly string[] = ['html', 'head', 'body'];

/** The tag an element ref names: { body: true } or { path: [] } -> "body"; null when it is not in the page. */
export function tagOf(html: string, ref: ElementRef): string | null {
    if (ref.body || (!ref.id && ref.path?.length === 0)) return 'body';
    const node = ref.id ? findById(html, ref.id) : ref.path ? findByPath(html, ref.path) : null;
    return node?.tagName ?? null;
}

/**
 * Remove an element, markup and all. The page itself - <html>, <head>,
 * <body> - is never removed, whatever the ref says: one Backspace must not
 * leave an empty file. An element alone on its line takes the line with it,
 * so no blank indented line is left behind.
 */
export function removeElement(html: string, ref: ElementRef): { html: string; changed: boolean } {
    const node = ref.id ? findById(html, ref.id) : ref.path ? findByPath(html, ref.path) : null;
    const location = node?.sourceCodeLocation;
    if (!node || !location || PAGE_FRAME.includes(node.tagName ?? '')) return { html, changed: false };
    let before = html.slice(0, location.startOffset);
    let after = html.slice(location.endTag?.endOffset ?? location.endOffset);
    const indent = /\n([ \t]*)$/.exec(before);
    const lineEnd = /^[ \t]*\r?\n/.exec(after);
    if (indent && lineEnd) {
        before = before.slice(0, before.length - indent[1].length);
        after = after.slice(lineEnd[0].length);
    }
    return { html: before + after, changed: true };
}

/**
 * Every selector Draw2Code could have written for an element or anything
 * inside it: "#id" and '[data-d2c="N"]'. Removing the element takes these
 * rules away too (see dropRulesFor).
 */
export function selectorsWithin(html: string, ref: ElementRef): string[] {
    const node = ref.id ? findById(html, ref.id) : ref.path ? findByPath(html, ref.path) : null;
    if (!node) return [];
    const selectors: string[] = [];
    walkElements(node, (el) => { selectors.push(...ownSelectors(el)); });
    return selectors;
}

/** The selectors Draw2Code could have written for ONE element: "#id", '[data-d2c="N"]'. */
function ownSelectors(el: Node): string[] {
    const id = attr(el, 'id');
    const marker = attr(el, MARKER_ATTR);
    return [
        ...(id ? [`#${cssEscape(id)}`] : []),
        ...(marker ? [`[${MARKER_ATTR}="${marker}"]`] : []),
    ];
}

/** What may follow an element's own selector in a rule that is still only ITS rule: ":hover", "::placeholder", " > *". */
export const OWN_RULE_SUFFIX = /^(::?[A-Za-z-]+(\([^()]*\))?)*( > \*)?$/;

/** Whether a rule is one of the element's own: "#button-1", "#button-1:hover", "#button-1 > *"; not "#button-10". */
export function isOwnRule(rule: string, selector: string): boolean {
    return rule.startsWith(selector) && OWN_RULE_SUFFIX.test(rule.slice(selector.length));
}

/**
 * The overrides without the rules of elements that are gone: each selector's
 * own rule, and the ones that are that selector plus a pseudo-class,
 * pseudo-element or " > *" ("#button-1:hover", "#button-1::placeholder",
 * "#button-1 > *"). Left alone: another element whose name merely starts the
 * same (#button-10), and a selector still in `html` (an id used twice), whose
 * rules still style what is left. A rule left behind would style the next
 * element given that id or marker number.
 */
export function dropRulesFor(overrides: Overrides, selectors: string[], html: string): Overrides {
    const left = new Set<string>();
    walkElements(parse(html), (el) => { for (const selector of ownSelectors(el)) left.add(selector); });
    const gone = selectors.filter((selector) => !left.has(selector));
    const isGone = (rule: string): boolean =>
        gone.some((selector) => isOwnRule(rule, selector));
    const next: Overrides = {};
    for (const [rule, declarations] of Object.entries(overrides)) {
        if (!isGone(rule)) next[rule] = declarations;
    }
    return Object.keys(next).length === Object.keys(overrides).length ? overrides : next;
}

// A rectangle, an ellipse, a line or a pen stroke Draw2Code drew is an
// inline <svg> whose viewBox is its size. A resize draws it again at the
// new size (src/redraw.ts): only the numbers in its two tags change. The
// size it was drawn at is written on it (DRAWN_ATTR), so Revert element and
// Revert page draw it at that size again, to match the rules they leave.

/** On a drawing Draw2Code resized: the width and height it had before, "160 80". */
export const DRAWN_ATTR = 'data-d2c-drawn';

/** The splices that set attributes on one tag, or with null take one away (and the space before it). */
function attrEdits(html: string, node: Node, values: Record<string, string | null>): Array<{ from: number; to: number; text: string }> {
    const loc = node.sourceCodeLocation;
    if (!loc?.startTag) return [];
    const edits: Array<{ from: number; to: number; text: string }> = [];
    let added = '';
    for (const [name, value] of Object.entries(values)) {
        // parse5 keys where an attribute is by its lowercased name ("viewbox").
        const at = loc.startTag.attrs?.[name.toLowerCase()] ?? loc.attrs?.[name.toLowerCase()];
        if (value === null) {
            if (at) edits.push({ from: /\s/.test(html[at.startOffset - 1]) ? at.startOffset - 1 : at.startOffset, to: at.endOffset, text: '' });
        } else if (at) {
            edits.push({ from: at.startOffset, to: at.endOffset, text: `${name}="${escapeAttr(value)}"` });
        } else {
            added += ` ${name}="${escapeAttr(value)}"`;
        }
    }
    if (added) {
        const at = attrsEnd(html, loc.startTag);
        edits.push({ from: at, to: at, text: added });
    }
    return edits;
}

/** The <svg> and its shape, when `node` is a drawing Draw2Code drew; null for anything else. */
function drawingOf(node: Node | null): { svg: Node; shape: Node; tag: string } | null {
    if (node?.tagName !== 'svg') return null;
    const children = elementChildren(node);
    const tag = drawnShape(attr(node, 'id') ?? '', children.map((child) => child.tagName ?? ''));
    return tag ? { svg: node, shape: children[0], tag } : null;
}

/** The splices that draw a drawing again at w x h; `drawn` also sets DRAWN_ATTR, or with null takes it away. */
function redrawEdits(html: string, found: { svg: Node; shape: Node; tag: string }, w: number, h: number, drawn?: string | null): Array<{ from: number; to: number; text: string }> {
    const geometry = Object.fromEntries((found.shape.attrs ?? []).map((a) => [a.name, a.value]));
    const next = redrawn(found.tag, geometry, attr(found.svg, 'viewBox') ?? '', w, h);
    const svg: Record<string, string | null> = { ...next.svg };
    if (drawn !== undefined) svg[DRAWN_ATTR] = drawn;
    return [...attrEdits(html, found.svg, svg), ...attrEdits(html, found.shape, next.shape)];
}

/** A size a resize writes, "120px" -> 120; anything else (a percentage, '' to take it away) is undefined. */
function pxOf(value: string | undefined): number | undefined {
    const match = /^\s*(\d+(?:\.\d+)?)px\s*$/.exec(value ?? '');
    return match ? Number(match[1]) : undefined;
}

/**
 * A drawing Draw2Code drew, drawn again at the size a style edit gives it
 * (`declarations`' width and height in px; one that is not given stays as
 * the svg has it), so its picture fills the box instead of keeping the old
 * proportions. Anything else, or no size, is left as it is.
 */
export function redrawShape(html: string, ref: ElementRef, declarations: Declarations): { html: string; changed: boolean } {
    const found = drawingOf(findNode(html, ref));
    const width = pxOf(declarations.width);
    const height = pxOf(declarations.height);
    if (!found || (width === undefined && height === undefined)) return { html, changed: false };
    const w = width ?? (parseFloat(attr(found.svg, 'width') ?? '') || 0);
    const h = height ?? (parseFloat(attr(found.svg, 'height') ?? '') || 0);
    // The size it was drawn at is written once: a second resize keeps the first.
    const drawn = attr(found.svg, DRAWN_ATTR) === undefined ? `${attr(found.svg, 'width') ?? ''} ${attr(found.svg, 'height') ?? ''}` : undefined;
    const out = splice(html, redrawEdits(html, found, w, h, drawn));
    return { html: out, changed: out !== html };
}

/**
 * Draw a resized drawing at the size it was drawn at again (DRAWN_ATTR),
 * which then goes: the one `ref` names, or with no ref every one in the
 * page. Its own rules give it that size again once Draw2Code's are gone.
 */
export function restoreDrawings(html: string, ref?: ElementRef): { html: string; changed: boolean } {
    const nodes: Node[] = [];
    if (ref) {
        const node = findNode(html, ref);
        if (node) nodes.push(node);
    } else {
        walkElements(parse(html), (el) => { if (el.tagName === 'svg') nodes.push(el); });
    }
    const edits: Array<{ from: number; to: number; text: string }> = [];
    for (const node of nodes) {
        const found = drawingOf(node);
        const was = found ? attr(found.svg, DRAWN_ATTR) : undefined;
        if (!found || was === undefined) continue;
        const [w, h] = was.trim().split(/\s+/).map(Number);
        edits.push(...(Number.isFinite(w) && Number.isFinite(h) ? redrawEdits(html, found, w, h, null) : attrEdits(html, found.svg, { [DRAWN_ATTR]: null })));
    }
    const out = splice(html, edits);
    return { html: out, changed: out !== html };
}

// A button or a piece of text becomes a link by renaming its tags to <a> and
// adding an href. Its attributes, its text and its place stay, so the page's
// own rules for its id and classes still find it. What it was is written on
// it (LINK_WAS_ATTR), so taking the link away gives back the same bytes.

/** What removing a link Draw2Code made puts back (LINK_WAS_ATTR, read). */
export interface LinkMemory {
    /** The tag as it was written: "button", "H2". */
    tag: string;
    /** The link added the data-d2c marker its looks are written for. */
    marker: boolean;
    /** The link added Draw2Code's stylesheet to the page. */
    stylesheet: boolean;
    /** The type attribute it took away, as written: 'type="button"'. */
    type?: string;
}

/** A button's type attribute, which means something else on a link: 'type="button"', "type=submit". */
const BUTTON_TYPE = /^type\s*=\s*(["']?)(?:button|submit|reset)\1$/i;

/**
 * Exactly what makeLink writes into LINK_WAS_ATTR, and nothing else: the
 * attribute is in the page, and the page is just text, so a remembered
 * "script" or 'button onclick="..."' is not a link Draw2Code made.
 */
const WAS = /^([A-Za-z][A-Za-z0-9]*)( marker)?( stylesheet)?(?: (type\s*=\s*(["']?)(?:button|submit|reset)\5))?$/i;

/** LINK_WAS_ATTR read back: "button stylesheet" -> { tag: "button", stylesheet: true, ... }; null for anything makeLink would not have written. */
export function parseWas(value: string | undefined): LinkMemory | null {
    const match = value === undefined ? null : WAS.exec(value);
    const tag = match?.[1].toLowerCase() ?? '';
    if (!match || tag === 'a' || !LINKABLE.includes(tag)) return null;
    return { tag: match[1], marker: Boolean(match[2]), stylesheet: Boolean(match[3]), ...(match[4] ? { type: match[4] } : {}) };
}

/** A LinkMemory as LINK_WAS_ATTR holds it: { tag: "button", stylesheet: true } -> "button stylesheet". */
function wasText(memory: LinkMemory): string {
    return [memory.tag, memory.marker ? 'marker' : '', memory.stylesheet ? 'stylesheet' : '', memory.type ?? ''].filter(Boolean).join(' ');
}

/** An element as a link sees it (see linkInfo). */
export interface LinkInfo {
    /** Its tag, lower case: "button", "a". */
    tag: string;
    /** Its href as the file has it; absent when it is not a link. */
    href?: string;
    /** On a link Draw2Code made: what it was. */
    was?: LinkMemory;
    /** On a link Draw2Code made: the looks it wrote (LINK_LOOKS_ATTR). */
    looks: Declarations;
    /** Where Draw2Code writes its rules for it: "#id", '[data-d2c="N"]', or null for neither yet. */
    selector: string | null;
}

/**
 * The element a ref names, as a link sees it - or why it cannot be one: it
 * is not a button or text (an <img>, a <div> section, the <body>), it is
 * inside a link or holds one (a browser takes a link inside a link apart)
 * or holds a button or a field, it has an href but is not a link, or its
 * end tag is left out of the file (an <li> never closed: there is nowhere
 * to end the link).
 */
export function linkInfo(html: string, ref: ElementRef): LinkInfo | { problem: string } {
    if (ref.body || (!ref.id && ref.path?.length === 0)) return { problem: notLinkable('body') };
    const node = findNode(html, ref);
    if (!node?.tagName) return { problem: 'that element is no longer in the page; the page is kept' };
    const tag = node.tagName;
    if ((node.namespaceURI ?? HTML_NAMESPACE) !== HTML_NAMESPACE || !LINKABLE.includes(tag)) return { problem: notLinkable(tag) };
    const loc = node.sourceCodeLocation;
    if (!loc?.startTag || !loc.endTag) {
        return { problem: `the <${tag}> has no </${tag}> in the file, so there is nowhere to end a link; the page is kept` };
    }
    if (tag !== 'a') {
        for (let up = node.parentNode; up; up = up.parentNode) {
            if (up.tagName === 'a') return { problem: `the <${tag}> is inside a link already; the page is kept` };
            if (up.tagName === 'button') return { problem: `the <${tag}> is inside a button, and a button cannot hold a link; the page is kept` };
        }
        let holds = '';
        walkElements(node, (el) => {
            if (holds || el === node) return;
            if (el.tagName === 'a') holds = 'a link already, and a link cannot hold another';
            else if (['button', 'input', 'select', 'textarea'].includes(el.tagName ?? '')) holds = 'a button or a field, and a click on it would follow the link';
        });
        if (holds) return { problem: `the <${tag}> holds ${holds}; the page is kept` };
        // A browser keeps the FIRST of two hrefs, so the page's own one
        // (a javascript: one, say) would be where the new link goes.
        for (const name of ['href', LINK_WAS_ATTR, LINK_LOOKS_ATTR]) {
            if (attr(node, name) !== undefined) return { problem: `the <${tag}> has its own ${name} but is not a link; the page is kept` };
        }
    } else if ((html.slice(loc.startTag.startOffset, loc.startTag.endOffset).match(/[\s/"']href(?=[\s=/>])/gi) ?? []).length > 1) {
        // The file can only point at the last of two, and a browser follows the first.
        return { problem: 'the link has two hrefs, and a browser follows the first; the page is kept' };
    }
    const href = attr(node, 'href');
    const was = tag === 'a' ? parseWas(attr(node, LINK_WAS_ATTR)) : null;
    const id = attr(node, 'id');
    const marker = attr(node, MARKER_ATTR);
    return {
        tag,
        ...(href !== undefined ? { href } : {}),
        ...(was ? { was } : {}),
        looks: was ? parseLooks(attr(node, LINK_LOOKS_ATTR) ?? '') : {},
        selector: id ? `#${cssEscape(id)}` : marker ? `[${MARKER_ATTR}="${marker}"]` : null,
    };
}

// A section a link can go to ("#prices") is an element with an id. The
// elements offered are the ones a reader would scroll to: headings, the
// page's sections (<section>, <header>, ...), anything with an id already,
// and on a page made in Draw2Code everything placed on it.

/** An element of a page offered as a section a link can go to (see sectionTargets). */
export interface SectionTarget {
    /** Where it is, from <body> down, as an ElementRef's path. */
    path: number[];
    /** Its tag, lower case: "h2", "section", "svg". */
    tag: string;
    /** Its id, when it has one a link can point at; absent when it has none yet. */
    id?: string;
    /** Its words, on one line ("" for a drawing): what the user knows it by. */
    text: string;
    /** The name it would be given (see sectionName), when it has no id yet. */
    suggested?: string;
}

/** The tags of a page's own sections: offered as a section even without an id. */
const SECTION_TAGS: readonly string[] = ['section', 'article', 'header', 'footer', 'main', 'nav', 'aside', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'];
/** What is never a section: not shown, or part of something else. */
const NOT_SECTIONS: readonly string[] = ['script', 'style', 'template', 'noscript', 'link', 'meta', 'br', 'wbr', 'source', 'track', 'option', 'optgroup', 'head', 'title', 'base'];
/** A video's box: its player's own parts are not sections. */
const VIDEO_BOX = /(^|\s)(video-player|video-embed)(\s|$)/;

/** The word a section is named by when its own words give no name: "heading", "picture". */
function sectionFallback(el: Node): string {
    if (/^h[1-6]$/.test(el.tagName ?? '')) return 'heading';
    if (VIDEO_BOX.test(attr(el, 'class') ?? '')) return 'video';
    return ({ img: 'picture', svg: 'drawing', p: 'text', input: 'field', textarea: 'field', button: 'button', label: 'label' } as Record<string, string>)[el.tagName ?? ''] ?? 'section';
}

/** An element's words, as the user sees them: its text on one line, a picture's alt, a field's placeholder. */
function wordsOf(el: Node): string {
    if (el.tagName === 'img') return (attr(el, 'alt') ?? '').trim();
    if (el.tagName === 'input' || el.tagName === 'textarea') return (attr(el, 'placeholder') ?? '').trim();
    if (el.tagName === 'svg' || VIDEO_BOX.test(attr(el, 'class') ?? '')) return '';
    const parts: string[] = [];
    const visit = (node: Node): void => {
        if (node.nodeName === '#text') parts.push((node as unknown as { value: string }).value);
        if (NOT_SECTIONS.includes(node.tagName ?? '')) return;
        for (const child of node.childNodes ?? []) visit(child);
    };
    visit(el);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * The elements of a page a link can go to, in the page's order (see
 * SectionTarget). One with an id a link cannot point at as it is (a space,
 * a quote) is left out: renaming it could break the page's own rules.
 */
export function sectionTargets(html: string): SectionTarget[] {
    const doc = parse(html);
    const body = findTag(doc, 'body');
    if (!body) return [];
    const wrapper = generatedWrapper(doc);
    const taken = usedIds(html);
    const out: SectionTarget[] = [];
    const visit = (node: Node, path: number[]): void => {
        elementChildren(node).forEach((el, index) => {
            const tag = el.tagName ?? '';
            if (NOT_SECTIONS.includes(tag)) return;
            const at = [...path, index];
            const html5 = (el.namespaceURI ?? HTML_NAMESPACE) === HTML_NAMESPACE;
            const id = attr(el, 'id');
            const placed = wrapper !== null && node === wrapper;
            if ((html5 || tag === 'svg') && (id !== undefined || placed || SECTION_TAGS.includes(tag)) && (id === undefined || linkableId(id))) {
                const text = wordsOf(el);
                out.push({ path: at, tag, text, ...(id !== undefined ? { id } : { suggested: sectionName(text, sectionFallback(el), taken) }) });
            }
            // A drawing's shapes and a video player's parts belong to it.
            if (html5 && !VIDEO_BOX.test(attr(el, 'class') ?? '')) visit(el, at);
        });
    };
    visit(body, []);
    return out;
}

/**
 * Name an element as a section: it gets `id`, in place. One with that id
 * already is left as it is; one with another id says so (renaming it could
 * break the page's own rules and links), as does a name another element has. `marker` is the selector its rules
 * were written under until now ('[data-d2c="3"]'), for renameRules: the
 * editor names it by its id from now on.
 */
export function nameSection(html: string, ref: ElementRef, id: string): { html: string; changed: boolean; marker?: string } | { problem: string } {
    const node = findNode(html, ref);
    if (!node?.tagName || !node.sourceCodeLocation?.startTag) return { problem: GONE_TEXT };
    const own = attr(node, 'id');
    if (own === id) return { html, changed: false };
    if (own !== undefined) return { problem: `that element is named #${own} already; the page is kept` };
    if (usedIds(html).has(id)) return { problem: `#${id} already names another element on this page; the page is kept` };
    const marker = attr(node, MARKER_ATTR);
    return {
        html: splice(html, attrEdits(html, node, { id })),
        changed: true,
        ...(marker !== undefined ? { marker: `[${MARKER_ATTR}="${marker}"]` } : {}),
    };
}

/**
 * The rules written under one selector moved to another, with their
 * pseudo-classes and " > *" ('[data-d2c="3"]:hover' -> "#prices:hover"),
 * each in its place: an element named as a section is edited by its id from
 * then on, and Revert element must still find all of them. Where both have
 * a rule, the new selector's declarations win, as they did on the page.
 */
export function renameRules(overrides: Overrides, from: string, to: string): Overrides {
    const moved: Overrides = {};
    let changed = false;
    for (const [rule, declarations] of Object.entries(overrides)) {
        if (isOwnRule(rule, from)) {
            const target = to + rule.slice(from.length);
            moved[target] = { ...declarations, ...(overrides[target] ?? {}), ...(moved[target] ?? {}) };
            changed = true;
        } else if (!(rule in moved)) {
            moved[rule] = declarations;
        }
    }
    return changed ? moved : overrides;
}

/**
 * Set what an <input> or a <textarea> shows while it is empty: its
 * placeholder attribute, in place. Empty takes the attribute away. A line
 * break cannot be in one, so it becomes a space.
 */
export function setPlaceholder(html: string, ref: ElementRef, text: string): { html: string; changed: boolean } | { problem: string } {
    const node = findNode(html, ref);
    if (!node?.tagName || !node.sourceCodeLocation?.startTag) return { problem: GONE_TEXT };
    if (node.tagName !== 'input' && node.tagName !== 'textarea') return { problem: `a <${node.tagName}> has no placeholder; the page is kept` };
    const value = text.replace(/[\r\n]+/g, ' ');
    const now = attr(node, 'placeholder');
    if (value === '' ? now === undefined : now === value) return { html, changed: false };
    return { html: splice(html, attrEdits(html, node, { placeholder: value === '' ? null : value })), changed: true };
}

// Copying an element (Ctrl+C, Ctrl+D) keeps its bytes as the file has them,
// and notes where in them its names and addresses are: the id each element
// is named by (or where one goes), the markers and the drawn size that
// belong to this page only, and every src, href and poster, which are
// written relative to this page. Pasting (src/copyPaste.ts) then only
// splices those places, on whichever page it lands.

/** A place in a copied element's markup: [from, to) counted from its "<". */
export interface Span { from: number; to: number }

/** An element of a copy that is given a new id when it is pasted. */
export interface CopiedName {
    /** What its new id is made from: its id ("rect-3", "title"), or its tag when it has none ("div-1"). */
    base: string;
    /** Its id attribute, or its marker, replaced by the new id; an empty span is where the id is added. */
    at: Span;
    /** The selectors its rules are written under on the page it came from: "#rect-3", '[data-d2c="2"]'. */
    selectors: string[];
}

/** An attribute holding an address, rewritten for the page a copy lands on. */
export interface CopiedAddress {
    at: Span;
    /** The attribute's name ("src", "href", "poster") and value, as parse5 reads it. */
    name: string;
    value: string;
    /** On a link: the page's own section it names ("#prices"), which another page needs written with this page's name. */
    section?: boolean;
}

/** One element copied from a page, as copyElement reads it. */
export interface CopiedMarkup {
    /** Its markup, byte for byte. */
    markup: string;
    /** It first, then anything inside it, in the page's order. */
    names: CopiedName[];
    /** What goes when it is pasted: markers no rule needs, the drawn size of a resized drawing. */
    drop: Span[];
    addresses: CopiedAddress[];
    /** It sits in the wrapper of a page made in Draw2Code (see appendToPage). */
    inWrapper: boolean;
}

/** Tags that only mean something inside their table or list box: placed freely, a browser would drop them. */
const NOT_ALONE: readonly string[] = ['tr', 'td', 'th', 'thead', 'tbody', 'tfoot', 'caption', 'col', 'colgroup', 'option', 'optgroup'];

/**
 * Copy the element a ref names (see CopiedMarkup). `ruled` says whether a
 * selector has rules on this page: an element named only by a marker with
 * none is not given an id, and the marker just goes.
 */
export function copyElement(html: string, ref: ElementRef, ruled: (selector: string) => boolean): CopiedMarkup | { problem: string } {
    const doc = parse(html);
    const node = findNode(html, ref);
    const loc = node?.sourceCodeLocation;
    if (!node?.tagName || !loc?.startTag) return { problem: GONE_TEXT };
    if (PAGE_FRAME.includes(node.tagName)) return { problem: `<${node.tagName}> is the page itself and cannot be copied` };
    if (NOT_ALONE.includes(node.tagName)) return { problem: `a <${node.tagName}> only belongs inside its table or list, so it cannot be copied on its own` };
    const start = loc.startOffset;
    const end = loc.endTag?.endOffset ?? loc.endOffset;
    const span = (at: { startOffset: number; endOffset: number }): Span => ({ from: at.startOffset - start, to: at.endOffset - start });
    /** An attribute's place, with the space before it, so taking it away leaves the tag tidy. */
    const spaced = (at: { startOffset: number; endOffset: number }): Span =>
        ({ from: at.startOffset - (/\s/.test(html[at.startOffset - 1]) ? 1 : 0) - start, to: at.endOffset - start });
    const ids = usedIds(html);
    const names: CopiedName[] = [];
    const drop: Span[] = [];
    const addresses: CopiedAddress[] = [];
    walkElements(node, (el) => {
        const tag = el.sourceCodeLocation?.startTag;
        if (!tag) return;
        const where = (name: string) => tag.attrs?.[name] ?? el.sourceCodeLocation?.attrs?.[name];
        const id = attr(el, 'id');
        const marker = attr(el, MARKER_ATTR);
        const markerSelector = marker !== undefined ? `[${MARKER_ATTR}="${marker}"]` : undefined;
        const idAt = where('id');
        const markerAt = where(MARKER_ATTR);
        if (id !== undefined && idAt) {
            names.push({ base: id, at: span(idAt), selectors: ownSelectors(el) });
            if (markerAt) drop.push(spaced(markerAt));
        } else if (markerAt && (el === node || (markerSelector && ruled(markerSelector)))) {
            names.push({ base: `${el.tagName}-1`, at: span(markerAt), selectors: ownSelectors(el) });
        } else {
            if (markerAt) drop.push(spaced(markerAt));
            // The element copied is always named: its rules are written for its id.
            if (el === node) {
                const at = attrsEnd(html, tag) - start;
                names.push({ base: `${el.tagName}-1`, at: { from: at, to: at }, selectors: [] });
            }
        }
        const drawn = where(DRAWN_ATTR);
        if (drawn) drop.push(spaced(drawn));
        for (const name of ['src', 'href', 'poster']) {
            const value = attr(el, name);
            const at = where(name);
            if (value === undefined || !at) continue;
            const section = el.tagName === 'a' && name === 'href' && value.startsWith('#') && ids.has(value.slice(1));
            addresses.push({ at: span(at), name, value, ...(section ? { section: true } : {}) });
        }
    });
    const wrapper = generatedWrapper(doc);
    return {
        markup: html.slice(start, end),
        names,
        drop,
        addresses,
        inWrapper: Boolean(wrapper?.sourceCodeLocation && node.parentNode?.sourceCodeLocation?.startOffset === wrapper.sourceCodeLocation.startOffset),
    };
}

/**
 * The page's own styles, in the order a browser reads them: each linked
 * stylesheet's href as written, and the text of each <style> block.
 * Draw2Code's own stylesheet is left out: its rules are kept apart (see
 * pageEditor.readOverrides).
 */
export function pageStyles(html: string): Array<{ href: string } | { css: string }> {
    const out: Array<{ href: string } | { css: string }> = [];
    walkElements(parse(html), (el) => {
        const rel = (attr(el, 'rel') ?? '').toLowerCase().split(/\s+/);
        const href = attr(el, 'href');
        if (el.tagName === 'link' && rel.includes('stylesheet') && href !== undefined && !isDraw2CodeStylesheet(el)) out.push({ href });
        if (el.tagName === 'style') {
            const text = (el.childNodes ?? []).map((child) => (child as unknown as { value?: string }).value ?? '').join('');
            out.push({ css: text });
        }
    });
    return out;
}

/** The classes on <body>: a page made in Draw2Code is named by one ("page-about"), which its rules in the shared stylesheet are scoped to. */
export function bodyClasses(html: string): string[] {
    const body = findTag(parse(html), 'body');
    return (body ? attr(body, 'class') ?? '' : '').split(/\s+/).filter(Boolean);
}

/** Where a new attribute goes in a start tag: before its ">" (or "/>"), as ensureSelector adds a marker. */
function attrsEnd(html: string, startTag: { startOffset: number; endOffset: number }): number {
    return startTag.endOffset - (html.slice(startTag.startOffset, startTag.endOffset).endsWith('/>') ? 2 : 1);
}

/**
 * Make a button or text a link (linkInfo says which can be): its start and
 * end tag names become "a", an href is added right after the name, and what
 * it was is written on it. Its attributes and text stay as they are, except
 * a button's type attribute, which means something else on a link: the
 * remembered tag takes its place. `added` says what else this edit put in
 * the page - the looks (written down so removing takes exactly those away),
 * a marker, the stylesheet - so removing can take that away too.
 */
export function makeLink(html: string, ref: ElementRef, href: string,
    added: { looks?: Declarations; marker?: boolean; stylesheet?: boolean } = {}): { html: string; changed: boolean } {
    const node = findNode(html, ref);
    const loc = node?.sourceCodeLocation;
    if (!node?.tagName || node.tagName === 'a' || !loc?.startTag || !loc.endTag) return { html, changed: false };
    const start = loc.startTag;
    const end = loc.endTag;
    const length = node.tagName.length;
    const written = html.slice(start.startOffset + 1, start.startOffset + 1 + length);
    if (written.toLowerCase() !== node.tagName || html.slice(end.startOffset + 2, end.startOffset + 2 + length).toLowerCase() !== node.tagName) {
        return { html, changed: false };
    }
    const typeAt = start.attrs?.type ?? loc.attrs?.type;
    const typeText = typeAt ? html.slice(typeAt.startOffset, typeAt.endOffset) : '';
    const takesType = node.tagName === 'button' && BUTTON_TYPE.test(typeText);
    const memory: LinkMemory = { tag: written, marker: Boolean(added.marker), stylesheet: Boolean(added.stylesheet), ...(takesType ? { type: typeText } : {}) };
    const was = `${LINK_WAS_ATTR}="${escapeAttr(wasText(memory))}"`;
    const looks = Object.keys(added.looks ?? {}).length > 0 ? ` ${LINK_LOOKS_ATTR}="${escapeAttr(looksText(added.looks ?? {}))}"` : '';
    const at = attrsEnd(html, start);
    // The href goes FIRST: the editor finds a link's href by the first
    // "href=" in the tag, and a button's onclick="location.href='x.html'"
    // holds one too.
    const edits = [
        { from: start.startOffset + 1, to: start.startOffset + 1 + length, text: `a href="${escapeAttr(href)}"` },
        { from: at, to: at, text: `${takesType ? '' : ` ${was}`}${looks}` },
        { from: end.startOffset + 2, to: end.startOffset + 2 + length, text: 'a' },
    ];
    if (takesType && typeAt) edits.push({ from: typeAt.startOffset, to: typeAt.endOffset, text: was });
    return { html: splice(html, edits), changed: true };
}

/** Point a link somewhere else: only its href's value changes in place, or an <a> without one gets one. */
export function setHref(html: string, ref: ElementRef, href: string): { html: string; changed: boolean } {
    const node = findNode(html, ref);
    const loc = node?.sourceCodeLocation;
    if (node?.tagName !== 'a' || !loc?.startTag) return { html, changed: false };
    if (attr(node, 'href') === href) return { html, changed: false };
    const written = `href="${escapeAttr(href)}"`;
    const hrefAt = loc.startTag.attrs?.href ?? loc.attrs?.href;
    if (hrefAt) return { html: splice(html, [{ from: hrefAt.startOffset, to: hrefAt.endOffset, text: written }]), changed: true };
    const at = attrsEnd(html, loc.startTag);
    return { html: splice(html, [{ from: at, to: at, text: ` ${written}` }]), changed: true };
}

/** Attributes that only mean something on a link: a link that was already in the page loses them when it becomes a <span>. */
const LINK_ONLY: readonly string[] = ['href', 'target', 'rel', 'download', 'hreflang', 'ping', 'referrerpolicy', 'type'];

/**
 * Take a link away. One Draw2Code made goes back to exactly what it was:
 * its tag and type attribute, without the href, the looks and the
 * remembered tag - and with `dropMarker`, without the marker the link added.
 * One that was already in the page has nothing to go back to, so it becomes
 * a <span>: its id, classes and text stay, and the attributes only a link
 * has go.
 */
export function unlink(html: string, ref: ElementRef, dropMarker = false): { html: string; changed: boolean } {
    const node = findNode(html, ref);
    const loc = node?.sourceCodeLocation;
    if (node?.tagName !== 'a' || !loc?.startTag || !loc.endTag) return { html, changed: false };
    const start = loc.startTag;
    const end = loc.endTag;
    if (html[start.startOffset + 1]?.toLowerCase() !== 'a' || html[end.startOffset + 2]?.toLowerCase() !== 'a') return { html, changed: false };
    const memory = parseWas(attr(node, LINK_WAS_ATTR));
    const where = (name: string): { startOffset: number; endOffset: number } | undefined => start.attrs?.[name] ?? loc.attrs?.[name];
    const edits: Array<{ from: number; to: number; text: string }> = [];
    // An attribute Draw2Code added goes with the one space it put before it;
    // one of the page's own takes all the space before it (a line break too).
    const drop = (name: string, allSpace: boolean): void => {
        const at = where(name);
        if (!at) return;
        let from = at.startOffset;
        if (allSpace) while (from > start.startOffset + 1 && /\s/.test(html[from - 1])) from--;
        else if (/\s/.test(html[from - 1])) from--;
        edits.push({ from, to: at.endOffset, text: '' });
    };
    const tag = memory ? memory.tag : 'span';
    edits.push({ from: start.startOffset + 1, to: start.startOffset + 2, text: tag });
    edits.push({ from: end.startOffset + 2, to: end.startOffset + 3, text: tag });
    if (memory) {
        drop('href', false);
        drop(LINK_LOOKS_ATTR, false);
        const was = where(LINK_WAS_ATTR);
        if (memory.type && was) edits.push({ from: was.startOffset, to: was.endOffset, text: memory.type });
        else drop(LINK_WAS_ATTR, false);
        if (dropMarker && memory.marker) drop(MARKER_ATTR, false);
    } else {
        for (const name of [...LINK_ONLY, LINK_WAS_ATTR, LINK_LOOKS_ATTR]) drop(name, true);
    }
    return { html: splice(html, edits), changed: true };
}

/** The first <link> to this stylesheet in the page. */
function findStylesheetLink(html: string, href: string): Node | null {
    let found: Node | null = null;
    walkElements(parse(html), (el) => {
        if (!found && el.tagName === 'link' && attr(el, 'href') === href) found = el;
    });
    return found;
}

/**
 * Take a stylesheet link out of a page again, exactly as ensureStylesheet
 * put it in: the tag, the line break after it and, in <head>, the four
 * spaces before it. The indentation of an indented '    </head>' was there
 * before and stays.
 */
export function unlinkStylesheet(html: string, href: string): { html: string; changed: boolean } {
    const loc = findStylesheetLink(html, href)?.sourceCodeLocation;
    if (!loc) return { html, changed: false };
    return { html: cutTag(html, loc), changed: true };
}

/** Take a script out of a page again, as ensureScript put it in: like unlinkStylesheet. */
export function unlinkScript(html: string, src: string): { html: string; changed: boolean } {
    let found: Node | null = null;
    walkElements(parse(html), (el) => {
        if (!found && el.tagName === 'script' && attr(el, 'src') === src) found = el;
    });
    const loc = (found as Node | null)?.sourceCodeLocation;
    if (!loc) return { html, changed: false };
    return { html: cutTag(html, loc), changed: true };
}

/**
 * A tag Draw2Code put in taken out exactly as it went in: the tag and the
 * line break after it and, in <head>, the four spaces ensureStylesheet and
 * ensureScript wrote before it. Whatever indentation is left of those four
 * was the page's own (an indented '  </head>' lends its spaces to the line
 * the tag went on), so it stays. In front of <body>, on a page with no
 * <head>, nothing was written before the tag.
 */
function cutTag(html: string, loc: { startOffset: number; endOffset: number }): string {
    const lineEnd = /^\r?\n/.exec(html.slice(loc.endOffset));
    const to = loc.endOffset + (lineEnd ? lineEnd[0].length : 0);
    const headEnd = findTag(parse(html), 'head')?.sourceCodeLocation?.endTag?.startOffset;
    const inHead = headEnd !== undefined && loc.startOffset < headEnd;
    const from = inHead && html.slice(loc.startOffset - 4, loc.startOffset) === '    ' ? loc.startOffset - 4 : loc.startOffset;
    return html.slice(0, from) + html.slice(to);
}

/** The element a ref names: by its id, or by its path from <body>. */
function findNode(html: string, ref: ElementRef): Node | null {
    return ref.id ? findById(html, ref.id) : ref.path ? findByPath(html, ref.path) : null;
}

/** Apply edits that do not overlap, the last first, so the earlier offsets still hold. */
function splice(text: string, edits: Array<{ from: number; to: number; text: string }>): string {
    let out = text;
    for (const e of [...edits].sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.text + out.slice(e.to);
    return out;
}

/** One CSS rule per selector that says something, in the order they were added. */
export function ruleBlocks(overrides: Overrides): string[] {
    return Object.entries(overrides)
        .filter(([, declarations]) => Object.keys(declarations).length > 0)
        .map(([selector, declarations]) => {
            const lines = Object.entries(declarations).map(([prop, value]) => `  ${prop}: ${value};`);
            return `${selector} {\n${lines.join('\n')}\n}`;
        });
}

/** Rules shown only in a window as narrow as a phone's: `blocks` in one @media block, or nothing. */
export function phoneBlock(blocks: string[]): string[] {
    if (blocks.length === 0) return [];
    const indented = blocks.map((block) => block.split('\n').map((line) => `  ${line}`).join('\n'));
    return [`@media (max-width: ${PHONE_BREAKPOINT}px) {\n${indented.join('\n\n')}\n}`];
}

/**
 * What a page with a phone layout needs in a phone's window before its own
 * phone rules: the window's width, not the desktop's. The SAME rules as the
 * generator's phone block in media/generators/html.js baseCss (a test holds
 * them together); written again with a page's phone layout because a
 * project made before phones has a stylesheet without them.
 */
export const PHONE_BASE: Overrides = {
    [`html.${PHONE_LAYOUT_CLASS} body`]: { 'min-width': '0' },
    [`html.${PHONE_LAYOUT_CLASS} .page`]: { width: '100%' },
    [`html.${PHONE_LAYOUT_CLASS} .page > svg > *`]: { 'vector-effect': 'non-scaling-stroke' },
};

/**
 * The overrides stylesheet: the page's rules, then, when it has a phone
 * layout, PHONE_BASE and its phone layout's rules in one @media block,
 * which comes last and so wins in a phone's window. Selectors keep the
 * order they were added in.
 */
export function renderOverrides(overrides: Overrides, phone?: Overrides): string {
    const blocks = [...ruleBlocks(overrides), ...phoneBlock(phone ? [...ruleBlocks(PHONE_BASE), ...ruleBlocks(phone)] : [])];
    return ['/* Written by Draw2Code Web Editor. Edit the design, not this file. */', ...blocks].join('\n\n') + '\n';
}

/** Merge new declarations into a selector's rule; empty values remove one. */
export function mergeOverride(overrides: Overrides, selector: string, declarations: Declarations): Overrides {
    const next: Overrides = { ...overrides, [selector]: { ...(overrides[selector] ?? {}) } };
    for (const [prop, value] of Object.entries(declarations)) {
        if (value === '') delete next[selector][prop];
        else next[selector][prop] = value;
    }
    if (Object.keys(next[selector]).length === 0) delete next[selector];
    return next;
}

function escapeText(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttr(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/** The selector Draw2Code writes an element's rules under, by its id: "rect-7" -> "#rect-7". */
export function idSelector(id: string): string {
    return `#${cssEscape(id)}`;
}

/** Enough escaping for an id used inside a selector. */
function cssEscape(value: string): string {
    return value.replace(/([^\w-])/g, '\\$1');
}
