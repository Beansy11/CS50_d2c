// Unit tests for media/generators/html.js. Run: npm test
//
// CS50 citation: the name Draw2Code Web Editor was chosen with help from
// Claude (Anthropic AI), and at my direction Claude renamed
// the project from its earlier name, HardHat Designer, throughout this file.
//
// I did not write these tests. I had an AI coding agent read my code and
// write tests for it, to save time, and it put this file in
// website-editor/test/. The code it tests is mine; the tests are the agent's.
// I run them with npm test.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../media/model.js');
const H = require('../media/generators/html.js');

const shape = (id, type, box, extra = {}) => ({ ...M.createElement(id, type, box, M.DEFAULT_STYLE), ...extra });
const widget = (id, type, box, extra = {}) => ({ ...M.createElement(id, type, box, M.WIDGET_DEFAULTS[type]), ...extra });
// A design is a site: one page, which is the one generated.
const design = (elements, color = '#ffffff', title = '') => {
    const page = { ...M.makePage(M.ENTRY_PAGE), color, elements };
    if (title) page.title = title;
    return M.makeDesign([page], page.name);
};

describe('generate: the page', () => {
    const html = H.generate(design([], '#112233', 'My <Page>'));

    it('is a complete HTML document', () => {
        assert.match(html, /^<!DOCTYPE html>\n<html lang="en">/);
        assert.match(html, /<\/html>\n$/);
    });

    // Hosts add their own body spacing (VS Code webviews add 20px of side
    // padding), so both margin and padding must be reset for 1:1 positions.
    it('resets body margin and padding, and uses the page color', () => {
        assert.match(html, /body \{\n\s+margin: 0;\n\s+padding: 0;\n\s+background: #112233;/);
    });

    it('escapes the title', () => {
        assert.match(html, /<title>My &lt;Page&gt;<\/title>/);
    });

    it('the page names itself; the caller\'s title is only a fallback', () => {
        assert.match(H.generate(design([])), /<title>Home<\/title>/);
        assert.match(H.generate({ version: 1, page: { color: '#fff' }, elements: [] }, { title: 'Old' }),
            /<title>Old<\/title>/, 'a design from before pages still generates');
    });

    it('positions every element absolutely inside .page', () => {
        assert.match(html, /\.page > \* \{\n\s+position: absolute;/);
    });
});

describe('generate: shapes become inline svg', () => {
    it('rect keeps its box and style', () => {
        const { html, css } = H.renderElement(shape(1, 'rect', { x: 100, y: 40, w: 160, h: 80 }));
        assert.equal(html, '<svg id="rect-1" width="160" height="80" viewBox="0 0 160 80"><rect x="0" y="0" width="160" height="80" fill="#3b82f6" stroke="#f59e0b" stroke-width="2"/></svg>');
        assert.match(css[0], /#rect-1 \{\n  left: 100px;\n  top: 40px;\n  width: 160px;\n  height: 80px;\n\}/);
    });

    it('fill none and stroke width 0 are written as none', () => {
        const { html } = H.renderElement(shape(2, 'ellipse', { x: 0, y: 0, w: 50, h: 30 }, { fill: 'none', strokeWidth: 0 }));
        assert.match(html, /<ellipse cx="25" cy="15" rx="25" ry="15" fill="none" stroke="none"\/>/);
    });

    it('a line keeps its direction, relative to its box', () => {
        const up = { ...M.createElement(3, 'line', { x: 100, y: 200, w: 200, h: -150 }, M.DEFAULT_STYLE) };
        const { html } = H.renderElement(up);
        assert.match(html, /<line x1="0" y1="150" x2="200" y2="0" /);
    });

    it('a pen stroke becomes a polyline with no fill', () => {
        const pen = M.createPen(4, [[10, 10], [60, 10], [60, 50]], M.DEFAULT_STYLE);
        const { html } = H.renderElement(pen);
        assert.match(html, /<polyline points="0,0 50,0 50,40" fill="none" /);
    });
});

describe('generate: widgets become real tags', () => {
    it('button', () => {
        const { html, css } = H.renderElement(widget(5, 'button', { x: 0, y: 0, w: 120, h: 40 }, { text: 'Save' }));
        assert.equal(html, '<button id="button-5" type="button">Save</button>');
        assert.match(css[0], /background: #3b82f6;\n  border: 1px solid #1d4ed8;\n  color: #ffffff;\n  font-size: 14px;\n  border-radius: 4px;/);
    });

    it('input uses its text as the placeholder, in its text color', () => {
        const { html, css } = H.renderElement(widget(6, 'input', { x: 0, y: 0, w: 200, h: 40 }, { text: 'Email' }));
        assert.equal(html, '<input id="input-6" type="text" placeholder="Email">');
        assert.match(css[1], /#input-6::placeholder \{\n  color: #64748b;/);
    });

    it('label with no fill and no border', () => {
        const { html, css } = H.renderElement(widget(7, 'label', { x: 0, y: 0, w: 80, h: 20 }));
        assert.equal(html, '<label id="label-7">Label</label>');
        assert.match(css[0], /background: transparent;\n  border: none;\n  color: #1e293b;/);
    });
});

describe('generate: text wraps, keeps its lines and grows its box', () => {
    it('paragraph is a <p> and heading an <h1>', () => {
        assert.equal(H.renderElement(widget(1, 'paragraph', { x: 0, y: 0, w: 320, h: 40 })).html, '<p id="paragraph-1">Text</p>');
        assert.equal(H.renderElement(widget(2, 'heading', { x: 0, y: 0, w: 320, h: 40 })).html, '<h1 id="heading-2">Heading</h1>');
    });

    it('wraps with pre-wrap, takes min-height instead of a height, and has no margin', () => {
        for (const type of ['paragraph', 'heading']) {
            const { css } = H.renderElement(widget(3, type, { x: 10, y: 20, w: 320, h: 40 }));
            assert.match(css[0], /min-height: 40px;/);
            assert.doesNotMatch(css[0], /(^|\s)height:/);
            assert.match(css[0], /margin: 0;\n  white-space: pre-wrap;\n  overflow-wrap: break-word;/);
            assert.match(css[0], /background: transparent;\n  border: none;/);
        }
    });

    it('keeps the base rule nowrap for everything else, so only text gets pre-wrap', () => {
        const page = H.generate(design([widget(4, 'paragraph', { x: 0, y: 0, w: 320, h: 40 })]));
        assert.match(page, /\.page > \* \{[^}]*white-space: nowrap;/);
        assert.match(page, /#paragraph-4 \{[^}]*white-space: pre-wrap;/);
    });

    it('escapes the text and keeps its newlines as they are', () => {
        for (const [type, tag] of [['paragraph', 'p'], ['heading', 'h1']]) {
            const { html } = H.renderElement(widget(5, type, { x: 0, y: 0, w: 320, h: 40 }, { text: 'a < b\n& <script>x</script>\nend' }));
            assert.equal(html, `<${tag} id="${type}-5">a &lt; b\n&amp; &lt;script&gt;x&lt;/script&gt;\nend</${tag}>`);
        }
    });
});

describe('generate: nothing from the design is trusted', () => {
    it('escapes widget text', () => {
        const { html } = H.renderElement(widget(8, 'button', { x: 0, y: 0, w: 10, h: 10 }, { text: '<script>alert("x")</script>' }));
        assert.equal(html, '<button id="button-8" type="button">&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</button>');
    });

    it('escapes placeholder quotes so they cannot break the attribute', () => {
        const { html } = H.renderElement(widget(9, 'input', { x: 0, y: 0, w: 10, h: 10 }, { text: '" onfocus="x' }));
        assert.equal(html, '<input id="input-9" type="text" placeholder="&quot; onfocus=&quot;x">');
    });

    it('replaces anything that is not a hex color', () => {
        assert.equal(H.color('#abc'), '#abc');
        assert.equal(H.color('red; } body { display:none'), '#000000');
        const { css } = H.renderElement(widget(10, 'button', { x: 0, y: 0, w: 10, h: 10 }, { fill: 'url(evil)' }));
        assert.match(css[0], /background: #000000;/);
    });

    it('turns non-numbers into 0', () => {
        const { css } = H.renderElement(shape(11, 'rect', { x: 0, y: 0, w: 10, h: 10 }, { x: 'NaN', y: '1e999' }));
        assert.match(css[0], /left: 0px;\n  top: 0px;/);
    });
});

describe('generate: order', () => {
    it('keeps drawing order, so later elements stay on top', () => {
        const html = H.generate(design([
            shape(1, 'rect', { x: 0, y: 0, w: 10, h: 10 }),
            widget(2, 'button', { x: 0, y: 0, w: 10, h: 10 }),
            shape(3, 'ellipse', { x: 0, y: 0, w: 10, h: 10 }),
        ]));
        const order = [...html.matchAll(/id="([a-z]+-\d+)"/g)].map((m) => m[1]);
        assert.deepEqual(order, ['rect-1', 'button-2', 'ellipse-3']);
    });
});

describe('generateSite: html + separate css', () => {
    const d = design([widget(1, 'button', { x: 0, y: 0, w: 120, h: 40 })], '#ffffff');
    const out = H.generateSite(d, { title: 'Site' });

    it('links the stylesheet instead of embedding it', () => {
        assert.match(out.html, /<link rel="stylesheet" href="css\/style.css">/);
        assert.doesNotMatch(out.html, /<style>/);
        assert.match(out.html, /<button id="button-1" type="button">Button<\/button>/);
    });

    it('puts the same rules in the css file', () => {
        assert.match(out.css, /^\/\* Generated by Draw2Code Web Editor \*\//);
        assert.match(out.css, /#button-1 \{\n  left: 0px;/);
        assert.match(out.css, /body \{\n  margin: 0;/);
    });

    it('accepts a different css path', () => {
        assert.match(H.generateSite(d, { cssHref: '../css/site.css' }).html, /href="..\/css\/site.css"/);
    });
});

describe('elementParts: the same element, for an existing page', () => {
    it('gives the id, the markup and the rules as declarations', () => {
        const parts = H.elementParts(widget(3, 'input', { x: 10, y: 20, w: 200, h: 40 }));
        assert.equal(parts.id, 'input-3');
        assert.match(parts.html, /^<input id="input-3" type="text"/);
        assert.equal(parts.rules[0].selector, '#input-3');
        assert.equal(parts.rules[0].declarations.left, '10px');
        assert.equal(parts.rules[0].declarations.height, '40px');
        assert.equal(parts.rules[1].selector, '#input-3::placeholder', 'the extra rule comes along');
    });

    it('gives paragraphs and headings one rule with min-height and no height', () => {
        for (const [type, tag] of [['paragraph', 'p'], ['heading', 'h1']]) {
            const parts = H.elementParts(widget(1, type, { x: 10, y: 20, w: 320, h: 40 }));
            assert.equal(parts.id, `${type}-1`);
            assert.equal(parts.html, `<${tag} id="${type}-1">${M.WIDGET_DEFAULTS[type].text}</${tag}>`);
            assert.equal(parts.rules.length, 1);
            const d = parts.rules[0].declarations;
            assert.deepEqual([d.left, d.top, d.width, d['min-height'], d.height], ['10px', '20px', '320px', '40px', undefined]);
            assert.equal(d['white-space'], 'pre-wrap');
            assert.equal(d['font-size'], `${M.WIDGET_DEFAULTS[type].fontSize}px`);
        }
    });

    it('matches renderElement exactly', () => {
        const el = shape(2, 'ellipse', { x: 0, y: 0, w: 30, h: 20 });
        assert.equal(H.elementParts(el).html, H.renderElement(el).html);
        assert.deepEqual(Object.keys(H.elementParts(el).rules[0].declarations), ['left', 'top', 'width', 'height']);
    });
});

describe('a video: a file in the site\'s player, or a hosted player in a frame', () => {
    const video = (extra) => ({ ...M.createElement(1, 'video', { x: 10, y: 20, w: 480, h: 270 }, M.VIDEO_STYLE), ...extra });
    const file = video({ src: '../assets/intro.webm', poster: '../assets/intro.png', title: 'Intro' });

    it('a file plays in the player: the video, the big Play, the bar and the message line', () => {
        const html = H.elementParts(file).html;
        assert.match(html, /^<div id="video-1" class="video-player" role="group" aria-label="Intro"><video poster="..\/assets\/intro.png" preload="metadata" playsinline controls><source src="..\/assets\/intro.webm" type="video\/webm"><\/video>/);
        for (const [cls, label] of [['video-big-play', 'Play Intro'], ['video-play', 'Play'], ['video-mute', 'Mute'], ['video-full', 'Full screen']]) {
            assert.match(html, new RegExp(`<button class="${cls}" type="button" aria-label="${label}">`), cls);
        }
        assert.match(html, /<input class="video-seek" type="range" min="0" max="1000" step="1" value="0" aria-label="Seek" aria-valuetext="0:00 of 0:00">/);
        assert.match(html, /<input class="video-volume" type="range" min="0" max="1" step="0.05" value="1" aria-label="Volume">/);
        assert.match(html, /<span class="video-time">0:00 \/ 0:00<\/span>/);
        assert.match(html, /<span class="video-message" aria-live="polite"><\/span><\/div>$/);
        // Every symbol is decoration: its button has the name.
        const svgs = html.match(/<svg[^>]*>/g);
        assert.equal(svgs.length, 7);
        for (const svg of svgs) assert.match(svg, /viewBox="0 0 16 16" aria-hidden="true" focusable="false"/);
        assert.doesNotMatch(html.replace(/currentColor/g, ''), /#[0-9a-f]{3,6}/i, 'the symbols take the bar\'s colour');
    });

    it('leaves the poster out when there is none, and names a video without a name "Video"', () => {
        const html = H.elementParts(video({ src: 'a.webm' })).html;
        assert.match(html, /<video preload="metadata" playsinline controls><source src="a.webm" type="video\/webm"><\/video>/);
        assert.match(html, /aria-label="Video"/);
        assert.match(html, /aria-label="Play Video"/);
    });

    it('escapes the name, the file and the poster, and refuses an address that leaves the site', () => {
        const html = H.elementParts(video({ src: 'a"b<c>.webm', srcMp4: 'm"n.mp4', poster: 'p"q.png', title: '"><script>alert(1)</script>' })).html;
        assert.match(html, /<video poster="p&quot;q.png" preload="metadata" playsinline controls><source src="a&quot;b&lt;c&gt;.webm" type="video\/webm"><source src="m&quot;n.mp4" type="video\/mp4"><\/video>/);
        assert.match(html, /aria-label="&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
        assert.doesNotMatch(html, /<script/);
        for (const src of ['javascript:alert(1)', 'data:video/webm;base64,AAAA', 'https://x.example/a.webm', '/etc/a.webm', 'a\\b.webm', '//x.example/a.mp4', ' java\tscript:x.mp4', 'C:\\a.mp4']) {
            assert.match(H.elementParts(video({ src, srcMp4: src, poster: src })).html, /<video preload="metadata" playsinline controls><\/video>/, src);
            // Each file is checked on its own: a good one beside a bad one still plays.
            assert.match(H.elementParts(video({ src, srcMp4: 'a.mp4' })).html, /<video preload="metadata" playsinline controls><source src="a.mp4" type="video\/mp4"><\/video>/, src);
            assert.match(H.elementParts(video({ src: 'a.webm', srcMp4: src })).html, /<video preload="metadata" playsinline controls><source src="a.webm" type="video\/webm"><\/video>/, src);
        }
    });

    it('a video with a .webm and an .mp4 has a <source> for each, the .webm first, and no src of its own', () => {
        const html = H.elementParts(video({ ...file, srcMp4: '../assets/intro.mp4' })).html;
        assert.match(html, /<video poster="..\/assets\/intro.png" preload="metadata" playsinline controls><source src="..\/assets\/intro.webm" type="video\/webm"><source src="..\/assets\/intro.mp4" type="video\/mp4"><\/video>/);
        assert.doesNotMatch(html, /<video[^>]* src=/, 'a src on the video would hide its sources');
        // Whichever field holds which, the .webm is tried first.
        const swapped = H.elementParts(video({ src: 'b.mp4', srcMp4: 'b.WEBM' })).html;
        assert.match(swapped, /<source src="b.WEBM" type="video\/webm"><source src="b.mp4" type="video\/mp4"><\/video>/);
        // The same file twice is one source.
        assert.equal(H.elementParts(video({ src: 'c.mp4', srcMp4: 'c.mp4' })).html.match(/<source/g).length, 1);
    });

    it('a video with only an .mp4 has that one source; a file of another kind has no type', () => {
        assert.match(H.elementParts(video({ src: 'a.mp4' })).html, /<video preload="metadata" playsinline controls><source src="a.mp4" type="video\/mp4"><\/video>/);
        assert.match(H.elementParts(video({ src: 'a.mp4?v=2#t=3' })).html, /<source src="a.mp4\?v=2#t=3" type="video\/mp4">/);
        assert.match(H.elementParts(video({ src: 'clip.mov' })).html, /<video preload="metadata" playsinline controls><source src="clip.mov"><\/video>/);
    });

    it('a hosted video is the provider\'s player in a frame, which may go full screen', () => {
        const embed = 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90';
        const parts = H.elementParts(video({ embed, title: 'Product <tour>' }));
        assert.equal(parts.html, `<div id="video-1" class="video-embed"><iframe src="${embed}" title="Product &lt;tour&gt;" allow="autoplay; encrypted-media; fullscreen; picture-in-picture" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen loading="lazy"></iframe></div>`);
    });

    it('a hosted link the generator did not make loads nothing: the box stays, empty', () => {
        for (const embed of ['javascript:alert(1)', 'https://evil.example/embed', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://player.vimeo.com/video/1?dnt=1" onload="x']) {
            const html = H.elementParts(video({ embed, title: 'Tour' })).html;
            assert.match(html, /^<div id="video-1" class="video-embed"><iframe src="" title="Tour"/, embed);
        }
    });

    it('its box takes the fill, the border and the corners, with no position of its own', () => {
        const [box, ...rest] = H.elementParts(video({ ...file, fill: '#112233', strokeWidth: 2, stroke: '#ff0000' })).rules;
        assert.equal(box.selector, '#video-1');
        assert.deepEqual(box.declarations, { left: '10px', top: '20px', width: '480px', height: '270px', background: '#112233', border: '2px solid #ff0000', overflow: 'hidden', 'box-sizing': 'border-box' });
        assert.equal('position' in box.declarations, false, 'placed freely, the editor adds one; in a page, the page places it');
        assert.equal(rest.length, 0, 'a file\'s player has its own stylesheet');
    });

    it('a hosted player fills its box, in a rule Delete takes away with the box', () => {
        const rules = H.elementParts(video({ embed: 'https://player.vimeo.com/video/1?dnt=1' })).rules;
        assert.equal(rules.length, 2);
        assert.equal(rules[1].selector, '#video-1 > *');
        assert.deepEqual(rules[1].declarations, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', border: '0', display: 'block' });
    });

    it('a generated page holds it like any element', () => {
        const html = H.generate(design([file]));
        assert.match(html, /<div class="page">\n {4}<div id="video-1" class="video-player"/);
        assert.match(html, /#video-1 \{\n {6}left: 10px;[^}]*overflow: hidden;/);
    });
});

describe('the page: a centred column, the project\'s page width wide', () => {
    const css = (d) => H.generateSite(d).css;

    it('is 1440px wide, centred in the window, unless the design says otherwise', () => {
        assert.match(css(design([])), /\.page \{\n  position: relative;\n  width: 1440px;\n  margin: 0 auto;\n  min-height: 100vh;\n\}/);
        assert.match(css({ ...design([]), pageWidth: 1200 }), /\.page \{[^}]*width: 1200px;/);
        assert.match(H.generate({ ...design([]), pageWidth: 1200 }), /\.page \{[^}]*width: 1200px;/);
    });

    it('a width that is not one a page can have is replaced', () => {
        assert.match(css({ ...design([]), pageWidth: 'wide' }), /\.page \{[^}]*width: 1440px;/);
        assert.match(css({ ...design([]), pageWidth: 99999 }), /\.page \{[^}]*width: 3840px;/);
        assert.match(css({ ...design([]), pageWidth: '1000px; } body { display: none' }), /\.page \{[^}]*width: 1440px;/, 'nothing typed gets into the stylesheet');
    });

    it('every page of a site shares one width', () => {
        const out = H.generateProject({ version: 2, active: 'index.html', pageWidth: 1280,
            pages: [{ ...M.makePage('index.html') }, { ...M.makePage('about.html') }] });
        assert.equal(out.css.match(/width: 1280px;/g).length, 1, 'one rule, in the shared stylesheet');
        assert.equal(out.pages.length, 2);
    });

    it('keeps everything past the column\'s sides from making the page scroll sideways, without stopping a narrow window scrolling', () => {
        const out = css(design([]));
        assert.match(out, /html \{\n  overflow-x: auto;\n/, '<html> scrolls itself, so <body>\'s clip stays on <body>');
        assert.match(out, /body \{[^}]*min-width: max-content;\n  overflow-x: clip;\n\}/, 'as wide as the column at least, and cut off past its sides');
        assert.doesNotMatch(out, /container-type|contain:/, 'nothing contained: the page colour on <body> still fills the window');
    });
});

describe('a link to a section scrolls there smoothly', () => {
    it('asks for smooth scrolling on <html>, and none for a reader who wants less motion', () => {
        for (const out of [H.generateSite(design([])).css, H.generate(design([])), H.generateProject({ version: 2, active: 'index.html', pages: [{ ...M.makePage('index.html') }] }).css]) {
            assert.match(out, /html \{\n *overflow-x: auto;\n *scroll-behavior: smooth;\n *\}/);
            assert.match(out, /@media \(prefers-reduced-motion: reduce\) \{\n *html \{\n *scroll-behavior: auto;\n *\}\n *\}/);
        }
    });
});

describe('a full-width element stretches across the whole window', () => {
    const full = (el) => ({ ...el, fullWidth: true });

    it('has the class the page editor writes, and keeps its own box rule', () => {
        const P = require('../../out/website-editor/src/pageEdit.js');
        assert.equal(H.FULL_WIDTH, P.FULL_WIDTH_CLASS);
        const { html, css } = H.renderElement(full(widget(1, 'button', { x: 10, y: 20, w: 120, h: 40 })));
        assert.equal(html, '<button id="button-1" class="full-width" type="button">Button</button>');
        assert.match(css[0], /left: 10px;\n  top: 20px;\n  width: 120px;/, 'its x and width are kept for when it is back in the page');
    });

    it('the rule wins over the element\'s own left and width, and keeps it from the window\'s edge to edge', () => {
        const out = H.generateSite(design([full(shape(1, 'rect', { x: 10, y: 20, w: 100, h: 50 }))])).css;
        assert.match(out, /\.page > \.full-width \{\n  left: min\(0px, 50% - 50vw\) !important;\n  width: max\(100%, 100vw\) !important;\n\}/);
        assert.match(out, /\.page > svg\.full-width > \* \{\n  vector-effect: non-scaling-stroke;\n\}/, 'a stretched drawing keeps its border\'s width');
    });

    it('a drawing is stretched to fit its box, whatever width that is', () => {
        const { html } = H.renderElement(full(shape(1, 'rect', { x: 10, y: 20, w: 100, h: 50 })));
        assert.equal(html, '<svg id="rect-1" class="full-width" width="100" height="50" viewBox="0 0 100 50" preserveAspectRatio="none"><rect x="0" y="0" width="100" height="50" fill="#3b82f6" stroke="#f59e0b" stroke-width="2"/></svg>');
        assert.doesNotMatch(H.renderElement(shape(1, 'rect', { x: 10, y: 20, w: 100, h: 50 })).html, /class=|preserveAspectRatio/, 'one that is not full width is as before');
    });

    it('a video\'s own class stays, and the class goes on its box', () => {
        const video = M.setProp(M.createElement(1, 'video', { x: 0, y: 0, w: 480, h: 270 }, M.VIDEO_STYLE), 'embed', 'https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ');
        assert.match(H.renderElement(full(video)).html, /^<div id="video-1" class="video-embed full-width">/);
        const own = M.setProp(M.createElement(2, 'video', { x: 0, y: 0, w: 480, h: 270 }, M.VIDEO_STYLE), 'src', 'assets/a.webm');
        assert.match(H.renderElement(full(own)).html, /^<div id="video-2" class="video-player full-width" role="group"/);
    });

    it('only true makes an element full width', () => {
        assert.doesNotMatch(H.renderElement({ ...widget(1, 'label', { x: 0, y: 0, w: 80, h: 20 }), fullWidth: 'yes' }).html, /full-width/);
    });
});

describe('a phone: the page shrunk to fit until it has a phone layout', () => {
    const project = (extra = {}) => H.generateProject({ version: 2, active: 'index.html', pages: [{ ...M.makePage('index.html') }, { ...M.makePage('about.html') }], ...extra });

    it('every generated page asks a phone for a viewport as wide as its column', () => {
        const meta = /<meta name="viewport" content="width=(\d+)">/;
        assert.equal(H.generate(design([])).match(meta)[1], '1440');
        assert.equal(H.generateSite({ ...design([]), pageWidth: 1200 }).html.match(meta)[1], '1200');
        for (const p of project({ pageWidth: 1280 }).pages) assert.equal(p.html.match(meta)[1], '1280', p.name);
        assert.equal(H.generate({ ...design([]), pageWidth: 99999 }).match(meta)[1], '3840', 'the width the column has');
        assert.doesNotMatch(H.generate(design([])), /device-width|initial-scale/);
        assert.equal(H.viewportMeta(undefined), '<meta name="viewport" content="width=1440">');
    });

    it('no generated page has a phone layout', () => {
        for (const p of project().pages) assert.match(p.html, /\n<html lang="en">\n/, p.name);
        assert.doesNotMatch(H.generate(design([])), new RegExp(`<html[^>]*${M.PHONE_LAYOUT_CLASS}`));
    });

    it('under the breakpoint, a page with a phone layout is as wide as the window, and no other page changes', () => {
        const block = `@media (max-width: ${M.PHONE_BREAKPOINT}px) {\n  html.${M.PHONE_LAYOUT_CLASS} body {\n    min-width: 0;\n  }\n  html.${M.PHONE_LAYOUT_CLASS} .page {\n    width: 100%;\n  }\n  html.${M.PHONE_LAYOUT_CLASS} .page > svg > * {\n    vector-effect: non-scaling-stroke;\n  }\n}`;
        for (const out of [H.generateSite(design([])).css, project().css]) {
            assert.equal(out.split(block).length, 2, 'once, in the stylesheet every page shares');
            assert.ok(out.indexOf(block) > out.indexOf('.page > .full-width'), 'after the desktop rules');
        }
        assert.match(H.generate(design([])), /@media \(max-width: 767px\) \{\n *html\.has-phone-layout body \{\n *min-width: 0;/);
    });
});
