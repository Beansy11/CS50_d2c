// The page shell: what Draw2Code wraps around someone's real page so it can be
// shown, and edited, inside a webview.
//
// Both the site preview and the designer use this, so there is one overlay,
// not two. What differs is the bar across the top and whether editing is
// always on (designer) or a toggle (preview).
//
// Why the page IS the webview document (learned the hard way):
//   - VS Code serves local files to the webview itself, not to an
//     <iframe srcdoc> inside it, so a framed page loses every asset;
//   - a <base href> makes VS Code's own frame resolve against the resource
//     origin, which its outer CSP blocks, and the tab renders blank.
// So every relative URL is rewritten to a webview URI instead, and the bar
// and editing layer are injected into the page inside a shadow root.
//
// CS50 citation: the name Draw2Code Web Editor was chosen with help from
// Claude (Anthropic AI), and at my direction Claude renamed
// the project from its earlier name, HardHat Designer, throughout this file.
//
// CS50 citation: the page's backdrop (the white painted behind an imported
// page that sets no background of its own, in the reset style and near the
// end of the page script) was written by Claude (Anthropic AI). I
// instructed Claude to fix it because I was in a hurry. Why it needed
// fixing: my reset made <html> and <body> transparent to undo VS Code's
// styles, so in a dark VS Code theme a plain page showed black text on near
// black instead of on white as in a browser, and could not be read.
//
// CS50 citation: the toolbar's symbols (TOOL_ICONS and the other icons below
// them), the description each one shows on hover, and the mouse wheel
// scrolling the row sideways were written by Claude (Anthropic AI) at my
// direction. How we got here: the toolbar's word labels made it
// about 1,200px wide, so in a narrow panel its last controls were off-screen.
// I asked Claude to suggest a fix. It first offered four options (symbols,
// wrapping to a second row, a "More" menu, wheel scrolling) and then, when I
// said it had to be especially useful to new users, it suggested keeping the
// words and adding a hint line. I chose symbols with a description on hover
// instead, to keep the toolbar minimal, and set the biggest requirement: what
// the editor shows must be the same as the website in a browser. That is why
// the toolbar stays one row of the same height (TOOLBAR_HEIGHT), so the page
// is never moved or squeezed and drawing lands where it does today. The hover
// text is the descriptions I had already written for each tool.
//
// CS50 citation: the fix that gives Delete back to the page after a toolbar
// field (releaseField, used by the style fields and the page's pointerdown)
// was written by Claude (Anthropic AI), at my direction. I
// used Claude for it because it was a small, quick fix, while I prepared to
// record my 3 minute video. The bug: after changing a colour, a border width
// or a font size, or typing in the address bar, the keyboard stayed in that
// field, so Delete went to the field and did nothing, and pressing on the
// selected element again did not help because that press starts a move.
//
// CS50 citation: two fixes found in a dry run where Claude built a website
// with the editor, written by Claude (Anthropic AI) at my
// direction. First, a picture on a page made with "+" showed in a browser
// but not in the editor: VS Code gives every webview img { max-height: 100% },
// and on a page where everything is placed freely the page's box is 0px
// tall, so the picture was squashed to nothing. The reset now undoes that
// one rule, inside VS Code's own layer, so the page's styles still win as in
// a browser. Second, a space could not be typed in a Button: Chromium takes
// Space in a <button> as a press, so while retyping one the space is put in
// by hand (BUTTON_SPACE, in the key handlers).
//
// CS50 citation: the corner rounding field (st-radius: its symbol, reading,
// preview and writing) was written by Claude (Anthropic AI),
// at my direction. I asked for it so the website in my demo video can look
// like a professional product page: the editor had no way to round a
// corner, and only Buttons had one, fixed at 4px.

import * as path from 'path';
import * as vscode from 'vscode';
import { Align, alignDeclarations, alignOf, boxOf } from './align';
import { ARRIVED_ATTR, ARRIVING_RULE, arriveAfterLoad, arrivalScroll } from './arrival';
import { hexOf, RECENT_MAX, recentOf, recentWith } from './colours';
import { pageCsp } from './csp';
import { loadModel } from './design';
import { fieldKey } from './fieldKeys';
import { LINKABLE, PLAIN_LOOKS, sectionLink, sectionScroll } from './links';
import { FULL_WIDTH_CLASS, LINK_WAS_ATTR } from './pageEdit';
import { PHONE_HIDDEN_OPACITY } from './pageEditor';
import { PHONE_LAYOUT_CLASS } from './pageWidth';
import { drawnShape, redrawn } from './redraw';
import { edgeSpeed } from './edgeScroll';
import { boxCutToColumn, boxesInColumn, boxFieldDeclarations, boxFieldValue, boxInColumn, drawnHandle, drawnSize, dragsFreely, fieldInColumn, isFreeKey, firstLineFrom, resizedBox, snapBox, snapLines, xInColumn } from './placement';
import { roomBox, roomOnly } from './room';
import { isUnderlined, underlineDeclarations } from './underline';
import { PAGE_LINK_PREFIX, rewriteUrls } from './siteFiles';

export interface ShellOptions {
    /** The page's HTML, as read from disk. */
    html: string;
    /** Absolute path of that page, and of the site root it belongs to. */
    file: string;
    siteRoot: string;
    /** Markup for the bar across the top (mode-specific). */
    bar: string;
    /** Can this page be edited at all (only the working copy can)? */
    editable: boolean;
    /** Designer: editing is always on. Preview: it is a toggle. */
    alwaysEditing: boolean;
    /** With this, the bar becomes the mock browser: tab strip + address row. */
    chrome?: ChromeOptions;
    /**
     * Show the drawing tools above the bar (the editor; the preview has none).
     * They need chrome too: it gives the extension folder the model is loaded from.
     */
    toolbar?: boolean;
    /**
     * Stylesheets whose saved file is not what the page should show (unsaved
     * edits): the page's <link> to each is replaced by the text itself.
     */
    heldStylesheets?: Array<{ file: string; css: string }>;
    /**
     * The colours used last in the toolbar, newest first. Kept by the
     * extension, so they are still there after the page is drawn again and
     * in the next session; the overlay sends each new one back.
     */
    recentColours?: string[];
    /**
     * The page width of a project Draw2Code made (src/pageWidth.ts): the
     * toolbar then has a button to change it. Absent for an imported site.
     */
    pageWidth?: number;
    /**
     * Rules of the editor's own, after the page's stylesheets: the phone
     * view's (src/pageEditor.ts phoneViewCss).
     */
    viewCss?: string;
    /**
     * A page made in Draw2Code: the toolbar has the Desktop / Phone toggle,
     * showing which view this is, and in the phone view Hide on phone; the
     * selectors listed are hidden on phones (shown faintly here).
     */
    phone?: {
        on: boolean;
        layout: boolean;
        hidden: string[];
        /** In the phone view: the page's Draw2Code rules as the desktop view has them, to measure its desktop boxes by. */
        desktopCss?: string;
    };
    /** Ids of elements to select once the page is shown: what was just pasted or duplicated. */
    select?: string[];
    /**
     * Ctrl+C, Ctrl+V and Ctrl+D copy, paste and duplicate the selection
     * (the editor). Without it they are the browser's own (the preview).
     */
    copyPaste?: boolean;
}

/** The drawing tools, in the canvas's order. Select is the way out of a tool. */
const TOOLS: Array<[string, string, string]> = [
    ['select', 'Select', 'Select, move, resize, retype - Shift+click selects more, Ctrl held while dragging turns snapping off, Ctrl+C / Ctrl+V copy and paste (onto any page of the site), Ctrl+D duplicates'],
    ['rect', 'Rect', 'Draw a rectangle'],
    ['ellipse', 'Ellipse', 'Draw an ellipse'],
    ['line', 'Line', 'Draw a line'],
    ['pen', 'Pen', 'Draw freehand'],
    ['button', 'Button', 'Add a button (drag a size, or click for the default)'],
    ['input', 'Input', 'Add a text box (double-click it to change the words it shows while empty)'],
    ['label', 'Label', 'Add a label'],
    ['paragraph', 'Text', 'Add text that wraps in its box (Shift+Enter starts a new line when retyping)'],
    ['heading', 'Heading', 'Add a heading'],
    ['image', 'Image', 'Add a picture (drag a size, or click for the default) - the editor asks for the file and what it shows'],
    ['video', 'Video', 'Add a video (drag a size, or click for the default)'],
];

/**
 * The two kinds the Video tool adds, picked in the small list beside it:
 * each one's name in the list and on the Video button, and what it is.
 */
const VIDEO_KINDS: Record<string, { item: string; label: string; title: string }> = {
    own: {
        item: 'Your own video',
        label: 'Video (your own file)',
        title: 'an .mp4 and/or a .webm of your own, copied into the site and played in its own player. Best give both, the same video: the .webm plays in browsers such as Fedora\'s, the .mp4 in this editor and in Safari and other systems that play H.264',
    },
    hosted: {
        item: 'Hosted video',
        label: 'Video (hosted)',
        title: 'a YouTube or Vimeo link, played in their player',
    },
};
/** The kind the Video tool adds until another is picked. */
const VIDEO_KIND_DEFAULT = 'own';

/** The Video button's name and hover description while it adds `kind`. */
function videoButton(kind: string): { label: string; title: string } {
    const tool = TOOLS.find(([name]) => name === 'video');
    return { label: VIDEO_KINDS[kind].label, title: `${VIDEO_KINDS[kind].label} - ${tool ? tool[2] : ''}: ${VIDEO_KINDS[kind].title}. The arrow beside it picks the other kind` };
}
const TOOLBAR_HEIGHT = 32;
/** The most a corner can be rounded, in px: past it, a box is as round as it gets. */
const RADIUS_MAX = 200;
/**
 * How near, in px, an edge or centre of a box being moved, resized or drawn
 * must come to another's to snap onto it (src/placement.ts).
 */
const SNAP_PX = 6;

/**
 * The toolbar's symbols: the inside of a 16x16 <svg>, drawn in the button's
 * text colour. Line drawings, so they stay readable at this size; the name
 * and what each does are in its hover description.
 */
const TOOL_ICONS: Record<string, string> = {
    select: '<path d="M4 2v11l3-3 2 4.5 1.8-.8-2-4.4H13z" fill="currentColor" stroke="none"/>',
    rect: '<rect x="2" y="3.5" width="12" height="9"/>',
    ellipse: '<ellipse cx="8" cy="8" rx="6" ry="4.5"/>',
    line: '<path d="M2.5 13.5l11-11"/>',
    pen: '<path d="M2 12c1.5-5 3.5-5 4.5-1.5S10 12 11 7s2-4.5 3-4"/>',
    button: '<rect x="1.5" y="4.5" width="13" height="7" rx="3"/><path d="M5.5 8h5"/>',
    input: '<rect x="1.5" y="4.5" width="13" height="7"/><path d="M4.5 6.5v3"/>',
    label: '<path d="M3.5 13L8 3l4.5 10M5.3 9.5h5.4"/>',
    paragraph: '<path d="M2 3.5h12M2 6.5h12M2 9.5h12M2 12.5h7"/>',
    heading: '<path d="M3.5 3v10M12.5 3v10M3.5 8h9"/>',
    image: '<rect x="2" y="3" width="12" height="10"/><path d="M2 11.5l3.5-3.5 3 3 2-2 3.5 3.5"/><circle cx="10.5" cy="6" r="1"/>',
    video: '<rect x="1.5" y="3" width="13" height="10" rx="2"/><path d="M6.5 5.8v4.4L10.2 8z" fill="currentColor"/>',
};
/** The style controls' symbols, the same way: one beside each field. */
const STYLE_ICONS: Record<string, string> = {
    fill: '<rect x="2.5" y="2.5" width="11" height="11" fill="currentColor"/>',
    nofill: '<rect x="2.5" y="2.5" width="11" height="11"/><path d="M2.5 13.5l11-11"/>',
    stroke: '<rect x="3" y="3" width="10" height="10" stroke-width="2.5"/>',
    radius: '<path d="M2.5 13.5V8.5a6 6 0 0 1 6-6h5"/>',
    width: '<path d="M2 3.5h12" stroke-width="1"/><path d="M2 7.5h12" stroke-width="2"/><path d="M2 12h12" stroke-width="3"/>',
    text: '<path d="M4 10.5L8 2l4 8.5M5.6 7.5h4.8"/><path d="M2.5 14h11" stroke-width="2.5"/>',
    size: '<path d="M1 13l2.5-6 2.5 6M1.8 11h3.4M7.5 13L11 3l3.5 10M8.6 10h4.8"/>',
    more: '<path d="M4.5 6.5L8 10l3.5-3.5"/>',
    link: '<path d="M7 9.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2L8.2 4M9 6.5a3 3 0 0 0-4.2 0L2.5 8.8a3 3 0 0 0 4.2 4.2L7.8 12"/>',
    // The window's two sides, and a band reaching from one to the other.
    full: '<path d="M1.5 2.5v11M14.5 2.5v11"/><rect x="1.5" y="5.5" width="13" height="5" fill="currentColor" stroke="none"/>',
    // A page, and how wide it is across.
    page: '<rect x="2" y="2.5" width="12" height="11"/><path d="M4.5 8h7M6 6.5L4.5 8 6 9.5M10 6.5l1.5 1.5L10 9.5"/>',
    // A phone, upright.
    phone: '<rect x="4.5" y="1.5" width="7" height="13" rx="1.5"/><path d="M7 12.5h2"/>',
    // A phone with a line through it.
    hide: '<rect x="4.5" y="1.5" width="7" height="13" rx="1.5"/><path d="M2 14L14 2"/>',
    // A phone, and an arrow going round: made again.
    reset: '<rect x="1.5" y="3.5" width="6" height="11" rx="1.2"/><path d="M10 3.5a4 4 0 0 1 4 4M14 7.5l-1.8-.6M14 7.5l.6-1.8"/>',
};
/**
 * The box fields' symbols: x and y are an arrow from the page's left or top
 * edge, width and height an arrow between two sides.
 */
const BOX_ICONS: Record<string, string> = {
    x: '<path d="M2 2.5v11M5 8h8.5M11 5.5L13.5 8 11 10.5"/>',
    y: '<path d="M2.5 2h11M8 5v8.5M5.5 11L8 13.5 10.5 11"/>',
    width: '<path d="M1.5 3v10M14.5 3v10M4 8h8M6 6L4 8l2 2M10 6l2 2-2 2"/>',
    height: '<path d="M3 1.5h10M3 14.5h10M8 4v8M6 6l2-2 2 2M6 10l2 2 2-2"/>',
};
/** The box fields, in the toolbar's order: [field, name, hover description]. */
const BOX_FIELDS: Array<[string, string, string]> = [
    ['x', 'X', 'X (px) - how far the selected element is from the left of the page (on a page made in Draw2Code, of its centred column). Type a number: Enter or leaving the field moves it'],
    ['y', 'Y', 'Y (px) - how far the selected element is from the top of the page. Type a number: Enter or leaving the field moves it'],
    ['width', 'Width', 'Width (px) - how wide the selected element is. Type a number: Enter or leaving the field resizes it'],
    ['height', 'Height', 'Height (px) - how tall the selected element is; for Text and Heading the least height, as the box grows with its words. Type a number: Enter or leaving the field resizes it'],
];
/** A symbol as markup: decorative, since its control carries the name. */
function icon(inner: string): string {
    return `<svg class="d2c-glyph" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
}

/** The alignment buttons, each with its picture: three lines lined up as the words will be. */
const ALIGNS: Array<[Align, string, string]> = [
    ['left', 'Align left', 'M1 2h12M1 6h8M1 10h10'],
    ['center', 'Align centre', 'M1 2h12M3 6h8M2 10h10'],
    ['right', 'Align right', 'M1 2h12M5 6h8M3 10h10'],
];

/**
 * The browser bar over a real page. It is the SAME bar as the canvas's:
 * media/chrome.js builds it and media/chrome.css styles it, here inside the
 * shadow root; this only says what it shows.
 */
export interface ChromeOptions {
    /** Where media/chrome.js and chrome.css are loaded from. */
    extensionUri: vscode.Uri;
    /** The pages with a tab, in order, with their <title>s. */
    tabs: Array<{ name: string; title: string }>;
    /** The page being shown, and every page of the site (for the address). */
    page: string;
    pages: string[];
    canBack: boolean;
    canForward: boolean;
    /** Show `+`? It writes a new page into the development copy. */
    addable: boolean;
}

/** Where the page starts: the bar's height, as media/chrome.css sizes it. */
export const CHROME = Object.freeze({
    tabStripHeight: 36,
    navHeight: 44,
});

const PLAIN_BAR_HEIGHT = 28;

/** The page's <title>, for the mock browser tab. */
export function pageTitle(html: string, fallback: string): string {
    const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
    const title = match ? match[1].trim() : '';
    return title || fallback;
}

export function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Take a page off disk and return what the webview should show: the page
 * itself, with its URLs rewritten, our styles reset, and the bar and editing
 * layer injected.
 */
export function buildPageHtml(webview: vscode.Webview, options: ShellOptions): string {
    const uri = (p: string) => webview.asWebviewUri(vscode.Uri.file(p)).toString();
    let html = rewriteUrls(options.html, path.dirname(options.file), options.siteRoot, uri);
    for (const sheet of options.heldStylesheets ?? []) {
        const href = uri(sheet.file);
        // Our own rules (src/pageEdit.ts renderOverrides): selectors and colours, never markup.
        // In the page, an address in them is read from the page, not the stylesheet: each is made whole.
        const css = sheet.css.replace(/url\(\s*(["']?)([^)"']+)\1\s*\)/gi, (m, quote: string, url: string) =>
            /^([a-z][a-z0-9+.-]*:|\/|#)/i.test(url) ? m : `url(${quote}${uri(path.resolve(path.dirname(sheet.file), url))}${quote})`);
        html = html.replace(/<link\b[^>]*>/gi, (tag) => tag.includes(href) ? `<style data-d2c-held>\n${css}\n</style>` : tag);
    }

    // What the page may load: see src/csp.ts.
    const csp = pageCsp(webview.cspSource);

    // VS Code injects its own styles into every webview (body padding, its
    // font and colours) inside @layer vscode-default. An UNLAYERED rule beats
    // any layered one, so this reset wins over VS Code; the site's own
    // stylesheets come after it and win over this, giving the page the plain
    // browser defaults it was written against.
    const reset = `<style data-draw2code-ui>
html { scrollbar-color: initial; }
html, body { font: initial; color: initial; background: initial; letter-spacing: initial; }
/* The white a browser paints behind a page that sets no background of its own
   (see "the page's backdrop" in the script below). */
html[data-draw2code-backdrop] { background-color: #fff; }
/* A page that only scrolls because of the editor's room below it has no
   scrollbar, as in a browser, so it keeps its whole width (src/room.ts). */
html[data-draw2code-room-only] { scrollbar-width: none; }
/* For a moment while that is measured: a page made in Draw2Code without its
   wrapper's least height (min-height: 100vh), so it is as tall as its elements. */
html[data-draw2code-measuring] body > div.page:first-child { min-height: 0 !important; }
/* Until the page has loaded, it scrolls at once whatever it asks for: a page
   drawn again is shown where it was, not slid back down to it (src/arrival.ts). */
${ARRIVING_RULE}
body { margin: 8px; padding: 0; }
/* The page is pushed down to make room for the bar. Positioning <html>
   makes it the containing block for the page's absolute elements, so they
   are pushed down with everything else instead of hiding under the bar -
   and what Draw2Code places freely is written in the page's own coordinates. */
html { position: relative; }
/* VS Code's own img, video { max-width: 100%; max-height: 100% }, in its layer,
   put back to a browser's (none): with <html> the containing block above, a
   page of freely placed elements is 0px tall, and a picture on it would be
   squashed to nothing. In the same layer, so the page's own rules still win. */
@layer vscode-default { img, video { max-width: none; max-height: none; } }
/* While editing, a press anywhere on a video (its player's controls, a
   hosted player's frame) lands on the video's box, so it is selected, moved,
   resized and deleted like any element. Frames the page has of its own are
   pressed through to what holds them the same way. Nothing looks different;
   with editing off in the preview, videos play. */
html[data-draw2code-editing] :is(.video-player, .video-embed) *, html[data-draw2code-editing] iframe { pointer-events: none !important; }
</style>`;
    // Marked as ours, so the overlay never counts them as part of the page.
    const head = `<meta data-draw2code-ui http-equiv="Content-Security-Policy" content="${csp}">\n${reset}`;
    html = /<head[^>]*>/i.test(html)
        ? html.replace(/<head[^>]*>/i, (m) => `${m}\n${head}`)
        : `${head}\n${html}`;
    // After the page's own stylesheets, so it wins over them: our rules, never markup.
    if (options.viewCss) {
        const view = `<style data-draw2code-ui data-d2c-view>\n${options.viewCss}\n</style>`;
        html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${view}\n</head>`) : `${view}\n${html}`;
    }

    const overlay = overlayMarkup(webview, options);
    return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${overlay}\n</body>`) : `${html}\n${overlay}`;
}

function overlayMarkup(webview: vscode.Webview, options: ShellOptions): string {
    const chrome = options.chrome;
    // The Size box takes its range from the model, found through the bar's extension folder.
    const model = options.toolbar && options.editable && chrome ? loadModel(chrome.extensionUri) : undefined;
    const TOOLBAR = Boolean(model);
    const TOOLBAR_PX = TOOLBAR ? TOOLBAR_HEIGHT : 0;
    const BAR_HEIGHT = (chrome ? CHROME.tabStripHeight + CHROME.navHeight : PLAIN_BAR_HEIGHT) + TOOLBAR_PX;
    // Beside each colour box, the small list of src/colours.ts: a hex code
    // typed, or a colour used lately. It opens below the toolbar, over the
    // bar and the page (after the bar, so on top of it), so the toolbar
    // stays one row and the page does not move.
    const MORE = (which: string, name: string) => `<button class="d2c-more" id="st-${which}-more" data-colour="${which}" title="${escapeHtml(`${name} - type a hex code, or pick a colour used lately`)}" aria-label="${escapeHtml(`${name}: hex code and recent colours`)}" aria-haspopup="true" aria-expanded="false">${icon(STYLE_ICONS.more)}</button>`;
    const COLOURS_MARKUP = TOOLBAR
        ? `<div class="d2c-colours" id="colours" hidden>
            <input type="text" id="colours-hex" maxlength="7" spellcheck="false" autocomplete="off" placeholder="#rrggbb" aria-label="Hex code" title="Hex code, like #0b1020 - Enter uses it, Esc puts the colour back">
            <div class="d2c-recent" id="colours-recent"></div>
        </div>`
        : '';
    const RECENT_COLOURS = JSON.stringify(recentOf(options.recentColours ?? [], RECENT_MAX));
    // Beside the Video tool, the same kind of small arrow: the list it opens
    // picks which kind of video the tool adds. Below the toolbar too.
    const VIDEO_MORE = `<button class="d2c-more" id="video-kind-more" title="Video kind - your own file, or a YouTube or Vimeo link" aria-label="Video kind" aria-haspopup="menu" aria-expanded="false" aria-controls="video-kinds">${icon(STYLE_ICONS.more)}</button>`;
    const KINDS_MARKUP = TOOLBAR
        ? `<div class="d2c-kinds" id="video-kinds" role="menu" aria-label="Video kind" hidden>${Object.entries(VIDEO_KINDS).map(([kind, about]) =>
            `<button class="d2c-kind" role="menuitemradio" aria-checked="${kind === VIDEO_KIND_DEFAULT}" data-kind="${kind}" tabindex="-1" title="${escapeHtml(`${about.item} - ${about.title}`)}">${escapeHtml(about.item)}</button>`).join('')}</div>`
        : '';
    const VIDEO_BUTTONS = JSON.stringify(Object.fromEntries(Object.keys(VIDEO_KINDS).map((kind) => [kind, videoButton(kind)])));
    // The canvas's style controls too: with an element selected they show
    // and change ITS colours; with nothing selected they set the next shape.
    const STYLE_MARKUP = `<span class="d2c-sep"></span>
        <label class="d2c-style" title="Fill - the background colour">${icon(STYLE_ICONS.fill)}<input type="color" id="st-fill" aria-label="Fill"></label>${MORE('fill', 'Fill')}
        <label class="d2c-style" title="No fill - a see-through background">${icon(STYLE_ICONS.nofill)}<input type="checkbox" id="st-nofill" aria-label="No fill"></label>
        <label class="d2c-style" title="Border colour">${icon(STYLE_ICONS.stroke)}<input type="color" id="st-stroke" aria-label="Border colour"></label>${MORE('stroke', 'Border colour')}
        <label class="d2c-style" title="Border width (px)">${icon(STYLE_ICONS.width)}<input type="number" id="st-width" min="0" max="20" aria-label="Border width"></label>
        <label class="d2c-style" title="Corner rounding (px) - 0 is square">${icon(STYLE_ICONS.radius)}<input type="number" id="st-radius" min="0" max="${RADIUS_MAX}" aria-label="Corner rounding"></label>
        <label class="d2c-style" title="Text colour">${icon(STYLE_ICONS.text)}<input type="color" id="st-text" aria-label="Text colour"></label>${MORE('text', 'Text colour')}
        <label class="d2c-style" title="Font size (px)">${icon(STYLE_ICONS.size)}<input type="number" id="st-size" min="${model?.FONT_MIN}" max="${model?.FONT_MAX}" aria-label="Font size"></label>`;
    // The selected element's place and size, in the page's coordinates
    // (src/placement.ts): off with nothing selected.
    const BOX_MARKUP = `<span class="d2c-sep"></span>
        ${BOX_FIELDS.map(([field, name, title]) => `<label class="d2c-style d2c-box" title="${escapeHtml(title)}">${icon(BOX_ICONS[field])}<input type="number" id="box-${field}" aria-label="${escapeHtml(name)}" disabled></label>`).join('\n        ')}`;
    // Not a tool: it acts on the selected element at once, and the editor
    // asks where the link goes.
    const LINK_MARKUP = `<span class="d2c-sep"></span>
        <button class="d2c-action" id="link" title="Link - make the selected button or text a link, to a page of this site, a section of a page or a web address" aria-label="Link" disabled>${icon(STYLE_ICONS.link)}</button>`;
    // On a page made in Draw2Code: the selected element across the whole
    // window, and the width of every page (asked, then confirmed).
    const WIDTH_MARKUP = `<button class="d2c-action" id="full-width" title="Full width - stretch the selected element across the whole window, keeping its place from the top and its height: for a section's background. The rest of the page stays in its centred column. Click again to put it back in the page's width (only for elements placed freely on a page made in Draw2Code)" aria-label="Full width" aria-pressed="false" disabled>${icon(STYLE_ICONS.full)}</button>${options.pageWidth === undefined ? '' : `
        <span class="d2c-sep"></span>
        <button class="d2c-action" id="page-width" title="${escapeHtml(`Page width (now ${options.pageWidth}px) - how wide every page of this project is, centred in a wider window. Asks for the new width, then what it changes, before anything changes`)}" aria-label="Page width">${icon(STYLE_ICONS.page)}</button>`}${options.phone ? `
        <span class="d2c-sep"></span>
        <button class="d2c-action${options.phone.on ? ' on' : ''}" id="phone-view" title="${escapeHtml(options.phone.on
            ? 'Phone view - this page as a phone shows it. A move, a resize, a font size or an alignment changes it on phones only; colours, words, links and the rest change it everywhere. Click for the desktop view'
            : 'Phone view - lay this page out for phones. The first time, it asks before making the page a phone layout of its own')}" aria-label="Phone view" aria-pressed="${options.phone.on}">${icon(STYLE_ICONS.phone)}</button>${options.phone.on ? `
        <button class="d2c-action" id="phone-hide" title="Hide on phone - the selected element is not shown on phones (here it is shown faintly). Click again to show it" aria-label="Hide on phone" aria-pressed="false" disabled>${icon(STYLE_ICONS.hide)}</button>
        <button class="d2c-action" id="phone-reset" title="Reset phone layout - make this page's phone layout again from its desktop layout, as the first time. Asks first; Ctrl+Z puts the layout back" aria-label="Reset phone layout">${icon(STYLE_ICONS.reset)}</button>` : ''}` : ''}`;
    // Not tools either: each click changes the selected element at once.
    const TEXT_MARKUP = `<span class="d2c-sep"></span>
        <button class="d2c-action" id="st-bold" title="Bold, or back to normal weight" disabled><b>B</b></button>
        <button class="d2c-action" id="st-underline" title="Underline - underline the selected text, or take its underline away: a link's too" aria-label="Underline" aria-pressed="false" disabled><span class="d2c-u">U</span></button>
        ${ALIGNS.map(([align, title, lines]) => `<button class="d2c-action" id="st-${align}" title="${escapeHtml(title)}" disabled><svg width="14" height="12" viewBox="0 0 14 12"><path d="${lines}" stroke="currentColor" stroke-width="1.5"/></svg></button>`).join('')}`;
    const TOOLBAR_MARKUP = TOOLBAR
        ? `<div class="d2c-toolbar" id="toolbar">${TOOLS.map(([tool, label, title]) => {
            const named = tool === 'video' ? videoButton(VIDEO_KIND_DEFAULT) : { label, title: `${label} - ${title}` };
            return `<button class="d2c-tool${tool === 'select' ? ' active' : ''}" data-tool="${tool}" title="${escapeHtml(named.title)}" aria-label="${escapeHtml(named.label)}">${icon(TOOL_ICONS[tool])}</button>${tool === 'video' ? VIDEO_MORE : ''}`;
        }).join('')}${BOX_MARKUP}${STYLE_MARKUP}${TEXT_MARKUP}${LINK_MARKUP}${WIDTH_MARKUP}</div>`
        : '';
    const PAGES = JSON.stringify(chrome ? chrome.pages : []);
    const CURRENT_PAGE = JSON.stringify(chrome ? chrome.page : '');
    // The page shown, as a link of the site names it: also without the browser bar (the preview).
    const PAGE_NAME = JSON.stringify(path.relative(options.siteRoot, options.file).split(path.sep).join('/'));
    const EDITABLE = JSON.stringify(options.editable);
    const ALWAYS_EDITING = JSON.stringify(options.alwaysEditing);
    const COPY_PASTE = JSON.stringify(Boolean(options.copyPaste));
    // Selectors from the page's ids: a "</script>" in one must not end the script.
    const PHONE = JSON.stringify(options.phone ?? null).replace(/</g, '\\u003c');
    // With the browser bar: the shared module (loaded from media/) is mounted
    // into the shadow root and given the tabs; the editing controls go in
    // its tools slot. Without it: the plain one-row bar the preview uses.
    const media = (file: string) => chrome
        ? webview.asWebviewUri(vscode.Uri.joinPath(chrome.extensionUri, 'website-editor', 'media', file)).toString()
        : '';
    const CHROME_VIEW = JSON.stringify(chrome ? {
        pages: chrome.tabs.map((t) => ({ name: t.name, title: t.title, active: t.name === chrome.page, closable: chrome.tabs.length > 1 })),
        address: chrome.page,
        canBack: chrome.canBack,
        canForward: chrome.canForward,
        addable: chrome.addable,
        suggestions: chrome.pages,
        tools: options.bar,
    } : null);
    const BAR_MARKUP = chrome
        ? `<link rel="stylesheet" href="${media('chrome.css')}"><div class="chrome-host" id="chrome"></div>`
        : `<div class="bar">${options.bar}</div>`;
    return /* html */ `
<div id="__draw2code_bar" data-draw2code-ui></div>
${chrome ? `<script data-draw2code-ui src="${media('chrome.js')}"></script>` : ''}
<script data-draw2code-ui>
(function () {
    const vscode = acquireVsCodeApi();
    const HOST = document.getElementById('__draw2code_bar');
    const root = HOST.attachShadow({ mode: 'open' });
    root.innerHTML = \`
        <style>
            :host { all: initial; }
            /* Where the shared bar sits over the page; its look is chrome.css. */
            .chrome-host { position: fixed; top: ${TOOLBAR_PX}px; left: 0; right: 0; z-index: 2147483647; }
            /* The drawing tools, above the bar, as symbols (the name is on hover); a very narrow panel scrolls to the last controls, by wheel too. */
            .d2c-toolbar { position: fixed; top: 0; left: 0; right: 0; height: ${TOOLBAR_HEIGHT}px; z-index: 2147483647;
                          display: flex; align-items: center; gap: 4px; padding: 0 8px; box-sizing: border-box;
                          background: #252526; border-bottom: 1px solid #3c3c3c; font: 12px system-ui, sans-serif;
                          overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; }
            .d2c-tool, .d2c-action { background: #3c3c3c; color: #ccc; border: 1px solid #555; border-radius: 3px;
                                     padding: 2px 5px; font: inherit; cursor: pointer; flex: none; }
            .d2c-glyph { display: block; }
            .d2c-action[disabled] { cursor: default; opacity: 0.4; }
            .d2c-action svg { display: block; }
            .d2c-u { text-decoration: underline; }
            .d2c-tool.active { background: #0e639c; color: #fff; border-color: #0e639c; }
            .d2c-tool[data-tool="pen"], #video-kind-more { margin-right: 4px; }
            .d2c-sep { width: 1px; height: 18px; background: #555; margin: 0 4px; flex: none; }
            .d2c-style { display: inline-flex; align-items: center; gap: 3px; color: #ccc; flex: none; }
            .d2c-style input[type="color"] { width: 26px; height: 20px; padding: 0; border: 1px solid #555; background: none; }
            .d2c-style input[type="number"] { width: 40px; background: #3c3c3c; color: #ccc; border: 1px solid #555; border-radius: 3px; font: inherit; padding: 1px 4px; }
            .d2c-style input[disabled] { opacity: 0.4; }
            .d2c-box input[type="number"] { width: 52px; }
            /* The arrow beside a colour box, and the list it opens: a hex field and the colours used lately. */
            .d2c-more { background: none; color: #ccc; border: 1px solid transparent; border-radius: 3px; padding: 2px 0; margin-left: -2px;
                        cursor: pointer; flex: none; }
            .d2c-more .d2c-glyph { width: 10px; }
            .d2c-more:hover, .d2c-more[aria-expanded="true"] { border-color: #555; background: #3c3c3c; }
            .d2c-more[disabled] { cursor: default; opacity: 0.4; background: none; border-color: transparent; }
            .d2c-colours { position: fixed; top: ${TOOLBAR_HEIGHT}px; left: 0; z-index: 2147483647; box-sizing: border-box;
                           display: flex; flex-direction: column; gap: 6px; padding: 6px; max-width: 230px;
                           background: #252526; border: 1px solid #555; border-radius: 3px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
                           font: 12px system-ui, sans-serif; color: #ccc; }
            .d2c-colours[hidden] { display: none; }
            .d2c-colours input { width: 80px; background: #3c3c3c; color: #ccc; border: 1px solid #555; border-radius: 3px;
                                 font: 12px ui-monospace, monospace; padding: 2px 4px; }
            .d2c-recent { display: flex; flex-wrap: wrap; gap: 4px; }
            .d2c-recent .d2c-swatch { width: 18px; height: 18px; padding: 0; border: 1px solid #555; border-radius: 3px; cursor: pointer; }
            .d2c-recent .d2c-swatch:hover, .d2c-recent .d2c-swatch:focus-visible { border-color: #fff; }
            .d2c-recent .d2c-none { color: #8a8a8a; }
            /* The list beside Video: which kind of video it adds, the one in use ticked. */
            .d2c-kinds { position: fixed; top: ${TOOLBAR_HEIGHT}px; left: 0; z-index: 2147483647; box-sizing: border-box;
                         display: flex; flex-direction: column; padding: 4px; min-width: 150px;
                         background: #252526; border: 1px solid #555; border-radius: 3px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
                         font: 12px system-ui, sans-serif; }
            .d2c-kinds[hidden] { display: none; }
            .d2c-kind { background: none; color: #ccc; border: 1px solid transparent; border-radius: 3px; padding: 3px 8px 3px 20px;
                        text-align: left; white-space: nowrap; cursor: pointer; position: relative; }
            .d2c-kind:hover, .d2c-kind:focus-visible { background: #3c3c3c; border-color: #555; outline: none; }
            .d2c-kind[aria-checked="true"] { color: #fff; }
            .d2c-kind[aria-checked="true"]::before { content: ''; position: absolute; left: 7px; top: 50%; width: 6px; height: 6px;
                                                     margin-top: -3px; border-radius: 50%; background: currentColor; }
            /* The box being drawn. */
            .draft { position: fixed; border: 1px dashed #0e639c; background: rgba(14, 99, 156, 0.12);
                     pointer-events: none; display: none; }
            .bar { position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
                   display: flex; align-items: center; gap: 8px; height: 28px; padding: 0 8px; box-sizing: border-box;
                   background: #252526; color: #ccc; border-bottom: 1px solid #3c3c3c; font: 12px system-ui, sans-serif; }
            select, button { background: #3c3c3c; color: #ccc; border: 1px solid #555; border-radius: 3px; padding: 1px 6px; font: inherit; }
            button.on { background: #0e639c; color: #fff; border-color: #0e639c; }
            .spacer { flex: 1; }
            .hint { color: #8a8a8a; }
            button[disabled] { opacity: 0.4; }
            .tab { background: #3a3a40; color: #eee; border-radius: 6px 6px 0 0;
                   padding: 4px 12px; margin-right: 6px; max-width: 220px;
                   overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .address { flex: 1; min-width: 80px; border-radius: 12px; padding: 2px 10px; }
            /* Editing layer: outlines and handles, drawn over the page. */
            .layer { position: fixed; inset: 0; z-index: 2147483646; pointer-events: none; }
            .hover { position: fixed; border: 1px dashed #0e639c; pointer-events: none; display: none; }
            /* Purely visual: if it caught clicks, nothing underneath could be
               selected, dragged or double-clicked. */
            .sel { position: fixed; border: 1px solid #0e639c; pointer-events: none; display: none; }
            .tag { position: absolute; top: -18px; left: -1px; background: #0e639c; color: #fff;
                   font: 10px system-ui, sans-serif; padding: 1px 4px; white-space: nowrap; }
            .h { position: fixed; width: 9px; height: 9px; background: #fff; border: 1px solid #0e639c;
                 pointer-events: auto; display: none; }
            /* A line a box being dragged has snapped onto (src/placement.ts). */
            .guide { position: fixed; background: #f72585; pointer-events: none; display: none; }
            /* The editor's room below the page (src/room.ts): only scrolled into, never seen or pressed. */
            .room { position: absolute; left: 0; top: 0; width: 1px; height: 0; visibility: hidden; pointer-events: none; }
            /* The column of a page made in Draw2Code (see "the page's column" below): its two sides
               as thin dashed lines over the page, the whole height of the view. Never pressed. */
            .column-side { position: fixed; top: 0; bottom: 0; width: 1px; pointer-events: none; display: none;
                           background: repeating-linear-gradient(to bottom, rgba(14, 99, 156, 0.7) 0 4px, transparent 4px 8px); }
        </style>
        ${TOOLBAR_MARKUP}
        ${BAR_MARKUP}
        ${COLOURS_MARKUP}
        ${KINDS_MARKUP}
        <div class="layer" id="layer">
            ${TOOLBAR ? '<div class="column-side" id="column-left"></div><div class="column-side" id="column-right"></div>' : ''}
            <div class="draft" id="draft"></div>
            <div class="hover" id="hover"></div>
            <div class="sel" id="sel"><span class="tag" id="tag"></span></div>
        </div>
        ${TOOLBAR ? '<div class="room" id="room"></div>' : ''}\`;
    const $ = (id) => root.getElementById(id);
    // The page starts below the bar, exactly as it does on the canvas.
    document.documentElement.style.marginTop = '${BAR_HEIGHT}px';
    // The shared browser bar, if this shell has one. A tab is a page shown;
    // its x closes the tab and nothing else. The address goes to a page of
    // the site (typed with or without .html) and refuses anything else.
    const CHROME_VIEW = ${CHROME_VIEW};
    if (CHROME_VIEW && window.D2CChrome) {
        const chrome = window.D2CChrome.mount($('chrome'), {
            onShow: (name) => vscode.postMessage({ type: 'page', page: name }),
            onClose: (name) => vscode.postMessage({ type: 'closeTab', page: name }),
            onAdd: () => vscode.postMessage({ type: 'addPage' }),
            onRename: (name, title) => vscode.postMessage({ type: 'retitle', page: name, title }),
            onAddress: (value) => goToTyped(value, chrome),
            onBack: () => vscode.postMessage({ type: 'back' }),
            onForward: () => vscode.postMessage({ type: 'forward' }),
            onReload: () => vscode.postMessage({ type: 'refresh' }),
        });
        chrome.render(CHROME_VIEW);
    }

    // ---- bar ----------------------------------------------------------
    // Controls a mode may or may not have; wire whichever exist.
    const on = (id, event, handler) => { const el = $(id); if (el) el.addEventListener(event, handler); };
    on('page', 'change', (e) => vscode.postMessage({ type: 'page', page: e.target.value }));
    on('src-copy', 'click', () => vscode.postMessage({ type: 'source', source: 'copy' }));
    on('src-original', 'click', () => vscode.postMessage({ type: 'source', source: 'original' }));
    on('apply', 'click', () => vscode.postMessage({ type: 'apply' }));
    on('preview', 'click', () => vscode.postMessage({ type: 'preview' }));
    // A typed address: a page of this site, with or without .html, goes
    // there; anything else is put back, because this bar can only show pages
    // of the site being edited.
    const PAGES = ${PAGES};
    const CURRENT_PAGE = ${CURRENT_PAGE};
    function goToTyped(value, chrome) {
        const want = String(value || '').trim().replace(/^[.\\/]+/, '').toLowerCase();
        const hit = PAGES.find((p) => p.toLowerCase() === want)
            || PAGES.find((p) => p.toLowerCase() === want + '.html')
            || PAGES.find((p) => p.toLowerCase().split('/').pop() === want)
            || PAGES.find((p) => p.toLowerCase().split('/').pop() === want + '.html');
        if (hit) { vscode.postMessage({ type: 'page', page: hit }); return; }
        chrome.address.value = CURRENT_PAGE;
        vscode.postMessage({ type: 'status', text: want ? '"' + want + '" is not a page of this site' : '' });
    }
    on('revert', 'click', () => {
        if (!selected) return;
        if (several()) {
            // Every one selected, as one step.
            const refs = chosen().filter((el) => !isFrame(el)).map(refOf);
            if (refs.length && refs.every(Boolean)) {
                vscode.postMessage({ type: 'edit', op: { op: 'batch', ref: {}, label: 'Revert elements', ops: refs.map((ref) => ({ op: 'revert', ref })) } });
            }
            return;
        }
        const ref = refOf(selected);
        if (ref) vscode.postMessage({ type: 'edit', op: { op: 'revert', ref } });
    });
    on('revert-page', 'click', () => {
        vscode.postMessage({ type: 'edit', op: { op: 'revertPage', ref: {} } });
    });

    const PAGE_LINK = ${JSON.stringify(PAGE_LINK_PREFIX)};
    const PAGE_NAME = ${PAGE_NAME};
    const WAS_ATTR = ${JSON.stringify(LINK_WAS_ATTR)};
    const EDITABLE = ${EDITABLE};
    const ALWAYS_EDITING = ${ALWAYS_EDITING};
    const COPY_PASTE = ${COPY_PASTE};
    /** The phone view (src/pageShell.ts ShellOptions.phone); null on a page not made in Draw2Code. */
    const PHONE = ${PHONE};
    const PHONE_VIEW = Boolean(PHONE && PHONE.on);
    /** The white-space values that show a line break as one; the rest fold it into a space. */
    const KEEPS_LINES = ['pre', 'pre-wrap', 'pre-line', 'break-spaces'];

    // ---- editing ------------------------------------------------------
    const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    const handles = {};
    for (const name of HANDLES) {
        const h = document.createElement('div');
        h.className = 'h';
        h.dataset.handle = name;
        h.style.cursor = (name === 'n' || name === 's') ? 'ns-resize'
            : (name === 'e' || name === 'w') ? 'ew-resize'
            : (name === 'nw' || name === 'se') ? 'nwse-resize' : 'nesw-resize';
        $('layer').appendChild(h);
        handles[name] = h;
    }

    // A re-render (any file in the site changing) rebuilds this page, so edit
    // mode is remembered in the webview's own state instead of being lost.
    const saved = vscode.getState ? (vscode.getState() || {}) : {};
    /** Keep a change in that state, beside what is kept already. */
    function keepState(changes) {
        Object.assign(saved, changes);
        if (vscode.setState) vscode.setState({ ...saved });
    }
    let editing = false;      // edit mode on/off
    let selected = null;      // the page element being edited
    let others = [];          // the rest of the selection, picked with Shift+click
    let drag = null;          // { mode: 'move' | 'resize', handle, startX, startY, box }
    let typing = false;       // text editing in progress
    let justDragged = false;  // the click that ends a drag must not re-select
    // Following a link waits this long, so a double-click can say "no, I am
    // retyping this" first. Long enough for a real double-click, short
    // enough that clicking through the site does not feel stuck.
    const FOLLOW_DELAY = 280;
    let followTimer = 0;

    const isOurs = (el) => !el || el === HOST || (el.closest && el.closest('[data-draw2code-ui]'));

    /**
     * Where an element sits in the page: its id, or its position from <body>.
     * An id used twice names the FIRST one in the file, so for those the
     * position is sent: Delete on the second must not take out the first.
     */
    function refOf(el) {
        if (el.id && document.querySelectorAll('[id="' + CSS.escape(el.id) + '"]').length === 1) return { id: el.id };
        const path = [];
        let node = el;
        while (node && node !== document.body) {
            const parent = node.parentElement;
            if (!parent) return null;
            const siblings = Array.from(parent.children).filter((c) => !c.hasAttribute('data-draw2code-ui'));
            path.unshift(siblings.indexOf(node));
            node = parent;
        }
        return { path };
    }

    /** Everything selected: the one picked last first. */
    const chosen = () => selected ? [selected, ...others] : [];
    /** Several elements are selected: the controls that change one element are off. */
    const several = () => others.length > 0;

    /**
     * The selected elements an edit of the selection acts on, in the page's
     * order: not one inside another selected one (it goes, moves or is
     * copied with it), and never the page itself.
     */
    function outermost(list) {
        const kept = list.filter((el) => el && el.isConnected && !isFrame(el)
            && !list.some((other) => other !== el && other && other.contains(el)));
        return kept.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
    }

    function place(el, box) {
        el.style.left = box.left + 'px';
        el.style.top = box.top + 'px';
        el.style.width = box.width + 'px';
        el.style.height = box.height + 'px';
    }

    // The outlines of the rest of a selection, made as they are needed.
    const outlines = [];

    function paint() {
        const sel = $('sel');
        paintColumn();
        syncBox();
        others.forEach((el, i) => {
            if (!outlines[i]) {
                outlines[i] = document.createElement('div');
                outlines[i].className = 'sel';
                $('layer').appendChild(outlines[i]);
            }
            const r = el.getBoundingClientRect();
            outlines[i].style.display = 'block';
            place(outlines[i], { left: r.left, top: r.top, width: r.width, height: r.height });
        });
        for (let i = others.length; i < outlines.length; i++) outlines[i].style.display = 'none';
        if (!selected) {
            sel.style.display = 'none';
            for (const name of HANDLES) handles[name].style.display = 'none';
            return;
        }
        const r = selected.getBoundingClientRect();
        sel.style.display = 'block';
        place(sel, { left: r.left, top: r.top, width: r.width, height: r.height });
        $('tag').textContent = selected.tagName.toLowerCase() + (selected.id ? '#' + selected.id : '') + (several() ? ' +' + others.length : '');
        const points = { nw: [r.left, r.top], n: [r.left + r.width / 2, r.top], ne: [r.right, r.top],
                         e: [r.right, r.top + r.height / 2], se: [r.right, r.bottom],
                         s: [r.left + r.width / 2, r.bottom], sw: [r.left, r.bottom], w: [r.left, r.top + r.height / 2] };
        for (const name of HANDLES) {
            const [x, y] = points[name];
            const h = handles[name];
            // Several selected are moved together, never resized together.
            h.style.display = typing || several() ? 'none' : 'block';
            h.style.left = (x - 4.5) + 'px';
            h.style.top = (y - 4.5) + 'px';
        }
    }

    function setEditing(value) {
        editing = (value || ALWAYS_EDITING) && EDITABLE;
        keepState({ editing });
        // The reset style's hook: a video is one element while editing (see it above).
        document.documentElement.toggleAttribute('data-draw2code-editing', editing);
        const button = $('edit');
        if (button) button.classList.toggle('on', editing);
        if ($('hint')) $('hint').textContent = editing
            ? 'click to select - Shift+click to select more - drag to move - handles to resize - double-click to retype (Shift+Enter: new line) - pick a tool and drag to add - Ctrl+C / Ctrl+V / Ctrl+D - Ctrl+Z / Ctrl+Y - click a selected link again to follow it - Delete to remove - Esc to deselect'
            : (EDITABLE ? '' : 'switch to the working copy to edit');
        if (!editing) { select(null); }
        clearTimeout(followTimer);
        $('hover').style.display = 'none';
    }

    /** Select one element (null: none), with the rest given selected beside it. */
    function select(el, rest = []) {
        if (typing) stopTyping(true);
        // An open colour list is the old selection's: closed, its colour put back.
        if (picking) closeColours(true);
        // A size, a place or a size of its box still being typed is the old
        // selection's: written before it goes.
        if (st.size && root.activeElement === st.size) st.size.blur();
        if (boxEdit) boxFields[boxEdit.which].blur();
        selected = el;
        others = el ? rest.filter((other, i) => other && other !== el && rest.indexOf(other) === i) : [];
        paint();
        syncStyle();
        syncText();
        syncFull();
        syncHide();
        if ($('link')) $('link').disabled = !el || several();
    }

    /**
     * Shift+click: an element not selected is added to the selection (and
     * is the one picked last), a selected one is taken out of it.
     */
    function toggleSelect(el) {
        if (!el || isFrame(el)) return;
        const all = chosen();
        if (!all.includes(el)) { select(el, all); return; }
        const rest = all.filter((other) => other !== el);
        select(rest[0] || null, rest.slice(1));
    }

    // ---- colours and borders ----------------------------------------------
    // The canvas's Fill / None / Border / width / Text, on a real page. With
    // an element selected the controls show what it has now and write what
    // is changed - shown at once, written when the picker closes, so a colour
    // is one undo step. With nothing selected they set the next shape drawn.
    // Size is the selected element's font size; it sets nothing for the next
    // shape, so with nothing selected it is off.
    const nextStyle = { fill: '#3b82f6', stroke: '#f59e0b', strokeWidth: 2 };
    const st = { fill: $('st-fill'), nofill: $('st-nofill'), stroke: $('st-stroke'), width: $('st-width'), radius: $('st-radius'), text: $('st-text'), size: $('st-size') };
    let sizeFrom = ''; // the size shown: leaving it as it was writes nothing
    let sizeKept = ''; // the element's own inline font-size, put back when nothing changes
    const hasStyleControls = Boolean(st.fill);

    function toHex(value) {
        const m = /rgba?\\((\\d+),\\s*(\\d+),\\s*(\\d+)(?:,\\s*([\\d.]+))?\\)/.exec(value || '');
        if (!m) return { hex: '#000000', none: !value || value === 'transparent' || value === 'none' };
        if (m[4] !== undefined && parseFloat(m[4]) === 0) return { hex: '#000000', none: true };
        const hex = '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
        return { hex, none: false };
    }

    const isDrawing = (el) => Boolean(el && el.tagName && el.tagName.toLowerCase() === 'svg');
    const shapeOf = (svg) => svg.firstElementChild;
    /** A video's box: a file in the site's player, or a hosted player's frame. */
    const VIDEO = '.video-player, .video-embed';
    const isVideo = (el) => Boolean(el && el.matches && el.matches(VIDEO));

    /** What the selected element has now, as the controls show it. */
    function readStyle(el) {
        if (isDrawing(el)) {
            const shape = shapeOf(el);
            const cs = shape ? getComputedStyle(shape) : null;
            const fill = toHex(cs ? cs.fill : 'none');
            const stroke = toHex(cs ? cs.stroke : 'none');
            // Only a rectangle has corners; an ellipse, a line or a pen stroke has none.
            const radius = shape && shape.localName === 'rect' ? Math.round(parseFloat(cs.rx) || 0) : null;
            return { fill: fill.hex, none: fill.none, stroke: stroke.hex, width: stroke.none ? 0 : Math.round(parseFloat(cs.strokeWidth) || 0), radius, text: null, size: null };
        }
        const cs = getComputedStyle(el);
        const fill = toHex(cs.backgroundColor);
        const stroke = toHex(cs.borderTopColor);
        const width = cs.borderTopStyle === 'none' ? 0 : Math.round(parseFloat(cs.borderTopWidth) || 0);
        // A video has a box, a border and corners, but no words of its own.
        const words = !isVideo(el);
        return { fill: fill.hex, none: fill.none, stroke: stroke.hex, width, radius: Math.round(parseFloat(cs.borderTopLeftRadius) || 0),
                 text: words ? toHex(cs.color).hex : null, size: words ? Math.round(parseFloat(cs.fontSize) || 0) : null };
    }

    function syncStyle() {
        if (!hasStyleControls) return;
        // They change one element: with several selected they are off.
        const off = several();
        for (const field of [st.nofill, st.stroke, st.width]) field.disabled = off;
        if (off) {
            for (const field of Object.values(st)) field.disabled = true;
            syncMore();
            return;
        }
        const s = selected ? readStyle(selected) : { fill: nextStyle.fill, none: nextStyle.fill === 'none', stroke: nextStyle.stroke, width: nextStyle.strokeWidth, radius: null, text: null, size: null };
        st.nofill.checked = s.none;
        if (!s.none) st.fill.value = s.fill;
        st.fill.disabled = s.none;
        st.stroke.value = s.stroke;
        st.width.value = String(s.width);
        // Rounding is for the selected element only: off with nothing selected.
        st.radius.disabled = s.radius === null;
        st.radius.value = s.radius === null ? '' : String(s.radius);
        st.text.disabled = s.text === null;
        if (s.text !== null) st.text.value = s.text;
        st.size.disabled = s.size === null;
        st.size.value = s.size === null ? '' : String(s.size);
        sizeFrom = st.size.value;
        sizeKept = selected ? selected.style.fontSize : '';
        syncMore();
    }

    /** The typed size as the model allows it: "200" -> 96. */
    function fontSize() {
        const min = Number(st.size.min), max = Number(st.size.max);
        return Math.max(min, Math.min(max, Math.round(Number(st.size.value) || min)));
    }

    /** Write one style change (a colour, a border, a font size) for the selected element, or keep it for the next shape. */
    function writeStyle(what) {
        if (several()) return;
        const el = selected;
        const fill = st.nofill.checked ? 'none' : st.fill.value;
        const width = Math.max(0, Math.min(20, Math.round(Number(st.width.value) || 0)));
        const radius = Math.max(0, Math.min(${RADIUS_MAX}, Math.round(Number(st.radius.value) || 0)));
        if (!el && what === 'radius') return;
        if (!el) {
            if (what === 'fill') nextStyle.fill = fill;
            if (what === 'border') { nextStyle.stroke = st.stroke.value; nextStyle.strokeWidth = width; }
            syncStyle();
            return;
        }
        const ref = refOf(el);
        if (!ref) return;
        const op = { op: 'style', ref, declarations: {} };
        if (what === 'size') {
            // Compared before clamping: a 120px heading left alone stays 120px.
            // An emptied box puts back the size it had.
            if (st.size.value === '' || st.size.value === sizeFrom) { st.size.value = sizeFrom; return; }
            const size = fontSize();
            st.size.value = String(size);
            if (st.size.value === sizeFrom) return;
            sizeFrom = st.size.value;
            sizeKept = size + 'px';
            op.declarations = { 'font-size': size + 'px' };
        } else if (what === 'radius') {
            st.radius.value = String(radius);
            // A drawn rectangle is an SVG <rect>: its corners are rx and ry.
            if (isDrawing(el)) op.childDeclarations = { rx: radius + 'px', ry: radius + 'px' };
            else op.declarations = { 'border-radius': radius + 'px' };
        } else if (isDrawing(el)) {
            op.childDeclarations = what === 'fill'
                ? { fill }
                : { stroke: width > 0 ? st.stroke.value : 'none', 'stroke-width': width > 0 ? width + 'px' : '' };
        } else if (what === 'fill') {
            op.declarations = { background: fill === 'none' ? 'transparent' : fill };
        } else if (what === 'border') {
            op.declarations = { border: width > 0 ? width + 'px solid ' + st.stroke.value : 'none' };
        } else if (what === 'text') {
            op.declarations = { color: st.text.value };
        }
        vscode.postMessage({ type: 'edit', op });
    }

    /** Show a style while it is still being picked, before anything is written. */
    function previewStyle(what) {
        const el = selected;
        if (!el || several()) return;
        if (isDrawing(el)) {
            const shape = shapeOf(el);
            if (!shape) return;
            if (what === 'fill') shape.style.fill = st.nofill.checked ? 'none' : st.fill.value;
            else if (what === 'radius') { shape.style.rx = shape.style.ry = (Number(st.radius.value) || 0) + 'px'; }
            else { shape.style.stroke = st.stroke.value; shape.style.strokeWidth = st.width.value + 'px'; }
        } else if (what === 'fill') {
            el.style.background = st.nofill.checked ? 'transparent' : st.fill.value;
        } else if (what === 'border') {
            const w = Number(st.width.value) || 0;
            el.style.border = w > 0 ? w + 'px solid ' + st.stroke.value : 'none';
        } else if (what === 'text') {
            el.style.color = st.text.value;
        } else if (what === 'radius') {
            el.style.borderRadius = (Number(st.radius.value) || 0) + 'px';
        } else if (what === 'size') {
            // An emptied box, or one back at its size, shows the size it had:
            // its own, not the rounded one in the box (13.333px stays so).
            el.style.fontSize = st.size.value === '' || st.size.value === sizeFrom ? sizeKept : fontSize() + 'px';
        }
    }

    /**
     * Gives the keys back to the page: the editor's own field that has them
     * (a style field, the address bar) lets go, so Delete removes the
     * selected element again instead of editing, or doing nothing in, that
     * field. Leaving Size this way writes it, as any click elsewhere does.
     */
    function releaseField() {
        const active = root.activeElement;
        if (active && isField(active)) active.blur();
    }

    // ---- colours typed and used again -----------------------------------
    // The small list beside each colour box (src/colours.ts). A hex code
    // typed shows at once, as the picker does, and Enter writes it: one undo
    // step. Something that is not a colour is refused and the old one comes
    // back. A colour used lately is one click, written at once. Esc or a
    // press anywhere else closes the list and puts the colour back. The
    // colours used last go to the extension, which keeps them for the next
    // time the page is drawn, and the next session.
    const hexOf = ${hexOf.toString()};
    const recentWith = ${recentWith.toString()};
    const RECENT_MAX = ${RECENT_MAX};
    let recent = ${RECENT_COLOURS};
    /** Each colour box, and the style it previews and writes. */
    const COLOURS = { fill: { box: st.fill, style: 'fill' }, stroke: { box: st.stroke, style: 'border' }, text: { box: st.text, style: 'text' } };
    const more = { fill: $('st-fill-more'), stroke: $('st-stroke-more'), text: $('st-text-more') };
    const colours = $('colours');
    const hexField = $('colours-hex');
    // The open list: which box, its colour before, and the selected element's
    // own style attribute, put back as it was if nothing is written.
    let picking = null;

    /** Each arrow is on when its box is: Fill is off with No fill, Text with nothing selected. */
    function syncMore() {
        for (const which of Object.keys(more)) if (more[which]) more[which].disabled = COLOURS[which].box.disabled;
    }

    /** A colour just used goes to the front of the list, and to the extension to keep. */
    function remember(hex) {
        recent = recentWith(recent, hex, RECENT_MAX);
        vscode.postMessage({ type: 'recentColours', colours: recent });
    }

    /** What a preview changes on the element: its style attribute, or its shape's for a drawing. */
    function keptStyle(el) {
        const target = el && isDrawing(el) ? shapeOf(el) : el;
        return target ? { target, style: target.getAttribute('style') } : null;
    }

    function showRecent() {
        const list = $('colours-recent');
        list.textContent = '';
        if (!recent.length) {
            const none = document.createElement('span');
            none.className = 'd2c-none';
            none.textContent = 'No colours used yet';
            list.appendChild(none);
        }
        for (const hex of recent) {
            const swatch = document.createElement('button');
            swatch.className = 'd2c-swatch';
            swatch.title = hex;
            swatch.setAttribute('aria-label', hex);
            swatch.style.background = hex;
            swatch.addEventListener('click', () => useColour(hex));
            list.appendChild(swatch);
        }
    }

    function openColours(which) {
        const was = picking && picking.which;
        closeColours(true);
        // A second click on the same arrow only closes it.
        if (was === which || COLOURS[which].box.disabled) return;
        picking = { which, from: COLOURS[which].box.value, kept: keptStyle(selected) };
        hexField.value = picking.from;
        showRecent();
        colours.hidden = false;
        more[which].setAttribute('aria-expanded', 'true');
        // Under its arrow, kept inside the view.
        const r = more[which].getBoundingClientRect();
        colours.style.left = Math.max(4, Math.min(r.left, window.innerWidth - colours.offsetWidth - 4)) + 'px';
        hexField.focus();
        hexField.select();
    }

    /** The colour the list opened with, back in its box and on the element, exactly as it was. */
    function putBack(was) {
        COLOURS[was.which].box.value = was.from;
        if (!was.kept) return;
        if (was.kept.style === null) was.kept.target.removeAttribute('style');
        else was.kept.target.setAttribute('style', was.kept.style);
    }

    /** Close the list; cancelled, the colour shown before it opened comes back. */
    function closeColours(cancel) {
        if (!picking) return;
        const was = picking;
        picking = null;
        colours.hidden = true;
        more[was.which].setAttribute('aria-expanded', 'false');
        if (cancel) putBack(was);
        releaseField();
    }

    /**
     * Use a colour from the list: shown, written and remembered. The one it
     * had is only remembered: nothing is written, so the element gets its
     * own style back (a preview of 'border' or 'background' would cover a
     * bottom border or a gradient the file still has).
     */
    function useColour(hex) {
        if (!picking) return;
        const { box, style } = COLOURS[picking.which];
        if (hex === picking.from) {
            closeColours(true);
            remember(hex);
            return;
        }
        box.value = hex;
        previewStyle(style);
        closeColours(false);
        remember(hex);
        writeStyle(style);
    }

    if (colours) {
        for (const which of Object.keys(more)) more[which].addEventListener('click', () => openColours(which));
        hexField.addEventListener('input', () => {
            const hex = hexOf(hexField.value);
            if (!picking) return;
            // Half a code shows the colour it had, not the last whole one typed.
            if (!hex) { putBack(picking); return; }
            COLOURS[picking.which].box.value = hex;
            previewStyle(COLOURS[picking.which].style);
        });
        hexField.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || !picking) return;
            e.preventDefault();
            const hex = hexOf(hexField.value);
            if (hex) { useColour(hex); return; }
            // Not a colour: refused, and the one it had comes back.
            hexField.value = picking.from;
            putBack(picking);
            hexField.select();
        });
        // A press anywhere but the list or its arrow closes it, before the
        // press does anything else.
        document.addEventListener('pointerdown', (e) => {
            if (!picking) return;
            const path = e.composedPath();
            if (!path.includes(colours) && !path.includes(more[picking.which])) closeColours(true);
        }, true);
    }

    if (hasStyleControls) {
        // A colour, None or a border width is done once it is written, so
        // each lets go of the keys then. (Typing a width still works: its
        // change comes with Enter or on leaving the box.)
        st.fill.addEventListener('input', () => previewStyle('fill'));
        st.fill.addEventListener('change', () => { remember(st.fill.value); writeStyle('fill'); releaseField(); });
        st.nofill.addEventListener('change', () => { st.fill.disabled = st.nofill.checked; syncMore(); previewStyle('fill'); writeStyle('fill'); releaseField(); });
        st.stroke.addEventListener('input', () => previewStyle('border'));
        st.stroke.addEventListener('change', () => { remember(st.stroke.value); writeStyle('border'); releaseField(); });
        st.width.addEventListener('change', () => { previewStyle('border'); writeStyle('border'); releaseField(); });
        st.radius.addEventListener('change', () => { previewStyle('radius'); writeStyle('radius'); releaseField(); });
        st.text.addEventListener('input', () => previewStyle('text'));
        st.text.addEventListener('change', () => { remember(st.text.value); writeStyle('text'); releaseField(); });
        // Written when the box is left (Enter, or a click anywhere else), not
        // at every arrow click: finding a size is ONE undo step.
        st.size.addEventListener('input', () => previewStyle('size'));
        st.size.addEventListener('keydown', (e) => { if (e.key === 'Enter') st.size.blur(); });
        st.size.addEventListener('blur', () => writeStyle('size'));
        syncStyle();
    }

    // ---- bold, underline and alignment ---------------------------------
    // B, U and the three alignment buttons show what the selected element
    // has now, and a click changes it at once and writes it: ONE undo step
    // per click. A drawing, a picture or a video has no words to move, so for those, and
    // with nothing selected, they are off. An inline element (a link inside
    // a sentence) is only as wide as its words, so alignment is off there.

    // The functions of src/align.ts, copied in as they are: the overlay
    // writes what the tests check.
    const alignDeclarations = ${alignDeclarations.toString()};
    const alignOf = ${alignOf.toString()};
    const boxOf = ${boxOf.toString()};
    const ALIGN_NAMES = ${JSON.stringify(ALIGNS.map(([align]) => align))};
    const hasWords = (el) => Boolean(el) && !isDrawing(el) && el.localName !== 'img' && !isVideo(el);
    // And those of src/underline.ts.
    const isUnderlined = ${isUnderlined.toString()};
    const underlineDeclarations = ${underlineDeclarations.toString()};

    function syncText() {
        if (!$('st-bold')) return;
        const cs = hasWords(selected) && !several() ? getComputedStyle(selected) : null;
        const aligns = Boolean(cs) && cs.display !== 'inline';
        const align = aligns ? alignOf(boxOf(cs.display, cs.flexDirection), cs.textAlign, cs.justifyContent) : undefined;
        $('st-bold').disabled = !cs;
        $('st-bold').classList.toggle('on', Boolean(cs) && parseInt(cs.fontWeight, 10) >= 600);
        if ($('st-underline')) {
            const under = Boolean(cs) && isUnderlined(cs.textDecorationLine);
            $('st-underline').disabled = !cs;
            $('st-underline').classList.toggle('on', under);
            $('st-underline').setAttribute('aria-pressed', String(under));
        }
        for (const name of ALIGN_NAMES) {
            $('st-' + name).disabled = !aligns;
            $('st-' + name).classList.toggle('on', name === align);
        }
    }

    /** Show declarations on the selected element and write them as one style edit. */
    function writeText(declarations) {
        const el = selected;
        const ref = hasWords(el) && !several() ? refOf(el) : null;
        if (!ref) return;
        for (const [prop, value] of Object.entries(declarations)) el.style.setProperty(prop, value);
        vscode.postMessage({ type: 'edit', op: { op: 'style', ref, declarations } });
        syncText();
    }

    on('st-bold', 'click', () => {
        // Focus left on the button would keep Ctrl+Z from the editor's history.
        $('st-bold').blur();
        writeText({ 'font-weight': $('st-bold').classList.contains('on') ? 'normal' : 'bold' });
    });

    // U adds an underline, or takes it away - the one a link has from the
    // browser too. Any other line (a line-through) stays as it is.
    on('st-underline', 'click', () => {
        $('st-underline').blur();
        if (!hasWords(selected)) return;
        writeText(underlineDeclarations(getComputedStyle(selected).textDecorationLine));
    });
    for (const name of ALIGN_NAMES) {
        on('st-' + name, 'click', () => {
            $('st-' + name).blur();
            // Already so: a step that changes nothing would make the next Ctrl+Z undo nothing.
            if (!selected || $('st-' + name).classList.contains('on')) return;
            const cs = getComputedStyle(selected);
            writeText(alignDeclarations(boxOf(cs.display, cs.flexDirection), name));
        });
    }

    // ---- full width and the page's width --------------------------------
    // A page made in Draw2Code is a column the project's page width wide,
    // centred in the window, inside its wrapper (src/pageEdit.ts). Full
    // width stretches an element of the wrapper across the whole window: a
    // class on it, which the generator's rule stretches, keeping its place
    // from the top and its height. Its own left and width stay in its rule,
    // so a second click puts it back where it was. The class is shown at
    // once and written as one edit; a drawing also stretches its picture,
    // as the file will have it. Page width asks the editor, which asks for
    // the new width and then what it changes.
    const FULL_WIDTH = ${JSON.stringify(FULL_WIDTH_CLASS)};
    /** The page's wrapper: <body>'s first element, <div class="page">, on a page that says it was generated. */
    const WRAPPER = (() => {
        const first = document.body ? document.body.firstElementChild : null;
        if (!first || first.localName !== 'div' || first.getAttribute('class') !== 'page') return null;
        const comments = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
        for (let node = comments.nextNode(); node; node = comments.nextNode()) {
            if (node.data.trim() === 'Generated by Draw2Code Web Editor') return first;
        }
        return null;
    })();
    const canFull = (el) => Boolean(WRAPPER && el && el.parentElement === WRAPPER);
    /** Is the element full width now? Then it moves only up and down, and only its height changes. */
    const isFull = (el) => canFull(el) && el.classList.contains(FULL_WIDTH);

    function syncFull() {
        const button = $('full-width');
        if (!button) return;
        button.disabled = !canFull(selected) || several();
        button.classList.toggle('on', isFull(selected));
        button.setAttribute('aria-pressed', String(isFull(selected)));
    }

    on('full-width', 'click', () => {
        $('full-width').blur();
        const el = selected;
        const ref = canFull(el) && !several() ? refOf(el) : null;
        if (!ref) return;
        const full = !isFull(el);
        el.classList.toggle(FULL_WIDTH, full);
        // A drawing Draw2Code drew is stretched to its box, as src/pageEdit.ts setFullWidth writes
        // it; on a page with a phone layout it is stretched already, and stays so.
        if (shapeDrawn(el)) {
            if (full) el.setAttribute('preserveAspectRatio', 'none');
            else if (!(PHONE && PHONE.layout)) el.removeAttribute('preserveAspectRatio');
        }
        vscode.postMessage({ type: 'edit', op: { op: 'fullWidth', ref, full } });
        paint();
        syncFull();
    });
    on('page-width', 'click', () => {
        $('page-width').blur();
        vscode.postMessage({ type: 'pageWidth' });
    });

    // ---- the phone view -------------------------------------------------
    // On a page made in Draw2Code, Phone shows the page as a phone does: the
    // editor draws it again with <html> as wide as a phone and the phone
    // layout's rules (src/pageEditor.ts viewStylesheet). The column is then
    // the phone's width, and the fields, snapping and the column's sides
    // follow it, as they read the wrapper. What a move or resize writes
    // there goes to the phone layout; the editor routes it. The first time,
    // the editor asks, and makes the phone layout from each element's box
    // as it is here, which is sent with the request.
    on('phone-view', 'click', () => {
        $('phone-view').blur();
        if (PHONE_VIEW) {
            vscode.postMessage({ type: 'view', view: 'desktop' });
            return;
        }
        vscode.postMessage({ type: 'view', view: 'phone', elements: desktopElements() });
    });
    on('phone-reset', 'click', () => {
        $('phone-reset').blur();
        vscode.postMessage({ type: 'resetPhone', elements: desktopElements() });
    });

    /**
     * What the first draft of a phone layout is made from (src/phoneDraft.ts):
     * each element placed freely on the page, as it is at desktop width. In
     * the phone view the page is measured with the desktop view's rules put
     * in for a moment - in the same task, so nothing of it is drawn.
     */
    function desktopElements() {
        const held = document.querySelector('style[data-d2c-held]');
        const view = document.querySelector('style[data-d2c-view]');
        const root = document.documentElement;
        const was = held ? held.textContent : null;
        const marked = root.classList.contains(${JSON.stringify(PHONE_LAYOUT_CLASS)});
        // What a move or resize made here shows on the element itself until the
        // page is drawn again: the phone's place, not the desktop's. Set aside too.
        const inline = PHONE_VIEW && WRAPPER ? Array.from(WRAPPER.children).filter((el) => el.hasAttribute('style')).map((el) => [el, el.getAttribute('style')]) : [];
        if (PHONE_VIEW) {
            if (held && typeof PHONE.desktopCss === 'string') held.textContent = PHONE.desktopCss;
            if (view) view.disabled = true;
            root.classList.remove(${JSON.stringify(PHONE_LAYOUT_CLASS)});
            for (const [el] of inline) el.removeAttribute('style');
        }
        const elements = [];
        try {
            for (const el of WRAPPER ? Array.from(WRAPPER.children) : []) {
                if (!el.id || isOurs(el)) continue;
                const b = pageBox(el);
                const cs = getComputedStyle(el);
                const one = { id: el.id, x: b.left, y: b.top, w: b.width, h: b.height,
                    kind: isDrawing(el) || el.localName === 'img' || isVideo(el) ? 'shape' : 'widget', drawing: isDrawing(el), full: isFull(el) };
                if (hasWords(el)) {
                    one.fontSize = parseFloat(cs.fontSize);
                    const lh = parseFloat(cs.lineHeight);
                    if (Number.isFinite(lh)) one.lineHeight = lh;
                    one.grows = grows(el);
                    one.wraps = !one.grows && !['input', 'textarea', 'select'].includes(el.localName);
                }
                elements.push(one);
            }
        } finally {
            if (PHONE_VIEW) {
                if (held && was !== null) held.textContent = was;
                if (view) view.disabled = false;
                if (marked) root.classList.add(${JSON.stringify(PHONE_LAYOUT_CLASS)});
                for (const [el, style] of inline) el.setAttribute('style', style);
            }
        }
        return elements;
    }

    // The first draft's Text and Heading, and labels and buttons too long
    // for a phone: how tall their words are at the width and font size the
    // draft gives them (src/phoneDraft.ts wordsToMeasure), the extension
    // asks, so their least height is what a phone shows. Measured on a
    // hidden copy beside the element, taken away in the same task.
    window.addEventListener('message', (event) => {
        const msg = event.data;
        if (!msg || msg.type !== 'measureWords' || !Array.isArray(msg.texts)) return;
        vscode.postMessage({ type: 'wordHeights', id: msg.id, heights: measureWords(msg.texts) });
    });
    function measureWords(texts) {
        const heights = Object.create(null);
        for (const one of texts) {
            const el = one && typeof one.id === 'string' ? document.getElementById(one.id) : null;
            if (!el || !WRAPPER || el.parentElement !== WRAPPER || !(one.width > 0) || !(one.fontSize > 0)) continue;
            const copy = el.cloneNode(true);
            const set = (name, value) => copy.style.setProperty(name, value, 'important');
            set('position', 'absolute');
            set('visibility', 'hidden');
            set('left', '0px');
            set('top', '0px');
            set('width', one.width + 'px');
            set('font-size', one.fontSize + 'px');
            set('height', 'auto');
            set('min-height', '0px');
            set('max-height', 'none');
            if (one.wrap) set('white-space', 'normal');
            WRAPPER.appendChild(copy);
            try {
                heights[one.id] = Math.ceil(copy.getBoundingClientRect().height);
            } finally {
                copy.remove();
            }
        }
        return heights;
    }

    // Hide on phone: the selected element is not shown on phones - one
    // more rule of its phone layout (display: none). Here it stays, faintly,
    // so it can be selected and shown again.
    const phoneHidden = new Set();
    if (PHONE_VIEW) {
        for (const selector of PHONE.hidden) {
            try {
                for (const el of document.querySelectorAll(selector)) phoneHidden.add(el);
            } catch {
                /* not a selector this page can use: nothing to mark */
            }
        }
    }
    function syncHide() {
        const button = $('phone-hide');
        if (!button) return;
        const hidden = phoneHidden.has(selected);
        button.disabled = !canFull(selected) || several();
        button.classList.toggle('on', hidden);
        button.setAttribute('aria-pressed', String(hidden));
    }
    on('phone-hide', 'click', () => {
        $('phone-hide').blur();
        const el = selected;
        const ref = canFull(el) && !several() ? refOf(el) : null;
        if (!ref) return;
        const hide = !phoneHidden.has(el);
        if (hide) phoneHidden.add(el);
        else phoneHidden.delete(el);
        // Shown again at once: until the page is drawn again, its old rule still says faint.
        el.style.setProperty('opacity', hide ? ${JSON.stringify(PHONE_HIDDEN_OPACITY)} : '1');
        vscode.postMessage({ type: 'edit', op: { op: 'style', ref, declarations: { display: hide ? 'none' : '' } } });
        syncHide();
    });

    // ---- the page's column ----------------------------------------------
    // The editor only (the preview shows the page as a browser would). On a
    // page made in Draw2Code, the column its elements are placed in is shown:
    // a thin dashed line along each side, over the whole height of the view
    // (so also over the room below the page). They are ours, in the shadow
    // root: nothing is written to the page, and they take no press. They are
    // fixed in the view, moved across with the wrapper as the page scrolls
    // sideways or the panel is resized. They are above the page, like the
    // selection's outline, so the column is seen over a full-width section
    // too. Nothing else is drawn: beside the column, the page looks exactly
    // as it will in a browser (a veil over its background showed through
    // every full-width element without a background of its own).
    // Everything but a full-width element is kept inside the column
    // (src/placement.ts): a drawing, a move or a resize stops at its sides,
    // a typed x or width is kept in, and the extension moves a paste or a
    // widget clicked near a side in. Ctrl (Cmd) turns snapping off, not that.
    const boxInColumn = ${boxInColumn.toString()};
    const boxesInColumn = ${boxesInColumn.toString()};
    const boxCutToColumn = ${boxCutToColumn.toString()};
    const xInColumn = ${xInColumn.toString()};
    const fieldInColumn = ${fieldInColumn.toString()};
    const COLUMN = Boolean(WRAPPER && $('column-left'));
    const COLUMN_PARTS = COLUMN ? ['column-left', 'column-right'].map($) : [];

    function paintColumn() {
        if (!COLUMN) return;
        const r = WRAPPER.getBoundingClientRect();
        const [left, right] = COLUMN_PARTS;
        for (const part of COLUMN_PARTS) part.style.display = 'block';
        // Just outside the column, so an element at its edge is not covered,
        // and on whole pixels (a centred column can start on half of one),
        // so each line is as sharp as the other.
        left.style.left = (Math.round(r.left) - 1) + 'px';
        right.style.left = Math.round(r.right) + 'px';
    }

    /** Is the element kept in the column? One placed freely in the wrapper, not full width (nor fixed in the view). */
    const inColumn = (el) => COLUMN && canFull(el) && !isFull(el) && getComputedStyle(el).position !== 'fixed';
    /** The column in the document's coordinates; null without one. */
    function columnOnPage() {
        if (!COLUMN) return null;
        const b = docBox(WRAPPER);
        return { left: b.left, right: b.left + b.width };
    }

    // ---- x, y, width and height -------------------------------------------
    // The selected element's box in the page's coordinates (src/placement.ts):
    // from the wrapper's top-left on a page made in Draw2Code, so the numbers
    // are its rule's, and from the page's own top-left on any other page.
    // They follow a move or a resize as it happens. A number typed is shown
    // at once and written when the field is left (Enter, or a click anywhere
    // else), as Size is: ONE undo step, the same edit a drag makes. Esc puts
    // the element back. Full width, X and Width are off: the window sets
    // them. Text and Heading grow with their words, so their height is the
    // least height they take, and the field shows how tall they really are.
    const boxFieldValue = ${boxFieldValue.toString()};
    const boxFieldDeclarations = ${boxFieldDeclarations.toString()};
    const boxFields = { x: $('box-x'), y: $('box-y'), width: $('box-width'), height: $('box-height') };
    const BOX_SIDES = { x: 'left', y: 'top', width: 'width', height: 'height' };
    // The field being typed in: which, the element, what it showed, and the
    // element as it was (its style attribute, its drawing), put back when
    // nothing is written.
    let boxEdit = null;

    /** An element's box in the page's coordinates, as the fields show it. */
    function pageBox(el) {
        const r = el.getBoundingClientRect();
        const fixed = getComputedStyle(el).position === 'fixed';
        const origin = WRAPPER ? WRAPPER.getBoundingClientRect()
            : fixed ? { left: 0, top: BAR_PX } : { left: -window.scrollX, top: BAR_PX - window.scrollY };
        return { left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height };
    }

    /** What a field needs to know to change an element (src/placement.ts Placed). */
    function placedOf(el) {
        const cs = getComputedStyle(el);
        const nudge = currentNudge(el);
        const r = el.getBoundingClientRect();
        const inline = cs.display === 'inline';
        // An inline element has no CSS size of its own ('auto'): it is all box.
        const extra = (size, css) => { const n = parseFloat(css); return inline || !Number.isFinite(n) ? 0 : Math.round(size - n); };
        return { box: pageBox(el), left: nudge.left, top: nudge.top, placed: nudge.placed,
                 extraWidth: extra(r.width, cs.width), extraHeight: extra(r.height, cs.height), grows: grows(el), inline };
    }

    function syncBox() {
        if (!boxFields.x) return;
        const el = selected && !isFrame(selected) && !several() ? selected : null;
        const b = el ? pageBox(el) : null;
        const full = isFull(el);
        for (const which of Object.keys(boxFields)) {
            const field = boxFields[which];
            field.disabled = !b || (full && (which === 'x' || which === 'width'));
            // The one being typed in keeps what is typed.
            if (boxEdit && boxEdit.which === which) continue;
            field.value = b ? String(Math.round(b[BOX_SIDES[which]])) : '';
        }
    }

    /** The element as it was when its field was entered: its style, and a drawing's size and shape. */
    function putBoxBack(edit) {
        if (edit.style === null) edit.el.removeAttribute('style');
        else edit.el.setAttribute('style', edit.style);
        if (!edit.drawing) return;
        for (const [name, value] of Object.entries(edit.svg)) {
            if (value === null) edit.el.removeAttribute(name);
            else edit.el.setAttribute(name, value);
        }
        const shape = edit.drawing.shape;
        for (const a of Array.from(shape.attributes)) if (!(a.name in edit.drawing.geometry)) shape.removeAttribute(a.name);
        for (const [name, value] of Object.entries(edit.drawing.geometry)) shape.setAttribute(name, value);
    }

    /**
     * The edit the field's number makes, or null: nothing (yet), or what the
     * element has already. An x or width that would take it past a side of
     * the page's column stops there; the field shows that once it is left.
     */
    function boxDeclarations(edit) {
        let value = boxFieldValue(boxFields[edit.which].value, edit.which);
        if (value !== null && edit.column) value = fieldInColumn(edit.which, value, edit.placed.box, edit.column);
        return value === null ? null : boxFieldDeclarations(edit.which, value, edit.placed);
    }

    /**
     * Show an edit on the element, from how it was: a drawing Draw2Code drew
     * is drawn again at its new size, as the extension draws it in the file
     * (a size not given is the one its svg has, as there).
     */
    function showBox(edit, declarations) {
        putBoxBack(edit);
        for (const [prop, value] of Object.entries(declarations)) edit.el.style.setProperty(prop, value);
        if (!edit.drawing || (declarations.width === undefined && declarations.height === undefined)) return;
        const size = (css, attr) => css === undefined ? Number(attr) || 0 : parseFloat(css) || 0;
        redraw(edit.drawing, size(declarations.width, edit.svg.width), size(declarations.height, edit.svg.height));
    }

    if (boxFields.x) {
        for (const which of Object.keys(boxFields)) {
            const field = boxFields[which];
            field.addEventListener('focus', () => {
                const el = selected;
                if (!el || isFrame(el) || several()) return;
                const drawing = shapeDrawn(el);
                boxEdit = { which, el, from: field.value, style: el.getAttribute('style'), placed: placedOf(el), drawing,
                            column: inColumn(el) ? WRAPPER.getBoundingClientRect().width : 0,
                            svg: drawing ? { width: el.getAttribute('width'), height: el.getAttribute('height'), viewBox: el.getAttribute('viewBox') } : null };
            });
            field.addEventListener('input', () => {
                if (!boxEdit) return;
                const declarations = boxDeclarations(boxEdit);
                if (declarations) showBox(boxEdit, declarations);
                else putBoxBack(boxEdit);
                paint();
            });
            field.addEventListener('keydown', (e) => { if (e.key === 'Enter') field.blur(); });
            field.addEventListener('blur', () => {
                const edit = boxEdit;
                if (!edit) return;
                boxEdit = null;
                const declarations = boxDeclarations(edit);
                const ref = declarations && edit.el.isConnected ? refOf(edit.el) : null;
                if (ref) {
                    showBox(edit, declarations);
                    vscode.postMessage({ type: 'edit', op: { op: 'style', ref, declarations } });
                } else {
                    putBoxBack(edit);
                }
                // The number as it is now: a width of -5 shows 0.
                paint();
            });
        }
    }

    on('edit', 'click', () => setEditing(!editing));
    window.addEventListener('scroll', paint, true);
    window.addEventListener('resize', paint);

    document.addEventListener('mousemove', (e) => {
        if (!editing || drag || typing) return;
        if (isOurs(e.target) || e.target === document.body || e.target === document.documentElement) { $('hover').style.display = 'none'; return; }
        const el = drawingOf(e.target);
        const r = el.getBoundingClientRect();
        const hover = $('hover');
        hover.style.display = 'block';
        place(hover, { left: r.left, top: r.top, width: r.width, height: r.height });
    }, true);

    document.addEventListener('click', (e) => {
        // Links to another page of this site switch the page being shown
        // instead of navigating the webview: rewriteUrls marked them with
        // this prefix. A link to a section ("#prices", or "about.html#team")
        // scrolls to it, there or on this page.
        const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
        const selectInstead = e.altKey || e.ctrlKey || e.metaKey;
        if (a && !(editing && selectInstead)) {
            const href = a.getAttribute('href') || '';
            const section = sectionLink(href, PAGE_LINK);
            const inSite = Boolean(section);
            const follow = () => followSection(section);
            if (inSite && !editing) {
                e.preventDefault();
                e.stopPropagation();
                follow();
                return;
            }
            if (inSite && editing) {
                // While editing, a link is an element first. Following it on
                // the first click made its text impossible to retype: the
                // page was gone before the double-click landed. So the first
                // click SELECTS, and only a second click on the link that is
                // already selected follows it - after a pause a double-click
                // cancels, because a double-click means "retype this".
                e.preventDefault();
                e.stopPropagation();
                // Retyping the link: a click only moves the caret, as in any
                // other text, and the typing is not lost to another page.
                if (typing && selected === a) return;
                if (e.shiftKey && !typing) { clearTimeout(followTimer); toggleSelect(a); return; }
                if (selected === a) {
                    clearTimeout(followTimer);
                    followTimer = setTimeout(follow, FOLLOW_DELAY);
                } else {
                    select(a);
                }
                return;
            }
            if (editing) {
                // Links off the site do nothing while editing.
                e.preventDefault();
            }
        }
        if (!editing || isOurs(e.target) || typing) return;
        // In edit mode a click selects instead of doing what the page would do.
        e.preventDefault();
        e.stopPropagation();
        if (justDragged) { justDragged = false; return; }
        const hit = e.target === document.body ? null : drawingOf(e.target);
        if (e.shiftKey) toggleSelect(hit);
        else select(hit);
    }, true);

    // ---- sections -------------------------------------------------------
    // A link to a section of a page (src/links.ts) scrolls to the element it
    // names, as in a browser: its top just under the bar, where a browser
    // has the top of its window, and no further than the page's end (not
    // into the editor's room below it). The page's own scroll-behavior
    // says whether that is smooth. On another page, the page is shown and
    // then scrolled there at once, as a browser arrives at a section.

    // The functions of src/links.ts, copied in as they are.
    const sectionLink = ${sectionLink.toString()};
    const sectionScroll = ${sectionScroll.toString()};

    /** The page's element with this id ("caf%C3%A9" is "café" too, as in a browser), or null; never ours. */
    function sectionNamed(id) {
        let decoded = id;
        try { decoded = decodeURIComponent(id); } catch (err) { /* kept as written */ }
        for (const name of [id, decoded]) {
            const el = name ? document.getElementById(name) : null;
            if (el && !isOurs(el)) return el;
        }
        return null;
    }

    function scrollToSection(id, instant) {
        // "#" and "#top" with no element of that name are the top of the page.
        const el = sectionNamed(id);
        if (!el && id && id.toLowerCase() !== 'top') {
            vscode.postMessage({ type: 'status', text: '#' + id + ' is not on this page' });
            return;
        }
        const scroller = document.scrollingElement || document.documentElement;
        const to = sectionScroll(el ? el.getBoundingClientRect() : null, { x: window.scrollX, y: window.scrollY },
            { width: window.innerWidth, height: window.innerHeight }, BAR_PX, pageEnd || scroller.scrollHeight);
        window.scrollTo(instant ? { ...to, behavior: 'instant' } : to);
    }

    /** Follow a link of this site: the section on this page, or the other page and then its section. */
    function followSection(section) {
        if (section.page && section.page !== PAGE_NAME) {
            if (section.id) keepState({ jump: { page: section.page, id: section.id } });
            vscode.postMessage({ type: 'page', page: section.page });
            return;
        }
        scrollToSection(section.id, false);
    }

    /**
     * An inline <svg> is one drawing: pressing its shape means the svg. A
     * video is one too: pressing its player (a symbol of the player is an
     * svg as well) means the video's box.
     */
    function drawingOf(el) {
        const video = el && el.closest ? el.closest(VIDEO) : null;
        if (video && !isOurs(video)) return video;
        const svg = el && el.closest ? el.closest('svg') : null;
        return svg && !isOurs(svg) ? svg : el;
    }

    // The function of src/fieldKeys.ts, copied in as it is.
    const fieldKey = ${fieldKey.toString()};

    /**
     * Space while retyping a <button>: Chromium takes it as a press of the
     * button and types nothing, so the space is put in here instead, and the
     * press it would make on key-up is stopped.
     */
    const BUTTON_SPACE = (e) => typing && e.key === ' ' && selected && selected.localName === 'button'
        && !e.ctrlKey && !e.metaKey && !e.altKey;
    document.addEventListener('keyup', (e) => { if (BUTTON_SPACE(e)) e.preventDefault(); }, true);

    document.addEventListener('keydown', (e) => {
        if (BUTTON_SPACE(e)) {
            e.preventDefault();
            document.execCommand('insertText', false, ' ');
            return;
        }
        if (e.key === 'Escape') {
            // Esc in the Video kind list closes it; the kind stays as it was.
            if (kindsOpen()) { closeKinds(true); return; }
            // Esc in a colour list closes it and puts the colour back.
            if (picking) { closeColours(true); return; }
            // Esc in Size puts back the size it had, so the blur writes
            // nothing; the element stays selected, and a second Esc deselects.
            if (st.size && root.activeElement === st.size) { st.size.value = sizeFrom; previewStyle('size'); st.size.blur(); return; }
            // The same in X, Y, Width and Height: the element is put back as it was.
            if (boxEdit) { boxFields[boxEdit.which].value = boxEdit.from; boxFields[boxEdit.which].blur(); return; }
            // Retyping a placeholder, Esc puts back the one it had.
            if (typing) stopTyping(!typingInput);
            else if (tool !== 'select') setTool('select');
            else if (selected) select(null);
            else if (editing) setEditing(false);
            return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
            removeSelected(e);
            return;
        }
        // Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z): the editor's history. Not while
        // retyping - there the browser's own text undo is the right one -
        // and not in our own fields, like the address bar.
        const mod = e.ctrlKey || e.metaKey;
        if (!mod || e.altKey) return;
        const k = e.key.toLowerCase();
        if (!editing || typing || isOurs(e.target)) {
            // The text's own undo and select all: stopped here, or VS Code's
            // webview would pass the key on - Ctrl+Z as an undo of the whole
            // page, Ctrl+A as a second select all that lands a moment later
            // and swallows the first digit typed after it (src/fieldKeys.ts).
            if (fieldKey(e)) e.stopPropagation();
            return;
        }
        // Ctrl+C, Ctrl+V and Ctrl+D: the selection copied, pasted or
        // duplicated (src/copyPaste.ts). A page's own text box being typed
        // in keeps its copy and paste, and so does a host without them (the
        // preview).
        if (COPY_PASTE && (k === 'c' || k === 'v' || k === 'd') && !e.shiftKey) {
            if (drag || isPageTyping(e.target)) return;
            e.preventDefault();
            e.stopPropagation();
            if (k === 'v') vscode.postMessage({ type: 'paste', wrapper: wrapperOrigin() });
            else copySelection(k === 'c' ? 'copy' : 'duplicate');
            return;
        }
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); vscode.postMessage({ type: 'undo' }); }
        else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); vscode.postMessage({ type: 'redo' }); }
    }, true);

    // ---- delete --------------------------------------------------------
    /** The page itself: <html>, <head>, <body>. Removing one would leave no page. */
    const isFrame = (el) => el === document.documentElement || el === document.head || el === document.body;
    /** A place where Delete and Backspace edit text: a field, or anything being typed in. */
    const isField = (el) => Boolean(el && el.closest && (el.isContentEditable
        || el.closest('input, textarea, select, [contenteditable]')));
    /**
     * Is the key meant for the text of a page field? Clicking a page <input>
     * selects it AND focuses it: the field that IS the selection is deleted,
     * any other field is typed in.
     */
    const isPageTyping = (el) => isField(el) && el !== selected;

    /**
     * Delete or Backspace with an element selected removes it. Not while
     * retyping, and not in the editor's own fields (the address bar, a tab
     * being renamed) or a page field the user is typing in: there the key
     * edits text. A selected link is removed, not followed. Backspace never
     * goes back a page.
     */
    function removeSelected(e) {
        if (!editing || typing || drag || e.ctrlKey || e.metaKey || e.altKey) return;
        if ((isOurs(e.target) && isField(root.activeElement)) || isPageTyping(e.target)) return;
        e.preventDefault();
        e.stopPropagation();
        // A second click on a selected link has started following it: Delete wins.
        clearTimeout(followTimer);
        if (several()) { removeSeveral(); return; }
        const el = selected;
        if (!el) return;
        if (isFrame(el)) {
            vscode.postMessage({ type: 'status', text: '<' + el.localName + '> is the page itself and cannot be removed; the page is kept' });
            return;
        }
        const ref = refOf(el);
        if (!ref) return;
        select(null);
        $('hover').style.display = 'none';
        vscode.postMessage({ type: 'edit', op: { op: 'remove', ref } });
        // Gone from the page at once, so a path worked out before the page is
        // drawn again already counts the elements after it one place earlier.
        el.remove();
    }

    /**
     * Delete with several selected: all of them go as ONE edit, named last
     * in the page first, so a place counted before the edit is still true
     * when each is taken out (see pageEditor's batch).
     */
    function removeSeveral() {
        const gone = outermost(chosen()).reverse();
        const refs = gone.map(refOf);
        if (!refs.length || !refs.every(Boolean)) return;
        select(null);
        $('hover').style.display = 'none';
        vscode.postMessage({ type: 'edit', op: { op: 'batch', ref: {}, label: 'Remove elements', ops: refs.map((ref) => ({ op: 'remove', ref })) } });
        for (const el of gone) el.remove();
    }

    // ---- copy, paste and duplicate -------------------------------------
    // The extension keeps what is copied (src/copyPaste.ts), so it is still
    // there once the page is drawn again or another page of the site is
    // shown. The overlay says which elements, in the page's order, and
    // where each is shown: copies keep their places to each other.

    /**
     * Where the page's wrapper starts, in the page's coordinates (the bar is
     * not part of the page), and in the editor how wide it is: the column
     * the extension keeps a paste or a widget clicked near a side in.
     * Undefined without one.
     */
    function wrapperOrigin() {
        if (!WRAPPER) return undefined;
        const r = WRAPPER.getBoundingClientRect();
        const at = { x: r.left + window.scrollX, y: r.top + window.scrollY - BAR_PX };
        return COLUMN ? { ...at, width: r.width } : at;
    }

    function copySelection(type) {
        const all = outermost(chosen());
        if (!all.length) {
            vscode.postMessage({ type: 'status', text: type === 'copy' ? 'select what to copy first' : 'select what to duplicate first' });
            return;
        }
        const items = [];
        for (const el of all) {
            const ref = refOf(el);
            if (!ref) return;
            const b = pageBox(el);
            items.push({ ref, box: { x: b.left, y: b.top, w: b.width, h: b.height }, full: isFull(el) });
        }
        vscode.postMessage({ type, items, wrapper: wrapperOrigin() });
    }

    // ---- links ---------------------------------------------------------
    // Link makes the selected button or text a link, or changes or takes
    // away the link it is. Where it goes is asked in the editor (a page of
    // the site or a web address), which also refuses what cannot be a link;
    // the overlay says which element, and what it looks like now.
    const LINKABLE = ${JSON.stringify(LINKABLE)};
    const SIDES = ['top', 'right', 'bottom', 'left'];
    /** Looks compared one to one between the element and the <a> it would be (see src/links.ts). */
    const PLAIN_LOOKS = ${JSON.stringify(PLAIN_LOOKS)};

    on('link', 'click', () => {
        const el = selected;
        if (!el) return;
        const ref = refOf(el);
        if (!ref) return;
        // A second click on a selected link has started following it: Link wins.
        clearTimeout(followTimer);
        vscode.postMessage({ type: 'link', ref, looks: LINKABLE.includes(el.localName) ? linkLooks(el) : {} });
        // Esc or a refusal does not draw the page again: focus left on this
        // button would keep Ctrl+Z from the editor's history.
        $('link').blur();
    });

    /** An element's computed style copied as it is now: { getPropertyValue, appearance, display }. */
    function styleOf(el) {
        const cs = getComputedStyle(el);
        const copy = new Map(Array.from(cs, (prop) => [prop, cs.getPropertyValue(prop)]));
        return { getPropertyValue: (prop) => copy.get(prop) ?? '', appearance: cs.appearance, display: cs.display };
    }

    /**
     * What the element would lose by becoming an <a>, as the declarations
     * that keep it. A <button> drops the browser's button look (its padding,
     * font, border and grey background) and text takes the link blue, so an
     * <a> with the same attributes and content is put in its place for a
     * moment, and every look that differs is measured from the element as it
     * is now. A button also gets the button's layout - its words centred, no
     * underline, the hand pointer; text takes the link's underline.
     * A border nobody sees (no width, or style none) is no border, whatever
     * its colour: text would otherwise "keep" an invisible black border.
     */
    function linkLooks(el) {
        const tag = el.localName;
        if (tag === 'a') return {};
        const probe = document.createElement('a');
        for (const a of Array.from(el.attributes)) {
            if (a.name === 'type') continue;
            try {
                probe.setAttribute(a.name, a.value);
            } catch {
                // A name only the parser takes, like Jinja's '{%': it styles nothing.
            }
        }
        probe.setAttribute('href', '#'); // only an <a> with an href looks like a link
        for (const child of Array.from(el.childNodes)) probe.appendChild(child.cloneNode(true));
        // A computed style is live, so each is copied while it is true: the
        // element's before the probe goes in, the probe's while it stands in
        // the element's own place - first child, after the same neighbour -
        // where the page's ':first-child' and 'h2 + p' rules find it as they
        // will find the link.
        const was = styleOf(el);
        el.replaceWith(probe);
        const now = styleOf(probe);
        const looks = {};
        const keep = (prop, value, then) => { if (value !== then) looks[prop] = value; };
        const sides = (cs, name) => SIDES.map((side) => cs.getPropertyValue(name + '-' + side)).join(' ');
        keep('padding', sides(was, 'padding'), sides(now, 'padding'));
        keep('margin', sides(was, 'margin'), sides(now, 'margin'));
        const edge = (cs, side) => {
            const [width, style, color] = ['width', 'style', 'color'].map((part) => cs.getPropertyValue('border-' + side + '-' + part));
            return parseFloat(width) === 0 || style === 'none' || style === 'hidden' ? 'none' : width + ' ' + style + ' ' + color;
        };
        const edges = SIDES.map((side) => [edge(was, side), edge(now, side)]);
        if (edges.some(([a, b]) => a !== b)) {
            if (edges.every(([a]) => a === edges[0][0])) looks.border = edges[0][0];
            else SIDES.forEach((side, i) => { looks['border-' + side] = edges[i][0]; });
        }
        // An elliptical corner ("4px 8px") has no place in the one-value shorthand: it is left as the page has it.
        const corners = (cs) => ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map((c) => cs.getPropertyValue('border-' + c + '-radius'));
        if (!corners(was).some((c) => c.includes(' '))) keep('border-radius', corners(was).join(' '), corners(now).join(' '));
        for (const prop of PLAIN_LOOKS) keep(prop, was.getPropertyValue(prop), now.getPropertyValue(prop));
        // A button the browser paints itself (appearance: auto, the border
        // and background the page never set - a Fill turns the painting
        // off and shows the outset border as it is) does not show its computed 2px outset border,
        // which on a link is a heavy black frame. What shows is a 1px grey
        // line with rounded corners, so the link gets that, its padding
        // taking the rest of the border's width so its size stays the same.
        const native = tag === 'button' && was.appearance !== 'none'
            && was.getPropertyValue('background-color') === 'rgb(239, 239, 239)' && was.getPropertyValue('background-image') === 'none'
            && SIDES.every((side) => was.getPropertyValue('border-' + side + '-style') === 'outset');
        if (native) {
            looks.padding = SIDES.map((side) => (parseFloat(was.getPropertyValue('padding-' + side))
                + Math.max(0, parseFloat(was.getPropertyValue('border-' + side + '-width')) - 1)) + 'px').join(' ');
            looks.border = '1px solid rgb(118, 118, 118)';
            if (corners(was).every((c) => parseFloat(c) === 0)) looks['border-radius'] = '2px';
        }
        if (tag === 'button') {
            looks.display = was.display === 'none' ? 'none' : was.display.startsWith('inline') ? 'inline-flex' : 'flex';
            // The words stay where the button had them: centred, unless it was aligned left or right.
            const align = alignOf(boxOf(was.display, was.getPropertyValue('flex-direction')), was.getPropertyValue('text-align'), was.getPropertyValue('justify-content')) ?? 'center';
            Object.assign(looks, { 'align-items': 'center', 'justify-content': alignDeclarations('flex', align)['justify-content'], 'text-decoration': 'none', cursor: 'pointer', 'box-sizing': 'border-box' });
        }
        // A size the page gave the old tag ('button { width: 160px }') is
        // kept, but only one the looks so far do not give back already: a
        // button sized by its words stays sized by them, so retyping them
        // still resizes it.
        for (const [prop, value] of Object.entries(looks)) probe.style.setProperty(prop, value);
        const sized = getComputedStyle(probe);
        keep('width', was.getPropertyValue('width'), sized.width);
        keep('height', was.getPropertyValue('height'), sized.height);
        probe.replaceWith(el);
        return looks;
    }

    // ---- move & resize -------------------------------------------------
    // A move NUDGES an element: position: relative with left/top offsets, so
    // it keeps its place in the page and nothing else reflows. (Absolute
    // placement pulls it out of the flow: a header whose only child moved
    // collapses to its padding, which is how a real page gets wrecked.)
    // A resize writes width/height, and makes an inline element inline-block
    // so those can apply at all. A shape Draw2Code drew is drawn again at
    // each size on the way (src/redraw.ts), so it fills its box as it will
    // in the saved page, where the extension draws it again the same way.
    // An element placed at exact coordinates (absolute: everything Draw2Code
    // generates, and anything placed freely) is MOVED - its left/top change.
    // An element in the page's flow is NUDGED - relative offsets, as above.
    function currentNudge(el) {
        const style = getComputedStyle(el);
        const placed = style.position === 'absolute' || style.position === 'fixed';
        const positioned = style.position !== 'static';
        const offset = (value, fallback) => { const n = parseFloat(value); return Number.isFinite(n) ? n : fallback; };
        return {
            placed,
            left: positioned ? offset(style.left, placed ? el.offsetLeft : 0) : 0,
            top: positioned ? offset(style.top, placed ? el.offsetTop : 0) : 0,
            width: Math.round(el.getBoundingClientRect().width),
            height: Math.round(el.getBoundingClientRect().height),
        };
    }

    const drawnShape = ${drawnShape.toString()};
    const redrawn = ${redrawn.toString()};

    /** A drawing Draw2Code drew, as it is before a resize: what each size on the way is drawn from. */
    function shapeDrawn(el) {
        if (!isDrawing(el)) return null;
        const tag = drawnShape(el.id, Array.from(el.children, (child) => child.localName));
        if (!tag) return null;
        const shape = el.firstElementChild;
        const geometry = {};
        for (const a of Array.from(shape.attributes)) geometry[a.name] = a.value;
        return { svg: el, shape, tag, geometry, viewBox: el.getAttribute('viewBox') || '' };
    }

    function redraw(drawing, width, height) {
        // In the phone view a drawing is stretched to its box, not drawn again (src/pageEdit.ts stretchDrawings).
        if (PHONE_VIEW) return;
        const next = redrawn(drawing.tag, drawing.geometry, drawing.viewBox, width, height);
        for (const [name, value] of Object.entries(next.svg)) drawing.svg.setAttribute(name, value);
        for (const [name, value] of Object.entries(next.shape)) drawing.shape.setAttribute(name, value);
    }

    // ---- scrolling at the edges while dragging --------------------------
    // A drawing, a move or a resize held near the top of the page area (or
    // over the bar) or near the bottom of the view scrolls the page, faster
    // the nearer the edge (src/edgeScroll.ts), so a box taller than the view
    // is drawn, moved or resized in one drag. Into the room below the page
    // too: a moved or resized element that reaches it makes the page longer,
    // and the room goes on past it.
    const edgeSpeed = ${edgeSpeed.toString()};

    /**
     * The scrolling of one drag. Every pointer move tells it where the
     * pointer is; while that is near an edge it scrolls a step a frame and
     * calls follow(), so the drag goes on with the page in the same frame
     * (the pointer has not moved in the view, but it is over another part of
     * the page). A scroll of any other kind - the mouse wheel mid-drag -
     * calls follow() too. stop() ends it, on release.
     */
    function edgeScroller(follow) {
        let at = null, frame = 0;
        const step = () => {
            frame = 0;
            const speed = at === null ? 0 : edgeSpeed(at, BAR_PX, window.innerHeight);
            if (!speed) return;
            const was = window.scrollY;
            // At once: a page may ask for smooth scrolling.
            window.scrollTo({ left: window.scrollX, top: was + speed, behavior: 'instant' });
            if (window.scrollY !== was) follow();
            // Still near the edge: on again next frame, also at the end of
            // the page, which the room may yet make longer.
            frame = requestAnimationFrame(step);
        };
        window.addEventListener('scroll', follow);
        return {
            point(y) {
                at = y;
                if (!frame) frame = requestAnimationFrame(step);
            },
            stop() {
                at = null;
                if (frame) cancelAnimationFrame(frame);
                frame = 0;
                window.removeEventListener('scroll', follow);
            },
        };
    }

    // ---- snapping guides ---------------------------------------------------
    // While a box is moved, resized or drawn, its edges and centres snap onto
    // those of the elements beside it and of the page's wrapper, within
    // SNAP_PX (src/placement.ts), and a thin line shows each one it is on.
    // Small boxes, sizes and the gaps between neighbours are left as the
    // pointer has them: see snapBox.
    // The lines are measured once, when the press starts, in the document's
    // coordinates, so a scroll mid-drag leaves them true. Holding Ctrl (Cmd
    // on a Mac) drags freely. The guides are the editor's own, drawn in the
    // overlay: never part of the page.
    const snapLines = ${snapLines.toString()};
    const firstLineFrom = ${firstLineFrom.toString()};
    const snapBox = ${snapBox.toString()};
    const resizedBox = ${resizedBox.toString()};
    const drawnHandle = ${drawnHandle.toString()};
    const drawnSize = ${drawnSize.toString()};
    const dragsFreely = ${dragsFreely.toString()};
    const isFreeKey = ${isFreeKey.toString()};
    const SNAP_PX = ${SNAP_PX};
    /** The most neighbours measured: past it, the first ones are enough to line up with. */
    const SNAP_MOST = 2000;
    const guideLines = [];

    /** An element's box in the document's coordinates. */
    function docBox(el) {
        const r = el.getBoundingClientRect();
        return { left: r.left + window.scrollX, top: r.top + window.scrollY, width: r.width, height: r.height };
    }

    /** The box around boxes. */
    function boxAround(boxes) {
        return boxes.reduce((a, b) => {
            const left = Math.min(a.left, b.left), top = Math.min(a.top, b.top);
            return { left, top, width: Math.max(a.left + a.width, b.left + b.width) - left, height: Math.max(a.top + a.height, b.top + b.height) - top };
        });
    }

    /**
     * The lines a box among the holder's children snaps to: those of the
     * children (but not those being dragged), of the holder, and of the
     * page's wrapper when there is one.
     */
    function snapLinesIn(holder, dragged) {
        if (!holder) return null;
        const boxes = [docBox(holder)];
        if (WRAPPER && WRAPPER !== holder) boxes.push(docBox(WRAPPER));
        let n = 0;
        for (const child of holder.children) {
            if (dragged.includes(child) || isOurs(child)) continue;
            if (++n > SNAP_MOST) break;
            boxes.push(docBox(child));
        }
        return snapLines(boxes);
    }

    /** Draw the guides (in the document's coordinates), hiding the ones left over. */
    function showGuides(guides) {
        while (guideLines.length < guides.length) {
            const line = document.createElement('div');
            line.className = 'guide';
            $('layer').appendChild(line);
            guideLines.push(line);
        }
        guideLines.forEach((line, i) => {
            const g = guides[i];
            if (!g) { line.style.display = 'none'; return; }
            line.style.display = 'block';
            const x = window.scrollX, y = window.scrollY;
            place(line, g.axis === 'x'
                ? { left: g.at - x - 0.5, top: g.from - y, width: 1, height: g.to - g.from }
                : { left: g.from - x, top: g.at - y - 0.5, width: g.to - g.from, height: 1 });
        });
    }

    /**
     * Follow Ctrl (Cmd) while a drag is held: pressed or let go, the drag is
     * shown again with or without snapping. The key still goes on to VS
     * Code, which does nothing with it alone, so it never thinks the key is
     * held after it was let go.
     */
    function freeWatcher(changed) {
        const key = (e) => {
            if (isFreeKey(e.key)) changed(dragsFreely(e));
        };
        document.addEventListener('keydown', key, true);
        document.addEventListener('keyup', key, true);
        return () => {
            document.removeEventListener('keydown', key, true);
            document.removeEventListener('keyup', key, true);
        };
    }

    /**
     * Drags use pointer capture: every move and the release go to the element
     * that was pressed, wherever the pointer wanders, so the drag does not
     * depend on what is under the cursor (page, overlay, or nothing).
     */
    function startDrag(e, mode, handle, captor) {
        if (!selected) return;
        e.preventDefault();
        e.stopPropagation();
        const box = currentNudge(selected);
        // A move, or a resize by a left or top handle, changes its offsets:
        // an element in the page's flow is nudged from where it is.
        if (!box.placed && (mode === 'move' || /[nw]/.test(handle))) selected.style.position = 'relative';
        if (mode === 'resize' && getComputedStyle(selected).display === 'inline') selected.style.display = 'inline-block';
        // The rest of a selection moves with it, by as much: each from where it is.
        const group = mode === 'move' ? outermost(chosen()).filter((el) => el !== selected).map((el) => {
            const at = currentNudge(el);
            if (!at.placed) el.style.position = 'relative';
            return { el, box: at, full: isFull(el), next: null };
        }) : [];
        // A press does not move focus, so a size still in the box is written now, as select() does.
        if (st.size && root.activeElement === st.size) st.size.blur();
        if (boxEdit) boxFields[boxEdit.which].blur();
        // Where the press was on the page, not in the view: a scroll while the
        // drag is held moves the pointer over the page as much as moving it
        // would. Not for an element fixed in the view, which a scroll leaves
        // where it is.
        const fixed = getComputedStyle(selected).position === 'fixed';
        const scrolled = () => fixed ? { x: 0, y: 0 } : { x: window.scrollX, y: window.scrollY };
        let pointer = { x: e.clientX, y: e.clientY };
        drag = { mode, handle, startX: e.clientX + scrolled().x, startY: e.clientY + scrolled().y, box, next: null, grows: grows(selected), drawing: mode === 'resize' ? shapeDrawn(selected) : null,
                 full: isFull(selected), group };
        // Full width, an element moves only up and down; several move sideways unless all are.
        const upDown = [drag.full, ...group.map((g) => g.full)].every(Boolean);
        // What it snaps to, and where its box starts (not for an element
        // fixed in the view): with several, the box around them all.
        let lines = fixed ? null : snapLinesIn(selected.parentElement, [selected, ...group.map((g) => g.el)]);
        if (lines && upDown) lines = { x: [], y: lines.y };
        const rect = boxAround([selected, ...group.map((g) => g.el)].map(docBox));
        let free = dragsFreely(e);
        // What is kept in the page's column (see "the page's column"): each
        // element that is, where it starts in the document, and its drawing,
        // drawn again if a move makes it as wide as the column.
        const column = fixed ? null : columnOnPage();
        const kept = column ? [selected, ...group.map((g) => g.el)].filter(inColumn)
            .map((el) => ({ el, doc: docBox(el), drawing: shapeDrawn(el) })) : [];
        // Listen on the document, not on what was pressed: a handle lives in
        // our shadow root, and pointer capture is not dependable here, so the
        // release can arrive on any element of the page.
        try { captor.setPointerCapture(e.pointerId); } catch (err) { /* best effort */ }
        const update = () => {
            if (!drag || !selected) return;
            // Full width, the element is as wide as the window wherever it
            // is: only its place from the top and its height change.
            let dx = (drag.mode === 'move' ? upDown : drag.full) ? 0 : pointer.x + scrolled().x - drag.startX;
            let dy = pointer.y + scrolled().y - drag.startY;
            const b = drag.box;
            let guides = [];
            if (lines && !free) {
                // The box where the pointer would put it, snapped: the edges
                // a handle drags, or the whole box.
                const h = drag.mode === 'move' ? 'move' : drag.handle;
                const at = h === 'move'
                    ? { left: rect.left + dx, top: rect.top + dy, width: rect.width, height: rect.height }
                    : resizedBox(rect, h, dx, dy);
                const snapped = snapBox(at, h, lines, SNAP_PX);
                dx += snapped.dx;
                dy += snapped.dy;
                guides = snapped.guides;
            }
            // Kept in the column, each element is moved across by as much
            // more as it needs to stay in (shift), and made as wide as the
            // column if it is wider (narrow). The guides are then those of
            // where the boxes are: a side stopped at the column's edge lies
            // on the wrapper's line.
            const shift = new Map(), narrow = new Map();
            let next;
            if (drag.mode === 'move') {
                if (kept.length) {
                    const moved = kept.map((k) => ({ ...k.doc, left: k.doc.left + dx }));
                    boxesInColumn(moved, column).forEach((box, i) => {
                        shift.set(kept[i].el, box.left - moved[i].left);
                        if (box.width < moved[i].width) narrow.set(kept[i].el, box.width);
                    });
                }
                const placeOne = (el, from, isFull) => {
                    const to = { left: from.left + (isFull ? 0 : dx + (shift.get(el) || 0)), top: from.top + dy, width: from.width, height: from.height, narrow: narrow.has(el) };
                    if (!isFull) el.style.left = Math.round(to.left) + 'px';
                    el.style.top = Math.round(to.top) + 'px';
                    if (to.narrow) {
                        to.width = narrow.get(el);
                        el.style.width = Math.round(to.width) + 'px';
                        const k = kept.find((one) => one.el === el);
                        if (k && k.drawing) redraw(k.drawing, Math.round(to.width), Math.round(k.doc.height));
                    }
                    return to;
                };
                next = placeOne(selected, b, drag.full);
                for (const g of drag.group) g.next = placeOne(g.el, g.box, g.full);
                if (lines && !free && ([...shift.values()].some(Boolean) || narrow.size)) {
                    guides = snapBox(boxAround([selected, ...drag.group.map((g) => g.el)].map(docBox)), 'move', lines, 0).guides;
                }
            } else {
                const h = drag.handle;
                // Only the edges being dragged move: a left or top handle
                // moves the element's offset as much as its size changes, so
                // the edge across from it stays where it is.
                next = resizedBox(b, h, dx, dy);
                // Kept in the column, a side dragged past it stops at it; one
                // sticking out from before is cut to it too.
                if (kept.length && !drag.full) {
                    const shown = resizedBox(rect, h, dx, dy);
                    const cut = boxCutToColumn(shown, column);
                    const dl = cut.left - shown.left, dr = cut.left + cut.width - (shown.left + shown.width);
                    if (dl || dr) {
                        next = { ...next, left: next.left + dl, width: Math.max(b.width > 0 ? 1 : 0, next.width + dr - dl) };
                        if (lines && !free) guides = snapBox(cut, h, lines, 0).guides;
                    }
                }
                if (!drag.full) selected.style.width = Math.round(next.width) + 'px';
                if (!drag.grows) selected.style.height = Math.round(next.height) + 'px';
                else if (/[ns]/.test(h)) selected.style.minHeight = Math.round(next.height) + 'px';
                // A text that grows is no shorter than its words: a top
                // handle stops where they need it to, its bottom kept.
                if (drag.grows && h.includes('n')) {
                    const real = Math.round(selected.getBoundingClientRect().height);
                    if (real > next.height) {
                        next = { ...next, top: b.top + b.height - real };
                        // Its top is not where it snapped: no guide there.
                        guides = guides.filter((g) => g.axis !== 'y');
                    }
                }
                if ((h.includes('w') || next.left !== b.left) && !drag.full) selected.style.left = Math.round(next.left) + 'px';
                if (h.includes('n')) selected.style.top = Math.round(next.top) + 'px';
                // A full-width drawing keeps the width it was drawn at: its picture is stretched to the window.
                if (drag.drawing) redraw(drag.drawing, drag.full ? Number(drag.drawing.svg.getAttribute('width')) || 0 : Math.round(next.width), Math.round(next.height));
            }
            showGuides(guides);
            drag.next = next;
            paint();
        };
        const edges = fixed ? null : edgeScroller(update);
        const unwatch = freeWatcher((held) => { free = held; update(); });
        const onMove = (ev) => {
            pointer = { x: ev.clientX, y: ev.clientY };
            free = dragsFreely(ev);
            update();
            if (edges) edges.point(ev.clientY);
        };
        const onUp = (ev) => {
            document.removeEventListener('pointermove', onMove, true);
            document.removeEventListener('pointerup', onUp, true);
            document.removeEventListener('pointercancel', onUp, true);
            if (edges) edges.stop();
            unwatch();
            showGuides([]);
            try { captor.releasePointerCapture(ev.pointerId); } catch (err) { /* already released */ }
            finishDrag();
        };
        document.addEventListener('pointermove', onMove, true);
        document.addEventListener('pointerup', onUp, true);
        document.addEventListener('pointercancel', onUp, true);
        paint();
    }

    /**
     * Text and Heading grow with their text: a resize sets the least height
     * they take. Only a <p> or a heading (a textarea is pre-wrap too, and it
     * must still get shorter), also once it is a link: data-d2c-was="p".
     */
    function grows(el) {
        const tag = el.getAttribute(WAS_ATTR) || el.localName;
        return /^(p|h[1-6])(\\s|$)/i.test(tag) && KEEPS_LINES.includes(getComputedStyle(el).whiteSpace);
    }

    /**
     * The rule a resize writes: a text that grows keeps its least height
     * unless a top or bottom handle moved. A left or top handle moved the
     * element too, so its left or top goes with it (nudged from its place in
     * the page's flow when it is not placed freely).
     */
    function resizeDeclarations(box, growing, handle, placed) {
        const out = { width: Math.round(box.width) + 'px' };
        if (!growing) out.height = Math.round(box.height) + 'px';
        // A side handle leaves the least height as it was: the box is as
        // tall as its text there, not as it was drawn.
        else if (/[ns]/.test(handle)) Object.assign(out, { 'min-height': Math.round(box.height) + 'px', height: '' });
        if (handle.includes('w')) out.left = Math.round(box.left) + 'px';
        if (handle.includes('n')) out.top = Math.round(box.top) + 'px';
        if (!placed && /[nw]/.test(handle)) out.position = 'relative';
        return out;
    }

    function finishDrag() {
        if (!drag || !selected) return;
        const box = drag.next;
        const ref = refOf(selected);
        justDragged = Boolean(drag.next);
        const mode = drag.mode;
        const placed = drag.box.placed;
        const growing = drag.grows;
        const handle = drag.handle;
        const full = drag.full;
        const from = drag.box;
        const group = drag.group;
        drag = null;
        paint();
        // A press that never moved is a click, not an edit: writing a rule for
        // it would put a step in the history that undoes nothing.
        if (!ref || !box) return;
        const moved = (to, isPlaced, isFull) => {
            const declarations = isPlaced
                ? { left: Math.round(to.left) + 'px', top: Math.round(to.top) + 'px' }
                : { position: 'relative', left: Math.round(to.left) + 'px', top: Math.round(to.top) + 'px' };
            // Full width, its own left stays as it is, for when it is back in the page's width.
            if (isFull) delete declarations.left;
            // Made as wide as the page's column: a drawing is drawn again at that width.
            if (to.narrow) declarations.width = Math.round(to.width) + 'px';
            return declarations;
        };
        if (group.length) {
            // Several moved together: ONE edit, each by as much as the one
            // pressed, or as far as it went to stay in the page's column.
            const dx = box.left - from.left, dy = box.top - from.top;
            const ops = [{ op: 'style', ref, declarations: moved(box, placed, full) }];
            for (const g of group) {
                const at = refOf(g.el);
                if (!at) return;
                ops.push({ op: 'style', ref: at, declarations: moved(g.next || { left: g.box.left + dx, top: g.box.top + dy }, g.box.placed, g.full) });
            }
            vscode.postMessage({ type: 'edit', op: { op: 'batch', ref: {}, label: 'Move elements', ops } });
            return;
        }
        const declarations = mode === 'move' ? moved(box, placed, full) : resizeDeclarations(box, growing, handle, placed);
        // A resize stopped at a side of the page's column it was sticking out of moved its left too.
        if (mode === 'resize' && declarations.left === undefined && Math.round(box.left) !== Math.round(from.left)) declarations.left = Math.round(box.left) + 'px';
        if (mode === 'resize' && selected.style.display === 'inline-block') declarations.display = 'inline-block';
        // Full width, its own left and width stay as they are, for when it is back in the page's width.
        if (full) {
            delete declarations.left;
            delete declarations.width;
            if (!Object.keys(declarations).length) return;
        }
        vscode.postMessage({ type: 'edit', op: { op: 'style', ref, declarations } });
    }

    // ---- drawing -------------------------------------------------------
    // The canvas's tools, on a real page. A drag draws a box (a click places
    // a widget at its default size); where the element goes is then asked
    // in the editor - placed freely where it was drawn, or added into the
    // section it was drawn over. Like the canvas, a tool is used once and
    // Select comes back.
    let tool = 'select';
    const BAR_PX = ${BAR_HEIGHT};
    const CONTAINERS = ['main', 'section', 'article', 'header', 'footer', 'nav', 'aside', 'form', 'div', 'li', 'ul', 'ol', 'figure', 'fieldset', 'details', 'td', 'body'];

    function setTool(name) {
        tool = name;
        for (const b of root.querySelectorAll('.d2c-tool')) b.classList.toggle('active', b.dataset.tool === name);
        document.documentElement.style.cursor = name === 'select' ? '' : 'crosshair';
        if (name !== 'select') select(null);
    }
    if ($('toolbar')) {
        $('toolbar').addEventListener('click', (e) => {
            const b = e.target.closest ? e.target.closest('.d2c-tool') : null;
            if (b) setTool(b.dataset.tool);
        });
        // Only when the row is wider than the panel: an up-down wheel then
        // scrolls it sideways, so the last controls are never out of reach.
        $('toolbar').addEventListener('wheel', (e) => {
            const bar = $('toolbar');
            if (bar.scrollWidth <= bar.clientWidth || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
            bar.scrollLeft += e.deltaY;
            e.preventDefault();
        }, { passive: false });
    }

    // ---- the Video tool's kind -----------------------------------------
    // The arrow beside Video opens a small list of the two kinds it adds:
    // your own file or a hosted link, each with its own hover description.
    // Picking one picks the Video tool in that kind, and the Video button
    // then says which; a click on the button uses the kind picked last. It
    // is remembered in the webview's state, so a re-render keeps it. Esc,
    // Tab or a press anywhere else closes the list; the arrows move in it.
    const VIDEO_BUTTONS = ${VIDEO_BUTTONS};
    let videoKind = VIDEO_BUTTONS[saved.videoKind] ? saved.videoKind : ${JSON.stringify(VIDEO_KIND_DEFAULT)};
    const kinds = $('video-kinds');
    const kindMore = $('video-kind-more');
    const kindItems = kinds ? Array.from(kinds.querySelectorAll('.d2c-kind')) : [];
    const kindsOpen = () => Boolean(kinds && !kinds.hidden);

    /** The Video button's name and hover description, and the tick in the list, for the kind in use. */
    function showKind() {
        const button = root.querySelector('.d2c-tool[data-tool="video"]');
        if (button) {
            button.title = VIDEO_BUTTONS[videoKind].title;
            button.setAttribute('aria-label', VIDEO_BUTTONS[videoKind].label);
        }
        for (const item of kindItems) item.setAttribute('aria-checked', String(item.dataset.kind === videoKind));
    }

    function openKinds() {
        closeColours(true);
        kinds.hidden = false;
        kindMore.setAttribute('aria-expanded', 'true');
        // Under its arrow, kept inside the view, with the kind in use focused.
        const r = kindMore.getBoundingClientRect();
        kinds.style.left = Math.max(4, Math.min(r.left, window.innerWidth - kinds.offsetWidth - 4)) + 'px';
        (kindItems.find((item) => item.dataset.kind === videoKind) || kindItems[0]).focus();
    }

    /** Close the list; with back, the focus goes back to its arrow (Esc). */
    function closeKinds(back) {
        if (!kindsOpen()) return;
        kinds.hidden = true;
        kindMore.setAttribute('aria-expanded', 'false');
        if (back) kindMore.focus();
    }

    /** Pick a kind: the Video tool is chosen in it, as a click on a tool chooses one. */
    function useKind(kind) {
        if (!VIDEO_BUTTONS[kind]) return;
        videoKind = kind;
        keepState({ videoKind });
        showKind();
        closeKinds(false);
        setTool('video');
        // The list's own button had the focus; nothing of the toolbar keeps it.
        if (root.activeElement) root.activeElement.blur();
    }

    if (kinds && kindMore) {
        kindMore.addEventListener('click', () => { if (kindsOpen()) closeKinds(false); else openKinds(); });
        for (const item of kindItems) item.addEventListener('click', () => useKind(item.dataset.kind));
        kinds.addEventListener('keydown', (e) => {
            const at = kindItems.indexOf(root.activeElement);
            const go = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: kindItems.length - 1 }[e.key];
            if (e.key === 'Tab') { closeKinds(false); return; }
            if (go === undefined) return;
            e.preventDefault();
            kindItems[(go + kindItems.length) % kindItems.length].focus();
        });
        // A press anywhere but the list or its arrow closes it, before the
        // press does anything else.
        document.addEventListener('pointerdown', (e) => {
            if (!kindsOpen()) return;
            const path = e.composedPath();
            if (!path.includes(kinds) && !path.includes(kindMore)) closeKinds(false);
        }, true);
        showKind();
    }

    /** The nearest ancestor of an element that holds children (<body> at the most), or null. */
    function holderOf(el) {
        let node = el;
        while (node && node !== document.documentElement) {
            if (node.tagName && CONTAINERS.includes(node.tagName.toLowerCase()) && !isOurs(node)) return node;
            node = node.parentElement;
        }
        return null;
    }

    /** The section an element sits in: the nearest ancestor that holds children. */
    function sectionOf(el) {
        let node = el;
        while (node && node !== document.documentElement) {
            if (node.tagName && CONTAINERS.includes(node.tagName.toLowerCase()) && !isOurs(node)) {
                if (node === document.body) return { ref: { body: true }, label: 'the page' };
                const ref = refOf(node);
                if (!ref) return null;
                const tag = node.tagName.toLowerCase();
                const name = node.id ? '#' + node.id : node.classList.length ? '.' + node.classList[0] : '';
                return { ref, label: tag + name };
            }
            node = node.parentElement;
        }
        return { ref: { body: true }, label: 'the page' };
    }

    function startDraw(e) {
        e.preventDefault();
        e.stopPropagation();
        // Every point is kept in the document's coordinates (the view's plus
        // the scroll), so a drawing goes on growing while the page scrolls
        // under a pointer held at an edge. The box being drawn is shown in
        // the view's.
        const onPage = (x, y) => ({ x: x + window.scrollX, y: y + window.scrollY });
        let pointer = { x: e.clientX, y: e.clientY };
        const pressed = onPage(e.clientX, e.clientY);
        const into = sectionOf(e.target);
        const draft = $('draft');
        // The corner pressed stays where it was pressed; the corner the
        // pointer has snaps, as a resize by that corner does (snapBox), so a
        // small shape, or one drawn a few px from another, is made as it is
        // drawn. A freehand stroke does not snap. On a page made in
        // Draw2Code, a box snaps to what is placed freely in its wrapper.
        // There, both corners and every point of a stroke stop at the sides
        // of the page's column, and a corner stopped there lies on its line.
        const lines = tool === 'pen' ? null : snapLinesIn(WRAPPER || holderOf(e.target) || document.body, []);
        const column = columnOnPage();
        let free = dragsFreely(e);
        let guides = [];
        const keptIn = (p) => column ? { x: xInColumn(p.x, column), y: p.y } : p;
        const start = keptIn(pressed);
        // Where the pointer's corner goes, from the pointer at p.
        const snapped = (p) => {
            const at = keptIn(p);
            if (!lines || free) return at;
            const h = drawnHandle(start, at);
            const box = { left: Math.min(start.x, at.x), top: Math.min(start.y, at.y), width: Math.abs(at.x - start.x), height: Math.abs(at.y - start.y) };
            const s = snapBox(box, h, lines, SNAP_PX);
            const to = { x: at.x + (h.includes('e') || h.includes('w') ? s.dx : 0), y: at.y + (h.includes('n') || h.includes('s') ? s.dy : 0) };
            const x = column ? xInColumn(to.x, column) : to.x;
            if (x === to.x) { guides.push(...s.guides); return to; }
            const kept = { x, y: to.y };
            guides.push(...snapBox({ left: Math.min(start.x, x), top: box.top, width: Math.abs(x - start.x), height: box.height }, h, lines, 0).guides);
            return kept;
        };
        let last = start;
        const points = [[start.x, start.y]];
        showGuides(guides);
        const show = (a, b) => {
            draft.style.display = 'block';
            place(draft, { left: Math.min(a.x, b.x) - window.scrollX, top: Math.min(a.y, b.y) - window.scrollY, width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) });
        };
        show(start, start);
        const update = () => {
            guides = [];
            last = snapped(onPage(pointer.x, pointer.y));
            showGuides(guides);
            if (tool === 'pen') {
                const [px, py] = points[points.length - 1];
                if (Math.hypot(last.x - px, last.y - py) >= 2) points.push([last.x, last.y]);
                const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
                show({ x: Math.min(...xs), y: Math.min(...ys) }, { x: Math.max(...xs), y: Math.max(...ys) });
            } else {
                show(start, last);
            }
        };
        const edges = edgeScroller(update);
        const unwatch = freeWatcher((held) => { free = held; update(); });
        const onMove = (ev) => {
            pointer = { x: ev.clientX, y: ev.clientY };
            free = dragsFreely(ev);
            update();
            edges.point(ev.clientY);
        };
        const onUp = () => {
            document.removeEventListener('pointermove', onMove, true);
            document.removeEventListener('pointerup', onUp, true);
            document.removeEventListener('pointercancel', onUp, true);
            edges.stop();
            unwatch();
            showGuides([]);
            draft.style.display = 'none';
            justDragged = true;
            const drawn = tool;
            setTool('select');
            // Document -> page coordinates: measured from where the page
            // starts (the bar is not part of the page). Rounded to whole px
            // of the wrapper, which a centred column can start half a px
            // into: a corner stopped at its left side is at 0, not at 1.
            const across = WRAPPER ? wrapperOrigin().x : 0;
            const toPage = (x, y) => ({ x: Math.round(x - across) + across, y: Math.round(y - BAR_PX) });
            // Each corner is rounded on its own, so a corner snapped onto
            // another element's edge ends on that edge's whole px.
            const a = toPage(Math.min(start.x, last.x), Math.min(start.y, last.y));
            const b = toPage(Math.max(start.x, last.x), Math.max(start.y, last.y));
            // Whether it was dragged at all goes by the pointer's own travel,
            // not the snapped corners; dragged, nothing is made 0px wide or
            // tall but a line drawn straight (drawnSize).
            const end = onPage(pointer.x, pointer.y);
            const size = drawnSize({ x: end.x - pressed.x, y: end.y - pressed.y }, b.x - a.x, b.y - a.y, drawn === 'line');
            const moved = size.moved;
            if (drawn === 'pen' && points.length < 2) return;
            if (!moved && ['rect', 'ellipse', 'line'].includes(drawn)) return; // a shape needs a size
            vscode.postMessage({
                type: 'draw',
                tool: drawn,
                box: { x: a.x, y: a.y, w: size.w, h: size.h },
                flip: drawn === 'line' && ((last.x - start.x) * (last.y - start.y) < 0),
                points: drawn === 'pen' ? points.map(([x, y]) => { const p = toPage(x, y); return [p.x, p.y]; }) : undefined,
                into,
                // The editor goes straight to this kind's questions.
                kind: drawn === 'video' ? videoKind : undefined,
                // Placed freely in the page's wrapper, the box is measured from
                // where the wrapper starts: centred, in a window wider than the page.
                wrapper: wrapperOrigin(),
                style: { ...nextStyle },
            });
        };
        document.addEventListener('pointermove', onMove, true);
        document.addEventListener('pointerup', onUp, true);
        document.addEventListener('pointercancel', onUp, true);
    }

    // Pressing inside the selected element starts a move; the handles (the
    // only part of the overlay that takes clicks) start a resize. With a
    // drawing tool chosen, a press starts a drawing instead.
    document.addEventListener('pointerdown', (e) => {
        // A new press starts a new interaction: whatever the last drag left
        // behind no longer applies. (The click that ends a drag does not
        // always arrive, so this cannot be left to that click alone.)
        justDragged = false;
        if (!editing || typing || isOurs(e.target) || e.button !== 0) return;
        // A press on the page means the page: a move or a drawing keeps the
        // focus where it was, so a toolbar field would keep Delete.
        releaseField();
        if (tool !== 'select') { startDraw(e); return; }
        // Only a press ON the selected element moves it. A press on something
        // inside it - a rect inside the page wrapper, a link inside a section -
        // is meant for that thing: it goes on to be a click that selects it.
        // (Moving the container instead also captured the pointer, so the
        // click came back to the container, and nothing inside a selected
        // container could ever be selected.)
        // Shift+click picks more, or fewer: it never moves. A press on any of
        // several selected moves them all, led by the one pressed (or the
        // selected one it is in).
        const hit = drawingOf(e.target);
        if (e.shiftKey || !chosen().includes(hit)) return;
        const lead = outermost(chosen()).find((el) => el === hit || el.contains(hit)) || hit;
        if (lead !== selected) select(lead, chosen());
        startDrag(e, 'move', null, lead);
    }, true);
    for (const name of HANDLES) {
        handles[name].addEventListener('pointerdown', (e) => startDrag(e, 'resize', name, handles[name]));
    }

    // ---- text ----------------------------------------------------------
    let typedFrom = '';
    let keepsLines = false; // the element being typed in shows line breaks
    // Retyping an input's placeholder: what the input had before, put back after.
    let typingInput = null;

    /** The kinds of <input> that show a placeholder (a number field would refuse words). */
    const PLACEHOLDER_TYPES = ['text', 'search', 'url', 'tel', 'email', 'password'];
    const hasPlaceholder = (el) => Boolean(el && el.localName === 'input' && PLACEHOLDER_TYPES.includes(el.type));

    /**
     * An input is retyped by its placeholder, the words it shows while
     * empty: they are put in the field to edit, drawn in the placeholder's
     * own colour, and written back as the placeholder (Enter, or a click
     * elsewhere); Esc puts back the one it had. Nothing typed stays in the
     * field.
     */
    function startPlaceholder(el) {
        selected = el;
        others = [];
        typing = true;
        keepsLines = false;
        typedFrom = el.getAttribute('placeholder') || '';
        const colour = getComputedStyle(el, '::placeholder').color;
        typingInput = { placeholder: el.getAttribute('placeholder'), style: el.getAttribute('style'), type: el.getAttribute('type'), value: el.value };
        // A password field would hide the words as dots.
        if (el.type === 'password') el.setAttribute('type', 'text');
        el.removeAttribute('placeholder');
        el.value = typedFrom;
        if (colour) el.style.color = colour;
        el.focus();
        el.select();
        paint();
    }

    /** The input as it was before its placeholder was retyped, now showing that placeholder (null: none). */
    function endPlaceholder(el, placeholder) {
        const was = typingInput;
        typingInput = null;
        el.value = was.value;
        if (was.style === null) el.removeAttribute('style');
        else el.setAttribute('style', was.style);
        if (was.type === null) el.removeAttribute('type');
        else el.setAttribute('type', was.type);
        if (placeholder === null) el.removeAttribute('placeholder');
        else el.setAttribute('placeholder', placeholder);
        // The keys go back to the page: Delete removes the input again.
        el.blur();
    }

    /**
     * Only elements whose content is plain text can be retyped safely. Not a
     * part of a video's player either: its time would be typed into the file.
     */
    function startTyping(el) {
        if (hasPlaceholder(el) && !(el.closest && el.closest(VIDEO))) { startPlaceholder(el); return; }
        if (!el || el.children.length > 0 || (el.closest && el.closest(VIDEO))) return;
        selected = el;
        others = [];
        typing = true;
        typedFrom = el.textContent;
        // Measured first: Chromium makes everything it lets you type keep
        // its line breaks (pre or pre-wrap), so a label would seem to keep
        // lines it then folds away.
        keepsLines = KEEPS_LINES.includes(getComputedStyle(el).whiteSpace);
        el.setAttribute('contenteditable', 'plaintext-only');
        el.focus();
        document.getSelection().selectAllChildren(el);
        paint();
    }

    document.addEventListener('dblclick', (e) => {
        // A double-click in the text being typed picks a word, as anywhere
        // else: starting again would forget what was typed so far.
        if (!editing || isOurs(e.target) || (typing && e.target === selected)) return;
        clearTimeout(followTimer); // retyping a link, not following it
        e.preventDefault();
        e.stopPropagation();
        startTyping(e.target);
    }, true);

    /**
     * What was typed, as plain text. Chromium's 'plaintext-only' writes a new
     * line as a "\\n" and adds one more at the very end to hold the caret:
     * that one is dropped. It is a node of its own, so a text that merely
     * ends in "\\n" keeps it. A <br> left after deleting is a "\\n". Comments
     * are skipped, as in textContent.
     */
    function typedText(el) {
        const parts = Array.from(el.childNodes, (n) => n.nodeType === Node.TEXT_NODE ? n.data
            : n.nodeName === 'BR' ? '\\n'
            : n.nodeType === Node.ELEMENT_NODE ? n.textContent
            : '');
        const text = parts.join('');
        const last = el.lastChild;
        const caretBreak = last && (last.nodeName === 'BR' || (last.nodeType === Node.TEXT_NODE && last.data === '\\n'));
        return text === typedFrom || !caretBreak ? text : parts.slice(0, -1).join('');
    }

    function stopTyping(commit) {
        if (!typing || !selected) return;
        const el = selected;
        typing = false;
        if (typingInput) {
            const text = el.value;
            const changes = commit && text !== typedFrom;
            // Empty, the file has no placeholder at all (src/pageEdit.ts setPlaceholder).
            endPlaceholder(el, changes ? (text === '' ? null : text) : typingInput.placeholder);
            const ref = changes ? refOf(el) : null;
            if (ref) vscode.postMessage({ type: 'edit', op: { op: 'placeholder', ref, text } });
            paint();
            return;
        }
        el.removeAttribute('contenteditable');
        const text = typedText(el);
        // One text node again, as the file will have it: a <br> left inside
        // would make the element look like it has children, and it could
        // never be retyped.
        el.textContent = text;
        if (!commit || text === typedFrom) { paint(); return; }
        const ref = refOf(el);
        if (ref) vscode.postMessage({ type: 'edit', op: { op: 'text', ref, text } });
        paint();
    }

    // Enter saves. Shift+Enter starts a new line in text that shows one (a
    // paragraph, a heading, anything with white-space: pre-wrap); anywhere
    // else a line break would fold into a space, so it saves like Enter.
    document.addEventListener('keydown', (e) => {
        if (!typing || e.key !== 'Enter') return;
        if (e.shiftKey && keepsLines) return;
        e.preventDefault();
        stopTyping(true);
    }, true);
    document.addEventListener('focusout', (e) => { if (typing && e.target === selected) stopTyping(true); }, true);

    // ---- room below the page -------------------------------------------
    // The editor only (the preview shows the page as a browser would): our
    // empty box past the page's lowest point, so the page scrolls two screens
    // further and the next section can be drawn there. Measured again
    // whenever the page could grow or shrink. The box is in the shadow root,
    // so changing it does not start this again.
    const roomBox = ${roomBox.toString()};
    const roomOnly = ${roomOnly.toString()};
    const room = $('room');
    let roomFrame = 0;
    let pageEnd = 0; // how far the page scrolls without the room, as in a browser
    function makeRoom() {
        roomFrame = 0;
        const x = window.scrollX, y = window.scrollY;
        // Folded away first, to measure the page alone: counting itself, the
        // room would grow every time it was measured.
        room.style.top = '0px';
        room.style.height = '0px';
        const origin = room.getBoundingClientRect().top + window.scrollY;
        const scroller = document.scrollingElement || document.documentElement;
        const content = scroller.scrollHeight;
        pageEnd = content;
        // A page made in Draw2Code is measured once more without its
        // wrapper's least height: does it scroll in a browser as tall as
        // the page area? Any other page gets the bar's height to spare
        // (src/room.ts). The attribute is on <html>, outside what the
        // watcher below follows, so this does not start it again.
        let own = content;
        if (WRAPPER) {
            document.documentElement.setAttribute('data-draw2code-measuring', '');
            own = scroller.scrollHeight;
            document.documentElement.removeAttribute('data-draw2code-measuring');
        }
        document.documentElement.toggleAttribute('data-draw2code-room-only',
            roomOnly(own, scroller.clientHeight, WRAPPER ? 0 : BAR_PX, scroller.scrollWidth, window.innerWidth));
        const box = roomBox(content, window.innerHeight, BAR_PX, origin);
        room.style.top = box.top + 'px';
        room.style.height = box.height + 'px';
        // Folding it away pulls a view scrolled into the room back up: put it
        // back where it was, at once (a page may ask for smooth scrolling).
        if (window.scrollX !== x || window.scrollY !== y) window.scrollTo({ left: x, top: y, behavior: 'instant' });
        // The scrollbar shown or hidden moves a centred column without a resize.
        paintColumn();
    }
    const roomLater = () => { if (!roomFrame) roomFrame = requestAnimationFrame(makeRoom); };
    if (room) {
        makeRoom();
        window.addEventListener('load', roomLater);
        document.addEventListener('load', roomLater, true);
        window.addEventListener('resize', roomLater);
        if (document.fonts) document.fonts.addEventListener('loadingdone', roomLater);
        new MutationObserver(roomLater).observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    }

    // ---- the page's backdrop -------------------------------------------
    // A browser paints its own white behind every page, so a page that sets
    // no background shows white. A webview has nothing behind the page but
    // VS Code's editor, which is near black in a dark theme, and the reset
    // above leaves html and body transparent: the page's black text was drawn
    // on near black. So when neither <html> nor <body> has a background of its
    // own, the root is painted white, as a browser would. A page that sets one
    // keeps it, and a body colour still fills the whole view, because it only
    // spreads to the whole view while <html> has no background.
    const BACKDROP = 'data-draw2code-backdrop';
    const bare = (el) => {
        if (!el) return true;
        const cs = getComputedStyle(el);
        return cs.backgroundColor === 'rgba(0, 0, 0, 0)' && cs.backgroundImage === 'none';
    };
    function backdrop() {
        const html = document.documentElement;
        html.removeAttribute(BACKDROP); // measure the page's own colours, not ours
        if (bare(html) && bare(document.body)) html.setAttribute(BACKDROP, '');
    }
    backdrop();
    // Measured again whenever the page's colours could change: a stylesheet
    // finishing loading, unsaved edits redrawn in <head>, or a style or class
    // changed on <html> or <body>. Our own attribute is not watched, so
    // setting it does not start this again.
    window.addEventListener('load', backdrop);
    document.addEventListener('load', backdrop, true);
    const watch = new MutationObserver(backdrop);
    watch.observe(document.head, { childList: true, subtree: true, characterData: true, attributes: true });
    for (const el of [document.documentElement, document.body]) {
        if (el) watch.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
    }

    // ---- arriving at a section -------------------------------------------
    // A link to a section of another page kept where to go before that page
    // was shown: once it is laid out (after the room is measured), it is
    // scrolled there. Used once, whatever page comes next.
    const jump = saved.jump;
    if (jump) keepState({ jump: null });
    if (jump && jump.page === PAGE_NAME) {
        const arrive = () => requestAnimationFrame(() => scrollToSection(jump.id, true));
        if (document.readyState === 'complete') arrive();
        else window.addEventListener('load', arrive, { once: true });
    }

    // ---- arriving where it was --------------------------------------------
    // Drawn again, the page is put back where it was at once: VS Code
    // scrolls it as far down as it was, and this as far across, which VS
    // Code does not keep. A page switched to starts at its top instead, or at
    // the section a link goes to. Then its own scroll-behavior is back
    // (src/arrival.ts). How far across it is, is kept as it scrolls, with the
    // page it is for; not before it is put back, as VS Code's scroll puts it
    // at its left first.
    const arriveAfterLoad = ${arriveAfterLoad.toString()};
    const arrivalScroll = ${arrivalScroll.toString()};
    const keptScroll = { scrollPage: saved.scrollPage, scrollX: saved.scrollX };
    keepState({ scrollPage: PAGE_NAME, scrollX: keptScroll.scrollPage === PAGE_NAME ? keptScroll.scrollX : 0 });
    let scrollPutBack = false;
    arriveAfterLoad(window, document.documentElement, ${JSON.stringify(ARRIVED_ATTR)}, () => {
        const jumping = Boolean(jump && jump.page === PAGE_NAME && sectionNamed(jump.id));
        const to = arrivalScroll(keptScroll, PAGE_NAME, { x: window.scrollX, y: window.scrollY }, jumping);
        if (to) window.scrollTo({ ...to, behavior: 'instant' });
        scrollPutBack = true;
    });
    window.addEventListener('scroll', () => {
        if (scrollPutBack && window.scrollX !== saved.scrollX) keepState({ scrollX: window.scrollX });
    }, { passive: true });

    setEditing(ALWAYS_EDITING || Boolean(saved.editing));

    // ---- what was just pasted --------------------------------------------
    // A paste or a duplicate draws the page again: the copies are selected,
    // so they can be moved away at once. Outlined again once the page's
    // stylesheets and pictures are in, which can move them.
    const PASTED = ${JSON.stringify(options.select ?? [])}.map((id) => document.getElementById(id)).filter((el) => el && !isOurs(el));
    if (editing && PASTED.length) {
        select(PASTED[PASTED.length - 1], PASTED.slice(0, -1));
        window.addEventListener('load', paint);
    }
})();
</script>`;
}
