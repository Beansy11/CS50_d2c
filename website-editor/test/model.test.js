// Unit tests for media/model.js. Run: npm test
//
// CS50 citation: I did not write these tests. I had an AI coding agent read
// my code and write tests for it, to save time, and it put this file in
// website-editor/test/. The code it tests is mine; the tests are the agent's.
// I run them with npm test.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../media/model.js');

const style = M.DEFAULT_STYLE;
const line = (x1, y1, x2, y2) =>
    M.createElement(1, 'line', { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }, style);

describe('snap', () => {
    it('rounds to the 20px grid when on', () => {
        assert.equal(M.snap(29, true), 20);
        assert.equal(M.snap(31, true), 40);
    });
    it('only rounds to whole pixels when off', () => {
        assert.equal(M.snap(29.4, false), 29);
    });
});

describe('nextId', () => {
    it('is one above the largest id, even after deletions', () => {
        assert.equal(M.nextId([]), 1);
        assert.equal(M.nextId([{ id: 2 }, { id: 7 }]), 8);
    });
});

describe('createElement + normalize', () => {
    it('rejects unknown types', () => {
        assert.throws(() => M.createElement(1, 'star', { x: 0, y: 0, w: 1, h: 1 }, style));
    });

    it('never stores a negative width or height', () => {
        const r = M.createElement(1, 'rect', { x: 100, y: 100, w: -40, h: -60 }, style);
        assert.deepEqual([r.x, r.y, r.w, r.h], [60, 40, 40, 60]);
    });

    it('keeps a line pointing where it was drawn, in all four directions', () => {
        // The notebook example: up and to the right.
        assert.deepEqual(M.lineEndpoints(line(100, 200, 300, 50)), [100, 200, 300, 50]);
        // down-right
        assert.deepEqual(M.lineEndpoints(line(0, 0, 50, 50)), [0, 0, 50, 50]);
        // up-left (same segment as down-right, drawn backwards)
        assert.deepEqual(M.lineEndpoints(line(50, 50, 0, 0)), [0, 0, 50, 50]);
        // down-left (same segment as up-right, drawn backwards)
        assert.deepEqual(M.lineEndpoints(line(300, 50, 100, 200)), [100, 200, 300, 50]);
    });

    it('stores the up-right line as a box plus flip', () => {
        const l = line(100, 200, 300, 50);
        assert.deepEqual([l.x, l.y, l.w, l.h, l.flip], [100, 50, 200, 150, true]);
    });

    it('mirrors pen points when the box flips', () => {
        const pen = { id: 1, type: 'pen', x: 0, y: 0, w: -10, h: 10, points: [[0.25, 0.5]],
                      fill: 'none', stroke: '#000', strokeWidth: 1 };
        assert.deepEqual(M.normalize(pen).points, [[0.75, 0.5]]);
    });
});

describe('resize', () => {
    const rect = M.createElement(1, 'rect', { x: 100, y: 100, w: 100, h: 50 }, style);

    it('moves only the dragged edges', () => {
        const r = M.resize(rect, 'se', 240, 180);
        assert.deepEqual([r.x, r.y, r.w, r.h], [100, 100, 140, 80]);
        const n = M.resize(rect, 'n', 999, 60);
        assert.deepEqual([n.x, n.y, n.w, n.h], [100, 60, 100, 90]);
    });

    it('flips when dragged past the opposite edge', () => {
        const r = M.resize(rect, 'e', 60, 0);
        assert.deepEqual([r.x, r.w], [60, 40]);
    });

    it('flips a line diagonal when only one axis crosses', () => {
        const l = line(0, 0, 100, 100); // flip false
        const crossed = M.resize(l, 'e', -50, 0);
        assert.equal(crossed.flip, true);
        assert.deepEqual(M.lineEndpoints(crossed), [-50, 100, 0, 0]);
    });
});

describe('hitTest', () => {
    it('only hits a diagonal line near the line, not its whole box', () => {
        const l = line(0, 0, 100, 100);
        assert.equal(M.hitTest(l, 50, 50, 4), true);
        assert.equal(M.hitTest(l, 90, 10, 4), false);
    });

    it('misses the corners of an ellipse box', () => {
        const e = M.createElement(1, 'ellipse', { x: 0, y: 0, w: 100, h: 100 }, style);
        assert.equal(M.hitTest(e, 50, 50, 4), true);
        assert.equal(M.hitTest(e, 3, 3, 4), false);
    });

    it('picks the topmost element (last in the array)', () => {
        const a = { ...M.createElement(1, 'rect', { x: 0, y: 0, w: 100, h: 100 }, style) };
        const b = { ...M.createElement(2, 'rect', { x: 50, y: 50, w: 100, h: 100 }, style) };
        assert.equal(M.topHit([a, b], 75, 75, 0).id, 2);
        assert.equal(M.topHit([a, b], 10, 10, 0).id, 1);
        assert.equal(M.topHit([a, b], 300, 300, 0), null);
    });
});

describe('handles', () => {
    it('finds the handle under the pointer', () => {
        const r = M.createElement(1, 'rect', { x: 0, y: 0, w: 100, h: 50 }, style);
        assert.equal(M.handleAt(r, 101, 49, 7), 'se');
        assert.equal(M.handleAt(r, 50, -2, 7), 'n');
        assert.equal(M.handleAt(r, 50, 25, 7), null);
    });
});

describe('widgets', () => {
    it('knows which types are widgets', () => {
        assert.equal(M.isWidget('button'), true);
        assert.equal(M.isWidget('rect'), false);
    });

    it('gives each widget type its own text defaults', () => {
        const b = M.createElement(1, 'button', { x: 0, y: 0, w: 120, h: 40 }, M.WIDGET_DEFAULTS.button);
        assert.deepEqual([b.text, b.fontSize, b.textColor], ['Button', 14, '#ffffff']);
        const i = M.createElement(2, 'input', { x: 0, y: 0, w: 200, h: 40 }, M.WIDGET_DEFAULTS.input);
        assert.equal(i.text, 'Type here...');
    });

    it('never gives shapes text fields', () => {
        const r = M.createElement(1, 'rect', { x: 0, y: 0, w: 10, h: 10 }, style);
        assert.equal('text' in r, false);
    });

    it('has a click-to-place size for widgets only', () => {
        assert.deepEqual(M.defaultSize('button'), { w: 120, h: 40 });
        assert.equal(M.defaultSize('rect'), null);
    });
});

describe('text: paragraphs and headings are widgets with their own look', () => {
    it('makes a paragraph and a heading with text, a font size and a colour', () => {
        const p = M.createElement(1, 'paragraph', { x: 0, y: 0, w: 320, h: 40 }, M.WIDGET_DEFAULTS.paragraph);
        assert.deepEqual([p.text, p.fontSize, p.textColor, p.fill, p.strokeWidth], ['Text', 16, '#1e293b', 'none', 0]);
        const h = M.createElement(2, 'heading', { x: 0, y: 0, w: 320, h: 40 }, M.WIDGET_DEFAULTS.heading);
        assert.deepEqual([h.text, h.fontSize, h.textColor, h.fill, h.strokeWidth], ['Heading', 32, '#0f172a', 'none', 0]);
    });

    it('has a click-to-place size for both', () => {
        assert.deepEqual(M.defaultSize('paragraph'), { w: 320, h: 40 });
        assert.deepEqual(M.defaultSize('heading'), { w: 320, h: 40 });
    });

    it('keeps typed line breaks, and clamps the font size like every widget', () => {
        for (const type of ['paragraph', 'heading']) {
            const el = M.createElement(1, type, { x: 0, y: 0, w: 320, h: 40 }, M.WIDGET_DEFAULTS[type]);
            assert.equal(M.setProp(el, 'text', 'one\ntwo').text, 'one\ntwo');
            assert.equal(M.setProp(el, 'fontSize', '200').fontSize, M.FONT_MAX);
            assert.equal(M.setProp(el, 'fontSize', '1').fontSize, M.FONT_MIN);
            assert.equal(M.setProp(el, 'textColor', '#ff0000').textColor, '#ff0000');
        }
    });
});

describe('setProp', () => {
    const b = M.createElement(1, 'button', { x: 0, y: 0, w: 120, h: 40 }, M.WIDGET_DEFAULTS.button);
    const l = line(0, 0, 100, 100);

    it('turns popup strings into whole numbers', () => {
        assert.equal(M.setProp(b, 'x', '42.6').x, 43);
        assert.equal(M.setProp(b, 'x', '').x, 0);
    });

    it('clamps sizes to the model rules', () => {
        assert.equal(M.setProp(b, 'w', '-5').w, 0);
        assert.equal(M.setProp(b, 'strokeWidth', '99').strokeWidth, 20);
        assert.equal(M.setProp(b, 'fontSize', '2').fontSize, 6);
        assert.equal(M.setProp(b, 'fontSize', '500').fontSize, 96);
    });

    it('only lets widgets have text and only lines flip', () => {
        assert.equal(M.setProp(b, 'text', 'OK').text, 'OK');
        assert.equal('text' in M.setProp(l, 'text', 'nope'), false);
        assert.equal(M.setProp(l, 'flip', true).flip, true);
        assert.equal('flip' in M.setProp(b, 'flip', true), false);
    });

    it('returns a new element and leaves the original alone', () => {
        const moved = M.setProp(b, 'y', '80');
        assert.notEqual(moved, b);
        assert.equal(b.y, 0);
    });

    it('rejects unknown properties', () => {
        assert.throws(() => M.setProp(b, 'colour', 'red'));
    });
});

describe('pen', () => {
    const pen = M.createPen(1, [[10, 10], [60, 10], [60, 50]], style);

    it('boxes the stroke and stores points as fractions', () => {
        assert.deepEqual([pen.x, pen.y, pen.w, pen.h], [10, 10, 50, 40]);
        assert.deepEqual(pen.points, [[0, 0], [1, 0], [1, 1]]);
        assert.equal(pen.fill, 'none');
    });

    it('turns fractions back into canvas points, following the box', () => {
        assert.deepEqual(M.penPoints(pen), [[10, 10], [60, 10], [60, 50]]);
        const bigger = M.resize(pen, 'se', 110, 90); // box doubles
        assert.deepEqual(M.penPoints(bigger), [[10, 10], [110, 10], [110, 90]]);
    });

    it('survives a perfectly straight stroke (zero-width box)', () => {
        const straight = M.createPen(2, [[5, 0], [5, 30]], style);
        assert.equal(straight.w, 0);
        assert.deepEqual(M.penPoints(straight), [[5, 0], [5, 30]]);
    });

    it('is hit along the stroke, not inside its box', () => {
        assert.equal(M.hitTest(pen, 35, 11, 4), true);   // on the top segment
        assert.equal(M.hitTest(pen, 20, 40, 4), false);  // inside the box, off the stroke
    });
});

describe('design', () => {
    it('packs every page as plain copies', () => {
        const el = M.createElement(1, 'rect', { x: 0, y: 0, w: 10, h: 10 }, style);
        const page = { ...M.makePage(M.ENTRY_PAGE), elements: [el] };
        const d = M.makeDesign([page, M.makePage('about.html')], 'about.html');
        assert.deepEqual(Object.keys(d), ['version', 'active', 'pages']);
        assert.equal(d.version, M.DESIGN_VERSION);
        assert.equal(d.active, 'about.html');
        assert.notEqual(d.pages[0].elements[0], el, 'a copy, so the canvas cannot change it after sending');
        assert.deepEqual(d.pages[0].elements[0], el);
    });

    it('the active page is the one shown, whatever the design version', () => {
        const d = M.makeDesign([M.makePage(M.ENTRY_PAGE), M.makePage('about.html')], 'about.html');
        assert.equal(M.activePage(d).name, 'about.html');
        assert.equal(M.activePage({ ...d, active: 'gone.html' }).name, 'index.html', 'falls back to the first page');
        const old = { version: 1, page: { color: '#123456' }, elements: [{ id: 1 }] };
        assert.deepEqual(M.activePage(old), { name: 'index.html', title: '', color: '#123456', elements: [{ id: 1 }], open: true },
            'no title: whoever generates an old design still says what it should be');
    });
});

describe('pages', () => {
    const site = () => [M.makePage(M.ENTRY_PAGE), M.makePage('about.html')];

    it('names a page from its file, and the entry page is Home', () => {
        assert.equal(M.pageTitleFrom('index.html'), 'Home');
        assert.equal(M.pageTitleFrom('about.html'), 'About');
        assert.equal(M.pageTitleFrom('my-notes.html'), 'My notes');
    });

    it('takes a typed name with or without .html', () => {
        assert.equal(M.normalizePageName('  about '), 'about.html');
        assert.equal(M.normalizePageName('./about.html'), 'about.html');
        assert.equal(M.normalizePageName(''), '');
        assert.equal(M.findPage(site(), 'ABOUT').name, 'about.html');
        assert.equal(M.findPage(site(), 'nope'), null);
    });

    it('adds a page, named or numbered, and never twice', () => {
        assert.equal(M.nextPageName(site()), 'page2.html');
        const added = M.addPage(site(), '');
        assert.deepEqual(added.map((p) => p.name), ['index.html', 'about.html', 'page2.html']);
        assert.equal(M.nextPageName(added), 'page3.html');
        assert.equal(M.addPage(added, 'about'), added, 'a name already in use changes nothing');
    });

    it('closing a page keeps it: only its tab goes', () => {
        const closed = M.closePage(site(), 'about.html');
        assert.deepEqual(M.openPages(closed).map((p) => p.name), ['index.html']);
        assert.equal(closed.length, 2, 'the page itself is still there');
        assert.deepEqual(M.openPages(M.reopenPage(closed, 'about')).map((p) => p.name), ['index.html', 'about.html']);
    });

    it('the last open page cannot be closed', () => {
        const one = [M.makePage(M.ENTRY_PAGE)];
        assert.equal(M.closePage(one, M.ENTRY_PAGE), one);
    });

    it('renaming takes the title with it, unless the title was chosen', () => {
        const renamed = M.renamePage(site(), 'about.html', 'story');
        assert.deepEqual(renamed[1], { ...renamed[1], name: 'story.html', title: 'Story' });
        const named = site().map((p) => (p.name === 'about.html' ? { ...p, title: 'My story' } : p));
        assert.equal(M.renamePage(named, 'about.html', 'notes')[1].title, 'My story');
    });

    it('a new page takes the home page\'s title', () => {
        const pages = site().map((p) => (p.name === 'index.html' ? { ...p, title: 'Birthdays' } : p));
        const added = M.addPage(pages, '');
        assert.equal(added[2].name, 'page2.html');
        assert.equal(added[2].title, 'Birthdays');
        const noIndex = [{ ...M.makePage('about.html'), title: 'My site' }];
        assert.equal(M.addPage(noIndex, '')[1].title, 'My site', 'no index.html: the first page is home');
    });

    it('retitles a page, and refuses a blank title', () => {
        const renamed = M.retitlePage(site(), 'about', '  My story  ');
        assert.equal(renamed[1].title, 'My story');
        assert.equal(renamed[1].name, 'about.html', 'the file name is not the title');
        const pages = site();
        assert.equal(M.retitlePage(pages, 'about.html', '   '), pages);
        assert.equal(M.retitlePage(pages, 'nope.html', 'x'), pages);
    });

    it('a name another page has is refused', () => {
        const pages = site();
        assert.equal(M.renamePage(pages, 'about.html', 'index'), pages);
    });

    it('defaults to a white page with dark label text', () => {
        assert.equal(M.DEFAULT_PAGE.color, '#ffffff');
        assert.equal(M.WIDGET_DEFAULTS.label.textColor, '#1e293b');
    });
});

describe('video: the element the page editor adds', () => {
    const video = M.createElement(1, 'video', { x: 0, y: 0, w: 0, h: 0 }, M.VIDEO_STYLE);
    const rect = M.createElement(2, 'rect', { x: 0, y: 0, w: 10, h: 10 }, style);

    it('is a black box with no border, with no file, poster, link or name yet', () => {
        assert.deepEqual([video.fill, video.stroke, video.strokeWidth], ['#000000', '#000000', 0]);
        assert.deepEqual([video.src, video.srcMp4, video.poster, video.embed, video.title], ['', '', '', '', '']);
        assert.equal(M.TYPES.includes('video'), true);
        assert.equal(M.isWidget('video'), false, 'it has no text');
        assert.equal('text' in video, false);
    });

    it('is 16:9 when placed with a click', () => {
        assert.deepEqual(M.defaultSize('video'), { w: 480, h: 270 });
    });

    it('takes a file and a poster, or a hosted link, and a name', () => {
        const file = M.setProp(M.setProp(M.setProp(video, 'src', 'assets/intro.webm'), 'poster', 'assets/intro.png'), 'title', 'Intro');
        assert.deepEqual([file.src, file.poster, file.title], ['assets/intro.webm', 'assets/intro.png', 'Intro']);
        assert.equal(M.setProp(file, 'srcMp4', 'assets/intro.mp4').srcMp4, 'assets/intro.mp4', 'an .mp4 beside the .webm');
        assert.equal(M.setProp(video, 'embed', 'https://player.vimeo.com/video/1?dnt=1').embed, 'https://player.vimeo.com/video/1?dnt=1');
    });

    it('only a video has a poster, a link and a name; a picture keeps its src and alt', () => {
        for (const prop of ['srcMp4', 'poster', 'embed', 'title']) assert.equal(M.setProp(rect, prop, 'x'), rect, prop);
        const image = M.createElement(3, 'image', { x: 0, y: 0, w: 10, h: 10 }, style);
        assert.equal(M.setProp(image, 'poster', 'x.png'), image);
        assert.equal(M.setProp(image, 'srcMp4', 'x.mp4'), image);
        assert.equal(M.setProp(image, 'src', 'x.png').src, 'x.png');
        assert.equal(M.setProp(video, 'alt', 'words'), video, 'a video has a name, not alt text');
    });
});

describe('full width and the page width', () => {
    it('any element can be full width, and back', () => {
        for (const type of M.TYPES) {
            const el = M.createElement(1, type, { x: 10, y: 20, w: 100, h: 50 }, M.isWidget(type) ? M.WIDGET_DEFAULTS[type] : M.DEFAULT_STYLE);
            assert.equal(el.fullWidth, undefined, 'a new element is in the page\'s width');
            const full = M.setProp(el, 'fullWidth', true);
            assert.equal(full.fullWidth, true);
            assert.deepEqual([full.x, full.w], [10, 100], 'its own x and width are kept');
            assert.equal(M.setProp(full, 'fullWidth', false).fullWidth, false);
        }
        assert.equal(M.setProp(M.createElement(1, 'rect', { x: 0, y: 0, w: 1, h: 1 }, M.DEFAULT_STYLE), 'fullWidth', 'true').fullWidth, true, 'as the properties popup sends it');
        assert.equal(M.setProp(M.createElement(1, 'rect', { x: 0, y: 0, w: 1, h: 1 }, M.DEFAULT_STYLE), 'fullWidth', 'yes').fullWidth, false);
    });

    it('a page width is a whole number of px within the limits, 1440 when not given', () => {
        assert.equal(M.PAGE_WIDTH, 1440);
        assert.equal(M.pageWidthOf(undefined), 1440);
        assert.equal(M.pageWidthOf('wide'), 1440);
        assert.equal(M.pageWidthOf(1200.4), 1200);
        assert.equal(M.pageWidthOf(10), M.PAGE_WIDTH_MIN);
        assert.equal(M.pageWidthOf(1e9), M.PAGE_WIDTH_MAX);
    });
});

describe('the phone layout\'s constants', () => {
    it('lay a phone layout out for a 390px window, shown in any window up to 767px', () => {
        assert.equal(M.PHONE_WIDTH, 390);
        assert.equal(M.PHONE_BREAKPOINT, 767);
        assert.equal(M.PHONE_LAYOUT_CLASS, 'has-phone-layout');
        assert.ok(M.PHONE_WIDTH >= M.PAGE_WIDTH_MIN && M.PHONE_WIDTH <= M.PHONE_BREAKPOINT);
        assert.ok(M.PHONE_BREAKPOINT < M.PAGE_WIDTH, 'a desktop window is never laid out as a phone');
    });
});
