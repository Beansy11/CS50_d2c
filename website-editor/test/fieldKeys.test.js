// Unit tests for the keys a field keeps from VS Code in the page editor:
// src/fieldKeys.ts (compiled to out/ by npm test's pretest).
//
// CS50 citation: I did not write these tests. I had an AI coding agent read
// my code and write tests for it, to save time, and it put this file in
// website-editor/test/. The code it tests is mine; the tests are the agent's.
// I run them with npm test.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const K = require('../../out/website-editor/src/fieldKeys.js');

/** A key press as the overlay's keydown handler sees it. */
const press = (key, mods = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, ...mods });

describe('fieldKey: Undo, Redo and Select All stay in the field', () => {
    it('keeps Ctrl+A, so VS Code does not select all a second time after the first digit', () => {
        assert.equal(K.fieldKey(press('a', { ctrlKey: true })), true);
        assert.equal(K.fieldKey(press('a', { metaKey: true })), true);
    });

    it('keeps Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z, as before', () => {
        assert.equal(K.fieldKey(press('z', { ctrlKey: true })), true);
        assert.equal(K.fieldKey(press('y', { ctrlKey: true })), true);
        // With Shift held the key reads upper case.
        assert.equal(K.fieldKey(press('Z', { ctrlKey: true, shiftKey: true })), true);
        assert.equal(K.fieldKey(press('A', { ctrlKey: true })), true);
    });

    it('leaves plain typing alone: the digits and letters go to the field as they are', () => {
        for (const key of ['a', 'z', 'y', '1', '6', 'Enter', 'Backspace']) {
            assert.equal(K.fieldKey(press(key)), false, key);
        }
    });

    it('leaves VS Code its other shortcuts, and copy, cut and paste', () => {
        for (const key of ['s', 'f', 'p', 'c', 'x', 'v', 'w']) {
            assert.equal(K.fieldKey(press(key, { ctrlKey: true })), false, key);
        }
    });

    it('leaves any shortcut with Alt to VS Code', () => {
        assert.equal(K.fieldKey(press('a', { ctrlKey: true, altKey: true })), false);
        assert.equal(K.fieldKey(press('z', { metaKey: true, altKey: true })), false);
    });

    it('runs on its own, as it is copied into the overlay', () => {
        // src/pageShell.ts writes the function's text into the page script.
        const copied = new Function(`return (${K.fieldKey.toString()});`)();
        assert.equal(copied(press('a', { ctrlKey: true })), true);
        assert.equal(copied(press('s', { ctrlKey: true })), false);
    });
});
