// Scrolling the page while a drag is held at its top or bottom edge, in the
// page editor.
//
// A drawing, a move or a resize used to stop at the edge of what the panel
// shows: a section's background taller than the view (760 to 800px, in a
// view showing less) had to be drawn in two goes, or drawn short and then
// resized. Now, while the pointer is held near the top of the page area
// (just under the bar, or over the bar itself) or near the bottom of the
// view, the overlay (src/pageShell.ts) scrolls the page a little every
// frame, faster the nearer the pointer is to the edge, and the drag goes on
// with the page.
//
// The function is copied into the overlay as it is (src/pageShell.ts), so it
// uses nothing outside itself.
//
// Plain Node - no vscode import - so test/edgeScroll.test.js can run it.

/**
 * How far to scroll this frame, in whole px: less than 0 is up, more than 0
 * is down, 0 is not at all.
 *   at     - the pointer's height in the view (clientY)
 *   top    - where the page area starts in the view (under the bar)
 *   bottom - where it ends (the view's height)
 *   zone   - how near an edge the pointer must be to scroll, in px
 *   most   - the fastest it scrolls, in px a frame: with the pointer at the
 *            edge or past it (over the bar, or out of the panel)
 * Just inside the zone it scrolls 1px a frame, and faster the deeper in.
 * In a view too short for two whole zones they shrink to a quarter of it
 * each, so there is always a middle where nothing scrolls.
 */
export function edgeSpeed(at: number, top: number, bottom: number, zone = 40, most = 24): number {
    const size = Math.min(zone, Math.max(0, (bottom - top) / 4));
    if (!(size > 0) || !Number.isFinite(at)) return 0;
    const speed = (depth: number) => Math.max(1, Math.round(most * Math.min(1, depth / size)));
    if (at < top + size) return -speed(top + size - at);
    if (at > bottom - size) return speed(at - (bottom - size));
    return 0;
}
