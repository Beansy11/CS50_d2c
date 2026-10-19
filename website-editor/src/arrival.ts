// A page drawn again, in the page editor and the Site Preview: it is shown
// where it was, at once.
//
// Adding, removing or reverting an element, or making it a link, draws the
// page again (src/designerPanel.ts render): VS Code puts a new document in
// the webview and, once it has loaded, scrolls it to where the old one was,
// with a plain window.scroll(). A page made in Draw2Code asks for smooth
// scrolling (html { scroll-behavior: smooth }, for its section links), so
// that scroll was smooth too: the new page was shown at its top and slid
// back down to where it was, most of a second from far down the page (from
// the room below it, past 2000px). The view moved by itself after every
// element drawn there, and a double-click on the new element in that time
// landed on whatever was passing under the pointer, so it did not retype it.
//
// So until the page has loaded, it scrolls at once whatever it asks for
// (the rule below, put in the page by src/pageShell.ts), and VS Code's
// scroll shows it where it was before it is shown at all. Right after that,
// the page's own scroll-behavior is back, for its section links.
//
// VS Code only keeps how far down the page was: its scroll is
// window.scroll(0, y), and a new page always starts at its left. A page made
// in Draw2Code scrolls sideways in a panel narrower than its column, so how
// far across it was is kept by the overlay (in the webview's state, with the
// page it is for) and put back in the same step (arrivalScroll). A page
// switched to (a tab, a site link, Back) is drawn the same way, and VS Code
// scrolls it as far down as the page before was: it starts at its top
// instead, as a page newly opened in a browser does, or at the section a
// link goes to.
//
// The functions are copied into the overlay as they are (src/pageShell.ts),
// so they use nothing outside themselves.
//
// Plain Node - no vscode import - so test/arrival.test.js can run it.

/** On <html> once the page has loaded and been scrolled where it was. */
export const ARRIVED_ATTR = 'data-draw2code-arrived';

/** Scrolls at once until then, over the page's own rule (which has no !important). */
export const ARRIVING_RULE = `html:not([${ARRIVED_ATTR}]) { scroll-behavior: auto !important; }`;

/** What it uses of the page's window and its <html> (no DOM types here). */
export interface ArrivingWindow {
    document: { readyState: string };
    setTimeout(run: () => void, ms: number): unknown;
    requestAnimationFrame(run: () => void): unknown;
    addEventListener(type: 'load', listener: () => void, options: { once: boolean }): void;
}
export interface ArrivingRoot {
    setAttribute(name: string, value: string): void;
}

/**
 * Put the attribute on <html> right after the page's load event: after
 * every listener of that event, VS Code's among them, which is where it
 * scrolls the page (or earlier, when the page was slow to load and it
 * stopped waiting). Already loaded, as soon as the listeners now running
 * are done. Just before, settle() puts the page where it should be: in the
 * first animation frame or the first timer after the load, whichever is
 * first, so before the page is painted where VS Code left it.
 *   win    - the page's window
 *   html   - its <html>
 *   attr   - the attribute (ARRIVED_ATTR)
 *   settle - scrolls the page where it was, or to its top (arrivalScroll)
 */
export function arriveAfterLoad(win: ArrivingWindow, html: ArrivingRoot, attr: string, settle: () => void): void {
    let done = false;
    const arrive = () => {
        if (done) return;
        done = true;
        settle();
        html.setAttribute(attr, '');
    };
    const arrived = () => { win.requestAnimationFrame(arrive); win.setTimeout(arrive, 0); };
    if (win.document.readyState === 'complete') arrived();
    else win.addEventListener('load', arrived, { once: true });
}

/** Where the view was, kept in the webview's state: the page it was on and how far across. */
export interface KeptScroll {
    scrollPage?: string;
    scrollX?: number;
}

/**
 * Where a page just drawn is scrolled to, once VS Code has scrolled it down
 * to where the page before was; null leaves it there.
 *   kept    - what the page before kept (nothing kept: left as it is)
 *   page    - the page now shown
 *   at      - where it is now (VS Code's scroll done)
 *   jumping - it goes to a section of its own (that wins)
 * The same page: as far across as it was, as far down as VS Code put it.
 * Another page: its top-left.
 */
export function arrivalScroll(kept: KeptScroll, page: string, at: { x: number; y: number }, jumping: boolean): { left: number; top: number } | null {
    if (jumping || typeof kept.scrollPage !== 'string') return null;
    const to = kept.scrollPage === page
        ? { left: Number(kept.scrollX) || 0, top: at.y }
        : { left: 0, top: 0 };
    return to.left === at.x && to.top === at.y ? null : to;
}
