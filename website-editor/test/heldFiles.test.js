// Held edits: nothing reaches the development copy until Save.
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
const { HeldFiles } = require('../../out/website-editor/src/heldFiles.js');
const E = require('../../out/website-editor/src/pageEditor.js');

const PAGE = '<!DOCTYPE html><html><head><title>Home</title></head><body><h1 id="title">Hi</h1></body></html>';
const site = () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-held-'));
    fs.writeFileSync(path.join(work, 'index.html'), PAGE);
    return work;
};

describe('HeldFiles: unsaved edits', () => {
    it('reads what was written, while the file on disk stays as it was', () => {
        const work = site();
        const held = new HeldFiles(work);
        const file = path.join(work, 'index.html');
        held.write(file, 'changed');
        assert.equal(held.read(file), 'changed');
        assert.equal(fs.readFileSync(file, 'utf8'), PAGE);
        assert.equal(held.dirty, true);
        assert.deepEqual(held.heldPaths(), ['index.html']);
    });

    it('save writes every held file into the copy and is clean again', () => {
        const work = site();
        const held = new HeldFiles(work);
        held.write(path.join(work, 'index.html'), 'changed');
        held.write(path.join(work, 'draw2code', 'index.css'), '#title { color: red; }');
        const written = held.save();
        assert.equal(written.length, 2);
        assert.equal(fs.readFileSync(path.join(work, 'index.html'), 'utf8'), 'changed');
        assert.equal(fs.readFileSync(path.join(work, 'draw2code', 'index.css'), 'utf8'), '#title { color: red; }');
        assert.equal(held.dirty, false);
    });

    it('writing back what is saved (an edit undone) holds nothing', () => {
        const work = site();
        const held = new HeldFiles(work);
        const file = path.join(work, 'index.html');
        held.write(file, 'changed');
        held.write(file, PAGE);
        assert.equal(held.dirty, false);
        assert.deepEqual(held.heldPaths(), []);
    });

    it('discard forgets the edits; the copy is what shows again', () => {
        const work = site();
        const held = new HeldFiles(work);
        const file = path.join(work, 'index.html');
        held.write(file, 'changed');
        held.discard();
        assert.equal(held.read(file), PAGE);
        assert.equal(held.dirty, false);
    });

    it('a page added since the last save is listed until it is saved', () => {
        const work = site();
        const held = new HeldFiles(work);
        held.write(path.join(work, 'page2.html'), PAGE);
        assert.deepEqual(held.added(), ['page2.html']);
        assert.equal(held.exists(path.join(work, 'page2.html')), true);
        held.save();
        assert.deepEqual(held.added(), []);
    });

    it('says once per edit - not per file - so each edit is one undo step', () => {
        const work = site();
        const held = new HeldFiles(work);
        const told = [];
        held.onDidEdit = (label) => { told.push(label); };
        held.write(path.join(work, 'index.html'), 'a');
        held.write(path.join(work, 'draw2code', 'index.css'), 'b');
        assert.deepEqual(told, []);
        held.edited('Style');
        assert.deepEqual(told, ['Style']);
    });

    it('removing a page that was never saved forgets it; a saved one goes on Save', () => {
        const work = site();
        const held = new HeldFiles(work);
        const fresh = path.join(work, 'page2.html');
        held.write(fresh, 'new');
        held.remove(fresh);
        assert.equal(held.exists(fresh), false);
        assert.equal(held.dirty, false, 'adding and taking away a new page leaves nothing to save');
        const saved = path.join(work, 'index.html');
        held.remove(saved);
        assert.equal(held.exists(saved), false);
        assert.throws(() => held.read(saved), /ENOENT/);
        assert.deepEqual(held.removed(), ['index.html']);
        assert.equal(fs.existsSync(saved), true, 'still on disk until Save');
        held.save();
        assert.equal(fs.existsSync(saved), false);
    });

    it('a backup brings the edits back, and never reaches outside the copy', () => {
        const work = site();
        const held = new HeldFiles(work);
        held.write(path.join(work, 'index.html'), 'changed');
        const backup = JSON.parse(JSON.stringify(held.backup()));
        backup.files.push({ path: '../elsewhere.html', content: 'no' });
        const again = new HeldFiles(work);
        again.restore(backup);
        assert.deepEqual(again.heldPaths(), ['index.html']);
        assert.equal(again.read(path.join(work, 'index.html')), 'changed');
        again.restore({ something: 'else' });
        assert.deepEqual(again.heldPaths(), ['index.html'], 'anything that is not a backup is ignored');
    });

    it('is found by its development copy only while registered', () => {
        const work = site();
        const held = new HeldFiles(work);
        assert.equal(HeldFiles.for(work), undefined);
        held.register();
        assert.equal(HeldFiles.for(work.toUpperCase()), held);
        held.unregister();
        assert.equal(HeldFiles.for(work), undefined);
    });
});

describe('editing through held edits', () => {
    it('an edit, and the next one on top of it, touch nothing on disk until saved', () => {
        const work = site();
        const held = new HeldFiles(work);
        const first = E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'title' }, declarations: { color: 'red' } }, held);
        assert.equal(first.error, undefined);
        E.applyEdit(work, 'index.html', { op: 'text', ref: { id: 'title' }, text: 'Hello' }, held);
        assert.equal(fs.readFileSync(path.join(work, 'index.html'), 'utf8'), PAGE, 'the page on disk is untouched');
        assert.equal(fs.existsSync(path.join(work, 'draw2code', 'index.css')), false);
        assert.equal(fs.existsSync(E.overridesStore(work)), false);
        const snap = E.snapshotPage(work, 'index.html', held);
        assert.match(snap.html, />Hello</);
        assert.equal(snap.overrides['#title'].color, 'red');
        held.save();
        assert.match(fs.readFileSync(path.join(work, 'index.html'), 'utf8'), />Hello</);
        assert.match(fs.readFileSync(path.join(work, 'draw2code', 'index.css'), 'utf8'), /color: red/);
    });

    it('an edit undone leaves nothing to save - not even rule files the edit made', () => {
        const work = site();
        const held = new HeldFiles(work);
        const before = E.snapshotPage(work, 'index.html', held);
        E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'title' }, declarations: { color: 'red' } }, held);
        assert.equal(held.dirty, true);
        E.restorePage(work, before, held);
        assert.deepEqual(held.heldPaths(), [], 'page, overrides.json and draw2code/index.css are all as saved');
    });

    it('a page changed on disk: its unsaved edits can be dropped, other pages keep theirs', () => {
        const work = site();
        fs.writeFileSync(path.join(work, 'about.html'), PAGE);
        const held = new HeldFiles(work);
        const pages = ['index.html', 'about.html'];
        E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'title' }, declarations: { color: 'red' } }, held);
        E.applyEdit(work, 'about.html', { op: 'style', ref: { id: 'title' }, declarations: { color: 'blue' } }, held);
        assert.equal(E.pageOfFile(work, path.join(work, 'index.html'), pages), 'index.html');
        assert.equal(E.pageOfFile(work, path.join(work, 'draw2code', 'about.css'), pages), 'about.html', 'its stylesheet is the page too');
        assert.equal(E.pageOfFile(work, path.join(work, 'styles.css'), pages), undefined);
        assert.equal(E.pageIsHeld(work, 'index.html', held), true);

        E.dropHeldPage(work, 'index.html', held);
        assert.equal(E.pageIsHeld(work, 'index.html', held), false);
        assert.equal(held.read(path.join(work, 'index.html')), PAGE, 'the saved page again');
        assert.equal(E.readOverrides(work, held)['index.html'], undefined, 'and none of its unsaved rules');
        assert.equal(E.pageIsHeld(work, 'about.html', held), true, 'about keeps its edits');
        assert.equal(E.readOverrides(work, held)['about.html']['#title'].color, 'blue');

        E.dropHeldPage(work, 'about.html', held);
        assert.equal(held.dirty, false, 'nothing left unsaved');
    });

    it('undo restores into the held edits too', () => {
        const work = site();
        const held = new HeldFiles(work);
        const before = E.snapshotPage(work, 'index.html', held);
        E.applyEdit(work, 'index.html', { op: 'text', ref: { id: 'title' }, text: 'Hello' }, held);
        E.restorePage(work, before, held);
        assert.match(held.read(path.join(work, 'index.html')), />Hi</);
        assert.equal(fs.readFileSync(path.join(work, 'index.html'), 'utf8'), PAGE);
    });

    it('adding a page is undoable: its snapshot from before it existed takes it away', () => {
        const work = site();
        const held = new HeldFiles(work);
        const before = E.absentPage('page2.html');
        held.write(path.join(work, 'page2.html'), PAGE);
        E.applyEdit(work, 'page2.html', { op: 'style', ref: { id: 'title' }, declarations: { color: 'red' } }, held);
        const after = E.snapshotPage(work, 'page2.html', held);
        E.restorePage(work, before, held);
        assert.equal(held.exists(path.join(work, 'page2.html')), false);
        assert.equal(held.exists(path.join(work, 'draw2code', 'page2.css')), false);
        assert.equal(E.readOverrides(work, held)['page2.html'], undefined);
        E.restorePage(work, after, held);
        assert.equal(held.exists(path.join(work, 'page2.html')), true, 'and redo brings it back');
        assert.equal(E.readOverrides(work, held)['page2.html']['#title'].color, 'red');
    });

    it('the stylesheet the page should show comes from the held edits', () => {
        const work = site();
        const held = new HeldFiles(work);
        assert.deepEqual(E.heldStylesheet(work, 'index.html'), []);
        held.register();
        try {
            E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'title' }, declarations: { color: 'red' } }, held);
            const sheets = E.heldStylesheet(work, 'index.html');
            assert.equal(sheets.length, 1);
            assert.equal(sheets[0].file, path.join(work, 'draw2code', 'index.css'));
            assert.match(sheets[0].css, /color: red/);
        } finally {
            held.unregister();
        }
    });
});
