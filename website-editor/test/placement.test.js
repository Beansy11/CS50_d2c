// Unit tests for exact placement in the page editor: the x, y, width and
// height fields and snapping guides, src/placement.ts (compiled to out/ by
// npm test's pretest).
//
// CS50 citation: I did not write these tests. I had an AI coding agent read
// my code and write tests for it, to save time, and it put this file in
// website-editor/test/. The code it tests is mine; the tests are the agent's.
// I run them with npm test.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../../out/website-editor/src/placement.js');
const M = require('../media/model.js');
const { shellHtml } = require('./shellHtml.js');

// A page's wrapper 1440px wide, a button and a picture on it.
const PAGE = { left: 0, top: 0, width: 1440, height: 900 };
const BUTTON = { left: 100, top: 300, width: 120, height: 40 };
const PICTURE = { left: 400, top: 100, width: 300, height: 200 };
const LINES = P.snapLines([PAGE, BUTTON, PICTURE]);

describe('snapLines: what a dragged box snaps to', () => {
    it('gives each box its left, centre and right, and its top, middle and bottom, sorted', () => {
        assert.deepEqual(LINES.x.map((l) => l.at), [0, 100, 160, 220, 400, 550, 700, 720, 1440]);
        assert.deepEqual(LINES.y.map((l) => l.at), [0, 100, 200, 300, 300, 320, 340, 450, 900]);
    });

    it('says how far along the other axis each line reaches', () => {
        assert.deepEqual(LINES.x.find((l) => l.at === 160), { at: 160, from: 300, to: 340, side: 0.5 });
        assert.deepEqual(LINES.y.find((l) => l.at === 100), { at: 100, from: 400, to: 700, side: 0 });
        assert.deepEqual(LINES.x.find((l) => l.at === 220), { at: 220, from: 300, to: 340, side: 1 });
    });

    it('leaves out a box with no size (hidden), but not a straight line', () => {
        const lines = P.snapLines([{ left: 50, top: 50, width: 0, height: 0 }, { left: 10, top: 20, width: 0, height: 80 }, null]);
        assert.deepEqual(lines.x.map((l) => l.at), [10, 10, 10]);
        assert.deepEqual(lines.y.map((l) => l.at), [20, 60, 100]);
        assert.deepEqual(P.snapLines([{ left: NaN, top: 0, width: 10, height: 10 }]), { x: [], y: [] });
    });

    it('finds the first line at or past a value by halving', () => {
        assert.equal(P.firstLineFrom(LINES.x, -5), 0);
        assert.equal(P.firstLineFrom(LINES.x, 100), 1);
        assert.equal(P.firstLineFrom(LINES.x, 101), 2);
        assert.equal(P.firstLineFrom(LINES.x, 5000), LINES.x.length);
        assert.equal(P.firstLineFrom([], 3), 0);
    });
});

describe('snapBox: moving', () => {
    it('pulls an edge onto a line within the threshold', () => {
        // Its left 4px short of the picture's left; its top 3px under the picture's middle.
        const s = P.snapBox({ left: 396, top: 203, width: 80, height: 50 }, 'move', LINES, 6);
        assert.equal(s.dx, 4);
        assert.equal(s.dy, -3);
    });

    it('leaves a box with nothing near where it is', () => {
        const s = P.snapBox({ left: 1000, top: 600, width: 50, height: 50 }, 'move', LINES, 6);
        assert.deepEqual(s, { dx: 0, dy: 0, guides: [] });
    });

    it('does not reach past the threshold, and reaches exactly to it', () => {
        assert.equal(P.snapBox({ left: 393, top: 600, width: 50, height: 50 }, 'move', LINES, 6).dx, 0);
        assert.equal(P.snapBox({ left: 394, top: 600, width: 50, height: 50 }, 'move', LINES, 6).dx, 6);
    });

    it('snaps its centre too, and takes the nearest of its edges and centre', () => {
        // Its centre 2px left of the button's centre (160); its sides near nothing.
        assert.equal(P.snapBox({ left: 10, top: 600, width: 296, height: 40 }, 'move', LINES, 6).dx, 2);
        // Its top 3px, its middle 2px and its bottom 1px from the button's: the bottom wins.
        assert.equal(P.snapBox({ left: 1000, top: 297, width: 50, height: 42 }, 'move', LINES, 6).dy, 1);
    });

    it('draws a guide for each edge or centre on a line, reaching from the box to the elements on it', () => {
        const s = P.snapBox({ left: 396, top: 500, width: 300, height: 50 }, 'move', LINES, 6);
        assert.equal(s.dx, 4);
        // As wide as the picture: once its left is on the picture's, so are its centre and right.
        assert.deepEqual(s.guides, [
            { axis: 'x', at: 400, from: 100, to: 550 },
            { axis: 'x', at: 550, from: 100, to: 550 },
            { axis: 'x', at: 700, from: 100, to: 550 },
        ]);
    });

    it('draws one guide where several elements share a line, reaching all of them', () => {
        const lines = P.snapLines([{ left: 0, top: 0, width: 10, height: 10 }, { left: 0, top: 500, width: 30, height: 10 }]);
        const s = P.snapBox({ left: 2, top: 200, width: 40, height: 40 }, 'move', lines, 6);
        assert.equal(s.dx, -2);
        assert.deepEqual(s.guides.filter((g) => g.at === 0), [{ axis: 'x', at: 0, from: 0, to: 510 }]);
    });

    it('snaps only up and down when there are no upright lines (a full-width element)', () => {
        const s = P.snapBox({ left: 797, top: 302, width: 80, height: 50 }, 'move', { x: [], y: LINES.y }, 6);
        assert.equal(s.dx, 0);
        assert.equal(s.dy, -2);
        assert.ok(s.guides.every((g) => g.axis === 'y'));
    });

    it('a point is a box of no size: it does not snap', () => {
        assert.deepEqual(P.snapBox({ left: 103, top: 296, width: 0, height: 0 }, 'move', LINES, 6), { dx: 0, dy: 0, guides: [] });
    });

    it('a line drawn straight snaps across by its length', () => {
        // Upright, 0px wide and 80px tall: 3px from the button's left.
        const s = P.snapBox({ left: 103, top: 500, width: 0, height: 80 }, 'move', LINES, 6);
        assert.equal(s.dx, -3);
        assert.deepEqual(s.guides.map((g) => [g.axis, g.at]), [['x', 100]]);
    });
});

describe('snapBox: resizing', () => {
    it('snaps only the edges the handle drags', () => {
        // Right edge 3px short of the picture's left: e snaps it, w does not look there.
        const box = { left: 200, top: 600, width: 197, height: 30 };
        assert.equal(P.snapBox(box, 'e', LINES, 6).dx, 3);
        assert.equal(P.snapBox(box, 'w', LINES, 6).dx, 0);
        // Its left 2px past the button's right: w snaps it back.
        assert.equal(P.snapBox({ left: 222, top: 600, width: 100, height: 30 }, 'w', LINES, 6).dx, -2);
        // A corner snaps both of its edges.
        const s = P.snapBox({ left: 500, top: 250, width: 196, height: 47 }, 'se', LINES, 6);
        assert.equal(s.dx, 4);
        assert.equal(s.dy, 3);
    });

    it('does not snap a centre while resizing', () => {
        // Its centre would be on the picture's (550), but only its right edge is dragged.
        assert.equal(P.snapBox({ left: 500, top: 600, width: 100, height: 30 }, 'e', LINES, 6).dx, 0);
    });

    it('draws guides only for the dragged edges', () => {
        const s = P.snapBox({ left: 400, top: 120, width: 297, height: 30 }, 'e', LINES, 6);
        assert.equal(s.dx, 3);
        assert.deepEqual(s.guides, [{ axis: 'x', at: 700, from: 100, to: 300 }]);
        const n = P.snapBox({ left: 1000, top: 302, width: 50, height: 40 }, 'n', LINES, 6);
        assert.equal(n.dy, -2);
        assert.deepEqual(n.guides, [{ axis: 'y', at: 300, from: 100, to: 1050 }]);
    });

    it('a handle on one side does not snap the other axis', () => {
        assert.equal(P.snapBox({ left: 1000, top: 297, width: 50, height: 40 }, 'e', LINES, 6).dy, 0);
        assert.equal(P.snapBox({ left: 398, top: 600, width: 50, height: 40 }, 's', LINES, 6).dx, 0);
    });
});

describe('resizedBox: a box resized by a handle', () => {
    const box = { left: 480, top: 200, width: 120, height: 40 };

    it('moves only the edges the handle has', () => {
        assert.deepEqual(P.resizedBox(box, 'e', 30, 99), { left: 480, top: 200, width: 150, height: 40 });
        assert.deepEqual(P.resizedBox(box, 's', 99, 10), { left: 480, top: 200, width: 120, height: 50 });
        assert.deepEqual(P.resizedBox(box, 'se', 30, 10), { left: 480, top: 200, width: 150, height: 50 });
    });

    it('moves the left or top edge for a left or top handle, the other edge kept', () => {
        // Dragged 100px left: it grows to the left, its right edge still at 600.
        assert.deepEqual(P.resizedBox(box, 'w', -100, 0), { left: 380, top: 200, width: 220, height: 40 });
        assert.deepEqual(P.resizedBox(box, 'n', 0, 15), { left: 480, top: 215, width: 120, height: 25 });
        assert.deepEqual(P.resizedBox(box, 'nw', 20, -10), { left: 500, top: 190, width: 100, height: 50 });
        assert.deepEqual(P.resizedBox(box, 'ne', 20, -10), { left: 480, top: 190, width: 140, height: 50 });
        assert.deepEqual(P.resizedBox(box, 'sw', -20, 10), { left: 460, top: 200, width: 140, height: 50 });
    });

    it('is never less than 1px: a dragged edge stops 1px short of the one across from it', () => {
        assert.deepEqual(P.resizedBox(box, 'w', 500, 0), { left: 599, top: 200, width: 1, height: 40 });
        assert.deepEqual(P.resizedBox(box, 'n', 0, 90), { left: 480, top: 239, width: 120, height: 1 });
        assert.deepEqual(P.resizedBox(box, 'e', -500, 0), { left: 480, top: 200, width: 1, height: 40 });
        assert.deepEqual(P.resizedBox(box, 'se', -120, -40), { left: 480, top: 200, width: 1, height: 1 });
    });

    it('leaves a line drawn straight 0px across', () => {
        const line = { left: 10, top: 50, width: 200, height: 0 };
        assert.deepEqual(P.resizedBox(line, 'e', 40, 0), { left: 10, top: 50, width: 240, height: 0 });
        assert.deepEqual(P.resizedBox(line, 's', 0, -5), { left: 10, top: 50, width: 200, height: 0 });
    });

    it('puts the snapped edge on the guide drawn for it, for every handle', () => {
        // A rectangle whose right edge is at 380 and bottom at 150, as the
        // overlay snaps a resize: the box where the pointer is, snapped,
        // then resized again by the snapped amount.
        const lines = P.snapLines([{ left: 80, top: 50, width: 300, height: 100 }]);
        for (const [h, dx, dy] of [['w', -97, 0], ['n', 0, -47], ['nw', -97, -47], ['ne', 0, -47], ['sw', -97, 0]]) {
            const snapped = P.snapBox(P.resizedBox(box, h, dx, dy), h, lines, 6);
            const shown = P.resizedBox(box, h, dx + snapped.dx, dy + snapped.dy);
            assert.ok(snapped.guides.length, h);
            for (const g of snapped.guides) {
                const edge = g.axis === 'x' ? shown.left : shown.top;
                assert.equal(edge, g.at, `${h}: the ${g.axis === 'x' ? 'left' : 'top'} edge is on the guide`);
            }
            // The edge across from the handle has not moved.
            if (h.includes('w')) assert.equal(shown.left + shown.width, 600, h);
            if (h.includes('n')) assert.equal(shown.top + shown.height, 240, h);
        }
    });
});

// A drawing as the overlay snaps it (src/pageShell.ts): the corner pressed
// stays, the pointer's corner snaps as a resize by that corner, and the
// size made goes by the pointer's own travel (drawnSize). The box made, or
// null when nothing is.
function drawn(lines, from, to, line = false) {
    const h = P.drawnHandle(from, to);
    const box = { left: Math.min(from.x, to.x), top: Math.min(from.y, to.y), width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) };
    const s = P.snapBox(box, h, lines, 6);
    const last = { x: to.x + (/[ew]/.test(h) ? s.dx : 0), y: to.y + (/[ns]/.test(h) ? s.dy : 0) };
    const size = P.drawnSize({ x: to.x - from.x, y: to.y - from.y }, Math.abs(last.x - from.x), Math.abs(last.y - from.y), line);
    if (!size.moved) return null;
    return { left: Math.min(from.x, last.x), top: Math.min(from.y, last.y), width: size.w, height: size.h, guides: s.guides };
}
const sized = (b) => b && { left: b.left, top: b.top, width: b.width, height: b.height };

describe('snapping keeps what is drawn', () => {
    it('a row of 30 uptime bars, 8x40 and 4px apart, each drawn by dragging, keeps every size and gap', () => {
        const made = [];
        for (let i = 0; i < 30; i++) {
            const left = 100 + i * 12;
            const lines = P.snapLines([PAGE, ...made]);
            // Left to right, and every other one from its bottom-right corner up.
            const bar = i % 2 ? drawn(lines, { x: left + 8, y: 240 }, { x: left, y: 200 }) : drawn(lines, { x: left, y: 200 }, { x: left + 8, y: 240 });
            assert.deepEqual(sized(bar), { left, top: 200, width: 8, height: 40 }, `bar ${i}`);
            made.push(sized(bar));
        }
    });

    it('10px bars 4.7px apart stay 10px wide and 4.7px apart', () => {
        const made = [];
        for (let i = 0; i < 20; i++) {
            const left = 100 + i * 14.7;
            const bar = drawn(P.snapLines([PAGE, ...made]), { x: left, y: 200 }, { x: left + 10, y: 260 });
            assert.equal(bar.left, left, `bar ${i}`);
            assert.equal(bar.width, 10, `bar ${i}`);
            made.push(sized(bar));
        }
    });

    it('still lines up the bars: one drawn a px too tall ends with the one before it', () => {
        const lines = P.snapLines([PAGE, { left: 100, top: 200, width: 8, height: 40 }]);
        assert.deepEqual(sized(drawn(lines, { x: 112, y: 200 }, { x: 120, y: 241 })), { left: 112, top: 200, width: 8, height: 40 });
    });

    it('tiny boxes, 4x4 and 10x10, drawn right beside others keep their size and place', () => {
        const others = P.snapLines([PAGE, BUTTON, PICTURE, { left: 300, top: 600, width: 4, height: 4 }]);
        // Each 1-3px from the button's or picture's edges, or from the dot.
        for (const [x, y, w] of [[222, 302, 4], [96, 337, 4], [397, 98, 10], [702, 295, 10], [306, 602, 4], [306, 598, 10]]) {
            assert.deepEqual(sized(drawn(others, { x, y }, { x: x + w, y: y + w })), { left: x, top: y, width: w, height: w }, `${w}x${w} at ${x}, ${y}`);
            assert.deepEqual(sized(drawn(others, { x: x + w, y: y + w }, { x, y })), { left: x, top: y, width: w, height: w }, `${w}x${w} at ${x}, ${y}, drawn up`);
        }
    });

    it('an 8x8 dot drawn with both corners near one guide is still made, at 8x8', () => {
        // Its corners 2px either side of the button's top (300).
        const lines = P.snapLines([PAGE, BUTTON]);
        assert.deepEqual(sized(drawn(lines, { x: 400, y: 298 }, { x: 408, y: 306 })), { left: 400, top: 298, width: 8, height: 8 });
    });

    it('the corner pressed stays exactly where it was pressed', () => {
        // Pressed 6px from the picture's left (400) and 4px under its top: neither moves it.
        const lines = P.snapLines([PAGE, PICTURE]);
        const box = drawn(lines, { x: 394, y: 104 }, { x: 494, y: 204 });
        assert.equal(box.left, 394);
        assert.equal(box.top, 104);
        // The pointer's corner did snap: its bottom onto the picture's middle (200).
        assert.equal(box.height, 96);
    });

    it('a 1px grid line, or a shape dragged flat, is never made 0px across', () => {
        const lines = P.snapLines([PAGE, PICTURE]);
        // A rect dragged 300px along the picture's middle, 1px tall.
        assert.deepEqual(sized(drawn(lines, { x: 400, y: 200 }, { x: 700, y: 201 })), { left: 400, top: 200, width: 300, height: 1 });
        // Dragged flat: 1px, not 0.
        assert.deepEqual(sized(drawn(lines, { x: 400, y: 150 }, { x: 700, y: 150 })), { left: 400, top: 150, width: 300, height: 1 });
        // A line drawn straight keeps its 0: its stroke shows it.
        assert.deepEqual(sized(drawn(lines, { x: 400, y: 150 }, { x: 700, y: 150 }, true)), { left: 400, top: 150, width: 300, height: 0 });
    });

    it('a small box resized next to others keeps the size the pointer gives it', () => {
        const lines = P.snapLines([PAGE, BUTTON, { left: 230, top: 300, width: 4, height: 4 }]);
        // A 10x10 box 2px right of the button, its right edge dragged to 1px from the dot.
        assert.equal(P.snapBox({ left: 222, top: 300, width: 7, height: 10 }, 'e', lines, 6).dx, 0);
        assert.equal(P.snapBox({ left: 222, top: 300, width: 10, height: 10 }, 'w', lines, 6).dx, 0);
        assert.equal(P.snapBox({ left: 222, top: 300, width: 10, height: 4 }, 's', lines, 6).dy, 0);
        // No guide along an axis it is too small to snap on, even lying on a line.
        assert.deepEqual(P.snapBox({ left: 220, top: 300, width: 10, height: 10 }, 'se', lines, 6).guides, []);
    });

    it('a snap changes a size by a quarter of it at most', () => {
        // 16px wide, its right edge 5px short of the picture's left: a quarter is 4px.
        const lines = P.snapLines([PAGE, PICTURE]);
        assert.equal(P.snapBox({ left: 379, top: 600, width: 16, height: 30 }, 'e', lines, 6).dx, 0);
        assert.equal(P.snapBox({ left: 380, top: 600, width: 16, height: 30 }, 'e', lines, 6).dx, 4);
        assert.equal(P.snapBox({ left: 375, top: 600, width: 20, height: 30 }, 'e', lines, 6).dx, 5);
    });

    it('a small element moved near others does not jump; moving keeps the size anyway', () => {
        const lines = P.snapLines([PAGE, BUTTON]);
        // A 10x10 icon 2px off the button's left and top.
        assert.deepEqual(P.snapBox({ left: 102, top: 302, width: 10, height: 10 }, 'move', lines, 6), { dx: 0, dy: 0, guides: [] });
        // A thin bar moves on its long axis only.
        const bar = P.snapBox({ left: 102, top: 303, width: 8, height: 40 }, 'move', lines, 6);
        assert.equal(bar.dx, 0);
        assert.equal(bar.dy, -3);
        assert.ok(bar.guides.every((g) => g.axis === 'y'));
    });

    it('never closes a gap left between neighbours, however small', () => {
        // Cards 120x80; a new one 3px right of the first, and one 3px under it.
        const card = { left: 100, top: 100, width: 120, height: 80 };
        const lines = P.snapLines([PAGE, card]);
        assert.deepEqual(sized(drawn(lines, { x: 223, y: 100 }, { x: 343, y: 180 })), { left: 223, top: 100, width: 120, height: 80 });
        assert.deepEqual(sized(drawn(lines, { x: 343, y: 100 }, { x: 223, y: 180 })), { left: 223, top: 100, width: 120, height: 80 });
        // Moved 3px from it, or resized to 2px from it: the gap stays.
        assert.equal(P.snapBox({ left: 223, top: 100, width: 120, height: 80 }, 'move', lines, 6).dx, 0);
        assert.equal(P.snapBox({ left: 100, top: 183, width: 120, height: 80 }, 'move', lines, 6).dy, 0);
        assert.equal(P.snapBox({ left: 222, top: 100, width: 120, height: 80 }, 'w', lines, 6).dx, 0);
        assert.equal(P.snapBox({ left: -22, top: 100, width: 120, height: 80 }, 'e', lines, 6).dx, 0);
        // Overlapping it by 2px, it is pushed out to touch it.
        assert.equal(P.snapBox({ left: 218, top: 100, width: 120, height: 80 }, 'move', lines, 6).dx, 2);
        // Not beside it (lower down the page), its left lines up with the card's right as before.
        assert.equal(P.snapBox({ left: 223, top: 400, width: 120, height: 80 }, 'move', lines, 6).dx, -3);
    });

    it('still lines up normal-sized elements: edges, centres and the page', () => {
        const lines = P.snapLines([PAGE, PICTURE]);
        // A card drawn under the picture, its right edge 3px past the picture's.
        const card = drawn(lines, { x: 400, y: 340 }, { x: 703, y: 500 });
        assert.deepEqual(sized(card), { left: 400, top: 340, width: 300, height: 160 });
        assert.deepEqual(card.guides, [{ axis: 'x', at: 700, from: 100, to: 500 }]);
        // Centred under it by a move 2px off.
        assert.equal(P.snapBox({ left: 502, top: 400, width: 100, height: 60 }, 'move', lines, 6).dx, -2);
        // Against the page's left.
        assert.equal(P.snapBox({ left: 4, top: 400, width: 100, height: 60 }, 'move', lines, 6).dx, -4);
    });
});

describe('drawnHandle and drawnSize: a drawing\'s corner and size', () => {
    it('is the corner the pointer is at, from the one pressed', () => {
        assert.equal(P.drawnHandle({ x: 10, y: 10 }, { x: 20, y: 30 }), 'se');
        assert.equal(P.drawnHandle({ x: 10, y: 10 }, { x: 0, y: 0 }), 'nw');
        assert.equal(P.drawnHandle({ x: 10, y: 10 }, { x: 20, y: 10 }), 'e');
        assert.equal(P.drawnHandle({ x: 10, y: 10 }, { x: 10, y: 10 }), '');
    });

    it('goes by how far the pointer went: a click is 0 by 0, not moved', () => {
        assert.deepEqual(P.drawnSize({ x: 2, y: -3 }, 0, 0, false), { w: 0, h: 0, moved: false });
        assert.deepEqual(P.drawnSize({ x: 8, y: 8 }, 8, 8, false), { w: 8, h: 8, moved: true });
        // Dragged 4px, though the box came to nothing: made, 1px each way.
        assert.deepEqual(P.drawnSize({ x: 0, y: 4 }, 0, 0, false), { w: 1, h: 1, moved: true });
        assert.deepEqual(P.drawnSize({ x: 300, y: 0 }, 300, 0, true), { w: 300, h: 0, moved: true });
    });
});

describe('snapBox: many elements', () => {
    it('stays fast with hundreds of elements on the page', () => {
        const boxes = [];
        for (let i = 0; i < 400; i++) boxes.push({ left: (i % 20) * 70, top: Math.floor(i / 20) * 45, width: 60, height: 30 });
        const lines = P.snapLines(boxes);
        const started = process.hrtime.bigint();
        for (let i = 0; i < 10000; i++) P.snapBox({ left: i % 1400, top: i % 900, width: 80, height: 40 }, 'move', lines, 6);
        const ms = Number(process.hrtime.bigint() - started) / 1e6;
        // 10,000 moves: about one frame each would be 160 seconds.
        assert.ok(ms < 1000, `${ms}ms`);
    });

    it('finds the same line as looking at every one', () => {
        const boxes = [];
        for (let i = 0; i < 50; i++) boxes.push({ left: (i * 37) % 900, top: (i * 53) % 700, width: 20 + (i % 7) * 11, height: 15 + (i % 5) * 9 });
        const lines = P.snapLines(boxes);
        for (let at = -10; at < 1000; at += 3.5) {
            const box = { left: at, top: at % 700, width: 33, height: 24 };
            const { dx, dy } = P.snapBox(box, 'move', lines, 6);
            // Every line looked at, but none that would close a gap to an element beside the box.
            const best = (list, start, size, from, to) => {
                const end = start + size;
                const closes = (d) => list.some((m) => m.from <= to && m.to >= from
                    && ((d < 0 && m.side === 1 && m.at >= start + d && m.at < start) || (d > 0 && m.side === 0 && m.at > end && m.at <= end + d)));
                let shift = 0, d = Infinity;
                for (const part of [0, 0.5, 1]) for (const l of list) {
                    const gap = Math.abs(l.at - (start + size * part));
                    if (gap <= 6 && gap < d && !closes(l.at - (start + size * part))) { d = gap; shift = l.at - (start + size * part); }
                }
                return shift;
            };
            assert.equal(Math.abs(dx), Math.abs(best(lines.x, box.left, box.width, box.top, box.top + box.height)), `x at ${at}`);
            assert.equal(Math.abs(dy), Math.abs(best(lines.y, box.top, box.height, box.left, box.left + box.width)), `y at ${at}`);
        }
    });
});

describe('boxFieldValue: a number typed into X, Y, Width or Height', () => {
    it('is a whole number of px', () => {
        assert.equal(P.boxFieldValue('120', 'x'), 120);
        assert.equal(P.boxFieldValue(' 12.6 ', 'width'), 13);
        assert.equal(P.boxFieldValue('80px', 'height'), 80);
    });

    it('may be less than 0 for a place, never for a size', () => {
        assert.equal(P.boxFieldValue('-40', 'x'), -40);
        assert.equal(P.boxFieldValue('-40', 'y'), -40);
        assert.equal(P.boxFieldValue('-40', 'width'), 0);
        assert.equal(P.boxFieldValue('-1', 'height'), 0);
    });

    it('goes no further than the most either way', () => {
        assert.equal(P.boxFieldValue('1e9', 'x'), 100000);
        assert.equal(P.boxFieldValue('-1e9', 'y'), -100000);
        assert.equal(P.boxFieldValue('500000', 'width'), 100000);
        assert.equal(P.boxFieldValue('5000', 'width', 3840), 3840);
    });

    it('is null when emptied or not a number, so the field puts back what it showed', () => {
        for (const typed of ['', '   ', 'abc', '12abc', 'NaN', 'Infinity', undefined, null]) {
            assert.equal(P.boxFieldValue(typed, 'x'), null, String(typed));
        }
    });
});

describe('boxFieldDeclarations: the edit a box field makes', () => {
    // An element placed on a page made in Draw2Code: its rule's numbers are its box.
    const placed = { box: { left: 100, top: 300, width: 120, height: 40 }, left: 100, top: 300, placed: true,
        extraWidth: 0, extraHeight: 0, grows: false, inline: false };

    it('moves a placed element: its left or top', () => {
        assert.deepEqual(P.boxFieldDeclarations('x', 150, placed), { left: '150px' });
        assert.deepEqual(P.boxFieldDeclarations('y', -20, placed), { top: '-20px' });
    });

    it('resizes it: its width or height', () => {
        assert.deepEqual(P.boxFieldDeclarations('width', 200, placed), { width: '200px' });
        assert.deepEqual(P.boxFieldDeclarations('height', 0, placed), { height: '0px' });
    });

    it('writes nothing for the number the field shows already', () => {
        for (const [field, value] of [['x', 100], ['y', 300], ['width', 120], ['height', 40]]) {
            assert.equal(P.boxFieldDeclarations(field, value, placed), null, field);
        }
        // The field shows whole px: 100.4 is shown as 100, so 100 is no change.
        assert.equal(P.boxFieldDeclarations('x', 100, { ...placed, box: { ...placed.box, left: 100.4 } }), null);
        assert.equal(P.boxFieldDeclarations('x', NaN, placed), null);
    });

    it('moves an element by the difference from where it is shown, whatever its offsets', () => {
        // Its rule says left 10px, but it shows at 90 in the page (a wrapper's padding, say).
        const offset = { ...placed, box: { ...placed.box, left: 90 }, left: 10 };
        assert.deepEqual(P.boxFieldDeclarations('x', 100, offset), { left: '20px' });
    });

    it('nudges an element in the page\'s flow, as a drag does: relative offsets', () => {
        const flow = { ...placed, placed: false, left: 0, top: 0, box: { left: 20, top: 156, width: 224, height: 42 } };
        assert.deepEqual(P.boxFieldDeclarations('x', 50, flow), { position: 'relative', left: '30px' });
        assert.deepEqual(P.boxFieldDeclarations('y', 150, flow), { position: 'relative', top: '-6px' });
    });

    it('takes the padding and border of a content-box element off its CSS size', () => {
        const card = { ...placed, box: { left: 20, top: 156, width: 224, height: 42 }, extraWidth: 24, extraHeight: 24 };
        assert.deepEqual(P.boxFieldDeclarations('width', 300, card), { width: '276px' });
        assert.deepEqual(P.boxFieldDeclarations('height', 10, card), { height: '0px' });
    });

    it('gives a text that grows with its words a least height', () => {
        const text = { ...placed, grows: true, box: { left: 400, top: 100, width: 300, height: 60 } };
        assert.deepEqual(P.boxFieldDeclarations('height', 90, text), { 'min-height': '90px', height: '' });
        assert.deepEqual(P.boxFieldDeclarations('width', 250, text), { width: '250px' });
    });

    it('makes an inline element inline-block, so it takes a size', () => {
        const link = { ...placed, inline: true, box: { left: 40, top: 218, width: 25, height: 17 } };
        assert.deepEqual(P.boxFieldDeclarations('width', 80, link), { width: '80px', display: 'inline-block' });
        assert.deepEqual(P.boxFieldDeclarations('x', 50, link), { left: '110px' });
    });
});

describe('dragsFreely: the key that turns snapping off', () => {
    const held = (mods = {}) => ({ ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

    it('is Ctrl, or Cmd on a Mac', () => {
        assert.equal(P.dragsFreely(held({ ctrlKey: true })), true);
        assert.equal(P.dragsFreely(held({ metaKey: true })), true);
        assert.equal(P.dragsFreely(held({ ctrlKey: true, shiftKey: true })), true);
    });

    it('is never Alt: letting it go opens VS Code\'s menu bar on Linux and Windows', () => {
        assert.equal(P.dragsFreely(held({ altKey: true })), false);
        assert.equal(P.dragsFreely(held({ shiftKey: true })), false);
        assert.equal(P.dragsFreely(held()), false);
    });

    it('follows the key as it is let go: a keyup of Control no longer has it held', () => {
        // What the overlay sees from a press of Ctrl and its release mid-drag.
        assert.equal(P.dragsFreely({ key: 'Control', ctrlKey: true, metaKey: false }), true);
        assert.equal(P.dragsFreely({ key: 'Control', ctrlKey: false, metaKey: false }), false);
    });
});

describe('isFreeKey: the keys the overlay follows while a drag is held', () => {
    it('is Control and Meta (Cmd), not Alt or Shift', () => {
        assert.equal(P.isFreeKey('Control'), true);
        assert.equal(P.isFreeKey('Meta'), true);
        assert.equal(P.isFreeKey('Alt'), false);
        assert.equal(P.isFreeKey('Shift'), false);
        assert.equal(P.isFreeKey('c'), false);
    });

    it('is what the editor\'s drags follow (src/pageShell.ts freeWatcher)', () => {
        const html = shellHtml({ editor: true });
        assert.ok(html.includes(`const isFreeKey = ${P.isFreeKey.toString()};`));
        assert.ok(html.includes('if (isFreeKey(e.key)) changed(dragsFreely(e));'));
    });
});

describe('drawnInColumn: a box drawn, as the extension writes it', () => {
    it('a widget clicked near the right side, at its default size, is moved in', () => {
        const size = M.defaultSize('button');
        const drawn = P.drawnInColumn({ x: 1440 - 10, y: 200, w: size.w, h: size.h }, 1440);
        assert.deepEqual(drawn, { x: 1440 - size.w, y: 200, w: size.w, h: size.h });
    });

    it('one clicked past the left side starts at 0', () => {
        assert.deepEqual(P.drawnInColumn({ x: -30, y: 5, w: 120, h: 40 }, 1440), { x: 0, y: 5, w: 120, h: 40 });
    });

    it('one wider than the column is as wide as it, in whole px', () => {
        assert.deepEqual(P.drawnInColumn({ x: 10, y: 0, w: 900, h: 40 }, 600.5), { x: 0, y: 0, w: 601, h: 40 });
    });

    it('inside, or with no column (another page), it is the same box', () => {
        const box = { x: 100, y: 0, w: 120, h: 40 };
        assert.deepEqual(P.drawnInColumn(box, 1440), box);
        assert.equal(P.drawnInColumn({ x: 2000, y: 0, w: 120, h: 40 }, 0).x, 2000);
        assert.equal(P.drawnInColumn({ x: 2000, y: 0, w: 120, h: 40 }, NaN).x, 2000);
    });
});

describe('the column in the editor (src/pageShell.ts)', () => {
    it('is its two dashed sides only: nothing over or behind the page beside it', () => {
        const html = shellHtml({ editor: true });
        assert.ok(html.includes('id="column-left"') && html.includes('id="column-right"'));
        assert.doesNotMatch(html, /column-veil/);
    });

    it('is not in the Site Preview', () => {
        assert.ok(!shellHtml().includes('id="column-left"'));
    });
});

describe('the page\'s column: what is kept inside it', () => {
    // A 1440px column starting 240px in, in the document's coordinates.
    const COLUMN = { left: 240, right: 1680 };
    const box = (left, width) => ({ left, top: 50, width, height: 40 });

    it('boxInColumn: a box past a side stops at it; one inside is the same box', () => {
        assert.deepEqual(P.boxInColumn(box(400, 100), COLUMN), box(400, 100));
        assert.deepEqual(P.boxInColumn(box(200, 100), COLUMN), box(240, 100));
        assert.deepEqual(P.boxInColumn(box(1600, 100), COLUMN), box(1580, 100));
        // Exactly at a side is inside.
        assert.deepEqual(P.boxInColumn(box(1580, 100), COLUMN), box(1580, 100));
    });

    it('boxInColumn: a box wider than the column is made as wide as it, from its left side', () => {
        assert.deepEqual(P.boxInColumn(box(100, 1600), COLUMN), box(240, 1440));
        assert.deepEqual(P.boxInColumn(box(900, 1440), COLUMN), box(240, 1440));
    });

    it('boxesInColumn: several go in together, keeping their places to each other', () => {
        assert.deepEqual(P.boxesInColumn([box(1500, 100), box(1620, 100)], COLUMN), [box(1460, 100), box(1580, 100)]);
        assert.deepEqual(P.boxesInColumn([box(400, 100), box(600, 100)], COLUMN), [box(400, 100), box(600, 100)]);
        assert.deepEqual(P.boxesInColumn([], COLUMN), []);
    });

    it('boxesInColumn: when even the box around them is too wide, each goes in on its own', () => {
        assert.deepEqual(P.boxesInColumn([box(100, 100), box(1650, 100), box(300, 2000)], COLUMN), [box(240, 100), box(1580, 100), box(240, 1440)]);
    });

    it('boxCutToColumn: a side dragged past an edge stops at it, the other stays', () => {
        assert.deepEqual(P.boxCutToColumn(box(1500, 300), COLUMN), box(1500, 180));
        assert.deepEqual(P.boxCutToColumn(box(100, 300), COLUMN), box(240, 160));
        assert.deepEqual(P.boxCutToColumn(box(100, 2000), COLUMN), box(240, 1440));
        assert.deepEqual(P.boxCutToColumn(box(400, 300), COLUMN), box(400, 300));
        // Wholly outside, nothing is left: 0px wide at the nearer edge.
        assert.deepEqual(P.boxCutToColumn(box(1800, 50), COLUMN), box(1680, 0));
        assert.deepEqual(P.boxCutToColumn(box(0, 50), COLUMN), box(240, 0));
    });

    it('a resize by the right handle, snapped and then kept in: the edge stops at the wrapper\'s line, a guide there', () => {
        const lines = P.snapLines([{ left: 240, top: 0, width: 1440, height: 900 }]);
        const shown = P.resizedBox(box(1500, 100), 'e', 300, 0);
        const cut = P.boxCutToColumn(shown, COLUMN);
        assert.equal(cut.left + cut.width, 1680);
        assert.deepEqual(P.snapBox(cut, 'e', lines, 0).guides.map((g) => [g.axis, g.at]), [['x', 1680]]);
    });

    it('xInColumn: a drawing\'s corner or a pen stroke stops at a side', () => {
        assert.equal(P.xInColumn(100, COLUMN), 240);
        assert.equal(P.xInColumn(1700.5, COLUMN), 1680);
        assert.equal(P.xInColumn(900, COLUMN), 900);
    });

    it('fieldInColumn: a typed x or width that would cross a side is kept in (the column\'s left is 0)', () => {
        const shown = { left: 1200, top: 30, width: 200, height: 40 };
        assert.equal(P.fieldInColumn('x', 1300, shown, 1440), 1240);
        assert.equal(P.fieldInColumn('x', -20, shown, 1440), 0);
        assert.equal(P.fieldInColumn('x', 500, shown, 1440), 500);
        assert.equal(P.fieldInColumn('width', 400, shown, 1440), 240);
        assert.equal(P.fieldInColumn('width', 100, shown, 1440), 100);
        // A box wider than the column can only be at 0; y and height are as typed.
        assert.equal(P.fieldInColumn('x', 30, { ...shown, width: 1600 }, 1440), 0);
        assert.equal(P.fieldInColumn('y', 5000, shown, 1440), 5000);
        assert.equal(P.fieldInColumn('height', 3000, shown, 1440), 3000);
    });

    it('fieldInColumn with boxFieldDeclarations: x at its most already writes nothing', () => {
        const el = { box: { left: 1240, top: 30, width: 200, height: 40 }, left: 1240, top: 30, placed: true, extraWidth: 0, extraHeight: 0, grows: false, inline: false };
        assert.equal(P.boxFieldDeclarations('x', P.fieldInColumn('x', 1400, el.box, 1440), el), null);
        assert.deepEqual(P.boxFieldDeclarations('x', P.fieldInColumn('x', 1400, el.box, 1000), el), { left: '800px' });
    });
});

describe('placement: copied into the overlay', () => {
    it('runs on its own, as src/pageShell.ts copies it', () => {
        // src/pageShell.ts writes the functions' text into the page script.
        const copied = new Function(`
            const snapLines = ${P.snapLines.toString()};
            const firstLineFrom = ${P.firstLineFrom.toString()};
            const snapBox = ${P.snapBox.toString()};
            const resizedBox = ${P.resizedBox.toString()};
            const boxFieldValue = ${P.boxFieldValue.toString()};
            const boxFieldDeclarations = ${P.boxFieldDeclarations.toString()};
            const dragsFreely = ${P.dragsFreely.toString()};
            const boxInColumn = ${P.boxInColumn.toString()};
            const boxesInColumn = ${P.boxesInColumn.toString()};
            const boxCutToColumn = ${P.boxCutToColumn.toString()};
            const xInColumn = ${P.xInColumn.toString()};
            const fieldInColumn = ${P.fieldInColumn.toString()};
            return { snapLines, snapBox, resizedBox, boxFieldValue, boxFieldDeclarations, dragsFreely, boxesInColumn, boxCutToColumn, xInColumn, fieldInColumn };`)();
        const lines = copied.snapLines([PAGE, BUTTON, PICTURE]);
        assert.deepEqual(lines, LINES);
        const box = { left: 396, top: 500, width: 300, height: 50 };
        assert.deepEqual(copied.snapBox(box, 'move', lines, 6), P.snapBox(box, 'move', LINES, 6));
        assert.deepEqual(copied.resizedBox(BUTTON, 'w', -20, 0), { left: 80, top: 300, width: 140, height: 40 });
        assert.equal(copied.boxFieldValue('-7', 'width'), 0);
        assert.deepEqual(copied.boxFieldDeclarations('height', 90, { box: BUTTON, left: 0, top: 0, placed: true, extraWidth: 0, extraHeight: 0, grows: true, inline: false }),
            { 'min-height': '90px', height: '' });
        assert.equal(copied.dragsFreely({ ctrlKey: true, metaKey: false }), true);
        assert.equal(copied.dragsFreely({ ctrlKey: false, metaKey: false, altKey: true }), false);
        const column = { left: 0, right: 1440 };
        assert.deepEqual(copied.boxesInColumn([BUTTON, { ...PICTURE, left: 1300 }, { ...PICTURE, width: 2000 }], column),
            [BUTTON, { ...PICTURE, left: 1140 }, { ...PICTURE, left: 0, width: 1440 }]);
        assert.deepEqual(copied.boxCutToColumn({ ...PICTURE, left: 1300 }, column), { ...PICTURE, left: 1300, width: 140 });
        assert.equal(copied.xInColumn(-4, column), 0);
        assert.equal(copied.fieldInColumn('width', 2000, BUTTON, 1440), 1340);
    });
});
