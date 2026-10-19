// Exact placement in the page editor: the x, y, width and height fields, and
// the guides a box snaps to while it is moved, resized or drawn.
//
// The fields show the selected element's box in the page's coordinates: from
// the top-left of the page's wrapper (<div class="page">) on a page made in
// Draw2Code, so they read what its rule says, and from the top-left of the
// page itself on any other page. A number typed there is written as the
// same edit a drag makes (src/pageShell.ts): a move changes the element's
// left or top, a resize its width or height. Text and Heading grow with
// their words, so for them the height is the least height (min-height):
// the field shows how tall the box really is, and a smaller number only
// lets it shrink back to its words.
//
// Snapping: while a box is dragged, its edges and centres are pulled onto
// the edges and centres of the other elements beside it and of the page's
// wrapper, when one is within a few px. It never undoes what is drawn: a
// moved box keeps its size, a small box does not snap, a snap changes a
// size by a quarter at most, and a gap left between neighbours stays
// (snapBox). The lines are measured once, when
// the drag starts, and kept sorted, so each move only halves its way to the
// nearest one: fast with many elements on the page. Ctrl (Cmd on a Mac)
// held while dragging turns it off, as in design tools.
//
// The page's column: on a page made in Draw2Code, everything but a full-width
// element is kept inside the centred column the project's page width wide.
// A box moved past a side stops at it, and one wider than the column is made
// as wide as it (boxInColumn); several moved together go in as one, so they
// keep their places to each other (boxesInColumn). A side being dragged, a
// resize's or a drawing's, stops at the column's edge (boxCutToColumn, the
// x of a point: xInColumn), and a typed x or width is kept so that the box
// does not cross one (fieldInColumn). The editor draws the column's sides
// (src/pageShell.ts), so it is seen where the box stops.
//
// The functions are copied into the overlay as they are (src/pageShell.ts),
// so they use nothing outside themselves and each other.
//
// Plain Node - no vscode import - so test/placement.test.js can run it.

/** A box in px: from the left, from the top, how wide, how tall. */
export interface Box {
    left: number;
    top: number;
    width: number;
    height: number;
}

/**
 * A line a box snaps to: x (or y) = `at`, along an element reaching from
 * `from` to `to` on the other axis. `side` is which of the element's
 * lines it is: 0 its left (top), 0.5 its centre, 1 its right (bottom).
 */
export interface Line {
    at: number;
    from: number;
    to: number;
    side: 0 | 0.5 | 1;
}

/** Every line, upright ones (x) and level ones (y), each list sorted by where it is. */
export interface Lines {
    x: Line[];
    y: Line[];
}

/** A guide to draw: the line x (or y) = `at`, from `from` to `to`. */
export interface Guide {
    axis: 'x' | 'y';
    at: number;
    from: number;
    to: number;
}

/** How far a snapped box moves (dx, dy), and the guides it lies on. */
export interface Snap {
    dx: number;
    dy: number;
    guides: Guide[];
}

/**
 * The lines the boxes give: each one's left, centre and right, and its top,
 * middle and bottom. A box with no size at all (hidden) gives none; a line
 * drawn straight, 0px wide, still does.
 */
export function snapLines(boxes: Box[]): Lines {
    const x: Line[] = [];
    const y: Line[] = [];
    for (const b of boxes) {
        if (!b || !(b.width > 0 || b.height > 0)) continue;
        if (![b.left, b.top, b.width, b.height].every(Number.isFinite)) continue;
        const right = b.left + b.width;
        const bottom = b.top + b.height;
        for (const side of [0, 0.5, 1] as const) {
            x.push({ at: b.left + b.width * side, from: b.top, to: bottom, side });
            y.push({ at: b.top + b.height * side, from: b.left, to: right, side });
        }
    }
    const order = (a: Line, b: Line): number => a.at - b.at;
    return { x: x.sort(order), y: y.sort(order) };
}

/** Where the first line at or past `value` is in the sorted list (its length when there is none). */
export function firstLineFrom(lines: Line[], value: number): number {
    let lo = 0;
    let hi = lines.length;
    while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (lines[mid].at < value) lo = mid + 1;
        else hi = mid;
    }
    return lo;
}

/**
 * Snap a box being dragged. `how` is what the drag does to it:
 *   'move'  the whole box moves: its edges and centres snap, and it only
 *           ever moves, keeping its size
 *   a handle ('e', 'nw', ...) resizes it: only the edges that handle drags
 *           snap (a drawing is snapped so too, by the corner the pointer
 *           has, the corner pressed staying where it was pressed)
 * A line within `threshold` px of one of those pulls it on, the nearest
 * first: dx and dy are how much further the box (or the edge) goes, 0 when
 * nothing is near. So that a snap helps without undoing what is drawn:
 *   - a box smaller than twice the threshold along an axis does not snap
 *     along it, so small things (dots, thin bars, grid lines) keep the
 *     size and place the pointer gives them; a straight line, 0px across,
 *     counts by its length
 *   - a snap goes no further than a quarter of the box's size along that
 *     axis, so it never changes a size by much
 *   - a snap never closes a gap the pointer leaves between the box and an
 *     element beside it: an edge is not pulled onto, or past, the near
 *     edge of a neighbour it is apart from, however small the gap (bars
 *     drawn 4px apart stay 4px apart)
 * The guides are every snapped edge or centre that now lies on a line,
 * each reaching from the box to the farthest element on that line; none
 * along an axis the box is too small to snap on.
 */
export function snapBox(box: Box, how: string, lines: Lines, threshold: number): Snap {
    const move = how === 'move';
    // Where along the box each edge that may snap is: 0 its start, 0.5 its centre, 1 its end.
    const xs = move ? [0, 0.5, 1] : how.includes('w') ? [0] : how.includes('e') ? [1] : [];
    const ys = move ? [0, 0.5, 1] : how.includes('n') ? [0] : how.includes('s') ? [1] : [];
    // Big enough to snap along an axis, and how far a snap may pull it there.
    const big = (size: number, other: number): boolean => (size > 0 ? size : other) >= 2 * threshold;
    const reach = (size: number, other: number): number => big(size, other) ? Math.min(threshold, (size > 0 ? size : other) / 4) : 0;
    const bigX = big(box.width, box.height);
    const bigY = big(box.height, box.width);
    // Does moving the box by d (its dragged edges: all of them for a move)
    // close a gap to an element beside it? Its start edge pulled back onto
    // or past the end of one before it, or its end edge pushed onto or past
    // the start of one after it. Beside: reaching along the other axis as
    // far as some of the box (from-to).
    const closes = (list: Line[], start: number, size: number, parts: number[], d: number, from: number, to: number): boolean => {
        const beside = (l: Line): boolean => l.from <= to && l.to >= from;
        if (d < 0 && (move || parts[0] === 0)) {
            for (let i = firstLineFrom(list, start + d); i < list.length && list[i].at < start; i++) {
                if (list[i].side === 1 && beside(list[i])) return true;
            }
        }
        const end = start + size;
        if (d > 0 && (move || parts[0] === 1)) {
            for (let i = firstLineFrom(list, end); i < list.length && list[i].at <= end + d; i++) {
                if (list[i].at > end && list[i].side === 0 && beside(list[i])) return true;
            }
        }
        return false;
    };
    const shift = (list: Line[], start: number, size: number, parts: number[], most: number, from: number, to: number): number => {
        let best = 0;
        let distance = Infinity;
        if (!(most > 0)) return 0;
        for (const part of parts) {
            const edge = start + size * part;
            for (let i = firstLineFrom(list, edge - most); i < list.length && list[i].at <= edge + most; i++) {
                const d = list[i].at - edge;
                if (Math.abs(d) < distance && !closes(list, start, size, parts, d, from, to)) {
                    distance = Math.abs(d);
                    best = d;
                }
            }
        }
        return best;
    };
    const dx = shift(lines.x, box.left, box.width, xs, reach(box.width, box.height), box.top, box.top + box.height);
    const dy = shift(lines.y, box.top, box.height, ys, reach(box.height, box.width), box.left, box.left + box.width);
    // The box as it is once snapped: moved, or with the dragged edges moved.
    let { left, top, width, height } = box;
    if (move) {
        left += dx;
        top += dy;
    } else {
        if (xs[0] === 0) { left += dx; width -= dx; } else if (xs[0] === 1) width += dx;
        if (ys[0] === 0) { top += dy; height -= dy; } else if (ys[0] === 1) height += dy;
    }
    const guides: Guide[] = [];
    // The lines within half a px of an edge: those it lies on, as rounded px show it.
    const on = (axis: 'x' | 'y', list: Line[], at: number, from: number, to: number): void => {
        let reach = { from, to };
        let found = false;
        for (let i = firstLineFrom(list, at - 0.5); i < list.length && list[i].at <= at + 0.5; i++) {
            found = true;
            reach = { from: Math.min(reach.from, list[i].from), to: Math.max(reach.to, list[i].to) };
        }
        if (found && !guides.some((g) => g.axis === axis && Math.abs(g.at - at) < 0.5)) guides.push({ axis, at, ...reach });
    };
    if (bigX) for (const part of xs) on('x', lines.x, left + width * part, top, top + height);
    if (bigY) for (const part of ys) on('y', lines.y, top + height * part, left, left + width);
    return { dx, dy, guides };
}

/**
 * The handle a drawing is snapped as (snapBox): the corner the pointer is
 * at, seen from the corner pressed, which stays where it is. Only the
 * sides the pointer has moved away from it snap: none across a line drawn
 * straight.
 */
export function drawnHandle(pressed: { x: number; y: number }, at: { x: number; y: number }): string {
    return (at.y > pressed.y ? 's' : at.y < pressed.y ? 'n' : '') + (at.x > pressed.x ? 'e' : at.x < pressed.x ? 'w' : '');
}

/**
 * The size a drawing is made at, from the pointer's own travel (`moved`:
 * as far as it went from the press, unsnapped) and the box drawn. A press
 * with no drag is 0 by 0, which gives a widget its own size (and a shape
 * nothing). Anything dragged is at least 1px each way, so nothing is made
 * 0px wide or tall, unseen and out of reach of a click; a line drawn
 * straight keeps its 0, the thickness of its stroke showing it.
 */
export function drawnSize(moved: { x: number; y: number }, w: number, h: number, line: boolean): { w: number; h: number; moved: boolean } {
    const far = Math.abs(moved.x) >= 4 || Math.abs(moved.y) >= 4;
    if (!far) return { w: 0, h: 0, moved: false };
    return line ? { w, h, moved: true } : { w: Math.max(1, w), h: Math.max(1, h), moved: true };
}

/**
 * A box resized by a handle dragged dx across and dy down: the edges that
 * handle has move and the others stay where they are ('w' moves the left
 * edge, 'se' the right and the bottom one). It is never less than 1px wide
 * or tall: a dragged edge stops 1px short of the one across from it, so a
 * resize never leaves a box unseen and out of reach of a click. A line
 * drawn straight, 0px across, may stay so. The overlay shows a resize and
 * snaps it with this one box, so a guide lies where the edge is.
 */
export function resizedBox(box: Box, handle: string, dx: number, dy: number): Box {
    let { left, top, width, height } = box;
    const leastWide = box.width > 0 ? 1 : 0;
    const leastTall = box.height > 0 ? 1 : 0;
    if (handle.includes('e')) width = Math.max(leastWide, box.width + dx);
    if (handle.includes('w')) {
        width = Math.max(leastWide, box.width - dx);
        left = box.left + box.width - width;
    }
    if (handle.includes('s')) height = Math.max(leastTall, box.height + dy);
    if (handle.includes('n')) {
        height = Math.max(leastTall, box.height - dy);
        top = box.top + box.height - height;
    }
    return { left, top, width, height };
}

/**
 * Does this press, move or key leave the drag unsnapped? Ctrl (Cmd on a
 * Mac) held. Not Alt: on Linux and Windows VS Code moves the keys to its
 * menu bar when Alt is let go, so the File menu opened after the drag.
 */
export function dragsFreely(e: { ctrlKey: boolean; metaKey: boolean }): boolean {
    return Boolean(e.ctrlKey || e.metaKey);
}

/** Is this key (a KeyboardEvent's key) the one dragsFreely follows, pressed or let go? */
export function isFreeKey(key: string): boolean {
    return key === 'Control' || key === 'Meta';
}

/** The four fields: which part of the box each one is. */
export type BoxField = 'x' | 'y' | 'width' | 'height';

/**
 * A number typed into a box field, as it is written: whole px, a width or
 * height never less than 0, and nothing past `most` either way (well past
 * the widest page and a very long one). An emptied field, or something that
 * is not a number, is null: the field then puts back what it showed.
 */
export function boxFieldValue(typed: string, field: BoxField, most = 100000): number | null {
    const text = String(typed ?? '').trim().replace(/px$/i, '').trim();
    if (text === '') return null;
    const n = Number(text);
    if (!Number.isFinite(n)) return null;
    const least = field === 'width' || field === 'height' ? 0 : -most;
    return Math.max(least, Math.min(most, Math.round(n)));
}

/** What a box field needs to know about the element it changes. */
export interface Placed {
    /** Its box in the page's coordinates, as the fields show it (rounded there). */
    box: Box;
    /** Its offsets now, as its style gives them: what a move changes. */
    left: number;
    top: number;
    /** Placed at exact coordinates (absolute or fixed), or nudged in the page's flow (relative offsets)? */
    placed: boolean;
    /** How much wider and taller its box is than its CSS width and height: the padding and border of a content-box element, 0 for border-box. */
    extraWidth: number;
    extraHeight: number;
    /** Text that grows with its words (Text, Heading): a height is its least height. */
    grows: boolean;
    /** An inline element, which takes a width or height only once it is inline-block. */
    inline: boolean;
}

/**
 * The style edit a box field makes when `value` is typed into it, the same
 * one a drag writes; null when it is what the field shows already, so
 * leaving a field as it was puts nothing in the history.
 *   x, y           the element moves by the difference: its left or top
 *                  (relative offsets for an element in the page's flow)
 *   width, height  the box becomes that size, so its CSS size is the
 *                  number less its padding and border when those are
 *                  outside it; a text that grows gets a least height
 */
export function boxFieldDeclarations(field: BoxField, value: number, el: Placed): Record<string, string> | null {
    const px = (n: number): string => `${Math.round(n)}px`;
    const shown = { x: el.box.left, y: el.box.top, width: el.box.width, height: el.box.height }[field];
    if (!Number.isFinite(value) || value === Math.round(shown)) return null;
    if (field === 'x' || field === 'y') {
        const out: Record<string, string> = field === 'x' ? { left: px(el.left + value - shown) } : { top: px(el.top + value - shown) };
        return el.placed ? out : { position: 'relative', ...out };
    }
    const out: Record<string, string> = field === 'width'
        ? { width: px(Math.max(0, value - el.extraWidth)) }
        : el.grows
            ? { 'min-height': px(Math.max(0, value - el.extraHeight)), height: '' }
            : { height: px(Math.max(0, value - el.extraHeight)) };
    if (el.inline) out.display = 'inline-block';
    return out;
}


/** The page's column: its left and right sides, in the same coordinates as the boxes kept in it. */
export interface Column {
    left: number;
    right: number;
}

/**
 * The box moved across into the column: not past either side, and never
 * wider than the column (then as wide as it, from its left side). A box
 * inside already is the same box.
 */
export function boxInColumn(box: Box, column: Column): Box {
    const width = Math.min(box.width, Math.max(0, column.right - column.left));
    const left = Math.max(column.left, Math.min(box.left, column.right - width));
    return { ...box, left, width };
}

/**
 * A box drawn on a page made in Draw2Code, as the extension writes it (x
 * and y from the column's top-left, whole px), moved into a column this
 * wide (boxInColumn): a widget clicked near a side, at its default size, is
 * then inside. Without a column (0, or no number) it is the same box.
 */
export function drawnInColumn(box: { x: number; y: number; w: number; h: number }, column: number): { x: number; y: number; w: number; h: number } {
    if (!(column > 0)) return box;
    const inside = boxInColumn({ left: box.x, top: box.y, width: box.w, height: box.h }, { left: 0, right: column });
    return { ...box, x: Math.round(inside.left), w: Math.round(inside.width) };
}

/**
 * Boxes moved into the column together: the box around them all goes in
 * whole, so they keep their places to each other. When even that is wider
 * than the column, each one goes in on its own (boxInColumn).
 */
export function boxesInColumn(boxes: Box[], column: Column): Box[] {
    if (!boxes.length) return [];
    const left = Math.min(...boxes.map((b) => b.left));
    const right = Math.max(...boxes.map((b) => b.left + b.width));
    if (right - left > column.right - column.left) return boxes.map((b) => boxInColumn(b, column));
    const dx = boxInColumn({ left, top: 0, width: right - left, height: 0 }, column).left - left;
    return boxes.map((b) => ({ ...b, left: b.left + dx }));
}

/**
 * The box cut to the column: a side past one of the column's stops at it,
 * the other stays where it is. A resize and a drawing are kept in so, the
 * side dragged stopping at the edge; a box sticking out from before (a page
 * made narrower) loses the part outside. Nothing inside is 0px wide, at the
 * nearer edge.
 */
export function boxCutToColumn(box: Box, column: Column): Box {
    const left = Math.max(column.left, Math.min(box.left, column.right));
    const right = Math.min(column.right, Math.max(box.left + box.width, column.left));
    return { ...box, left, width: Math.max(0, right - left) };
}

/** A point's x kept in the column: where a drawing's corner, or a pen stroke, stops. */
export function xInColumn(x: number, column: Column): number {
    return Math.max(column.left, Math.min(x, column.right));
}

/**
 * A number typed into a box field, kept in a column `width` px wide whose
 * left side is 0 (the fields' coordinates on a page made in Draw2Code):
 *   x      no less than 0 and no more than leaves the box inside (0 for a
 *          box wider than the column)
 *   width  no more than reaches the column's right side from where the box
 *          starts
 * y and height are as typed: the page grows downwards. `box` is the box as
 * the fields show it, rounded.
 */
export function fieldInColumn(field: BoxField, value: number, box: Box, width: number): number {
    if (field === 'x') return Math.max(0, Math.min(value, width - Math.min(Math.round(box.width), width)));
    if (field === 'width') return Math.max(0, Math.min(value, width - Math.round(box.left)));
    return value;
}
