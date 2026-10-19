// Resizing a drawn shape in the page editor: drawing it again at its new size.
//
// Draw2Code draws a rectangle, an ellipse, a line or a pen stroke as an
// inline <svg> whose viewBox is the size it was drawn at (see
// media/generators/html.js). Given only another width and height, a browser
// keeps the drawing's proportions - it fits the viewBox into the box and
// centres it - so the shape no longer fills its box and leaves gaps beside
// it. A resize therefore draws the shape again: the svg's width, height and
// viewBox become the new size, and the shape is placed in it the way the
// generator would draw it at that size. The border keeps its width and a
// rectangle its corner rounding, as both are in the page's px, which the
// viewBox's units are again.
//
// The functions are copied into the overlay as they are (src/pageShell.ts),
// so they use nothing outside themselves. src/pageEdit.ts uses the same
// ones on the page file, so the editor and the saved page agree.
//
// Plain Node - no vscode import - so test/redraw.test.js can run it.

/** A drawing's attributes at its new size: the <svg>'s and its shape's. */
export interface Redrawn {
    svg: Record<string, string>;
    shape: Record<string, string>;
}

/**
 * The shape's tag when an <svg> is one Draw2Code drew, by the id it gave
 * it and the one shape inside: "rect-1" holding a <rect>, "pen-2" holding a
 * <polyline>. Anything else (a site's own icon, say) is undefined: it is
 * resized as it always was, its picture scaled to fit.
 */
export function drawnShape(id: string, childTags: string[]): string | undefined {
    const match = /^(rect|ellipse|line|pen)-\d+$/.exec(id || '');
    if (!match) return undefined;
    const tag = match[1] === 'pen' ? 'polyline' : match[1];
    return childTags.length === 1 && childTags[0] === tag ? tag : undefined;
}

/**
 * The drawing at w x h px. `tag` is its shape, `shape` that shape's
 * geometry as written now (x1, y1, x2, y2 for a line, points for a pen
 * stroke; the others need none), `viewBox` the svg's as written now.
 *   rect     fills the box, from 0,0
 *   ellipse  touches all four sides
 *   line     runs corner to corner, on the diagonal it ran on before
 *   pen      every point keeps its place as a fraction of the box
 * Numbers are rounded to 2 decimals, as the generator writes them.
 */
export function redrawn(tag: string, shape: Record<string, string | null | undefined>, viewBox: string, w: number, h: number): Redrawn {
    const round = (value: number): number => (Number.isFinite(value) ? Math.round(value * 100) / 100 : 0);
    const width = Math.max(0, round(w));
    const height = Math.max(0, round(h));
    const svg = { width: String(width), height: String(height), viewBox: `0 0 ${width} ${height}` };
    const at = (name: string): number => parseFloat(shape[name] ?? '') || 0;
    if (tag === 'rect') return { svg, shape: { x: '0', y: '0', width: String(width), height: String(height) } };
    if (tag === 'ellipse') {
        const rx = String(round(width / 2));
        const ry = String(round(height / 2));
        return { svg, shape: { cx: rx, cy: ry, rx, ry } };
    }
    if (tag === 'line') {
        // Up from left to right (bottom-left to top-right) or down: the model's flip.
        const up = (at('y1') > at('y2')) !== (at('x1') > at('x2'));
        const [y1, y2] = up ? [height, 0] : [0, height];
        return { svg, shape: { x1: '0', y1: String(y1), x2: String(width), y2: String(y2) } };
    }
    if (tag === 'polyline') {
        // The old box; a side of 0 (a stroke drawn straight) leaves its points on that side's start.
        const [left, top, oldW, oldH] = String(viewBox || '').trim().split(/[\s,]+/).map(Number);
        const scale = (value: number, start: number, from: number, to: number): number =>
            Number.isFinite(from) && from > 0 ? round(((value - (start || 0)) / from) * to) : 0;
        const numbers = String(shape.points || '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
        const points: string[] = [];
        for (let i = 0; i + 1 < numbers.length; i += 2) {
            points.push(`${scale(numbers[i], left, oldW, width)},${scale(numbers[i + 1], top, oldH, height)}`);
        }
        return { svg, shape: { points: points.join(' ') } };
    }
    return { svg, shape: {} };
}
