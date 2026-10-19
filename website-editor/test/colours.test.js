// Unit tests for the colours typed and used again in the page editor's
// toolbar: src/colours.ts (compiled to out/ by npm test's pretest).
//
// CS50 citation: I did not write these tests. I had an AI coding agent read
// my code and write tests for it, to save time, and it put this file in
// website-editor/test/. The code it tests is mine; the tests are the agent's.
// I run them with npm test.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../out/website-editor/src/colours.js');

describe('hexOf: a typed colour as a colour box holds it', () => {
    it('takes a code with or without #, in either case', () => {
        assert.equal(C.hexOf('#0B1020'), '#0b1020');
        assert.equal(C.hexOf('0b1020'), '#0b1020');
        assert.equal(C.hexOf('0B1020'), '#0b1020');
    });

    it('takes the short form, as CSS does', () => {
        assert.equal(C.hexOf('#fff'), '#ffffff');
        assert.equal(C.hexOf('A1c'), '#aa11cc');
    });

    it('ignores spaces around it (a pasted code)', () => {
        assert.equal(C.hexOf('  #0b1020 '), '#0b1020');
    });

    it('refuses anything a colour box cannot hold', () => {
        for (const typed of ['', '#', 'blue', '#12345', '#1234567', '#0b10209f', '#ggg', '# 0b1020', 'rgb(0, 0, 0)', '##0b1020']) {
            assert.equal(C.hexOf(typed), undefined, typed);
        }
    });
});

describe('recentWith: the colours used last, newest first', () => {
    it('puts the colour just used in front', () => {
        assert.deepEqual(C.recentWith(['#111111', '#222222'], '#333333', 10), ['#333333', '#111111', '#222222']);
    });

    it('keeps each colour once: using one again moves it to the front', () => {
        assert.deepEqual(C.recentWith(['#111111', '#222222', '#333333'], '#222222', 10), ['#222222', '#111111', '#333333']);
        assert.deepEqual(C.recentWith(['#111111'], '#111111', 10), ['#111111']);
    });

    it('lets the oldest fall off past the most it keeps', () => {
        const full = Array.from({ length: C.RECENT_MAX }, (_, i) => '#00000' + i.toString(16));
        const next = C.recentWith(full, '#ffffff', C.RECENT_MAX);
        assert.equal(next.length, C.RECENT_MAX);
        assert.equal(next[0], '#ffffff');
        assert.ok(!next.includes(full[full.length - 1]));
    });

    it('does not change the list it was given', () => {
        const list = ['#111111'];
        C.recentWith(list, '#222222', 10);
        assert.deepEqual(list, ['#111111']);
    });
});

describe('recentOf: a stored list as the toolbar can use it', () => {
    it('keeps colours in order, as a colour box writes them', () => {
        assert.deepEqual(C.recentOf(['#0B1020', '#ffffff'], 10), ['#0b1020', '#ffffff']);
    });

    it('leaves out whatever is not a colour, and repeats', () => {
        assert.deepEqual(C.recentOf(['#0b1020', 'blue', 5, null, '#fff', '#0B1020', { hex: '#000000' }, '#000000'], 10), ['#0b1020', '#000000']);
    });

    it('is empty for a store that is not a list (nothing kept yet)', () => {
        for (const stored of [undefined, null, '#0b1020', {}, 3]) assert.deepEqual(C.recentOf(stored, 10), []);
    });

    it('keeps at most the most it may', () => {
        const many = Array.from({ length: 20 }, (_, i) => '#0000' + i.toString(16).padStart(2, '0'));
        assert.deepEqual(C.recentOf(many, C.RECENT_MAX), many.slice(0, C.RECENT_MAX));
    });
});

describe('the toolbar list, as the overlay uses it', () => {
    it('a typed code, used, goes to the front of what is stored', () => {
        const stored = C.recentOf(['#ffffff', 'oops'], C.RECENT_MAX);
        const typed = C.hexOf('0B1020');
        assert.deepEqual(C.recentWith(stored, typed, C.RECENT_MAX), ['#0b1020', '#ffffff']);
    });

    it('runs on its own, as it is copied into the overlay', () => {
        // src/pageShell.ts writes the functions' text into the page script.
        const hexOf = new Function(`return (${C.hexOf.toString()});`)();
        const recentWith = new Function(`return (${C.recentWith.toString()});`)();
        assert.equal(hexOf('0B1020'), '#0b1020');
        assert.equal(hexOf('nope'), undefined);
        assert.deepEqual(recentWith(['#111111'], '#0b1020', 10), ['#0b1020', '#111111']);
    });
});
