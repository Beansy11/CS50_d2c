// Room below the page in the page editor: empty space to scroll into and
// draw on, past the lowest thing on the page.
//
// A page only scrolls as far as its lowest element, so a section below the
// first screen could not be drawn until something already reached that far.
// The editor's overlay (src/pageShell.ts) holds an empty, invisible box of
// its own, placed so that the page scrolls about two screens further. It is
// absolutely positioned, so nothing on the page moves or changes size, and
// it is inside the overlay's shadow root, so the published page has no room
// added and ends where its content does.
//
// The function is copied into the overlay as it is (src/pageShell.ts), so it
// uses nothing outside itself.
//
// Plain Node - no vscode import - so test/room.test.js can run it.

/**
 * Where the room goes, in px, as the overlay's box is placed: its top and
 * its height.
 *   contentBottom - how far the page scrolls without the room (its scrollHeight)
 *   viewHeight    - the webview's height (innerHeight)
 *   barPx         - the bar over the top of the page, which hides that much of it
 *   origin        - where the box sits in the document at top: 0 (its containing
 *                   block is usually <html>, but the page may position another)
 * The box starts where the page ends and is two screens of page tall. One
 * screen would leave the page's lowest point just under the bar at the very
 * bottom, so a box a screen tall drawn a little below it could not be
 * reached in one drag (an 800px section 60px under the last one, in a view
 * showing 847px of page). With two, any box up to a screen tall can be drawn
 * anywhere up to a screen below the lowest point.
 */
export function roomBox(contentBottom: number, viewHeight: number, barPx: number, origin: number): { top: number; height: number } {
    return {
        top: Math.max(0, Math.round(contentBottom - origin)),
        height: Math.max(0, Math.round(2 * (viewHeight - barPx))),
    };
}

/**
 * Does the page only scroll because of the room? Then the editor hides the
 * scrollbar: VS Code's takes 10px of the page's width, and in a browser a
 * page that fits the window has none, so a centred or full-width layout
 * would sit narrower in the editor than it does there. The room is still
 * reached with the mouse wheel. A page that scrolls on its own keeps its
 * scrollbar, as it would in a browser - and so does a page wider than the
 * view (a page width wider than the panel), which scrolls sideways: hiding
 * the scrollbars would hide that one too.
 * A page as tall as the window (min-height: 100vh) is the bar's height
 * taller in the editor than in a browser, because the editor's window is
 * the bar's height taller than the page shown under it. A page made in
 * Draw2Code is measured without its wrapper's least height, so what is left
 * is how far its elements reach, compared with the view as it is (barPx 0):
 * a page whose elements end just under the view still scrolls, as it does
 * in a browser. Any other page may be as tall as the window in ways not
 * known here, so up to the bar's height more does not count as scrolling
 * on its own (barPx, the bar's height).
 *   contentBottom - how far the page scrolls without the room (its scrollHeight)
 *   viewHeight    - how much of it the view shows (its clientHeight)
 *   barPx         - how much taller than that the page may be and not scroll
 *   contentRight  - how far the page scrolls sideways (its scrollWidth)
 *   viewWidth     - how wide the view is with no scrollbar (innerWidth)
 */
export function roomOnly(contentBottom: number, viewHeight: number, barPx = 0, contentRight = 0, viewWidth = Infinity): boolean {
    return contentBottom <= viewHeight + barPx && contentRight <= viewWidth;
}
