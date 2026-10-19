// Unit tests for scrolling at the edges while dragging in the page editor:
// src/edgeScroll.ts (compiled to out/ by npm test's pretest).
//
// CS50 citation: I did not write these tests. I had an AI coding agent read
// my code and write tests for it, to save time, and it put this file in
// website-editor/test/. The code it tests is mine; the tests are the agent's.
// I run them with npm test.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../out/website-editor/src/edgeScroll.js');

// The editor's bar over a page (tab strip, address row and toolbar), and a view.
const BAR = 36 + 44 + 32;
const VIEW = 900;

describe('edgeSpeed: scrolling while a drag is held at an edge', () => {
    it('does not scroll in the middle of the page area', () => {
        for (const at of [BAR + 40, 300, 500, VIEW - 40]) assert.equal(E.edgeSpeed(at, BAR, VIEW), 0, String(at));
    });

    it('scrolls up near the top and down near the bottom', () => {
        assert.ok(E.edgeSpeed(BAR + 10, BAR, VIEW) < 0);
        assert.ok(E.edgeSpeed(VIEW - 10, BAR, VIEW) > 0);
    });

    it('goes faster the nearer the pointer is to the edge', () => {
        const down = [VIEW - 39, VIEW - 30, VIEW - 20, VIEW - 10, VIEW].map((at) => E.edgeSpeed(at, BAR, VIEW));
        const up = [BAR + 39, BAR + 30, BAR + 20, BAR + 10, BAR].map((at) => -E.edgeSpeed(at, BAR, VIEW));
        for (const speeds of [down, up]) {
            for (let i = 1; i < speeds.length; i++) assert.ok(speeds[i] > speeds[i - 1], speeds.join(' '));
        }
        // Just inside the zone it creeps; at the edge it is at its fastest.
        assert.equal(E.edgeSpeed(VIEW - 39.5, BAR, VIEW), 1);
        assert.equal(E.edgeSpeed(VIEW, BAR, VIEW), 24);
        assert.equal(E.edgeSpeed(BAR, BAR, VIEW), -24);
    });

    it('is at its fastest over the bar or out of the panel, and no faster', () => {
        assert.equal(E.edgeSpeed(5, BAR, VIEW), -24);
        assert.equal(E.edgeSpeed(-300, BAR, VIEW), -24);
        assert.equal(E.edgeSpeed(VIEW + 300, BAR, VIEW), 24);
    });

    it('is the same both ways, and whole pixels', () => {
        for (let d = 0; d < 40; d += 0.5) {
            const down = E.edgeSpeed(VIEW - d, BAR, VIEW), up = E.edgeSpeed(BAR + d, BAR, VIEW);
            assert.equal(down, -up, String(d));
            assert.ok(Number.isInteger(down), String(down));
        }
    });

    it('takes another zone and top speed', () => {
        assert.equal(E.edgeSpeed(VIEW - 70, BAR, VIEW, 80, 10), 1);
        assert.equal(E.edgeSpeed(VIEW, BAR, VIEW, 80, 10), 10);
        assert.equal(E.edgeSpeed(VIEW - 70, BAR, VIEW), 0);
    });

    it('keeps a still middle in a very short view', () => {
        // 100px of page under the bar: zones of 25px each.
        const bottom = BAR + 100;
        assert.equal(E.edgeSpeed(BAR + 50, BAR, bottom), 0);
        assert.ok(E.edgeSpeed(BAR + 10, BAR, bottom) < 0);
        assert.ok(E.edgeSpeed(bottom - 10, BAR, bottom) > 0);
        assert.equal(E.edgeSpeed(BAR + 30, BAR, bottom), 0);
    });

    it('does not scroll with no page area or no pointer', () => {
        assert.equal(E.edgeSpeed(50, BAR, BAR), 0);
        assert.equal(E.edgeSpeed(50, BAR, 20), 0);
        assert.equal(E.edgeSpeed(NaN, BAR, VIEW), 0);
    });

    it('runs on its own, as it is copied into the overlay', () => {
        // src/pageShell.ts writes the function's text into the page script.
        const copied = new Function(`return (${E.edgeSpeed.toString()});`)();
        for (const at of [0, BAR + 5, 400, VIEW - 5, VIEW + 50]) assert.equal(copied(at, BAR, VIEW), E.edgeSpeed(at, BAR, VIEW));
    });
});
