// Draw2Code Web Editor - the data model.
//
// The canvas is only pixels. THIS is the drawing: a plain array of element
// objects. Rendering, selection, saving and every code generator read the same
// array, so the picture and the generated code can never disagree.
//
// Design decisions:
//   - Every element has a box: x, y, w, h (w and h are never negative).
//   - A line runs corner-to-corner inside its box. `flip: false` means
//     top-left -> bottom-right; `flip: true` means bottom-left -> top-right.
//   - A pen stroke stores points as fractions (0..1) of its box, so resizing
//     the box scales the stroke for free.
//   - Style: fill ('none' allowed), stroke, strokeWidth.
//   - Positions snap to a 20px grid unless snapping is turned off.
//   - Widgets (button, input, label) add text, fontSize, textColor, and are
//     drawn with the same fill/stroke as shapes. An input's text is its
//     placeholder.
//   - Text (paragraph, heading) is a widget too, but only the page editor
//     makes it: text that wraps in its box and keeps its line breaks.
//   - An image is a box with a picture file (src, relative to its page) and
//     alt text (what it shows, for people who cannot see it). Only the page
//     editor makes one: it copies the file into the site first.
//   - A video is a box with either its own file (src, poster, both relative
//     to its page) or a hosted player's address (embed), and a title. Only
//     the page editor makes one. A non-empty embed makes it a hosted video;
//     otherwise it is a file video. A file video may carry an .mp4 beside
//     a .webm (srcMp4): then src is the .webm. With one file, src is that
//     file, whichever kind it is, and srcMp4 is empty.
//   - Any element can be full width (fullWidth: true): on the generated
//     page it stretches across the whole window, keeping its y and height,
//     while everything else stays in the page's centred column. Its x and w
//     are kept, and are what it goes back to.
//   - A DESIGN is { version, page: { color }, elements }. The page color is
//     the generated page's background, and the canvas draws it too, so the
//     canvas looks like the output (default white).
//   - A design may say how wide its pages are (pageWidth, in px): the
//     generated page is a column that wide, centred in the window. The same
//     for every page of a site; 1440 when it says nothing.
//
// Everything here is PURE: functions take elements and return new ones, never
// touching the canvas or the DOM. That is what makes this file unit-testable
// (test/model.test.js) and reusable by the code generators later.
//
// CS50 citation: the name Draw2Code Web Editor was chosen with help from
// Claude (Anthropic AI), and at my direction Claude renamed
// the project from its earlier name, HardHat Designer, throughout this file.

// @ts-check
(function (root) {
    'use strict';

    const GRID = 20;
    const SHAPE_TYPES = ['rect', 'ellipse', 'line', 'pen'];
    const WIDGET_TYPES = ['button', 'input', 'label', 'paragraph', 'heading'];
    const TYPES = [...SHAPE_TYPES, ...WIDGET_TYPES, 'image', 'video'];
    const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

    /** Style for new SHAPES (the toolbar edits this). */
    const DEFAULT_STYLE = Object.freeze({
        fill: '#3b82f6',
        stroke: '#f59e0b',
        strokeWidth: 2,
    });

    /** Style + text for new WIDGETS, per type. */
    const WIDGET_DEFAULTS = Object.freeze({
        button: Object.freeze({ fill: '#3b82f6', stroke: '#1d4ed8', strokeWidth: 1,
                                text: 'Button', fontSize: 14, textColor: '#ffffff' }),
        input:  Object.freeze({ fill: '#ffffff', stroke: '#94a3b8', strokeWidth: 1,
                                text: 'Type here...', fontSize: 14, textColor: '#64748b' }),
        label:  Object.freeze({ fill: 'none', stroke: '#000000', strokeWidth: 0,
                                text: 'Label', fontSize: 14, textColor: '#1e293b' }),
        paragraph: Object.freeze({ fill: 'none', stroke: '#000000', strokeWidth: 0,
                                   text: 'Text', fontSize: 16, textColor: '#1e293b' }),
        heading: Object.freeze({ fill: 'none', stroke: '#000000', strokeWidth: 0,
                                 text: 'Heading', fontSize: 32, textColor: '#0f172a' }),
    });

    /**
     * Style for a new VIDEO: a black box with no border, as a player looks
     * before it plays. Not the next shape's style, which would give it a
     * blue background.
     */
    const VIDEO_STYLE = Object.freeze({
        fill: '#000000',
        stroke: '#000000',
        strokeWidth: 0,
    });

    /** Size used when a widget is placed with a click instead of a drag. */
    const DEFAULT_SIZES = Object.freeze({
        button: Object.freeze({ w: 120, h: 40 }),
        input:  Object.freeze({ w: 200, h: 40 }),
        label:  Object.freeze({ w: 80, h: 20 }),
        // The least they take: more text makes them taller.
        paragraph: Object.freeze({ w: 320, h: 40 }),
        heading: Object.freeze({ w: 320, h: 40 }),
        image: Object.freeze({ w: 200, h: 150 }),
        // 16:9, the shape most videos are.
        video: Object.freeze({ w: 480, h: 270 }),
    });

    /** Page settings for a new design. */
    const DEFAULT_PAGE = Object.freeze({ color: '#ffffff' });
    const DESIGN_VERSION = 2;
    const ENTRY_PAGE = 'index.html';

    /**
     * How wide a generated page is, in px, when the design does not say: a
     * common laptop and desktop width. The least and most it may be: a
     * phone's width, and a 4K screen's.
     */
    const PAGE_WIDTH = 1440;
    const PAGE_WIDTH_MIN = 320;
    const PAGE_WIDTH_MAX = 3840;

    /**
     * A page's phone layout: laid out for a window PHONE_WIDTH px wide, and
     * shown in any window up to PHONE_BREAKPOINT px wide. Only a page whose
     * <html> carries PHONE_LAYOUT_CLASS has one; any other page keeps its
     * desktop layout in every window, and a phone shrinks it to fit (the
     * viewport meta the generator writes).
     */
    const PHONE_WIDTH = 390;
    const PHONE_BREAKPOINT = 767;
    const PHONE_LAYOUT_CLASS = 'has-phone-layout';
    /** The least font size a phone layout's first draft gives text, in px: smaller is not read on a phone. */
    const PHONE_FONT_MIN = 14;

    const FONT_MIN = 6;
    const FONT_MAX = 96;
    const STROKE_MAX = 20;

    // ---- small helpers ----------------------------------------------------

    /** Round to the grid when snapping is on. */
    function snap(value, on) {
        return on ? Math.round(value / GRID) * GRID : Math.round(value);
    }

    function isWidget(type) {
        return WIDGET_TYPES.includes(type);
    }

    /** Click-to-place size for widgets, images and videos; null for shapes (a click draws nothing). */
    function defaultSize(type) {
        return DEFAULT_SIZES[type] || null;
    }

    function clampInt(value, lo, hi) {
        return Math.max(lo, Math.min(hi, Math.round(Number(value) || 0)));
    }

    /** A page width as the generator uses it: a whole number of px within the limits; anything else is the default. */
    function pageWidthOf(value) {
        const n = Number(value);
        if (value === undefined || value === null || value === '' || !Number.isFinite(n)) return PAGE_WIDTH;
        return clampInt(n, PAGE_WIDTH_MIN, PAGE_WIDTH_MAX);
    }

    // ---- pages ------------------------------------------------------------
    // A design is a SITE: one tab per page, the way the browser bar shows it.
    // A page is { name, title, color, elements, open }. `open` is whether it
    // has a tab: closing a page hides its tab, it never throws the page away.

    /** "about.html" -> "About"; the entry page is "Home". */
    function pageTitleFrom(name) {
        const base = String(name || '').replace(/\.html?$/i, '');
        if (!base || base.toLowerCase() === 'index') return 'Home';
        const word = base.split('/').pop().replace(/[-_]+/g, ' ');
        return word.charAt(0).toUpperCase() + word.slice(1);
    }

    /** What the user typed, as a page name: "about" -> "about.html". */
    function normalizePageName(name) {
        const clean = String(name || '').trim().replace(/^[.\/]+/, '');
        if (!clean) return '';
        return /\.html?$/i.test(clean) ? clean : clean + '.html';
    }

    function makePage(name, title) {
        const file = normalizePageName(name) || ENTRY_PAGE;
        return { name: file, title: title || pageTitleFrom(file), color: DEFAULT_PAGE.color, elements: [], open: true };
    }

    /** By name, however the user typed it (with or without .html). */
    function findPage(pages, name) {
        const want = normalizePageName(name).toLowerCase();
        if (!want) return null;
        return pages.find((p) => p.name.toLowerCase() === want)
            || pages.find((p) => p.name.toLowerCase().split('/').pop() === want) || null;
    }

    /** The pages with a tab, in order. */
    function openPages(pages) {
        return pages.filter((p) => p.open);
    }

    /** "page2.html", "page3.html", ... - the first one not in use. */
    function nextPageName(pages) {
        for (let n = 2; ; n++) {
            const name = `page${n}.html`;
            if (!findPage(pages, name)) return name;
        }
    }

    /** The home page: the entry page if there is one, else the first page. */
    function homePage(pages) {
        return findPage(pages, ENTRY_PAGE) || pages[0] || null;
    }

    /**
     * Add a page (named, or the next free "pageN"). Existing name: no change.
     * It takes the HOME page's title: pages of one site
     * usually share its name, and a double-click on the tab renames it.
     */
    function addPage(pages, name) {
        const file = normalizePageName(name) || nextPageName(pages);
        if (findPage(pages, file)) return pages;
        const home = homePage(pages);
        return [...pages, makePage(file, home ? home.title : undefined)];
    }

    /** Give a page a new title (the tab's text). Blank titles are refused. */
    function retitlePage(pages, name, title) {
        const page = findPage(pages, name);
        const clean = String(title || '').trim();
        if (!page || !clean || clean === page.title) return pages;
        return pages.map((p) => (p === page ? { ...p, title: clean } : p));
    }

    /**
     * Close a page: its tab goes, the page stays in the design and comes back
     * by name. The last open page cannot be closed - there would be nothing
     * to draw on.
     */
    function closePage(pages, name) {
        const page = findPage(pages, name);
        if (!page || !page.open || openPages(pages).length < 2) return pages;
        return pages.map((p) => (p === page ? { ...p, open: false } : p));
    }

    /** Give a page a tab again (typing its name in the address bar). */
    function reopenPage(pages, name) {
        const page = findPage(pages, name);
        if (!page || page.open) return pages;
        return pages.map((p) => (p === page ? { ...p, open: true } : p));
    }

    /** Rename a page. A name another page already has is refused. */
    function renamePage(pages, from, to) {
        const page = findPage(pages, from);
        const file = normalizePageName(to);
        if (!page || !file) return pages;
        const taken = findPage(pages, file);
        if (taken && taken !== page) return pages;
        const renamed = { ...page, name: file };
        // A title the user has not touched follows the name.
        if (page.title === pageTitleFrom(page.name)) renamed.title = pageTitleFrom(file);
        return pages.map((p) => (p === page ? renamed : p));
    }

    /** The whole design as plain data: what gets sent, generated and saved. */
    function makeDesign(pages, active) {
        const copies = pages.map((p) => ({ ...p, elements: p.elements.map((e) => ({ ...e })) }));
        return { version: DESIGN_VERSION, active: active || (copies[0] && copies[0].name) || ENTRY_PAGE, pages: copies };
    }

    /**
     * The page a design is showing. Designs made before pages existed had one
     * page's worth of data at the top level; they still read correctly.
     */
    function activePage(design) {
        if (design && design.pages && design.pages.length) {
            return findPage(design.pages, design.active) || design.pages[0];
        }
        // No title: a design from before pages never named one, so whoever
        // generates it keeps saying what the title should be.
        const page = (design && design.page) || DEFAULT_PAGE;
        return { name: ENTRY_PAGE, title: '', color: page.color, elements: (design && design.elements) || [], open: true };
    }

    /** One higher than the largest id in use. Ids are never reused. */
    function nextId(elements) {
        let max = 0;
        for (const el of elements) max = Math.max(max, el.id);
        return max + 1;
    }

    // ---- creating ---------------------------------------------------------

    /**
     * A new element. `box` may have negative w/h (dragging up or left); it is
     * normalized before being returned.
     */
    function createElement(id, type, box, style) {
        if (!TYPES.includes(type)) throw new Error('unknown element type: ' + type);
        const el = {
            id,
            type,
            x: box.x,
            y: box.y,
            w: box.w,
            h: box.h,
            fill: style.fill,
            stroke: style.stroke,
            strokeWidth: style.strokeWidth,
        };
        if (type === 'line') el.flip = false;
        if (type === 'pen') el.points = [];
        if (type === 'image') {
            el.src = '';
            el.alt = '';
        }
        if (type === 'video') {
            el.src = '';
            el.srcMp4 = '';
            el.poster = '';
            el.embed = '';
            el.title = '';
        }
        if (isWidget(type)) {
            const d = WIDGET_DEFAULTS[type];
            el.text = style.text !== undefined ? style.text : d.text;
            el.fontSize = style.fontSize !== undefined ? style.fontSize : d.fontSize;
            el.textColor = style.textColor !== undefined ? style.textColor : d.textColor;
        }
        return normalize(el);
    }

    /**
     * A pen stroke from raw canvas points. The box is the bounding box of the
     * points; each point is stored as a fraction (0..1) of that box.
     */
    function createPen(id, points, style) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [px, py] of points) {
            minX = Math.min(minX, px); maxX = Math.max(maxX, px);
            minY = Math.min(minY, py); maxY = Math.max(maxY, py);
        }
        if (!points.length) { minX = minY = maxX = maxY = 0; }
        const x = Math.round(minX);
        const y = Math.round(minY);
        const w = Math.round(maxX) - x;
        const h = Math.round(maxY) - y;
        const frac = (v, start, size) =>
            size ? Math.round(Math.max(0, Math.min(1, (v - start) / size)) * 10000) / 10000 : 0;
        return {
            id, type: 'pen', x, y, w, h,
            fill: 'none', stroke: style.stroke, strokeWidth: style.strokeWidth,
            points: points.map(([px, py]) => [frac(px, x, w), frac(py, y, h)]),
        };
    }

    /** A pen stroke's points in canvas coordinates. */
    function penPoints(el) {
        return el.points.map(([px, py]) => [el.x + px * el.w, el.y + py * el.h]);
    }

    /**
     * Make w and h non-negative, keeping the element looking identical.
     *
     * Flipping the box horizontally XOR vertically swaps which diagonal a line
     * follows; flipping both leaves it on the same diagonal. Pen points are
     * mirrored inside the box.
     */
    function normalize(el) {
        const out = { ...el };
        let flipX = false;
        let flipY = false;
        if (out.w < 0) { out.x += out.w; out.w = -out.w; flipX = true; }
        if (out.h < 0) { out.y += out.h; out.h = -out.h; flipY = true; }
        if (out.type === 'line' && flipX !== flipY) out.flip = !out.flip;
        if (out.type === 'pen' && (flipX || flipY)) {
            out.points = out.points.map(([px, py]) => [flipX ? 1 - px : px, flipY ? 1 - py : py]);
        }
        return out;
    }

    /** A line's two endpoints in canvas coordinates: [x1, y1, x2, y2]. */
    function lineEndpoints(el) {
        return el.flip
            ? [el.x, el.y + el.h, el.x + el.w, el.y]
            : [el.x, el.y, el.x + el.w, el.y + el.h];
    }

    // ---- editing ----------------------------------------------------------

    /** Move so the element's top-left lands on (x, y). */
    function moveTo(el, x, y) {
        return { ...el, x, y };
    }

    /**
     * Set one property from the properties popup (values arrive as strings),
     * keeping every rule of the model: whole numbers, w/h never negative,
     * sizes clamped, text fields only on widgets, flip only on lines, a
     * picture's file and alt text only on images, a video's .mp4 beside its
     * file, poster, hosted address and title only on videos. Any element
     * can be full width.
     */
    function setProp(el, prop, value) {
        switch (prop) {
            case 'x':
            case 'y':
                return { ...el, [prop]: Math.round(Number(value) || 0) };
            case 'w':
            case 'h':
                return { ...el, [prop]: clampInt(value, 0, 10000) };
            case 'strokeWidth':
                return { ...el, strokeWidth: clampInt(value, 0, STROKE_MAX) };
            case 'fill':
            case 'stroke':
                return { ...el, [prop]: String(value) };
            case 'text':
                return isWidget(el.type) ? { ...el, text: String(value) } : el;
            case 'fontSize':
                return isWidget(el.type) ? { ...el, fontSize: clampInt(value, FONT_MIN, FONT_MAX) } : el;
            case 'textColor':
                return isWidget(el.type) ? { ...el, textColor: String(value) } : el;
            case 'flip':
                return el.type === 'line' ? { ...el, flip: Boolean(value) } : el;
            case 'fullWidth':
                return { ...el, fullWidth: value === true || value === 'true' };
            case 'src':
                return el.type === 'image' || el.type === 'video' ? { ...el, src: String(value) } : el;
            case 'alt':
                return el.type === 'image' ? { ...el, alt: String(value) } : el;
            case 'srcMp4':
            case 'poster':
            case 'embed':
            case 'title':
                return el.type === 'video' ? { ...el, [prop]: String(value) } : el;
            default:
                throw new Error('unknown property: ' + prop);
        }
    }

    /** Where the 8 resize handles sit. */
    function handlePositions(el) {
        const cx = el.x + el.w / 2;
        const cy = el.y + el.h / 2;
        const r = el.x + el.w;
        const b = el.y + el.h;
        return [
            { name: 'nw', x: el.x, y: el.y }, { name: 'n', x: cx, y: el.y },
            { name: 'ne', x: r, y: el.y },    { name: 'e', x: r, y: cy },
            { name: 'se', x: r, y: b },       { name: 's', x: cx, y: b },
            { name: 'sw', x: el.x, y: b },    { name: 'w', x: el.x, y: cy },
        ];
    }

    /** Which handle (if any) is within `size` px of the point. */
    function handleAt(el, px, py, size) {
        for (const h of handlePositions(el)) {
            if (Math.abs(px - h.x) <= size && Math.abs(py - h.y) <= size) return h.name;
        }
        return null;
    }

    /**
     * Resize from the ORIGINAL element (as it was when the drag started) by
     * dragging `handle` to (px, py). Dragging past the opposite edge flips the
     * element, exactly like every drawing tool.
     */
    function resize(orig, handle, px, py) {
        let left = orig.x;
        let top = orig.y;
        let right = orig.x + orig.w;
        let bottom = orig.y + orig.h;
        if (handle.includes('w')) left = px;
        if (handle.includes('e')) right = px;
        if (handle.includes('n')) top = py;
        if (handle.includes('s')) bottom = py;
        return normalize({ ...orig, x: left, y: top, w: right - left, h: bottom - top });
    }

    // ---- hit testing ------------------------------------------------------

    function distanceToSegment(px, py, x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const lenSq = dx * dx + dy * dy;
        let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
    }

    /**
     * Does a click at (px, py) land on this element? `tolerance` makes thin
     * things clickable. The box model decides WHERE an element is; this
     * decides what counts as touching it, so a diagonal line is only hit near
     * the line itself, not anywhere in its box.
     */
    function hitTest(el, px, py, tolerance) {
        const tol = tolerance + el.strokeWidth / 2;
        switch (el.type) {
            case 'line': {
                const [x1, y1, x2, y2] = lineEndpoints(el);
                return distanceToSegment(px, py, x1, y1, x2, y2) <= tol;
            }
            case 'pen': {
                const pts = penPoints(el);
                if (pts.length === 1) return Math.hypot(px - pts[0][0], py - pts[0][1]) <= tol;
                for (let i = 1; i < pts.length; i++) {
                    const [x1, y1] = pts[i - 1];
                    const [x2, y2] = pts[i];
                    if (distanceToSegment(px, py, x1, y1, x2, y2) <= tol) return true;
                }
                return false;
            }
            case 'ellipse': {
                const rx = el.w / 2 + tol;
                const ry = el.h / 2 + tol;
                const nx = (px - (el.x + el.w / 2)) / rx;
                const ny = (py - (el.y + el.h / 2)) / ry;
                return nx * nx + ny * ny <= 1;
            }
            default: // rect and widgets
                return px >= el.x - tol && px <= el.x + el.w + tol &&
                       py >= el.y - tol && py <= el.y + el.h + tol;
        }
    }

    /** The topmost element under the point. Later in the array = on top. */
    function topHit(elements, px, py, tolerance) {
        for (let i = elements.length - 1; i >= 0; i--) {
            if (hitTest(elements[i], px, py, tolerance)) return elements[i];
        }
        return null;
    }

    const api = {
        GRID, SHAPE_TYPES, WIDGET_TYPES, TYPES, HANDLES,
        DEFAULT_STYLE, WIDGET_DEFAULTS, VIDEO_STYLE, DEFAULT_SIZES, DEFAULT_PAGE, DESIGN_VERSION,
        FONT_MIN, FONT_MAX, STROKE_MAX, PAGE_WIDTH, PAGE_WIDTH_MIN, PAGE_WIDTH_MAX, pageWidthOf,
        PHONE_WIDTH, PHONE_BREAKPOINT, PHONE_LAYOUT_CLASS, PHONE_FONT_MIN,
        isWidget, defaultSize, makeDesign, snap, nextId,
        ENTRY_PAGE, makePage, pageTitleFrom, normalizePageName, findPage, openPages,
        nextPageName, addPage, closePage, reopenPage, renamePage, activePage, homePage, retitlePage,
        createElement, createPen, penPoints, normalize, lineEndpoints,
        setProp, moveTo, handlePositions, handleAt, resize,
        distanceToSegment, hitTest, topHit,
    };

    // Works in the webview (as window.D2CModel) and in Node tests (require).
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.D2CModel = api;
})(typeof self !== 'undefined' ? self : this);
