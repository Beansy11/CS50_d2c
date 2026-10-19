// Unit tests for src/history.ts and the snapshot/restore pair in src/pageEditor.ts.
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
const fs = require('fs');
const os = require('os');
const path = require('path');
const H = require('../../out/website-editor/src/history.js');
const E = require('../../out/website-editor/src/pageEditor.js');

const snap = (n) => ({ page: 'index.html', html: `<p>${n}</p>`, overrides: {} });

describe('history', () => {
    it('undo goes back through what was recorded, keeping the present for redo', () => {
        const site = 'C:/site-a-dev';
        H.forget(site);
        assert.equal(H.canUndo(site), false);
        H.record(site, snap(1));
        H.record(site, snap(2));
        assert.equal(H.undo(site, snap(3)).html, '<p>2</p>');
        assert.equal(H.canRedo(site), true);
        assert.equal(H.redo(site, snap(2)).html, '<p>3</p>');
        assert.equal(H.undo(site, snap(3)).html, '<p>2</p>');
        assert.equal(H.undo(site, snap(2)).html, '<p>1</p>');
        assert.equal(H.undo(site, snap(1)), undefined, 'nothing further back');
    });

    it('peek shows the page the next step changes, without taking it', () => {
        const site = 'C:/site-peek-dev';
        H.forget(site);
        assert.equal(H.peek(site, 'undo'), undefined);
        H.record(site, { ...snap(1), page: 'about.html' });
        assert.equal(H.peek(site, 'undo').page, 'about.html');
        assert.equal(H.canUndo(site), true, 'still there');
        H.undo(site, { ...snap(2), page: 'about.html' });
        assert.equal(H.peek(site, 'redo').page, 'about.html');
    });

    it('a new edit after an undo forgets the redo path', () => {
        const site = 'C:/site-b-dev';
        H.forget(site);
        H.record(site, snap(1));
        H.undo(site, snap(2));
        assert.equal(H.canRedo(site), true);
        H.record(site, snap(1));
        assert.equal(H.canRedo(site), false);
    });

    it('is one history per site, whichever panel edits, and case does not matter on Windows paths', () => {
        H.forget('C:/Site-C-dev');
        H.record('C:/Site-C-dev', snap(1));
        assert.equal(H.canUndo('c:/site-c-dev'), true);
        assert.equal(H.canUndo('C:/site-d-dev'), false);
    });

    it('does not grow past the limit', () => {
        const site = 'C:/site-e-dev';
        H.forget(site);
        for (let i = 0; i < H.HISTORY_LIMIT + 20; i++) H.record(site, snap(i));
        let steps = 0;
        while (H.undo(site, snap(-1))) steps++;
        assert.equal(steps, H.HISTORY_LIMIT);
    });
});

describe('snapshot and restore a page', () => {
    it('brings the file and its overrides back exactly, css included', () => {
        const site = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-undo-'));
        const work = path.join(site, 'site-dev');
        fs.mkdirSync(work, { recursive: true });
        const original = '<!DOCTYPE html><html><head></head><body><h1 id="t">Hi</h1></body></html>';
        fs.writeFileSync(path.join(work, 'index.html'), original);

        const before = E.snapshotPage(work, 'index.html');
        assert.deepEqual(before, { page: 'index.html', html: original, overrides: {} });

        E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 't' }, declarations: { color: 'red' } });
        E.applyEdit(work, 'index.html', { op: 'add', ref: { id: 'rect-1' }, markup: '<svg id="rect-1"></svg>', declarations: { position: 'absolute', left: '1px' } });
        const after = E.snapshotPage(work, 'index.html');
        assert.match(after.html, /rect-1/);
        assert.match(after.html, /draw2code\/index.css/);
        assert.deepEqual(Object.keys(after.overrides), ['#t', '#rect-1']);

        const written = E.restorePage(work, before);
        assert.equal(fs.readFileSync(path.join(work, 'index.html'), 'utf8'), original, 'the page is byte for byte what it was');
        assert.doesNotMatch(fs.readFileSync(path.join(work, 'draw2code', 'index.css'), 'utf8'), /#t|rect-1/, 'the rules went too');
        assert.equal(JSON.parse(fs.readFileSync(E.overridesStore(work), 'utf8'))['index.html'], undefined, 'no rules left for the page');
        assert.equal(written.length, 3);

        E.restorePage(work, after);
        assert.equal(E.snapshotPage(work, 'index.html').html, after.html, 'and forward again');
        fs.rmSync(site, { recursive: true, force: true });
    });

    it('undoing a remove gives the page back byte for byte, rules and all, and redo removes it again', () => {
        const site = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-undo-remove-'));
        const work = path.join(site, 'site-dev');
        fs.mkdirSync(work, { recursive: true });
        fs.writeFileSync(path.join(work, 'index.html'), '<!DOCTYPE html><html><head></head><body>\n  <p>Keep</p>\n  <button>Go</button>\n</body></html>');
        E.applyEdit(work, 'index.html', { op: 'style', ref: { path: [1] }, declarations: { width: '80px' }, extraRules: [{ selector: '[data-d2c="1"]:hover', declarations: { opacity: '0.9' } }] });
        const before = E.snapshotPage(work, 'index.html');
        const html = fs.readFileSync(path.join(work, 'index.html'), 'utf8');
        const css = fs.readFileSync(path.join(work, 'draw2code', 'index.css'), 'utf8');
        H.forget(work);

        // The same steps as the panels' onEdit: snapshot, edit, then record.
        assert.equal(E.applyEdit(work, 'index.html', { op: 'remove', ref: { path: [1] } }).error, undefined);
        H.record(work, before);
        const after = E.snapshotPage(work, 'index.html');
        assert.doesNotMatch(after.html, /<button/);
        assert.deepEqual(after.overrides, {});

        E.restorePage(work, H.undo(work, E.snapshotPage(work, 'index.html')));
        assert.equal(fs.readFileSync(path.join(work, 'index.html'), 'utf8'), html, 'the page is byte for byte what it was');
        assert.deepEqual(E.snapshotPage(work, 'index.html'), before, 'its rules are back');
        assert.equal(fs.readFileSync(path.join(work, 'draw2code', 'index.css'), 'utf8'), css, 'and its stylesheet');

        E.restorePage(work, H.redo(work, E.snapshotPage(work, 'index.html')));
        assert.deepEqual(E.snapshotPage(work, 'index.html'), after, 'and gone again');
        H.forget(work);
        fs.rmSync(site, { recursive: true, force: true });
    });

    it('a page that is not there gives no snapshot', () => {
        assert.equal(E.snapshotPage(path.join(os.tmpdir(), 'nope-dev'), 'index.html'), null);
    });
});
