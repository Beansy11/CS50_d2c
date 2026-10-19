// Draw2Code Web Editor - HTML generator: design -> one self-contained .html file.
//
// Design decisions:
//   - Absolute positioning: every element keeps its canvas x, y, w, h, so the
//     page matches the drawing 1:1.
//   - One <style> block with one rule per element id. (A separate .html +
//     .css package is planned for polish.)
//   - The page background is the design's page color.
//
// How each type becomes HTML:
//   rect, ellipse, line, pen  -> an inline <svg> sized to the element's box
//   button                     -> <button>
//   input                      -> <input type="text" placeholder="...">
//   label                      -> <label>
//   paragraph, heading         -> <p>, <h1>: text that wraps and keeps its
//                                 line breaks, and grows its box
//   image                      -> <img src alt>, the picture fitted in its box
//   video                      -> a <div> holding a <video> (a <source> for
//                                 each of its files) and the site's own
//                                 player controls, or a YouTube/Vimeo <iframe>
//
// The page is a column the design's page width wide (1440px unless it says
// otherwise), centred in the window: a wider window shows the page's
// background either side, a narrower one starts at the left and scrolls
// sideways. Elements are placed from the column's top-left. A full-width
// element (a section's background) stretches across the whole window
// instead, keeping its y and height; anything else past the column's sides
// is cut off at the window's edge rather than making the page scroll
// sideways.
//
// Document order = drawing order, so later elements still sit on top.
// Nothing from the design is trusted: text is HTML-escaped and colors and
// numbers are validated, because any string could have been typed into the
// properties popup.
//
// Pure: design in, string out. Runs in Node (the extension, tests).
//
// CS50 citation: the name Draw2Code Web Editor was chosen with help from
// Claude (Anthropic AI), and at my direction Claude renamed
// the project from its earlier name, HardHat Designer, throughout this file.

// @ts-check
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('../model.js'));
    else root.D2CHtml = factory(root.D2CModel);
})(typeof self !== 'undefined' ? self : this, function (M) {
    'use strict';

    const FONT_FAMILY = 'system-ui, sans-serif';
    const INPUT_PADDING = 8;
    const BUTTON_RADIUS = 4;
    const FALLBACK_COLOR = '#000000';

    // ---- safety -----------------------------------------------------------

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /** Only #rgb / #rrggbb / #rrggbbaa get through; anything else is replaced. */
    function color(value, fallback = FALLBACK_COLOR) {
        return /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(String(value)) ? String(value) : fallback;
    }

    /**
     * A picture's or video's address inside the site, or '' when it is not
     * one: anything with a colon (a scheme such as "javascript:" or "data:",
     * or a drive), a leading slash ("/etc/x.png", "//other.site") or a
     * backslash.
     */
    function imageSrc(value) {
        const text = String(value || '').trim();
        return /[:\\\u0000-\u001F\u007F]/.test(text) || text.startsWith('/') ? '' : text;
    }

    /**
     * A hosted player's address, or '' when it is not one of the two that
     * src/videos.ts embedOf writes: YouTube's privacy-enhanced player, with
     * a start time or not, and Vimeo's, with an unlisted video's hash or not.
     * Whatever else the design says goes nowhere.
     */
    function embedSrc(value) {
        const text = String(value || '');
        const youtube = /^https:\/\/www\.youtube-nocookie\.com\/embed\/[A-Za-z0-9_-]{11}(\?start=\d+)?$/;
        const vimeo = /^https:\/\/player\.vimeo\.com\/video\/\d+\?(h=[0-9a-f]+&)?dnt=1$/;
        return youtube.test(text) || vimeo.test(text) ? text : '';
    }

    /** A finite number, rounded to 2 decimals; anything else is 0. */
    function num(value) {
        const n = Number(value);
        return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
    }

    // ---- the page ---------------------------------------------------------

    /** The class a full-width element has; src/pageEdit.ts FULL_WIDTH_CLASS is the same (a test holds them together). */
    const FULL_WIDTH = 'full-width';

    /**
     * The rules every generated page starts with. `background` is the page
     * colour, for a stylesheet of one page; a site's pages each set theirs.
     *
     * How a full-width element fills the window without a sideways
     * scrollbar: it starts half the window's width left of the column's
     * middle and is the window's width (100vw), and never narrower than the
     * page, so in a narrow window it spans the page as it scrolls. 100vw
     * counts the scrollbar too, so it reaches half a scrollbar past each
     * side of the window; <body> cuts off whatever is past its sides
     * (overflow-x: clip), and is at least as wide as the column, so a
     * narrow window still scrolls to the whole page. <html> scrolls on its
     * own (overflow-x: auto), or the clip would go to the window and stop
     * all sideways scrolling. Nothing is contained, so the page colour on
     * <body> still fills the whole window, as on any page. A drawn shape
     * that is full width is stretched to fit its box, its border keeping
     * its width.
     *
     * A link to a section of the page ("#prices") scrolls there smoothly,
     * unless the reader's system asks for less motion.
     *
     * A page with a phone layout (its <html> has M.PHONE_LAYOUT_CLASS) is,
     * in a window up to M.PHONE_BREAKPOINT px wide, as wide as the window:
     * the column is the window, and nothing makes <body> wider. Any other
     * page keeps its column in every window, so a narrow desktop window
     * still scrolls sideways to all of it. Its drawings are stretched to
     * their phone boxes (src/pageEdit.ts stretchDrawings), their borders
     * keeping their width.
     */
    function baseCss(pageWidth, background) {
        return [
            'html {\n  overflow-x: auto;\n  scroll-behavior: smooth;\n}',
            '@media (prefers-reduced-motion: reduce) {\n  html {\n    scroll-behavior: auto;\n  }\n}',
            `body {\n  margin: 0;\n  padding: 0;\n${background ? `  background: ${background};\n` : ''}  font-family: ${FONT_FAMILY};\n  min-width: max-content;\n  overflow-x: clip;\n}`,
            `.page {\n  position: relative;\n  width: ${M.pageWidthOf(pageWidth)}px;\n  margin: 0 auto;\n  min-height: 100vh;\n}`,
            '.page > * {\n  position: absolute;\n  box-sizing: border-box;\n  margin: 0;\n  padding: 0;\n  font-family: inherit;\n  white-space: nowrap;\n  overflow: hidden;\n}',
            '.page > svg {\n  overflow: visible;\n}',
            '.page > button {\n  cursor: pointer;\n}',
            // Important, so it wins over the element's own left and width,
            // which are kept for when it is no longer full width.
            `.page > .${FULL_WIDTH} {\n  left: min(0px, 50% - 50vw) !important;\n  width: max(100%, 100vw) !important;\n}`,
            `.page > svg.${FULL_WIDTH} > * {\n  vector-effect: non-scaling-stroke;\n}`,
            `@media (max-width: ${M.PHONE_BREAKPOINT}px) {\n  html.${M.PHONE_LAYOUT_CLASS} body {\n    min-width: 0;\n  }\n  html.${M.PHONE_LAYOUT_CLASS} .page {\n    width: 100%;\n  }\n  html.${M.PHONE_LAYOUT_CLASS} .page > svg > * {\n    vector-effect: non-scaling-stroke;\n  }\n}`,
        ];
    }

    // ---- shapes -> svg ----------------------------------------------------

    function fillAttr(el) {
        return el.fill === 'none' ? 'none' : color(el.fill);
    }

    function strokeAttrs(el) {
        const width = num(el.strokeWidth);
        return width > 0 ? `stroke="${color(el.stroke)}" stroke-width="${width}"` : 'stroke="none"';
    }

    function svgBody(el) {
        const w = num(el.w);
        const h = num(el.h);
        switch (el.type) {
            case 'rect':
                return `<rect x="0" y="0" width="${w}" height="${h}" fill="${fillAttr(el)}" ${strokeAttrs(el)}/>`;
            case 'ellipse':
                return `<ellipse cx="${num(w / 2)}" cy="${num(h / 2)}" rx="${num(w / 2)}" ry="${num(h / 2)}" fill="${fillAttr(el)}" ${strokeAttrs(el)}/>`;
            case 'line': {
                const [x1, y1, x2, y2] = M.lineEndpoints(el);
                return `<line x1="${num(x1 - el.x)}" y1="${num(y1 - el.y)}" x2="${num(x2 - el.x)}" y2="${num(y2 - el.y)}" ${strokeAttrs(el)} stroke-linecap="round"/>`;
            }
            case 'pen': {
                const points = M.penPoints(el).map(([px, py]) => `${num(px - el.x)},${num(py - el.y)}`).join(' ');
                return `<polyline points="${points}" fill="none" ${strokeAttrs(el)} stroke-linecap="round" stroke-linejoin="round"/>`;
            }
            default:
                return '';
        }
    }

    // ---- per element ------------------------------------------------------

    function elementId(el) {
        return `${el.type}-${num(el.id)}`;
    }

    function boxCss(el) {
        return [`left: ${num(el.x)}px;`, `top: ${num(el.y)}px;`, `width: ${num(el.w)}px;`, `height: ${num(el.h)}px;`];
    }

    /** A text's box: the drawn height is the least it takes, so more text grows it instead of being cut off. */
    function textBoxCss(el) {
        return [`left: ${num(el.x)}px;`, `top: ${num(el.y)}px;`, `width: ${num(el.w)}px;`, `min-height: ${num(el.h)}px;`];
    }

    /** The background and border of a box: a widget's, or a video's. */
    function fillCss(el) {
        const width = num(el.strokeWidth);
        return [
            `background: ${el.fill === 'none' ? 'transparent' : color(el.fill)};`,
            `border: ${width > 0 ? `${width}px solid ${color(el.stroke)}` : 'none'};`,
        ];
    }

    function widgetCss(el) {
        return [...fillCss(el), `color: ${color(el.textColor)};`, `font-size: ${num(el.fontSize)}px;`];
    }

    // ---- videos -----------------------------------------------------------
    // A video file plays in the site's own player: the browser's <video>
    // with controls drawn over it, which look the same in every browser.
    // Every part of the player is written here, so its script
    // (media/site/video-player.js) only ever changes attributes and text,
    // never which elements there are: the page editor finds an element by
    // its place among its neighbours, and that must not change under it.
    // The browser's own controls are written too, for a page whose script
    // does not load; the script takes them away.

    /** The player's symbols, as the inside of a 16x16 <svg>. */
    const VIDEO_ICONS = {
        play: '<path d="M5 3.2v9.6L12.8 8z" fill="currentColor"/>',
        pause: '<path d="M4.5 3h2.5v10H4.5zM9 3h2.5v10H9z" fill="currentColor"/>',
        sound: '<path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor"/><path d="M10.5 5.8a3 3 0 0 1 0 4.4M12.4 3.9a5.7 5.7 0 0 1 0 8.2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
        muted: '<path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor"/><path d="M10.5 6l4 4M14.5 6l-4 4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>',
        enter: '<path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
        exit: '<path d="M6 2v4H2M10 2v4h4M14 10h-4v4M2 10h4v4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    };

    /** One symbol: hidden from screen readers, since its button has the name. */
    function videoIcon(name, size = 16) {
        const cls = name === 'big' ? '' : ` class="video-icon-${name}"`;
        const inner = VIDEO_ICONS[name === 'big' ? 'play' : name];
        return `<svg${cls} width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true" focusable="false">${inner}</svg>`;
    }

    /** A video file's type, by its ending, so a browser passes over one it cannot play without fetching it. */
    const VIDEO_TYPES = { webm: 'video/webm', mp4: 'video/mp4' };

    /**
     * A video's files as its <source>s: each one checked as a picture's
     * address is (one that is refused is left out, and so is the same file
     * twice), and the .webm first. A browser plays the first one it can, so
     * one that plays WebM uses it, and VS Code's editor, which cannot, goes
     * on to the .mp4, as does any browser that cannot.
     */
    function videoSources(el) {
        const files = [el.src, el.srcMp4].map(imageSrc).filter((file, i, all) => file && all.indexOf(file) === i);
        const ending = (file) => (/\.([a-z0-9]+)$/i.exec(file.split(/[?#]/)[0]) || ['', ''])[1].toLowerCase();
        const webm = files.filter((file) => ending(file) === 'webm');
        return [...webm, ...files.filter((file) => !webm.includes(file))]
            .map((file) => ({ file, type: VIDEO_TYPES[ending(file)] || '' }));
    }

    /** What the video is, as screen readers say it; a video given no name is "Video". */
    function videoTitle(el) {
        return String(el.title || '').trim() || 'Video';
    }

    /** A video file and the site's player around it. */
    function playerMarkup(id, el) {
        const name = escapeHtml(videoTitle(el));
        const poster = imageSrc(el.poster);
        const button = (cls, label, icons) => `<button class="${cls}" type="button" aria-label="${label}">${icons}</button>`;
        // No src on the <video> itself: with one, a browser never looks at its <source>s.
        const sources = videoSources(el).map((source) => `<source src="${escapeHtml(source.file)}"${source.type ? ` type="${source.type}"` : ''}>`).join('');
        return [
            `<div id="${id}" class="video-player" role="group" aria-label="${name}">`,
            `<video${poster ? ` poster="${escapeHtml(poster)}"` : ''} preload="metadata" playsinline controls>${sources}</video>`,
            button('video-big-play', `Play ${name}`, videoIcon('big', 28)),
            '<div class="video-bar">',
            button('video-play', 'Play', videoIcon('play') + videoIcon('pause')),
            '<input class="video-seek" type="range" min="0" max="1000" step="1" value="0" aria-label="Seek" aria-valuetext="0:00 of 0:00">',
            '<span class="video-time">0:00 / 0:00</span>',
            button('video-mute', 'Mute', videoIcon('sound') + videoIcon('muted')),
            '<input class="video-volume" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume">',
            button('video-full', 'Full screen', videoIcon('enter') + videoIcon('exit')),
            '</div>',
            '<span class="video-message" aria-live="polite"></span>',
            '</div>',
        ].join('');
    }

    /** A hosted video: the provider's own player, in a frame. */
    function embedMarkup(id, el) {
        return `<div id="${id}" class="video-embed"><iframe src="${escapeHtml(embedSrc(el.embed))}" title="${escapeHtml(videoTitle(el))}"`
            + ' allow="autoplay; encrypted-media; fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen loading="lazy"></iframe></div>';
    }

    /** The element's tag, with its id (and its class, when it is full width). */
    function elementMarkup(el) {
        const markup = tagMarkup(el);
        if (el.fullWidth !== true || !M.TYPES.includes(el.type)) return markup;
        // Right after the id, in the element's own tag: a video's is its outer <div>.
        return markup.replace(/^(<[a-z0-9]+ id="[^"]*")( class="([^"]*)")?/, (m, start, cls, names) =>
            `${start} class="${names ? `${names} ` : ''}${FULL_WIDTH}"`);
    }

    function tagMarkup(el) {
        const id = elementId(el);
        if (M.SHAPE_TYPES.includes(el.type)) {
            const w = num(el.w);
            const h = num(el.h);
            // Full width, the drawing is stretched to whatever width its box is.
            const stretch = el.fullWidth === true ? ' preserveAspectRatio="none"' : '';
            return `<svg id="${id}" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"${stretch}>${svgBody(el)}</svg>`;
        }
        const text = escapeHtml(el.text || '');
        switch (el.type) {
            case 'button': return `<button id="${id}" type="button">${text}</button>`;
            case 'input': return `<input id="${id}" type="text" placeholder="${text}">`;
            case 'label': return `<label id="${id}">${text}</label>`;
            case 'paragraph': return `<p id="${id}">${text}</p>`;
            case 'heading': return `<h1 id="${id}">${text}</h1>`;
            case 'image': return `<img id="${id}" src="${escapeHtml(imageSrc(el.src))}" alt="${escapeHtml(el.alt || '')}">`;
            case 'video': return el.embed ? embedMarkup(id, el) : playerMarkup(id, el);
            default: return `<!-- unsupported element type: ${escapeHtml(el.type)} -->`;
        }
    }

    /** The element's rules: [{ selector, lines }], the first one its box. */
    function elementRules(el) {
        const id = elementId(el);
        if (M.SHAPE_TYPES.includes(el.type)) return [{ selector: `#${id}`, lines: boxCss(el) }];
        switch (el.type) {
            case 'button':
                return [{ selector: `#${id}`, lines: [...boxCss(el), ...widgetCss(el), `border-radius: ${BUTTON_RADIUS}px;`] }];
            case 'input':
                return [
                    { selector: `#${id}`, lines: [...boxCss(el), ...widgetCss(el), `padding: 0 ${INPUT_PADDING}px;`] },
                    { selector: `#${id}::placeholder`, lines: [`color: ${color(el.textColor)};`, 'opacity: 1;'] },
                ];
            case 'label':
                return [{ selector: `#${id}`, lines: [...boxCss(el), ...widgetCss(el), 'display: flex;', 'align-items: center;'] }];
            case 'paragraph':
            case 'heading':
                // pre-wrap shows the typed line breaks (the page's base rule
                // keeps every other element on one line), and a long word
                // breaks instead of running out of the box.
                return [{ selector: `#${id}`, lines: [...textBoxCss(el), ...widgetCss(el), 'margin: 0;', 'white-space: pre-wrap;', 'overflow-wrap: break-word;'] }];
            case 'image':
                // contain: the whole picture shows in the box drawn, never stretched.
                return [{ selector: `#${id}`, lines: [...boxCss(el), 'object-fit: contain;'] }];
            case 'video': {
                // The box: what the editor's Fill, Border and Corner rounding
                // change. Its border is inside its size, and the video or the
                // frame is cut to its rounded corners. No position here: placed
                // freely, the editor adds one; inside a generated page, the
                // page's own rule for its children places it.
                const box = { selector: `#${id}`, lines: [...boxCss(el), ...fillCss(el), 'overflow: hidden;', 'box-sizing: border-box;'] };
                if (!el.embed) return [box];
                // A hosted player fills the box, whatever size it is given.
                return [box, { selector: `#${id} > *`, lines: ['position: absolute;', 'left: 0;', 'top: 0;', 'width: 100%;', 'height: 100%;', 'border: 0;', 'display: block;'] }];
            }
            default:
                return [];
        }
    }

    /** "left: 10px;" lines -> { left: "10px" }. */
    function toDeclarations(lines) {
        const out = {};
        for (const line of lines) {
            const match = /^([a-z-]+):\s*(.+?);?$/.exec(line.trim());
            if (match) out[match[1]] = match[2];
        }
        return out;
    }

    /** { html, css } for one element. `css` is a list of rules. */
    function renderElement(el) {
        const rule = (selector, lines) => `${selector} {\n${lines.map((l) => `  ${l}`).join('\n')}\n}`;
        return { html: elementMarkup(el), css: elementRules(el).map((r) => rule(r.selector, r.lines)) };
    }

    /**
     * The same element as PARTS, for adding it to an existing page: its id,
     * its markup, and its rules as declaration objects the page editor can
     * write into that page's own overrides stylesheet.
     */
    function elementParts(el) {
        return {
            id: elementId(el),
            html: elementMarkup(el),
            rules: elementRules(el).map((r) => ({ selector: r.selector, declarations: toDeclarations(r.lines) })),
        };
    }

    // ---- whole page -------------------------------------------------------

    /**
     * The CSS and body markup for one page of a design; shared by both output
     * modes. A design holds every page of the site, so the page being shown
     * is the one that is generated (generating the whole site comes with
     * save/load).
     */
    function buildParts(design) {
        const page = M.activePage(design);
        const pageColor = color(page.color, '#ffffff');
        const parts = page.elements.map(renderElement);
        return {
            css: [...baseCss(design && design.pageWidth, pageColor), ...parts.flatMap((p) => p.css)].join('\n\n') + '\n',
            body: parts.map((p) => `    ${p.html}`).join('\n'),
        };
    }

    /**
     * The viewport a page with no phone layout asks for: a phone lays the
     * page out as wide as its column and shrinks it to fit the screen, with
     * pinch-zoom, as it does any desktop page. Desktop browsers ignore it.
     */
    function viewportMeta(pageWidth) {
        return `<meta name="viewport" content="width=${M.pageWidthOf(pageWidth)}">`;
    }

    function document(title, headExtra, body, bodyClass, pageWidth) {
        return [
            '<!DOCTYPE html>',
            '<html lang="en">',
            '<head>',
            '  <meta charset="UTF-8">',
            `  ${viewportMeta(pageWidth)}`,
            `  <title>${escapeHtml(title)}</title>`,
            '  <!-- Generated by Draw2Code Web Editor -->',
            ...headExtra,
            '</head>',
            bodyClass ? `<body class="${escapeHtml(bodyClass)}">` : '<body>',
            '  <div class="page">',
            body,
            '  </div>',
            '</body>',
            '</html>',
            '',
        ].join('\n');
    }

    /**
     * One self-contained file: the CSS in a <style> block.
     * @param {{page: {color: string}, elements: object[]}} design
     * @param {{title?: string}} [options]
     * @returns {string}
     */
    function generate(design, options) {
        const title = M.activePage(design).title || (options && options.title) || 'Draw2Code Design';
        const { css, body } = buildParts(design);
        const indent = (block, spaces) => block.split('\n').map((l) => (l ? ' '.repeat(spaces) + l : l)).join('\n');
        return document(title, ['  <style>', indent(css.trimEnd(), 4), '  </style>'], body, undefined, design && design.pageWidth);
    }

    /**
     * The site layout: an .html that links a separate .css file.
     * @param {{page: {color: string}, elements: object[]}} design
     * @param {{title?: string, cssHref?: string}} [options]  cssHref as written
     *        in the <link>, relative to the page (default 'css/style.css')
     * @returns {{html: string, css: string}}
     */
    function generateSite(design, options) {
        const title = M.activePage(design).title || (options && options.title) || 'Draw2Code Design';
        const cssHref = (options && options.cssHref) || 'css/style.css';
        const { css, body } = buildParts(design);
        return {
            html: document(title, [`  <link rel="stylesheet" href="${escapeHtml(cssHref)}">`], body, undefined, design && design.pageWidth),
            css: `/* Generated by Draw2Code Web Editor */\n${css}`,
        };
    }

    /** "about.html" -> "page-about": the class a page's <body> carries. */
    function pageScope(name) {
        const slug = String(name || '').replace(/\.html?$/i, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
        return `page-${slug || 'home'}`;
    }

    /**
     * Every page of a design as a real site: one .html per page and ONE
     * shared stylesheet. Pages share a stylesheet, so
     * each page's rules are scoped by its <body> class - two pages can both
     * have a rect-1, and neither restyles the other - through :where(), so
     * the scope adds no weight an edit would have to fight.
     * @param {{pages: object[]}} design
     * @param {{cssPath?: string}} [options]  site-relative path of the stylesheet
     * @returns {{pages: {name: string, html: string}[], css: string, cssPath: string}}
     */
    function generateProject(design, options) {
        const cssPath = (options && options.cssPath) || 'css/style.css';
        const pages = design.pages && design.pages.length ? design.pages : [M.activePage(design)];
        const rule = (selector, lines) => `${selector} {\n${lines.map((l) => `  ${l}`).join('\n')}\n}`;
        // One page width for every page: they share the stylesheet.
        const css = baseCss(design.pageWidth);
        const out = [];
        for (const page of pages) {
            const scope = pageScope(page.name);
            css.push(rule(`body.${scope}`, [`background: ${color(page.color, '#ffffff')};`]));
            // :where() scopes the rule to its page WITHOUT adding specificity, so
            // an edit made later in the editor (a plain #rect-1 rule) still wins,
            // as it does on an imported page. A plain .page-x would outrank it
            // and silently ignore every move and colour.
            for (const el of page.elements) {
                for (const r of elementRules(el)) css.push(rule(`:where(.${scope}) ${r.selector}`, r.lines));
            }
            // The stylesheet's path as written in this page's <link>.
            const depth = String(page.name).split('/').length - 1;
            const href = '../'.repeat(depth) + cssPath;
            const body = page.elements.map((el) => `    ${elementMarkup(el)}`).join('\n');
            out.push({
                name: page.name,
                html: document(page.title || 'Home', [`  <link rel="stylesheet" href="${escapeHtml(href)}">`], body, scope, design.pageWidth),
            });
        }
        return { pages: out, css: `/* Generated by Draw2Code Web Editor */\n${css.join('\n\n')}\n`, cssPath };
    }

    return { generate, generateSite, generateProject, pageScope, renderElement, elementParts, escapeHtml, color, embedSrc, viewportMeta, FULL_WIDTH };
});
