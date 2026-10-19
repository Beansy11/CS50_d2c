// Links in the page editor: which addresses a link may point at, how a page
// of the site is written from another page, and which looks a link may write.
//
// The page and the overlay's messages are just text, so every address is
// checked TWICE: when it is typed (the InputBox) and again when the edit is
// applied (applyEdit in pageEditor.ts). Only three kinds of web address are
// allowed - https:, http: and mailto: - and a link to a page of this site is
// a relative path to a page that is really there, or to a section of one
// ("#prices", "about.html#team") that is really on it.
//
// Plain Node - no vscode import - so test/links.test.js can run it.

import * as path from 'path';

/** The tags that can become a link: a button, or text. An <a> is one already. */
export const LINKABLE: readonly string[] = ['button', 'label', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'a'];

/** The schemes a typed address may use, lower case. */
const LINK_SCHEMES: readonly string[] = ['https', 'http', 'mailto'];

/** Longer than any real address: a pasted page of text is not one. */
const MAX_ADDRESS = 2000;

/** "javascript:x" -> "javascript"; the scheme as a browser reads it, before the first ":". */
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]*):/;

/** The answer for an element that cannot be a link: "<img> cannot be a link yet: ...". */
export function notLinkable(tag: string): string {
    return `<${tag}> cannot be a link yet: only buttons, labels, text, headings and list items can; the page is kept`;
}

/**
 * What a browser would read differently from what is shown, or what could
 * break out of the attribute: control characters (a browser drops a tab or
 * a line break INSIDE "java\tscript:", so the check must not), invisible
 * characters, spaces, HTML character references ("&#106;avascript:",
 * "javascript&colon;"), quotes, angle brackets and backslashes. Undefined
 * when there is none.
 */
function oddity(text: string): string | undefined {
    if (/[\u0000-\u001F\u007F-\u009F]/.test(text)) return 'an address cannot hold control characters such as tabs or line breaks';
    if (/[\u200B-\u200F\u2028-\u202E\u2060-\u2069\uFEFF]/.test(text)) return 'an address cannot hold invisible characters (zero-width spaces, direction marks)';
    if (/\s/.test(text)) return 'take out the spaces: an address has none (a space inside one is written %20)';
    if (/&(#|[A-Za-z][A-Za-z0-9]*;)/.test(text)) return 'an address cannot hold HTML character references like &#58; or &colon; - type the character itself';
    if (/["'<>`\\]/.test(text)) return 'quotes, angle brackets and backslashes are not allowed in an address';
    if (text.length > MAX_ADDRESS) return `that address is too long (over ${MAX_ADDRESS} characters)`;
    return undefined;
}

/**
 * A typed web address, checked: "https://example.com" -> { href } as typed;
 * "javascript:alert(1)", "//evil.example" or "example.com" -> { problem }
 * saying what to type instead. Only https:, http: and mailto: are allowed,
 * in any case ("HTTPS://" is still https).
 */
export function checkAddress(text: string): { href: string } | { problem: string } {
    if (text === '') return { problem: 'type an address that starts with https://, http:// or mailto:' };
    const odd = oddity(text);
    if (odd) return { problem: odd };
    if (text.startsWith('//')) return { problem: 'an address that starts with // has no scheme - write https:// in front' };
    const scheme = SCHEME.exec(text)?.[1].toLowerCase();
    if (!scheme) return { problem: 'a web address starts with https://, http:// or mailto: ("example.com" is written https://example.com)' };
    if (!LINK_SCHEMES.includes(scheme)) return { problem: `"${scheme}:" addresses are not allowed - only https://, http:// and mailto: links can be made` };
    if (scheme === 'mailto') {
        return text.length > 'mailto:'.length ? { href: text } : { problem: 'mailto: needs an email address after it' };
    }
    if (!/^https?:\/\/[^/?#]+/i.test(text)) return { problem: `write two slashes and a site after ${scheme}: (${scheme}://example.com)` };
    return { href: text };
}

/**
 * Any href a link is given, checked again where the edit is applied:
 * a web address (see checkAddress) -> {}; a relative link to a page of
 * this site -> { page }, that page site-relative ("../index.html" from
 * "pages/a.html" -> { page: "index.html" }), for the caller to check it is
 * really there. A section of a page is named after the "#": "#prices" on
 * this page -> { fragment: "prices" }, "b.html#top" -> { page, fragment },
 * for the caller to check that page has it. Anything else -> { problem }.
 */
export function checkHref(href: string, fromPage: string): { page?: string; fragment?: string } | { problem: string } {
    const odd = oddity(href);
    if (odd) return { problem: odd };
    if (SCHEME.test(href) || href.startsWith('//')) {
        const web = checkAddress(href);
        return 'problem' in web ? web : {};
    }
    const hashAt = href.indexOf('#');
    const fragment = hashAt === -1 ? '' : href.slice(hashAt + 1);
    if (fragment !== '' && !linkableId(fragment)) return { problem: `"#${fragment}" is not the name of a section that can be linked` };
    if (hashAt === 0) return fragment ? { fragment } : { problem: 'a link to a section of this page is # and the section\'s name' };
    const elsewhere = { problem: 'only pages of this site, their sections and web addresses (https://, http://, mailto:) can be linked' };
    let decoded = '';
    try {
        decoded = decodeURIComponent(href.split(/[?#]/)[0]);
    } catch {
        return elsewhere;
    }
    // Decoded, a page name may hold a space or a quote ("my page.html"), but
    // "%0a" or "%5c" is the control character or backslash trick spelled out.
    if (!decoded || decoded.startsWith('/') || /[\u0000-\u001F\u007F-\u009F\\]/.test(decoded)) return elsewhere;
    const dir = path.posix.dirname(fromPage);
    const page = path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, decoded));
    if (page === '..' || page.startsWith('../') || !/\.html?$/i.test(page)) return elsewhere;
    return fragment ? { page, fragment } : { page };
}

// A section of a page is an element with an id: a link to "#prices" scrolls
// to the element whose id is "prices", on this page or, after "other.html",
// on that one. An element picked as a section that has no id yet is given
// one, read from its words ("Our prices" -> "our-prices"), which the user
// can change before it is written.

/** The longest name sectionName makes from an element's words. */
const SECTION_NAME_MAX = 40;

/**
 * An id already in a page that a link can point at as it is: one a browser
 * reads the same in an href ("#prices", "über-uns"). Not one with a space,
 * a quote or a character an address would read differently ("%", "&", "?").
 */
export function linkableId(id: string): boolean {
    return id !== '' && oddity(id) === undefined && !/[#%?&]/.test(id);
}

/**
 * The problem with a name typed for a section, or undefined when it can be
 * an id: a letter first, then letters, digits, "-" and "_", so it reads the
 * same in a page, its stylesheet and a link. Not one another element has
 * already, in any capitals (two ids that differ only so are easily mixed up).
 */
export function checkSectionName(name: string, taken: Iterable<string>): string | undefined {
    if (name === '') return 'type a name for the section, like prices or about-us';
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) return 'a section\'s name starts with a letter and has only letters, digits, - and _ (no spaces)';
    if (name.length > 80) return 'that name is too long (over 80 characters)';
    const lower = name.toLowerCase();
    for (const id of taken) if (id.toLowerCase() === lower) return `#${id} already names another element on this page`;
    return undefined;
}

/**
 * A readable name for a section, from its words: "Our Prices!" ->
 * "our-prices"; accents dropped ("Café" -> "cafe"), at most a few words.
 * Words that give no name, or a name that starts with a digit, use
 * `fallback` ("heading", "picture"): "2026" -> "heading-2026". Never one in
 * `taken`, in any capitals: "prices" -> "prices-2".
 */
export function sectionName(text: string, fallback: string, taken: Iterable<string>): string {
    const words = text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    let base = '';
    for (const word of words) {
        const next = base ? `${base}-${word}` : word;
        if (next.length > SECTION_NAME_MAX) break;
        base = next;
    }
    if (!base && words.length > 0) base = words[0].slice(0, SECTION_NAME_MAX);
    if (!/^[a-z]/.test(base)) base = base ? `${fallback}-${base}` : fallback;
    const used = new Set(Array.from(taken, (id) => id.toLowerCase()));
    let name = base;
    for (let n = 2; used.has(name); n++) name = `${base}-${n}`;
    return name;
}

/**
 * How one page of the site links to another: relative to the linking page's
 * folder, each part URL-encoded. "pages/a.html" -> "index.html" is
 * "../index.html"; "index.html" -> "my page.html" is "my%20page.html".
 * A quote is encoded too ("bob's.html" -> "bob%27s.html"): checkHref
 * refuses one, as it would end the attribute.
 */
export function pageHref(fromPage: string, toPage: string): string {
    const dir = path.posix.dirname(fromPage);
    const rel = path.posix.relative(dir === '.' ? '' : dir, toPage);
    const encode = (part: string): string => (part === '..' ? part : encodeURIComponent(part).replace(/'/g, '%27'));
    return rel.split('/').map(encode).join('/');
}

/**
 * The file in the site a link already in a page goes to, resolved from that
 * page's folder the way a browser would: "../about.html#team" from
 * "pages/a.html" -> "about.html". Undefined for a web address, "#top" on
 * the same page, or anything outside the site. Not a check (see checkHref):
 * it only reads where an existing link points.
 */
export function linkedFile(href: string, fromPage: string): string | undefined {
    const bare = href.trim().split(/[?#]/)[0];
    if (!bare || SCHEME.test(bare) || bare.startsWith('/')) return undefined;
    let decoded = '';
    try {
        decoded = decodeURIComponent(bare);
    } catch {
        return undefined;
    }
    const dir = path.posix.dirname(fromPage);
    const file = path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, decoded));
    return file === '..' || file.startsWith('../') ? undefined : file;
}

/**
 * The looks the overlay compares one to one between the element and the <a>
 * it would be; the rest of LINK_LOOKS (sides, borders, sizes, a button's
 * layout) it works out itself.
 */
export const PLAIN_LOOKS: readonly string[] = [
    'display', 'box-sizing', 'background-color', 'color', 'font-family', 'font-size', 'font-weight', 'font-style',
    'line-height', 'letter-spacing', 'text-align', 'text-transform', 'white-space', 'vertical-align',
    'background-image', 'box-shadow', 'text-shadow', 'min-width', 'max-width',
];

/**
 * The CSS properties a link may write so its element keeps its look: what a
 * <button> drops when it becomes an <a> (its padding, font, border and
 * background from the browser), what text drops (its colour), and what the
 * page's own rules gave the old tag (a size, a gradient, a shadow). The
 * overlay measures them; applyEdit keeps only these.
 */
export const LINK_LOOKS: readonly string[] = [
    'align-items', 'justify-content', 'text-decoration', 'cursor',
    'padding', 'margin', 'border', 'border-top', 'border-right', 'border-bottom', 'border-left', 'border-radius', 'width', 'height',
    ...PLAIN_LOOKS,
];

/**
 * Only what a computed style can be ("13.3333px", "rgb(0, 0, 0)",
 * '"Segoe UI", Arial'): nothing that ends the declaration or the rule, opens a
 * comment, fetches a URL or raises its weight.
 */
function plainValue(value: string): boolean {
    return value.length > 0 && value.length <= 200
        && !/[;{}<>\\!'\u0000-\u001F\u007F]|\/\*|\*\/|url\(|image-set\(/i.test(value)
        && (value.match(/"/g) ?? []).length % 2 === 0;
}

/** The looks a link may write, from untrusted text: LINK_LOOKS names with plain values; the rest is dropped. */
export function cleanLooks(declarations: unknown): Record<string, string> {
    const out: Record<string, string> = {};
    if (!declarations || typeof declarations !== 'object') return out;
    for (const [prop, value] of Object.entries(declarations as Record<string, unknown>)) {
        if (LINK_LOOKS.includes(prop) && typeof value === 'string' && plainValue(value.trim())) out[prop] = value.trim();
    }
    return out;
}

/** Looks as one attribute value: { color: "red", display: "flex" } -> "color: red; display: flex". */
export function looksText(looks: Record<string, string>): string {
    return Object.entries(looks).map(([prop, value]) => `${prop}: ${value}`).join('; ');
}

/** The reverse of looksText, trusting nothing: "color: red; display: flex" -> { color: "red", display: "flex" }. */
export function parseLooks(text: string): Record<string, string> {
    const pairs: Record<string, string> = {};
    for (const part of text.split(';')) {
        const at = part.indexOf(':');
        if (at > 0) pairs[part.slice(0, at).trim()] = part.slice(at + 1).trim();
    }
    return cleanLooks(pairs);
}

// Following a link to a section in the editor (src/pageShell.ts). These two
// are copied into the overlay as they are, so they use nothing outside
// themselves.

/**
 * Where a link of the site goes, read from its href as the editor shows it
 * (src/siteFiles.ts rewriteUrls marks a page of the site with `prefix`):
 * "#prices" -> { page: "", id: "prices" } (this page);
 * prefix + "about.html#team" -> { page: "about.html", id: "team" };
 * prefix + "about.html" -> { page: "about.html", id: "" }. A web address,
 * or anything else, is null.
 */
export function sectionLink(href: string, prefix: string): { page: string; id: string } | null {
    if (href.startsWith(prefix)) {
        const rest = href.slice(prefix.length);
        const at = rest.indexOf('#');
        return at === -1 ? { page: rest, id: '' } : { page: rest.slice(0, at), id: rest.slice(at + 1) };
    }
    return href.startsWith('#') ? { page: '', id: href.slice(1) } : null;
}

/**
 * Where the editor scrolls to show a section, as a browser would: its top
 * at the top of the page area (just under the bar, `bar` px), sideways only
 * as far as it takes to show it, and never past `end`, the page's own
 * height without the editor's room below it. `box` is the section's place
 * in the view now; null is the top of the page.
 */
export function sectionScroll(box: { top: number; left: number; right: number } | null,
    scroll: { x: number; y: number }, view: { width: number; height: number }, bar: number, end: number): { left: number; top: number } {
    const most = Math.max(0, end - view.height);
    if (!box) return { left: scroll.x, top: 0 };
    let left = scroll.x;
    if (box.left < 0) left += box.left;
    else if (box.right > view.width) left += Math.min(box.left, box.right - view.width);
    return { left: Math.max(0, Math.round(left)), top: Math.max(0, Math.min(Math.round(box.top + scroll.y - bar), most)) };
}
