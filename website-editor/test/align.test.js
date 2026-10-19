// Unit tests for bold and alignment in the page editor: src/align.ts, and
// the style edits they write going through undo, Revert element and Publish
// (compiled to out/ by npm test's pretest).
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
const A = require('../../out/website-editor/src/align.js');
const E = require('../../out/website-editor/src/pageEditor.js');
const P = { ...require('../../out/src/projectFormat.js'), ...require('../../out/website-editor/src/siteProject.js'), ...require('../../out/src/publish.js') };
const M = require('../media/model.js');
const H = require('../media/generators/html.js');

describe('alignDeclarations: the words move whatever kind of box they are in', () => {
    it('block text (a <p>, an <h1>, a <button>) gets text-align alone', () => {
        assert.deepEqual(A.alignDeclarations('block', 'right'), { 'text-align': 'right' });
        assert.deepEqual(A.alignDeclarations('inline-block', 'center'), { 'text-align': 'center' });
    });

    it('a flex box (a label, a button made a link) gets justify-content and text-align', () => {
        assert.deepEqual(A.alignDeclarations('flex', 'left'), { 'justify-content': 'flex-start', 'text-align': 'left' });
        assert.deepEqual(A.alignDeclarations('flex', 'center'), { 'justify-content': 'center', 'text-align': 'center' });
        assert.deepEqual(A.alignDeclarations('inline-flex', 'right'), { 'justify-content': 'flex-end', 'text-align': 'right' });
    });
});

describe('alignOf: the button that shows as on', () => {
    it('reads block text by its text-align, "start" being left', () => {
        assert.equal(A.alignOf('block', 'start', 'normal'), 'left');
        assert.equal(A.alignOf('block', 'center', 'normal'), 'center');
        assert.equal(A.alignOf('block', 'end', 'normal'), 'right');
        assert.equal(A.alignOf('block', '-webkit-center', 'normal'), 'center');
    });

    it('reads a flex box by its justify-content, not its text-align', () => {
        assert.equal(A.alignOf('flex', 'start', 'normal'), 'left');
        assert.equal(A.alignOf('inline-flex', 'start', 'center'), 'center');
        assert.equal(A.alignOf('flex', 'left', 'flex-end'), 'right');
    });

    it('reads a flex box that runs top to bottom or backwards as a block', () => {
        assert.equal(A.boxOf('flex', 'row'), 'flex');
        assert.equal(A.boxOf('block', 'row'), 'block');
        assert.equal(A.boxOf('flex', 'column'), 'block');
        assert.equal(A.boxOf('inline-flex', 'row-reverse'), 'block');
        assert.deepEqual(A.alignDeclarations(A.boxOf('flex', 'column'), 'center'), { 'text-align': 'center' });
        assert.equal(A.alignOf(A.boxOf('flex', 'column'), 'center', 'normal'), 'center');
    });

    it('shows none for anything the buttons do not write', () => {
        assert.equal(A.alignOf('block', 'justify', 'normal'), undefined);
        assert.equal(A.alignOf('flex', 'start', 'space-between'), undefined);
    });

    it('reads back what each button writes', () => {
        for (const display of ['block', 'flex']) {
            for (const align of ['left', 'center', 'right']) {
                const d = A.alignDeclarations(display, align);
                assert.equal(A.alignOf(display, d['text-align'], d['justify-content'] ?? 'normal'), align, `${display} ${align}`);
            }
        }
    });
});

describe('bold and alignment are style edits like any other', () => {
    const setup = () => {
        const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-align-')), 'Shop');
        fs.mkdirSync(root);
        const home = { ...M.makePage('index.html'), elements: [M.createElement(1, 'label', { x: 10, y: 20, w: 120, h: 30 }, M.WIDGET_DEFAULTS.label)] };
        P.writeProject(root, 'Shop', M.makeDesign([home], 'index.html'), H, '0.9.0');
        const dev = path.join(root, 'Shop-dev');
        fs.writeFileSync(path.join(dev, 'index.html'), fs.readFileSync(path.join(dev, 'index.html'), 'utf8').replace('<div class="page">', '<div class="page"><p>no id here</p>'));
        return { root, dev };
    };
    const css = (dev) => fs.readFileSync(path.join(dev, E.cssPathFor('index.html')), 'utf8');

    it('undo takes a click back, redo puts it back, and Revert element takes them all', () => {
        const { dev } = setup();
        const before = E.snapshotPage(dev, 'index.html');
        assert.equal(E.applyEdit(dev, 'index.html', { op: 'style', ref: { id: 'label-1' }, declarations: A.alignDeclarations('flex', 'right') }).error, undefined);
        assert.match(css(dev), /#label-1 \{\n  justify-content: flex-end;\n  text-align: right;\n\}/);
        const after = E.snapshotPage(dev, 'index.html');
        E.restorePage(dev, before);
        assert.doesNotMatch(css(dev), /justify-content/);
        E.restorePage(dev, after);
        assert.match(css(dev), /justify-content: flex-end/, 'redo puts it back');
        E.restorePage(dev, before);
        E.applyEdit(dev, 'index.html', { op: 'style', ref: { id: 'label-1' }, declarations: { 'font-weight': 'bold' } });
        E.applyEdit(dev, 'index.html', { op: 'style', ref: { id: 'label-1' }, declarations: A.alignDeclarations('flex', 'center') });
        E.applyEdit(dev, 'index.html', { op: 'revert', ref: { id: 'label-1' } });
        assert.doesNotMatch(css(dev), /font-weight|text-align/);
    });

    it('Publish moves them into -prod\'s stylesheet, scoped to the page', () => {
        const { root, dev } = setup();
        E.applyEdit(dev, 'index.html', { op: 'style', ref: { id: 'label-1' }, declarations: A.alignDeclarations('flex', 'center') });
        E.applyEdit(dev, 'index.html', { op: 'style', ref: { path: [0, 0] }, declarations: { 'font-weight': 'bold' } });
        E.applyEdit(dev, 'index.html', { op: 'style', ref: { path: [0, 0] }, declarations: A.alignDeclarations('block', 'right') });
        P.buildProd(root);
        const prod = path.join(root, 'Shop-prod');
        const out = fs.readFileSync(path.join(prod, 'css', 'style.css'), 'utf8');
        assert.match(out, /\.page-index #label-1 \{\n  justify-content: center;\n  text-align: center;\n\}/);
        const id = /<p id="([^"]+)">no id here<\/p>/.exec(fs.readFileSync(path.join(prod, 'index.html'), 'utf8'))[1];
        assert.match(out, new RegExp(`\\.page-index #${id} \\{\\n  font-weight: bold;\\n  text-align: right;\\n\\}`));
        assert.equal(fs.existsSync(path.join(prod, 'draw2code')), false, 'no Draw2Code stylesheet is published');
    });
});
