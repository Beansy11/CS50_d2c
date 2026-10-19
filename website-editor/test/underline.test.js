// Unit tests for src/underline.ts: what the page editor's U button shows and
// writes (compiled to out/ by npm test's pretest).
//
// CS50 citation: I did not write these tests. I had an AI coding agent read
// my code and write tests for it, to save time, and it put this file in
// website-editor/test/. The code it tests is mine; the tests are the agent's.
// I run them with npm test.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const U = require('../../out/website-editor/src/underline.js');

describe('the U button', () => {
    it('shows an underline when the text has one, also beside another line', () => {
        assert.equal(U.isUnderlined('underline'), true);
        assert.equal(U.isUnderlined('underline line-through'), true);
        assert.equal(U.isUnderlined('none'), false);
        assert.equal(U.isUnderlined('line-through'), false);
        assert.equal(U.isUnderlined(''), false);
    });

    it('takes a link\'s underline away, and gives text one', () => {
        assert.deepEqual(U.underlineDeclarations('underline'), { 'text-decoration': 'none' });
        assert.deepEqual(U.underlineDeclarations('none'), { 'text-decoration': 'underline' });
        assert.deepEqual(U.underlineDeclarations(''), { 'text-decoration': 'underline' });
    });

    it('keeps any other line the text has', () => {
        assert.deepEqual(U.underlineDeclarations('underline line-through'), { 'text-decoration': 'line-through' });
        assert.deepEqual(U.underlineDeclarations('overline'), { 'text-decoration': 'overline underline' });
    });

    it('runs on its own, as it is copied into the overlay', () => {
        // src/pageShell.ts writes the functions' text into the page script.
        const shows = new Function(`return (${U.isUnderlined.toString()});`)();
        const writes = new Function(`return (${U.underlineDeclarations.toString()});`)();
        assert.equal(shows('underline'), true);
        assert.deepEqual(writes('underline'), { 'text-decoration': 'none' });
    });
});
