// Unit tests for the room below the page in the page editor: src/room.ts
// (compiled to out/ by npm test's pretest).
//
// CS50 citation: I did not write these tests. I had an AI coding agent read
// my code and write tests for it, to save time, and it put this file in
// website-editor/test/. The code it tests is mine; the tests are the agent's.
// I run them with npm test.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../out/website-editor/src/room.js');

// The editor's bar over a page: tab strip, address row and toolbar.
const BAR = 36 + 44 + 32;

describe('roomBox: two screens of empty page past the lowest point', () => {
    it('starts where the page ends and is twice the view under the bar tall', () => {
        // A page 1500px down, in an 800px view, the box's containing block at the top.
        assert.deepEqual(R.roomBox(1500, 800, BAR, 0), { top: 1500, height: 2 * (800 - BAR) });
    });

    it('scrolled to the very bottom, a whole screen of empty page is above the view', () => {
        const view = 800;
        const box = R.roomBox(1500, view, BAR, 0);
        const scrollMax = box.top + box.height - view;
        assert.equal(scrollMax + BAR, 1500 + (view - BAR));
    });

    it('lets a box a screen tall be drawn a gap below the lowest point in one drag', () => {
        // The showcase case: a section 800px tall, 60px under the page's last
        // element at 1180, in a view showing 847px of page under the bar.
        const view = 847 + BAR, bottom = 1180, top = bottom + 60, height = 800;
        const box = R.roomBox(bottom + BAR, view, BAR, BAR);
        const scrollMax = BAR + box.top + box.height - view;
        assert.ok(scrollMax + (view - BAR) >= top + height, 'its bottom edge can be reached');
        assert.ok(top + height - (view - BAR) <= top, 'with its top edge still on screen');
    });

    it('is placed from wherever its containing block starts', () => {
        // <html> pushed down under the bar, or a positioned <body> further down:
        // the box still ends up at the page's lowest point in the document.
        for (const origin of [BAR, BAR + 8, 300]) {
            const box = R.roomBox(1500, 800, BAR, origin);
            assert.equal(origin + box.top, 1500, String(origin));
            assert.equal(box.height, 2 * (800 - BAR));
        }
    });

    it('gives a short page the room too', () => {
        // A short page still scrolls as far as the view (scrollHeight never
        // reads less than it), so the room goes on from there.
        assert.deepEqual(R.roomBox(800, 800, BAR, BAR), { top: 800 - BAR, height: 2 * (800 - BAR) });
    });

    it('is whole pixels, and never above its block or less than nothing', () => {
        assert.deepEqual(R.roomBox(1000.4, 700.6, BAR, 0.5), { top: 1000, height: 1177 });
        assert.deepEqual(R.roomBox(50, 800, BAR, 100), { top: 0, height: 2 * (800 - BAR) });
        assert.deepEqual(R.roomBox(1500, 90, BAR, 0), { top: 1500, height: 0 });
    });

    it('runs on its own, as it is copied into the overlay', () => {
        // src/pageShell.ts writes the function's text into the page script.
        const copied = new Function(`return (${R.roomBox.toString()});`)();
        assert.deepEqual(copied(1500, 800, BAR, BAR), R.roomBox(1500, 800, BAR, BAR));
    });
});

describe('roomOnly: a page that fits the view has no scrollbar for the room', () => {
    it('is true while the page alone does not scroll', () => {
        assert.equal(R.roomOnly(800, 800), true, 'scrollHeight never reads less than the view');
        assert.equal(R.roomOnly(801, 800), false, 'a page that scrolls on its own keeps its scrollbar');
        assert.equal(R.roomOnly(1500, 800), false);
    });

    it('a page as tall as the window is the bar\'s height taller in the editor: that is not scrolling on its own', () => {
        // min-height: 100vh is the whole editor's height, and the page starts under the bar.
        const view = 900;
        assert.equal(R.roomOnly(BAR + view, view, BAR), true);
        assert.equal(R.roomOnly(BAR + view + 1, view, BAR), false, 'any more is the page\'s own');
    });

    it('a page made in Draw2Code, measured without its least height, gets nothing to spare', () => {
        // Its elements end 850px down, under the bar, in a 900px view: a
        // browser showing 788px of page scrolls, and so does the editor.
        const view = 900;
        assert.equal(R.roomOnly(BAR + 850, view, 0), false);
        assert.equal(R.roomOnly(BAR + 788, view, 0), true, 'ending just at the bottom of the page area, it does not scroll');
        assert.equal(R.roomOnly(BAR + 789, view, 0), false);
    });

    it('a page wider than the view keeps its scrollbars: it scrolls sideways, as in a browser', () => {
        // A 1440px page in a 1000px panel.
        assert.equal(R.roomOnly(800, 800, BAR, 1440, 1000), false);
        // A page as wide as the view with no scrollbar, or narrower, does not.
        assert.equal(R.roomOnly(800, 800, BAR, 1000, 1000), true);
        assert.equal(R.roomOnly(800, 800, BAR, 990, 1000), true, 'with its scrollbar, the view is 10px narrower');
    });

    it('runs on its own, as it is copied into the overlay', () => {
        const copied = new Function(`return (${R.roomOnly.toString()});`)();
        assert.equal(copied(800, 800), true);
        assert.equal(copied(1500, 800), false);
        assert.equal(copied(800, 800, BAR, 1440, 1000), false);
    });
});
