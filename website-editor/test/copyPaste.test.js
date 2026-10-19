// Unit tests for copy, paste and duplicate in the page editor:
// src/copyPaste.ts, pageEdit.ts copyElement, and the batch edit of
// pageEditor.ts that makes several edits one undo step (compiled to out/ by
// npm test's pretest).
//
// CS50 citation: I did not write these tests. I had an AI coding agent read
// my code and write tests for it, to save time, and it put this file in
// website-editor/test/. The code it tests is mine; the tests are the agent's.
// I run them with npm test.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const C = require('../../out/website-editor/src/copyPaste.js');
const P = require('../../out/website-editor/src/pageEdit.js');
const E = require('../../out/website-editor/src/pageEditor.js');
const M = require('../media/model.js');
const H = require('../media/generators/html.js');

// A project of two pages made in Draw2Code: a rectangle, a text box and a
// picture on the home page, nothing yet on pages/about.html.
const rect = M.createElement(3, 'rect', { x: 10, y: 20, w: 100, h: 50 }, M.DEFAULT_STYLE);
const input = M.createElement(1, 'input', { x: 200, y: 40, w: 160, h: 32 }, M.WIDGET_DEFAULTS.input);
const image = M.setProp(M.createElement(1, 'image', { x: 400, y: 100, w: 120, h: 90 }, M.DEFAULT_STYLE), 'src', 'assets/cat.png');
const RECT_BOX = { ref: { id: 'rect-3' }, box: { x: 10, y: 20, w: 100, h: 50 } };
const DESIGN = {
    version: 2,
    pages: [
        { name: 'index.html', title: 'Home', color: '#ffffff', open: true, elements: [rect, input, image] },
        { name: 'pages/about.html', title: 'About', color: '#ffffff', elements: [] },
    ],
};

/** A working copy of the project, as Draw2Code writes it. */
function makeProject() {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-paste-'));
    const out = H.generateProject(DESIGN);
    fs.mkdirSync(path.join(work, 'css'), { recursive: true });
    fs.mkdirSync(path.join(work, 'pages'), { recursive: true });
    fs.writeFileSync(path.join(work, out.cssPath), out.css);
    for (const page of out.pages) fs.writeFileSync(path.join(work, page.name), page.html);
    return work;
}

/** What DesignerPanel.onCopy keeps for these elements of `page` (its stylesheets read from disk). */
function copy(work, page, items, wrapper) {
    const html = fs.readFileSync(path.join(work, page), 'utf8');
    const overrides = E.readOverrides(work)[page] ?? {};
    const sheets = P.pageStyles(html).map((style) => {
        if ('css' in style) return { dir: path.posix.dirname(page), css: style.css };
        const file = path.posix.normalize(path.posix.join(path.posix.dirname(page), style.href));
        return { dir: path.posix.dirname(file), css: fs.readFileSync(path.join(work, file), 'utf8') };
    });
    const styles = { sheets, overrides, overridesDir: path.posix.dirname(E.cssPathFor(page)), scopes: P.bodyClasses(html) };
    return {
        page,
        wrapper,
        overridesDir: styles.overridesDir,
        pasted: {},
        items: items.map((item) => {
            const copied = P.copyElement(html, item.ref, (selector) => Object.keys(overrides).some((rule) => rule.startsWith(selector)));
            return { ...copied, rules: C.copiedRules(copied, styles), box: item.box, full: Boolean(item.full) };
        }),
    };
}

/** What DesignerPanel.paste does: the copies as one batch of adds on `page`, one made narrower to fit the column drawn again. */
function paste(work, clip, page, offset, wrapper) {
    const html = fs.readFileSync(path.join(work, page), 'utf8');
    const inWrapper = P.placesInWrapper(html);
    const pasted = C.pasteElements(clip, { page, taken: P.usedIds(html), inWrapper, wrapper, overridesDir: path.posix.dirname(E.cssPathFor(page)) }, offset);
    const ops = pasted.map((one) => ({ op: 'add', ref: { id: one.id }, markup: one.markup, declarations: one.declarations, extraRules: one.extraRules }));
    for (const one of pasted) if (one.narrowed) ops.push({ op: 'style', ref: { id: one.id }, declarations: { width: one.declarations.width } });
    return { pasted, result: E.applyEdit(work, page, { op: 'batch', ref: {}, label: 'Paste', ops }) };
}

describe('cssRules: a stylesheet read for the rules of one element', () => {
    it('reads each rule at the top level, one selector per comma, its declarations as written', () => {
        const rules = C.cssRules('/* a note */\n#a, #b > * { color: red; background: url("x;y.png") }\n.c{margin:0}');
        assert.deepEqual(rules, [
            { selectors: ['#a', '#b > *'], declarations: { color: 'red', background: 'url("x;y.png")' } },
            { selectors: ['.c'], declarations: { margin: '0' } },
        ]);
    });

    it('passes over @import, @media and @font-face, and keeps a custom property as named', () => {
        const rules = C.cssRules('@import "a.css";\n@media (max-width: 600px) { #a { color: blue } }\n@font-face { font-family: X }\n#a { --Gap: 4px; COLOR: green; color: teal }');
        assert.deepEqual(rules, [{ selectors: ['#a'], declarations: { '--Gap': '4px', color: 'teal' } }]);
    });
});

describe('ownSuffix: is a rule only this element\'s?', () => {
    it('its own rule, a pseudo-class or pseudo-element, and its children\'s', () => {
        assert.equal(C.ownSuffix('#rect-3', ['#rect-3'], []), '');
        assert.equal(C.ownSuffix('#input-1::placeholder', ['#input-1'], []), '::placeholder');
        assert.equal(C.ownSuffix('#rect-3>*', ['#rect-3'], []), ' > *');
        assert.equal(C.ownSuffix('[data-d2c="2"]:hover', ['[data-d2c="2"]'], []), ':hover');
    });

    it('scoped to its own page, but not another page\'s element of the same id, nor a longer id', () => {
        assert.equal(C.ownSuffix(':where(.page-index) #rect-3', ['#rect-3'], ['page-index']), '');
        assert.equal(C.ownSuffix(':where(.page-about) #rect-3', ['#rect-3'], ['page-index']), undefined);
        assert.equal(C.ownSuffix('#rect-30', ['#rect-3'], []), undefined);
        assert.equal(C.ownSuffix('header #rect-3', ['#rect-3'], []), undefined);
    });
});

describe('rebaseUrl: an address written from another folder', () => {
    it('is written from the folder it lands in', () => {
        assert.equal(C.rebaseUrl('assets/cat.png', '', 'pages'), '../assets/cat.png');
        assert.equal(C.rebaseUrl('../assets/cat.png?v=2#x', 'pages', ''), 'assets/cat.png?v=2#x');
        assert.equal(C.rebaseUrl('../img/a.png', 'css', 'draw2code/pages'), '../../img/a.png');
        assert.equal(C.rebaseUrl('a.png', 'pages', 'pages'), 'a.png');
    });

    it('leaves a web address, data:, the site root, a section and the outside of the site alone', () => {
        for (const value of ['https://example.com/a.png', 'data:image/png;base64,AA', '/a.png', '#top', '../../x.png']) {
            assert.equal(C.rebaseUrl(value, 'pages', ''), value);
        }
    });
});

describe('freshId: a new id for each copy', () => {
    it('a numbered one takes the first free number of its kind, on that page', () => {
        assert.equal(C.freshId('rect-3', new Set()), 'rect-1');
        assert.equal(C.freshId('rect-3', new Set(['rect-1', 'rect-2', 'rect-3', 'rect-4', 'rect-5', 'rect-6'])), 'rect-7');
        assert.equal(C.freshId('div-1', new Set(['div-1'])), 'div-2');
    });

    it('any other keeps its name while it is free, and is numbered from 2 once it is not', () => {
        assert.equal(C.freshId('title', new Set()), 'title');
        assert.equal(C.freshId('title', new Set(['title', 'title-2'])), 'title-3');
    });
});

describe('where a paste lands', () => {
    it('on the page it was copied from 16px further for each paste, elsewhere where it was first', () => {
        const clip = { page: 'index.html', items: [], pasted: {}, overridesDir: 'draw2code' };
        assert.equal(C.pasteOffset(clip, 'index.html'), 16);
        assert.equal(C.pasteOffset(clip, 'pages/about.html'), 0);
        clip.pasted = { 'index.html': 1, 'pages/about.html': 2 };
        assert.equal(C.pasteOffset(clip, 'index.html'), 32);
        assert.equal(C.pasteOffset(clip, 'pages/about.html'), 32);
    });

    it('keeps its place in the wrapper between pages with one, and its place on the page otherwise', () => {
        const box = { x: 10.4, y: 20, w: 100, h: 50 };
        assert.deepEqual(C.pastedAt(box, { x: 240, y: 0 }, { x: 0, y: 0 }, 16), { x: 26, y: 36 });
        assert.deepEqual(C.pastedAt(box, { x: 240, y: 0 }, undefined, 0), { x: 250, y: 20 });
        assert.deepEqual(C.pastedAt(box, undefined, { x: 240, y: 8 }, 0), { x: -230, y: 12 });
        assert.deepEqual(C.pastedAt(box, undefined, undefined, 0), { x: 10, y: 20 });
    });
});

describe('placedRule: a copy\'s own rule', () => {
    const item = { box: { x: 0, y: 0, w: 130, h: 45 }, full: false, inWrapper: true, tag: 'button' };

    it('is placed freely where it lands, keeping the size its rule gives', () => {
        const out = C.placedRule({ left: '1px', top: '2px', width: '120px', height: '40px', color: 'red' }, item, { x: 26, y: 36 }, true);
        assert.deepEqual(out, { left: '26px', top: '36px', width: '120px', height: '40px', color: 'red', position: 'absolute' });
    });

    it('full width, keeps its left; with no size of its own, takes the size it was shown at', () => {
        const full = C.placedRule({ left: '10px', top: '2px', width: '120px', height: '40px' }, { ...item, full: true }, { x: 99, y: 36 }, true);
        assert.equal(full.left, '10px');
        const flow = C.placedRule({ color: 'red' }, { ...item, inWrapper: false, tag: 'p' }, { x: 5, y: 6 }, false);
        assert.deepEqual(flow, { color: 'red', position: 'absolute', top: '6px', left: '5px', width: '130px', height: '45px', 'box-sizing': 'border-box' });
    });

    it('out of a wrapper onto a page without one, takes the generator\'s rules for the wrapper\'s children', () => {
        const css = H.generateSite({ version: 2, pages: [{ name: 'index.html', color: '#ffffff', elements: [] }] }).css;
        const rules = C.cssRules(css);
        const ruleOf = (selector) => rules.find((r) => r.selectors.includes(selector)).declarations;
        const { position, ...children } = ruleOf('.page > *');
        assert.equal(position, 'absolute');
        assert.deepEqual(C.WRAPPER_RULES['*'], children);
        assert.deepEqual(C.WRAPPER_RULES.svg, ruleOf('.page > svg'));
        assert.deepEqual(C.WRAPPER_RULES.button, ruleOf('.page > button'));
        const out = C.placedRule({ width: '120px', height: '40px' }, item, { x: 0, y: 0 }, false);
        assert.equal(out.cursor, 'pointer');
        assert.equal(out['white-space'], 'nowrap');
        assert.equal(out.padding, '0');
    });
});

describe('copyElement: an element read from its page', () => {
    const PAGE = `<!DOCTYPE html>
<html>
<head><style>#card { color: navy }</style></head>
<body>
    <div id="card" data-d2c="4"><h2 data-d2c="5">Hi</h2><a href="#card">top</a><svg id="rect-1" data-d2c-drawn="10 10"><rect/></svg><p data-d2c="6">x</p></div>
    <table><tr><td id="cell">1</td></tr></table>
</body>
</html>
`;

    it('notes its names, what goes, its addresses, and keeps its bytes', () => {
        const copied = P.copyElement(PAGE, { id: 'card' }, (selector) => selector === '[data-d2c="5"]');
        assert.equal(copied.markup.startsWith('<div id="card" data-d2c="4">') && copied.markup.endsWith('</div>'), true);
        const at = (span) => copied.markup.slice(span.from, span.to);
        assert.deepEqual(copied.names.map((name) => [name.base, at(name.at), name.selectors]), [
            ['card', 'id="card"', ['#card', '[data-d2c="4"]']],
            ['h2-1', 'data-d2c="5"', ['[data-d2c="5"]']],
            ['rect-1', 'id="rect-1"', ['#rect-1']],
        ]);
        // The id's marker, a marker no rule needs, and the drawn size go, each with its space.
        assert.deepEqual(copied.drop.map(at), [' data-d2c="4"', ' data-d2c-drawn="10 10"', ' data-d2c="6"']);
        assert.deepEqual(copied.addresses.map((a) => [a.name, a.value, a.section]), [['href', '#card', true]]);
        assert.equal(copied.inWrapper, false);
    });

    it('an element without a name is given one where its attributes end', () => {
        const copied = P.copyElement(PAGE, { path: [1] }, () => false);
        assert.equal(copied.problem, undefined);
        assert.deepEqual(copied.names.map((name) => [name.base, name.at.from === name.at.to]), [['table-1', true], ['cell', false]]);
        assert.equal(copied.markup.slice(0, copied.names[0].at.from), '<table');
    });

    it('a table cell, or the page itself, is not copied on its own', () => {
        assert.match(P.copyElement(PAGE, { id: 'cell' }, () => false).problem, /table/);
        assert.match(P.copyElement(PAGE, { path: [] }, () => false).problem, /gone|no longer|itself/);
    });

    it('pageStyles and bodyClasses read the page\'s own styles and its scope', () => {
        assert.deepEqual(P.pageStyles(PAGE), [{ css: '#card { color: navy }' }]);
        const page = H.generateProject(DESIGN).pages[1].html;
        assert.deepEqual(P.pageStyles(page), [{ href: '../css/style.css' }]);
        assert.deepEqual(P.bodyClasses(page), ['page-pages-about']);
    });
});

describe('copy and paste on pages made in Draw2Code', () => {
    // As the overlay measures them: in the wrapper, which starts 240px in.
    const WRAPPER = { x: 240, y: 0 };
    const RECT = { ref: { id: 'rect-3' }, box: { x: 10, y: 20, w: 100, h: 50 } };
    const INPUT = { ref: { id: 'input-1' }, box: { x: 200, y: 40, w: 160, h: 32 } };
    const IMAGE = { ref: { id: 'image-1' }, box: { x: 400, y: 100, w: 120, h: 90 } };

    it('a copy takes its first look from the shared stylesheet and Draw2Code\'s own rules on top', () => {
        const work = makeProject();
        E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'rect-3' }, declarations: { left: '30px' }, childDeclarations: { fill: '#ff0000' } });
        const clip = copy(work, 'index.html', [RECT], WRAPPER);
        assert.deepEqual(clip.items[0].rules, [{ '': { left: '30px', top: '20px', width: '100px', height: '50px' }, ' > *': { fill: '#ff0000' } }]);
        fs.rmSync(work, { recursive: true, force: true });
    });

    it('pasted on another page: fresh ids, the same places to each other, its rules and its picture', () => {
        const work = makeProject();
        const clip = copy(work, 'index.html', [RECT, INPUT, IMAGE], WRAPPER);
        const { pasted, result } = paste(work, clip, 'pages/about.html', C.pasteOffset(clip, 'pages/about.html'), WRAPPER);
        assert.equal(result.error, undefined);
        assert.deepEqual(pasted.map((one) => one.id), ['rect-1', 'input-1', 'image-1']);
        const html = fs.readFileSync(path.join(work, 'pages', 'about.html'), 'utf8');
        // In the wrapper, in the page's order, the picture's address written from pages/.
        assert.match(html, /<div class="page">\n\n {4}<svg id="rect-1"[^>]*>.*<\/svg>\n {4}<input id="input-1"[^>]*>\n {4}<img id="image-1" src="\.\.\/assets\/cat\.png"[^>]*>\n {2}<\/div>/);
        const css = fs.readFileSync(path.join(work, 'draw2code', 'pages', 'about.css'), 'utf8');
        assert.match(css, /#rect-1 \{\n {2}left: 10px;\n {2}top: 20px;\n {2}width: 100px;\n {2}height: 50px;\n {2}position: absolute;\n\}/);
        assert.match(css, /#input-1::placeholder \{\n {2}color: #[0-9a-f]{6};\n {2}opacity: 1;\n\}/);
        assert.match(css, /#image-1 \{[^}]*left: 400px;[^}]*object-fit: contain;/);
        fs.rmSync(work, { recursive: true, force: true });
    });

    it('pasted on its own page twice: rect-1 and rect-2 beside rect-3, each 16px further', () => {
        const work = makeProject();
        const clip = copy(work, 'index.html', [RECT], WRAPPER);
        const first = paste(work, clip, 'index.html', C.pasteOffset(clip, 'index.html'), WRAPPER);
        clip.pasted['index.html'] = 1;
        const second = paste(work, clip, 'index.html', C.pasteOffset(clip, 'index.html'), WRAPPER);
        assert.deepEqual([first.pasted[0].id, second.pasted[0].id], ['rect-1', 'rect-2']);
        assert.deepEqual([first.pasted[0].declarations.left, second.pasted[0].declarations.top], ['26px', '52px']);
        // The drawing is still one Draw2Code drew: a resize draws it again.
        const html = fs.readFileSync(path.join(work, 'index.html'), 'utf8');
        assert.equal(P.redrawShape(html, { id: 'rect-2' }, { width: '50px' }).changed, true);
        fs.rmSync(work, { recursive: true, force: true });
    });

    it('a link to a section of the page it came from still goes there from another page', () => {
        const work = makeProject();
        const index = path.join(work, 'index.html');
        fs.writeFileSync(index, P.appendToPage(fs.readFileSync(index, 'utf8'), '<a id="label-1" href="#rect-3">Up</a>').html);
        const clip = copy(work, 'index.html', [{ ref: { id: 'label-1' }, box: { x: 0, y: 0, w: 40, h: 20 } }], WRAPPER);
        assert.match(C.pasteElements(clip, { page: 'pages/about.html', taken: new Set(), inWrapper: true, overridesDir: 'draw2code/pages' }, 0)[0].markup, /href="\.\.\/index\.html#rect-3"/);
        assert.match(C.pasteElements(clip, { page: 'index.html', taken: new Set(['label-1']), inWrapper: true, overridesDir: 'draw2code' }, 16)[0].markup, /<a id="label-2" href="#rect-3">/);
        fs.rmSync(work, { recursive: true, force: true });
    });
});

describe('a paste kept in the page\'s column', () => {
    const item = (x, w, full = false) => ({ box: { x, y: 0, w, h: 40 }, full });
    const at = (x) => ({ x, y: 10 });

    it('lands where it is put while it is inside, and with no column measured', () => {
        assert.deepEqual(C.pastedInColumn([item(100, 200)], [at(116)], 1440), [{ x: 116, y: 10 }]);
        assert.deepEqual(C.pastedInColumn([item(1400, 200)], [at(1416)], undefined), [{ x: 1416, y: 10 }]);
    });

    it('past a side, is moved in, several together so they keep their places to each other', () => {
        assert.deepEqual(C.pastedInColumn([item(1300, 140)], [at(1316)], 1440), [{ x: 1300, y: 10 }]);
        assert.deepEqual(C.pastedInColumn([item(1200, 100), item(1320, 100)], [at(1236), at(1356)], 1440), [{ x: 1220, y: 10 }, { x: 1340, y: 10 }]);
        assert.deepEqual(C.pastedInColumn([item(-30, 100)], [at(-30)], 1440), [{ x: 0, y: 10 }]);
    });

    it('wider than the column, is made as wide as it; a full-width one is left as it is', () => {
        assert.deepEqual(C.pastedInColumn([item(-50, 1600)], [at(-34)], 1440), [{ x: 0, y: 10, w: 1440 }]);
        assert.deepEqual(C.pastedInColumn([item(-80, 1600, true), item(1400, 100)], [at(-64), at(1416)], 1440), [{ x: -64, y: 10 }, { x: 1340, y: 10 }]);
    });

    it('Ctrl+D at the right side: the copy stays in, 16px down, its drawing drawn again when it is narrower', () => {
        const work = makeProject();
        // rect-3 moved to the right side, and made wider than a page that was then made narrower.
        E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'rect-3' }, declarations: { left: '1340px', width: '100px' } });
        const wrapper = { x: 240, y: 0, width: 1440 };
        const right = copy(work, 'index.html', [{ ref: { id: 'rect-3' }, box: { x: 1340, y: 20, w: 100, h: 50 } }], wrapper);
        const { pasted } = paste(work, right, 'index.html', C.PASTE_STEP, wrapper);
        assert.deepEqual([pasted[0].declarations.left, pasted[0].declarations.top, pasted[0].narrowed], ['1340px', '36px', false]);
        const wide = copy(work, 'index.html', [{ ref: { id: 'image-1' }, box: { x: 400, y: 100, w: 1600, h: 90 } }, RECT_BOX], wrapper);
        const done = paste(work, wide, 'pages/about.html', 0, { ...wrapper, width: 1200 });
        assert.equal(done.result.error, undefined);
        assert.deepEqual([done.pasted[0].declarations.left, done.pasted[0].declarations.width, done.pasted[0].narrowed], ['0px', '1200px', true]);
        assert.deepEqual([done.pasted[1].declarations.left, done.pasted[1].narrowed], ['10px', false]);
        // A drawing made narrower is drawn again at the column's width, as a resize draws it.
        const svg = copy(work, 'index.html', [{ ref: { id: 'rect-3' }, box: { x: 0, y: 20, w: 1600, h: 50 } }], wrapper);
        const drawn = paste(work, svg, 'pages/about.html', 0, { ...wrapper, width: 1200 });
        assert.equal(drawn.result.error, undefined);
        const html = fs.readFileSync(path.join(work, 'pages', 'about.html'), 'utf8');
        assert.match(html, new RegExp(`<svg id="${drawn.pasted[0].id}"[^>]* width="1200" height="50" viewBox="0 0 1200 50"`));
        fs.rmSync(work, { recursive: true, force: true });
    });
});

describe('a full-width element pasted', () => {
    it('onto a page with no wrapper is placed and sized as it was shown, and is no longer full width', () => {
        const work = makeProject();
        assert.equal(E.applyEdit(work, 'index.html', { op: 'fullWidth', ref: { id: 'rect-3' }, full: true }).error, undefined);
        // Shown across a 1600px window, the page's 1440px wrapper starting 80px in.
        const wrapper = { x: 80, y: 0 };
        const clip = copy(work, 'index.html', [
            { ref: { id: 'rect-3' }, box: { x: -80, y: 20, w: 1600, h: 50 }, full: true },
            { ref: { id: 'input-1' }, box: { x: 200, y: 40, w: 160, h: 32 } },
        ], wrapper);
        assert.match(clip.items[0].markup, /class="full-width"/);
        fs.writeFileSync(path.join(work, 'plain.html'), '<!DOCTYPE html>\n<html><head><title>Plain</title></head><body><p>Hi</p></body></html>\n');
        const { pasted, result } = paste(work, clip, 'plain.html', 0, undefined);
        assert.equal(result.error, undefined);
        const [background, field] = pasted;
        // As far left of the field as it was: both moved by the wrapper's 80px.
        assert.equal(background.declarations.left, '0px');
        assert.equal(background.declarations.width, '1600px');
        assert.equal(background.declarations.top, '20px');
        assert.equal(field.declarations.left, '280px');
        assert.doesNotMatch(background.markup, /full-width|class=/);
        // Onto a page with a wrapper it stays full width, its own left kept.
        const again = C.pasteElements(clip, { page: 'pages/about.html', taken: new Set(), inWrapper: true, wrapper, overridesDir: 'draw2code/pages' }, 0)[0];
        assert.match(again.markup, /class="full-width"/);
        assert.equal(again.declarations.left, '10px');
        assert.equal(again.declarations.width, '100px');
        fs.rmSync(work, { recursive: true, force: true });
    });

    it('withoutClass takes one class off the outermost element only, keeping the others as written', () => {
        assert.equal(C.withoutClass('<svg id="a" class="full-width"><g class="full-width"/></svg>', 'full-width'), '<svg id="a"><g class="full-width"/></svg>');
        assert.equal(C.withoutClass('<div class=\'hero full-width x&amp;y\' id="b">', 'full-width'), '<div class=\'hero x&amp;y\' id="b">');
        assert.equal(C.withoutClass('<div title="class=full-width" class=full-width>', 'full-width'), '<div title="class=full-width">');
        assert.equal(C.withoutClass('<p class="lead">Hi</p>', 'full-width'), '<p class="lead">Hi</p>');
        assert.equal(C.withoutClass('<p>Hi</p>', 'full-width'), '<p>Hi</p>');
    });
});

describe('applyEdit: several edits as one (batch)', () => {
    const PAGE = '<!DOCTYPE html>\n<html>\n<head></head>\n<body>\n    <p>one</p>\n    <p>two</p>\n    <p>three</p>\n</body>\n</html>\n';
    const site = () => {
        const work = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-batch-'));
        fs.writeFileSync(path.join(work, 'index.html'), PAGE);
        return work;
    };

    it('removes several by their places, named last in the page first', () => {
        const work = site();
        const result = E.applyEdit(work, 'index.html', { op: 'batch', ref: {}, ops: [{ op: 'remove', ref: { path: [2] } }, { op: 'remove', ref: { path: [0] } }] });
        assert.equal(result.error, undefined);
        assert.equal(fs.readFileSync(path.join(work, 'index.html'), 'utf8'), PAGE.replace('    <p>one</p>\n', '').replace('    <p>three</p>\n', ''));
        fs.rmSync(work, { recursive: true, force: true });
    });

    it('moves several in one edit', () => {
        const work = site();
        E.applyEdit(work, 'index.html', { op: 'batch', ref: {}, ops: [
            { op: 'style', ref: { path: [0] }, declarations: { position: 'relative', left: '5px' } },
            { op: 'style', ref: { path: [1] }, declarations: { position: 'relative', left: '5px' } },
        ] });
        assert.deepEqual(Object.keys(E.readOverrides(work)['index.html']), ['[data-d2c="1"]', '[data-d2c="2"]']);
        fs.rmSync(work, { recursive: true, force: true });
    });

    it('one refused leaves the page as it was, and a batch holds only edits of elements', () => {
        const work = site();
        const result = E.applyEdit(work, 'index.html', { op: 'batch', ref: {}, ops: [{ op: 'remove', ref: { path: [0] } }, { op: 'remove', ref: { path: [7] } }] });
        assert.match(result.error, /no longer/);
        assert.equal(fs.readFileSync(path.join(work, 'index.html'), 'utf8'), PAGE);
        assert.match(E.applyEdit(work, 'index.html', { op: 'batch', ref: {}, ops: [{ op: 'revertPage', ref: {} }] }).error, /cannot be one of several/);
        assert.deepEqual(E.applyEdit(work, 'index.html', { op: 'batch', ref: {}, ops: [] }), { changed: [], selector: undefined });
        assert.deepEqual(E.BATCH_LABELS, ['Move elements', 'Remove elements', 'Revert elements', 'Paste', 'Duplicate']);
        fs.rmSync(work, { recursive: true, force: true });
    });
});
