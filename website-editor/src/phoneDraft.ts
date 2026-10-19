// The phone layout a page starts with: the first draft, made from the
// page's geometry when its phone view is first opened, and again by Reset
// phone layout. It is only rules for the phone layout's map (src/
// pageEditor.ts phoneKey), edited from there like any others; nothing it
// works out (which band holds what) is kept.
//
// There are no sections in a page made in Draw2Code: a band is a rectangle
// beside its texts, not their parent. So the draft works out what holds
// what from the boxes, as a person would see it:
//
//   - A shape, picture or video at least BAND_SHARE of the page wide is a
//     band. Anything whose box is at least INSIDE of it inside a box is in
//     the smallest box that holds it that way.
//   - A drawing that is only decoration (a circle behind a hero) is hidden
//     on phones (decorations), and holds nothing in the draft.
//   - A band is laid out again: as wide as the phone (one inside another,
//     as wide as what holds it), what is in it stacked top to bottom, and
//     the band as tall as what is in it.
//   - Elements side by side at desktop width (a row: their heights
//     overlap) are kept in reading order, left to right, in as many lines
//     as the width needs; the lines are centred when the row was. A row
//     whose elements are also above one another is columns: each column
//     is stacked, one after the other. Rows that make a grid (steps: their
//     numbers, their titles, their texts) are read column by column when
//     one of them does not fit on a line.
//   - A label or button too long for the phone at its new size has its
//     words on more lines (white-space: normal), as tall as they are.
//   - A smaller shape that holds others (a mock-up of a screen, a card) is
//     one picture: scaled down to fit, what is in it with it, the box round
//     them all within the column.
//   - Everything else is a block of its own in the page's order.
//   - Text is never smaller than fontMin; the rest of a font size is
//     scaled by FONT_SCALE, never up. Text and Heading grow with their
//     words, so they get a least height (min-height): the height the
//     overlay measured for their words at the new width and size
//     (wordsToMeasure, then the draft again with `heights`), or an
//     estimate from their desktop lines when there is none.
//
// Plain Node - no vscode import - so test/phone.test.js can run it.

import type { Overrides } from './pageEdit';

/** An element of the page as the editor shows it at desktop width (the overlay measures it). */
export interface SeenElement {
    /** Its id: what its rules are written for. */
    id: string;
    /** Its box from the column's top-left, in px. */
    x: number;
    y: number;
    w: number;
    h: number;
    /** A drawing, a picture or a video; anything else is a widget. */
    kind?: 'shape' | 'widget';
    /** A drawing (not a picture or a video): only a drawing can be decoration. */
    drawing?: boolean;
    /** Its font size and line height in px, when it has words. */
    fontSize?: number;
    lineHeight?: number;
    /** Text and Heading: they grow with their words, so their height is a least height. */
    grows?: boolean;
    /** A label or a button: its words on one line, which may go on more when too long for a phone. */
    wraps?: boolean;
    /** Full width: as wide as the window wherever it is. */
    full?: boolean;
}

export interface DraftSizes {
    /** The page's width, and the phone's. */
    pageWidth: number;
    phoneWidth: number;
    /** The least font size text is given, in px. */
    fontMin: number;
}

/** How wide a shape must be, as a share of the page, to be a band. */
export const BAND_SHARE = 0.6;
/** How much of an element's box must be inside another's for it to be in it. */
export const INSIDE = 0.9;
/** How much of a font size is kept on a phone (never under fontMin, never more than it was). */
export const FONT_SCALE = 0.65;
/** The phone's margin at each side, and the space between blocks, in px. */
export const MARGIN = 16;
export const GAP = 12;
/** A band's room above and below what is in it: half the desktop's, within these. */
export const PAD_MIN = 16;
export const PAD_MAX = 48;

interface Box { x: number; y: number; w: number; h: number }
interface Node { el: SeenElement; children: Node[]; band: boolean }
type Placed = Map<string, Record<string, string>>;

const px = (n: number): string => `${Math.round(n)}px`;
const area = (b: Box): number => Math.max(0, b.w) * Math.max(0, b.h);
function overlap(a: Box, b: Box): number {
    const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    return w > 0 && h > 0 ? w * h : 0;
}
const holds = (outer: SeenElement, inner: SeenElement): boolean =>
    outer !== inner && outer.kind === 'shape' && area(outer) > area(inner) && overlap(outer, inner) >= INSIDE * area(inner);
const byPlace = (a: Node, b: Node): number => a.el.y - b.el.y || a.el.x - b.el.x;
const byX = (a: Node, b: Node): number => a.el.x - b.el.x || a.el.y - b.el.y;
/** Do their heights overlap (are they beside each other)? Their widths (above each other)? */
const besideEach = (a: Box, b: Box): boolean => a.y < b.y + b.h && b.y < a.y + a.h;
const aboveEach = (a: Box, b: Box): boolean => a.x < b.x + b.w && b.x < a.x + a.w;

/** Only the elements the draft can place: an id a rule can name, and a box. */
function usable(elements: SeenElement[]): SeenElement[] {
    return (Array.isArray(elements) ? elements : []).filter((el) => /^[A-Za-z][\w-]*$/.test(String(el?.id ?? '')) && [el.x, el.y, el.w, el.h].every(Number.isFinite) && el.w >= 0 && el.h >= 0);
}

/**
 * The drawings that are only decoration: no words, smaller than a band, in
 * a band or in nothing, and
 *   - holding nothing and lying more than half over other elements (what
 *     holds it not counted): a circle behind a hero's words (a logo mark
 *     on a nav band is not); or
 *   - holding nothing and, in a band, wider and taller than the tallest
 *     element with words in it: a large circle in the band's empty space
 *     (a divider or an icon is not); or
 *   - behind: holding only what a shape it crosses (neither holds the
 *     other) holds too, which holds more. That shape is the content; this
 *     one is behind it, and would take a mock-up's cards out of it.
 *     Holding the same, the bigger one is behind.
 * What a shape holds is counted without drawings that hold nothing or are
 * behind (a circle behind a mock-up, inside a bigger circle, does not make
 * the bigger one content), and what is decoration holds nothing. So it is
 * all looked for again until nothing changes. A drawing behind something
 * in a card or a mock-up is part of its picture and stays; a picture or a
 * video is never decoration.
 */
function decorations(seen: SeenElement[], pageWidth: number): Set<SeenElement> {
    const out = new Set<SeenElement>();
    const behind = new Set<SeenElement>();
    const band = (el: SeenElement): boolean => el.kind === 'shape' && el.w >= BAND_SHARE * pageWidth;
    const holding = (outer: SeenElement, inner: SeenElement): boolean => !out.has(outer) && holds(outer, inner);
    const content = (outer: SeenElement): SeenElement[] => seen.filter((el) => holding(outer, el)
        && !(el.drawing && (behind.has(el) || !seen.some((one) => holding(el, one)))));
    const tallestWords = (outer: SeenElement): number => Math.max(0, ...seen.filter((el) => el.fontSize && holds(outer, el)).map((el) => el.h));
    for (let found = true; found;) {
        found = false;
        for (const shape of seen) {
            if (out.has(shape) || !shape.drawing || shape.fontSize || band(shape) || area(shape) === 0) continue;
            const inside = content(shape);
            const crossing = seen.filter((el) => el !== shape && !holding(el, shape) && !holding(shape, el) && overlap(shape, el) > 0);
            if (!behind.has(shape) && inside.length && crossing.some((other) => {
                if (other.kind !== 'shape' || out.has(other) || !inside.every((el) => holds(other, el))) return false;
                const theirs = content(other).length;
                return theirs > inside.length || (theirs === inside.length && area(other) < area(shape));
            })) {
                behind.add(shape);
                found = true;
            }
            const holder = seen.filter((el) => holding(el, shape)).sort((a, b) => area(a) - area(b))[0];
            if (holder && !band(holder)) continue;
            const over = crossing.reduce((sum, el) => sum + overlap(shape, el), 0);
            const empty = !inside.length && !seen.some((el) => holding(shape, el) && !el.drawing);
            const large = empty && holder !== undefined && Math.min(shape.w, shape.h) > tallestWords(holder);
            if ((empty && over > area(shape) / 2) || large || behind.has(shape)) {
                out.add(shape);
                found = true;
            }
        }
    }
    return out;
}

/** A text whose words the overlay measures: at this width and font size, on more lines when `wrap`. */
export interface WordsToMeasure { id: string; width: number; fontSize: number; wrap?: boolean }

/**
 * What the overlay is asked to measure after a first draft: the words of
 * each Text and Heading, and of each label or button that wraps, at the
 * width and font size the draft gave it. The heights it measures go back
 * into phoneDraft as `heights`, which changes no width.
 */
export function wordsToMeasure(elements: SeenElement[], rules: Overrides): WordsToMeasure[] {
    const out: WordsToMeasure[] = [];
    for (const el of usable(elements)) {
        const rule = rules[`#${el.id}`];
        const width = parseFloat(rule?.width ?? '');
        const fontSize = parseFloat(rule?.['font-size'] ?? '');
        const wrap = rule?.['white-space'] === 'normal';
        if ((el.grows || wrap) && Number.isFinite(width) && Number.isFinite(fontSize)) out.push({ id: el.id, width, fontSize, ...(wrap ? { wrap } : {}) });
    }
    return out;
}

/**
 * The phone layout's first draft: its rules, by selector. `heights` is what
 * the overlay measured for the words of a Text or Heading (wordsToMeasure).
 */
export function phoneDraft(elements: SeenElement[], sizes: DraftSizes, heights: Record<string, number> = {}): Overrides {
    const all = usable(elements);
    const hidden = decorations(all, sizes.pageWidth);
    const seen = all.filter((el) => !hidden.has(el));
    const font = (f: number): number => Math.max(sizes.fontMin, Math.min(f, Math.round(f * FONT_SCALE)));
    const measured = (el: SeenElement): number | undefined => {
        const h = heights && Object.prototype.hasOwnProperty.call(heights, el.id) ? Number(heights[el.id]) : NaN;
        return Number.isFinite(h) && h > 0 ? h : undefined;
    };

    // What holds what: each element in the smallest shape that holds it.
    const nodes = new Map<SeenElement, Node>(seen.map((el) => [el, { el, children: [], band: el.kind === 'shape' && el.w >= BAND_SHARE * sizes.pageWidth }]));
    const top: Node[] = [];
    for (const el of seen) {
        const parent = seen.filter((other) => holds(other, el)).sort((a, b) => area(a) - area(b))[0];
        (parent ? nodes.get(parent)!.children : top).push(nodes.get(el)!);
    }

    const placed: Placed = new Map();
    /** A rule for `el`: a least height when it grows with its words, and words on more lines when `wrap`. */
    const put = (el: SeenElement, box: Box, fontSize?: number, grows?: boolean, wrap?: boolean): void => {
        // Its edges rounded, not its size: so a box ends where what holds it ends.
        const rule: Record<string, string> = { left: px(box.x), top: px(box.y), width: px(Math.round(box.x + box.w) - Math.round(box.x)) };
        if (wrap) rule.height = 'auto';
        rule[grows || wrap ? 'min-height' : 'height'] = px(Math.round(box.y + box.h) - Math.round(box.y));
        if (fontSize !== undefined) rule['font-size'] = px(fontSize);
        if (wrap) rule['white-space'] = 'normal';
        placed.set(el.id, rule);
    };

    /**
     * A leaf's size at most `width` wide: its words at their new size, a
     * picture keeping its shape. A label or button too long for the width
     * at its new size `wrap`s: its words go on more lines, as tall as the
     * overlay measured them (or estimated), never shorter than its box.
     */
    function leafSize(el: SeenElement, width: number): { w: number; h: number; font?: number; wrap?: boolean } {
        if (el.fontSize && el.fontSize > 0) {
            const f = font(el.fontSize);
            const ratio = f / el.fontSize;
            if (el.grows) {
                const w = Math.min(el.w, width);
                const h = measured(el);
                if (h !== undefined) return { w, h, font: f };
                const lh = el.lineHeight && el.lineHeight > 0 ? el.lineHeight : el.fontSize * 1.2;
                // The same words, in lines as long as the new width allows at the new size.
                const lines = Math.max(1, Math.round(el.h / lh));
                const perLine = w / Math.max(1, el.w * ratio);
                return { w, h: Math.ceil(lines / Math.min(1, perLine)) * lh * ratio, font: f };
            }
            if (el.wraps && el.w * ratio > width + 0.5) {
                const lines = Math.ceil((el.w * ratio) / width);
                return { w: width, h: Math.max(el.h * ratio, measured(el) ?? lines * el.h * ratio), font: f, wrap: true };
            }
            return { w: Math.min(width, el.w * ratio), h: el.h * ratio, font: f };
        }
        const w = Math.min(width, el.w);
        return { w, h: el.w > 0 ? el.h * (w / el.w) : el.h };
    }

    /** A shape and what is in it, scaled down as one picture into `width`; its height. */
    function scaleGroup(node: Node, x: number, y: number, width: number): number {
        const origin = bounds(node);
        const s = origin.w > 0 ? Math.min(1, width / origin.w) : 1;
        const walk = (n: Node): void => {
            const el = n.el;
            const nx = x + (el.x - origin.x) * s;
            const ny = y + (el.y - origin.y) * s;
            if (el.fontSize && el.fontSize > 0) {
                // Words keep a size that can be read: their box grows with them, within the shape.
                const f = Math.max(sizes.fontMin, el.fontSize * s);
                const ratio = f / el.fontSize;
                put(el, { x: nx, y: ny, w: Math.min(el.w * ratio, x + width - nx), h: (el.grows && measured(el)) || el.h * ratio }, Math.round(f), el.grows);
            } else {
                put(el, { x: nx, y: ny, w: el.w * s, h: el.h * s });
            }
            n.children.forEach(walk);
        };
        walk(node);
        return origin.h * s;
    }

    /** A shape and what is in it: the box round them all (what it holds may stick out of it a little). */
    function bounds(node: Node): Box {
        const boxes: Box[] = [];
        const walk = (n: Node): void => {
            boxes.push(n.el);
            n.children.forEach(walk);
        };
        walk(node);
        const x = Math.min(...boxes.map((b) => b.x));
        const y = Math.min(...boxes.map((b) => b.y));
        return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y };
    }

    /** An element of a row at most `width` wide: a picture of others scaled down whole, or a leaf. */
    function itemSize(node: Node, width: number): { w: number; h: number; font?: number; wrap?: boolean } {
        if (!node.children.length) return leafSize(node.el, width);
        const all = bounds(node);
        const w = Math.min(width, all.w);
        return { w, h: all.w > 0 ? all.h * (w / all.w) : all.h };
    }

    /**
     * Lay `items` out top to bottom in a column `width` wide from `left`,
     * starting at `y`, inside `parent` (to tell what was centred in it).
     * Returns where the last one ends.
     */
    function stack(items: Node[], left: number, width: number, y: number, parent: Box | null): number {
        // Rows: elements beside each other at desktop width (their heights overlap). A band is a row of its own.
        const rows: Node[][] = [];
        for (const node of [...items].sort(byPlace)) {
            const row = rows[rows.length - 1];
            if (row && !node.band && !row[0].band && row.some((one) => besideEach(one.el, node.el))) row.push(node);
            else rows.push([node]);
        }
        let at = y;
        for (let i = 0; i < rows.length; i++) {
            const grid = gridFrom(rows, i);
            if (grid.length > 1 && grid.some((row) => !fitsOnALine(row, width))) {
                // Read column by column: each one stacked, centred in its own box when it was.
                for (let k = 0; k < grid[0].length; k++) {
                    const column = grid.map((row) => row[k]);
                    const x = Math.min(...column.map((node) => node.el.x));
                    const w = Math.max(...column.map((node) => node.el.x + node.el.w)) - x;
                    at = stack(column, left, width, at, { x, y: 0, w, h: 0 }) + GAP;
                }
                i += grid.length - 1;
                continue;
            }
            at = (rows[i].length > 1 ? lay(rows[i], left, width, at, parent) : block(rows[i][0], left, width, at, parent)) + GAP;
        }
        return items.length ? at - GAP : y;
    }

    /**
     * The rows from `rows[from]` that make a grid with it: one after another,
     * as many elements each, the k-th of each above the k-th of the next and
     * of no other (steps: their numbers, then their titles, then their texts).
     * Each row in reading order.
     */
    function gridFrom(rows: Node[][], from: number): Node[][] {
        const simple = (row: Node[]): Node[] | null => row.length > 1 && columnsOf(row).length === row.length ? [...row].sort(byX) : null;
        const first = simple(rows[from]);
        if (!first) return [];
        const grid = [first];
        for (let i = from + 1; i < rows.length; i++) {
            const next = simple(rows[i]);
            const prev = grid[grid.length - 1];
            if (!next || next.length !== prev.length) break;
            if (!next.every((node, k) => prev.filter((one) => aboveEach(one.el, node.el)).length === 1 && aboveEach(prev[k].el, node.el))) break;
            grid.push(next);
        }
        return grid;
    }

    /** Would the row's elements, at their new sizes, go on one line `width` wide? */
    function fitsOnALine(row: Node[], width: number): boolean {
        const sizes = row.map((node) => itemSize(node, width));
        return !sizes.some((size) => size.wrap) && sizes.reduce((sum, size) => sum + size.w, 0) + GAP * (row.length - 1) <= width;
    }

    /** A row of elements beside each other, placed at `y` in a column; where it ends. */
    function lay(row: Node[], left: number, width: number, y: number, parent: Box | null): number {
        const columns = columnsOf(row);
        if (columns.length === 1) {
            // Each over the others: one after another, in the page's order.
            let at = y;
            for (const node of [...row].sort(byPlace)) at = block(node, left, width, at, parent) + GAP;
            return at - GAP;
        }
        if (columns.some((column) => column.length > 1)) {
            // Columns (a text beside a picture): each stacked, left one first.
            let at = y;
            for (const column of columns) at = stack(column, left, width, at, parent) + GAP;
            return at - GAP;
        }
        // In reading order, in as many lines as the width needs: centred
        // as a whole when the row was, and each element on its line
        // centred when the row's elements were.
        const items = [...row].sort(byX).map((node) => ({ node, size: itemSize(node, width) }));
        const from = Math.min(...row.map((node) => node.el.x));
        const to = Math.max(...row.map((node) => node.el.x + node.el.w));
        const centre = centred({ x: from, w: to - from }, parent);
        const spread = (values: number[]): number => Math.max(...values) - Math.min(...values);
        const middle = spread(row.map((node) => node.el.y + node.el.h / 2)) < spread(row.map((node) => node.el.y));
        const lines: (typeof items)[] = [];
        let used = 0;
        for (const item of items) {
            const line = lines[lines.length - 1];
            if (line && used + GAP + item.size.w <= width) {
                line.push(item);
                used += GAP + item.size.w;
            } else {
                lines.push([item]);
                used = item.size.w;
            }
        }
        let at = y;
        for (const line of lines) {
            const total = line.reduce((sum, item) => sum + item.size.w, 0) + GAP * (line.length - 1);
            const tallest = Math.max(...line.map((item) => item.size.h));
            let x = centre ? left + (width - total) / 2 : left;
            for (const { node, size } of line) {
                const top = at + (middle ? (tallest - size.h) / 2 : 0);
                if (node.children.length) scaleGroup(node, x, top, size.w);
                else put(node.el, { x, y: top, w: size.w, h: size.h }, size.font, node.el.grows, size.wrap);
                x += size.w + GAP;
            }
            at += tallest + GAP;
        }
        return at - GAP;
    }

    /** A row's columns: its elements above one another (their widths overlap), left one first. */
    function columnsOf(row: Node[]): Node[][] {
        const columns: Node[][] = [];
        for (const node of [...row].sort(byX)) {
            const joined = columns.filter((column) => column.some((one) => aboveEach(one.el, node.el)));
            const merged = joined.flat().concat(node);
            for (const column of joined) columns.splice(columns.indexOf(column), 1);
            columns.push(merged);
        }
        return columns.sort((a, b) => Math.min(...a.map((n) => n.el.x)) - Math.min(...b.map((n) => n.el.x)));
    }

    /** One element (and what is in it) placed at `y` in a column; where it ends. */
    function block(node: Node, left: number, width: number, y: number, parent: Box | null): number {
        const el = node.el;
        if (node.band) {
            const pad = Math.min(PAD_MAX, Math.max(PAD_MIN, node.children.length ? (Math.min(...node.children.map((c) => c.el.y)) - el.y) / 2 : PAD_MIN));
            const inner = stack(node.children, left + MARGIN, width - 2 * MARGIN, y + pad, el);
            const h = node.children.length ? inner + pad - y : el.h * (width / el.w);
            put(el, { x: left, y, w: width, h });
            return y + h;
        }
        if (node.children.length) {
            const all = bounds(node);
            const w = Math.min(width, all.w);
            const x = centred(all, parent) ? left + (width - w) / 2 : left;
            return y + scaleGroup(node, x, y, w);
        }
        const size = leafSize(el, width);
        const x = centred(el, parent) ? left + (width - size.w) / 2 : left;
        put(el, { x, y, w: size.w, h: size.h }, size.font, el.grows, size.wrap);
        return y + size.h;
    }

    /** Was this box centred in what holds it (the page, when nothing does)? */
    function centred(box: { x: number; w: number }, parent: Box | null): boolean {
        const outer = parent ?? { x: 0, w: sizes.pageWidth };
        return Math.abs(box.x + box.w / 2 - (outer.x + outer.w / 2)) <= outer.w * 0.05;
    }

    // The page: bands across the whole phone, everything else within its
    // margins, elements in no band between two bands stacked together (so
    // a row of them stays a row).
    const runs: Node[][] = [];
    for (const node of [...top].sort(byPlace)) {
        const run = runs[runs.length - 1];
        if (run && !node.band && !run[0].band) run.push(node);
        else runs.push([node]);
    }
    let y = 0;
    runs.forEach((run, i) => {
        const node = run[0];
        const prev = runs[i - 1]?.[0];
        // Bands that touched at desktop width still touch; anything else has room between.
        const touching = prev && prev.band && node.band && node.el.y <= prev.el.y + prev.el.h + 4;
        y = i === 0 ? (node.band ? 0 : MARGIN) : y + (touching ? 0 : 2 * GAP);
        y = node.band ? block(node, 0, sizes.phoneWidth, y, null) : stack(run, MARGIN, sizes.phoneWidth - 2 * MARGIN, y, null);
    });

    // Decoration is hidden, where it would be in what holds it scaled as
    // that is: so the phone view's faint copy is near its place, and shown
    // again it is within the phone.
    for (const el of hidden) {
        const shapes = seen.filter((other) => other.kind === 'shape' && placed.has(other.id) && area(other) > area(el) && overlap(other, el) > 0);
        const holder = shapes.filter((other) => holds(other, el)).sort((a, b) => area(a) - area(b))[0]
            ?? shapes.sort((a, b) => overlap(b, el) - overlap(a, el))[0];
        const at = holder ? placed.get(holder.id)! : null;
        const s = holder && at && holder.w > 0 ? parseFloat(at.width) / holder.w : sizes.phoneWidth / sizes.pageWidth;
        const w = Math.min(sizes.phoneWidth, el.w * s);
        const left = holder && at ? parseFloat(at.left) + (el.x - holder.x) * s : el.x * s;
        const top = holder && at ? parseFloat(at.top) + (el.y - holder.y) * s : el.y * s;
        put(el, { x: Math.max(0, Math.min(left, sizes.phoneWidth - w)), y: Math.max(0, top), w, h: el.h * s });
        placed.get(el.id)!.display = 'none';
    }

    const rules: Overrides = {};
    for (const el of all) {
        const rule = placed.get(el.id);
        if (rule) rules[`#${el.id}`] = rule;
    }
    return rules;
}
