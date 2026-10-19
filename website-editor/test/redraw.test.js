// Unit tests for resizing a drawn shape in the page editor: src/redraw.ts,
// the splices in src/pageEdit.ts, and the style edit going through Revert
// element, Revert page, undo and Publish (compiled to out/ by npm test's
// pretest).
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
const R = require('../../out/website-editor/src/redraw.js');
const Edit = require('../../out/website-editor/src/pageEdit.js');
const E = require('../../out/website-editor/src/pageEditor.js');
const P = { ...require('../../out/src/projectFormat.js'), ...require('../../out/website-editor/src/siteProject.js'), ...require('../../out/src/publish.js') };
const M = require('../media/model.js');
const H = require('../media/generators/html.js');

const STYLE = { ...M.DEFAULT_STYLE, strokeWidth: 6 };

/** One of each drawing, drawn at 160 x 80 at 10, 20. */
function shapes() {
    const box = { x: 10, y: 20, w: 160, h: 80 };
    return [
        M.createElement(1, 'rect', box, STYLE),
        M.createElement(1, 'ellipse', box, STYLE),
        M.createElement(1, 'line', box, STYLE),
        { ...M.createElement(2, 'line', box, STYLE), flip: true },
        M.createPen(1, [[10, 20], [50, 100], [90, 60], [170, 20]], STYLE),
    ];
}

/** What the generator writes for `el` drawn at w x h. */
const drawnAt = (el, w, h) => H.renderElement({ ...el, w, h }).html;

/** An element's attributes as written in markup: '<rect x="0" ...>' -> { x: '0', ... }. */
function attrsOf(markup, tag) {
    const start = new RegExp(`<${tag}\\b([^>]*?)/?>`).exec(markup);
    return start ? Object.fromEntries([...start[1].matchAll(/([\w:-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]])) : null;
}

const SHAPE_TAG = { rect: 'rect', ellipse: 'ellipse', line: 'line', pen: 'polyline' };

describe('drawnShape: which <svg>s are drawings Draw2Code drew', () => {
    it('knows each kind by its id and the one shape inside', () => {
        assert.equal(R.drawnShape('rect-1', ['rect']), 'rect');
        assert.equal(R.drawnShape('ellipse-12', ['ellipse']), 'ellipse');
        assert.equal(R.drawnShape('line-3', ['line']), 'line');
        assert.equal(R.drawnShape('pen-2', ['polyline']), 'polyline');
    });

    it('leaves a site\'s own svg alone: another id, another shape, or more than one', () => {
        assert.equal(R.drawnShape('logo', ['rect']), undefined);
        assert.equal(R.drawnShape('', ['rect']), undefined);
        assert.equal(R.drawnShape('rect-1', ['path']), undefined);
        assert.equal(R.drawnShape('rect-1', ['rect', 'rect']), undefined);
        assert.equal(R.drawnShape('pen-1', ['path']), undefined);
        assert.equal(R.drawnShape('my-rect-1', ['rect']), undefined);
    });
});

describe('redrawn: a drawing at a new size is what the generator draws at that size', () => {
    for (const el of shapes()) {
        it(`${el.type}${el.flip ? ' (flipped)' : ''}`, () => {
            const before = drawnAt(el, 160, 80);
            const tag = SHAPE_TAG[el.type];
            for (const [w, h] of [[300, 50], [40, 200], [160, 80], [0, 30]]) {
                const next = R.redrawn(tag, attrsOf(before, tag), attrsOf(before, 'svg').viewBox, w, h);
                const after = drawnAt(el, w, h);
                const svg = attrsOf(after, 'svg');
                assert.deepEqual(next.svg, { width: svg.width, height: svg.height, viewBox: svg.viewBox }, `${w} x ${h}`);
                const shape = attrsOf(after, tag);
                for (const [name, value] of Object.entries(next.shape)) assert.equal(value, shape[name], `${tag} ${name} at ${w} x ${h}`);
                // The border is not scaled: the redraw never touches it.
                assert.equal(next.shape['stroke-width'], undefined);
                assert.equal(shape['stroke-width'], '6');
            }
        });
    }

    it('a line drawn straight (0 tall) runs corner to corner once it has a height, as on the canvas', () => {
        const next = R.redrawn('line', { x1: '0', y1: '0', x2: '120', y2: '0' }, '0 0 120 0', 120, 40);
        assert.deepEqual(next.shape, { x1: '0', y1: '0', x2: '120', y2: '40' });
    });

    it('rounds to 2 decimals and never goes below 0', () => {
        const next = R.redrawn('ellipse', {}, '0 0 10 10', 33.333, -5);
        assert.deepEqual(next.svg, { width: '33.33', height: '0', viewBox: '0 0 33.33 0' });
        assert.deepEqual(next.shape, { cx: '16.67', cy: '0', rx: '16.67', ry: '0' });
    });

    it('an unreadable pen stroke or viewBox gives points at 0, not NaN', () => {
        const next = R.redrawn('polyline', { points: '1,2 x,4' }, 'nonsense', 50, 50);
        assert.equal(next.shape.points, '0,0 0,0');
    });
});

describe('redrawShape and restoreDrawings: only the numbers in the tags change', () => {
    const page = (markup) => `<!DOCTYPE html>\n<html>\n<body>\n  <div class="page">\n    ${markup}\n    <svg id="logo" width="24" height="24" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20"/></svg>\n  </div>\n</body>\n</html>\n`;

    for (const el of shapes()) {
        it(`${el.type}${el.flip ? ' (flipped)' : ''}: drawn again, then back at its own size`, () => {
            const html = page(drawnAt(el, 160, 80));
            const id = H.elementParts(el).id;
            const out = Edit.redrawShape(html, { id }, { width: '300px', height: '50px' });
            assert.equal(out.changed, true);
            const resized = drawnAt(el, 300, 50).replace(/viewBox="[^"]*"/, '$& data-d2c-drawn="160 80"');
            assert.equal(out.html, page(resized), 'the same as the generator at 300 x 50, and the size it was drawn at written on it');
            // A second resize keeps the size it was drawn at.
            const again = Edit.redrawShape(out.html, { id }, { width: '200px' });
            assert.match(again.html, /data-d2c-drawn="160 80"/);
            assert.equal(attrsOf(again.html, 'svg').width, '200');
            assert.equal(attrsOf(again.html, 'svg').height, '50', 'a height not given stays as the svg has it');
            assert.equal(Edit.restoreDrawings(again.html, { id }).html, html, 'Revert element draws it as it was drawn');
            assert.equal(Edit.restoreDrawings(again.html).html, html, 'and so does Revert page');
        });
    }

    it('leaves a site\'s own svg, a size that is not px and an element that is not a drawing alone', () => {
        const html = page(drawnAt(shapes()[0], 160, 80));
        assert.equal(Edit.redrawShape(html, { id: 'logo' }, { width: '300px', height: '50px' }).changed, false);
        assert.equal(Edit.redrawShape(html, { id: 'rect-1' }, { width: '50%' }).changed, false);
        assert.equal(Edit.redrawShape(html, { id: 'rect-1' }, { width: '' }).changed, false);
        assert.equal(Edit.redrawShape(html, { id: 'rect-1' }, { left: '30px' }).changed, false);
        assert.equal(Edit.redrawShape(html, { path: [0] }, { width: '300px' }).changed, false);
        assert.equal(Edit.redrawShape(html, { id: 'nothing' }, { width: '300px' }).changed, false);
        assert.equal(Edit.restoreDrawings(html).changed, false, 'nothing was resized');
    });

    it('a drawing written without a viewBox or a size (an older page) is drawn with one and does not throw', () => {
        const html = page('<svg id="rect-1"><rect/></svg>');
        const out = Edit.redrawShape(html, { id: 'rect-1' }, { width: '30px', height: '20px' });
        assert.match(out.html, /<svg id="rect-1" width="30" height="20" viewBox="0 0 30 20" data-d2c-drawn=" "><rect x="0" y="0" width="30" height="20"\/><\/svg>/);
        const back = Edit.restoreDrawings(out.html);
        assert.doesNotMatch(back.html, /data-d2c-drawn/, 'a size it never had is forgotten, not drawn');
    });
});

describe('a resize in the page editor writes a rule and a drawing that agree', () => {
    const setup = () => {
        const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-redraw-')), 'Shop');
        fs.mkdirSync(root);
        const home = { ...M.makePage('index.html'), elements: shapes() };
        P.writeProject(root, 'Shop', M.makeDesign([home], 'index.html'), H, '0.9.0');
        return { root, dev: path.join(root, 'Shop-dev') };
    };
    const read = (dev, file) => fs.readFileSync(path.join(dev, file), 'utf8');
    const svgOf = (html, id) => new RegExp(`<svg id="${id}"[^>]*>.*?</svg>`).exec(html)[0];

    it('the svg\'s size and viewBox and the shape follow the rule\'s width and height; colour and corners stay', () => {
        const { dev } = setup();
        E.applyEdit(dev, 'index.html', { op: 'style', ref: { id: 'rect-1' }, childDeclarations: { rx: '12px', ry: '12px' } });
        assert.equal(E.applyEdit(dev, 'index.html', { op: 'style', ref: { id: 'rect-1' }, declarations: { width: '300px', height: '40px' } }).error, undefined);
        assert.match(read(dev, E.cssPathFor('index.html')), /#rect-1 \{\n  width: 300px;\n  height: 40px;\n\}/);
        assert.match(read(dev, E.cssPathFor('index.html')), /#rect-1 > \* \{\n  rx: 12px;\n  ry: 12px;\n\}/, 'the corners are in px, as before');
        assert.equal(svgOf(read(dev, 'index.html'), 'rect-1'),
            '<svg id="rect-1" width="300" height="40" viewBox="0 0 300 40" data-d2c-drawn="160 80"><rect x="0" y="0" width="300" height="40" fill="#3b82f6" stroke="#f59e0b" stroke-width="6"/></svg>');
        // Moving it is not a resize: the drawing stays as it is.
        const before = read(dev, 'index.html');
        E.applyEdit(dev, 'index.html', { op: 'style', ref: { id: 'rect-1' }, declarations: { left: '40px', top: '60px' } });
        assert.equal(read(dev, 'index.html'), before);
    });

    it('undo, Revert element and Revert page give back the drawing with the rules', () => {
        const { dev } = setup();
        const original = read(dev, 'index.html');
        const before = E.snapshotPage(dev, 'index.html');
        E.applyEdit(dev, 'index.html', { op: 'style', ref: { id: 'pen-1' }, declarations: { width: '80px', height: '160px' } });
        assert.match(svgOf(read(dev, 'index.html'), 'pen-1'), /viewBox="0 0 80 160"/);
        E.restorePage(dev, before);
        assert.equal(read(dev, 'index.html'), original, 'undo');

        E.applyEdit(dev, 'index.html', { op: 'style', ref: { id: 'pen-1' }, declarations: { width: '80px', height: '160px' } });
        E.applyEdit(dev, 'index.html', { op: 'style', ref: { id: 'ellipse-1' }, declarations: { width: '20px', height: '20px' } });
        E.applyEdit(dev, 'index.html', { op: 'revert', ref: { id: 'pen-1' } });
        assert.equal(svgOf(read(dev, 'index.html'), 'pen-1'), svgOf(original, 'pen-1'), 'Revert element');
        assert.match(svgOf(read(dev, 'index.html'), 'ellipse-1'), /viewBox="0 0 20 20"/, 'another drawing keeps its resize');
        const result = E.applyEdit(dev, 'index.html', { op: 'revertPage', ref: {} });
        assert.ok(result.changed.includes(path.join(dev, 'index.html')));
        // The page keeps its link to the (now empty) Draw2Code stylesheet, as after any Revert page.
        assert.equal(read(dev, 'index.html').replace(/ *<link rel="stylesheet" href="draw2code\/index.css">\n/, ''), original, 'Revert page');
    });

    it('Publish keeps the new size and leaves out the size it was drawn at', () => {
        const { root, dev } = setup();
        E.applyEdit(dev, 'index.html', { op: 'style', ref: { id: 'line-2' }, declarations: { width: '100px', height: '30px' } });
        P.buildProd(root);
        const prod = fs.readFileSync(path.join(root, 'Shop-prod', 'index.html'), 'utf8');
        assert.equal(svgOf(prod, 'line-2'), '<svg id="line-2" width="100" height="30" viewBox="0 0 100 30"><line x1="0" y1="30" x2="100" y2="0" stroke="#f59e0b" stroke-width="6" stroke-linecap="round"/></svg>');
        assert.match(fs.readFileSync(path.join(root, 'Shop-prod', 'css', 'style.css'), 'utf8'), /\.page-index #line-2 \{\n  width: 100px;\n  height: 30px;\n\}/);
    });
});
