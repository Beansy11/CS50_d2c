// Colours typed and colours used again in the page editor's toolbar.
//
// Each colour box (Fill, Border colour, Text colour) opens Chromium's own
// picker, which starts in RGB: a hex code took a click, two more to switch
// the picker to HEX, then typing. So beside each box there is a small list:
// a field to type the hex code in, and the colours used last, one click
// each. These are what the list needs: reading what is typed, and keeping
// the colours used last in order.
//
// The functions are copied into the overlay as they are (src/pageShell.ts),
// so they use nothing outside themselves.
//
// Plain Node - no vscode import - so test/colours.test.js can run it.

/** How many colours the list keeps: one short row in the toolbar's list. */
export const RECENT_MAX = 10;

/**
 * A typed colour as a colour box holds it: "#0B1020", "0b1020", " #0b1020 "
 * -> "#0b1020", and the short "#fff" -> "#ffffff". Undefined for anything
 * else ("blue", "#12345", "#0b10209f"): a colour box has no names and no
 * see-through, so those are refused and the old colour is kept.
 */
export function hexOf(typed: string): string | undefined {
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(typed).trim());
    if (!m) return undefined;
    const digits = m[1].length === 3 ? m[1].replace(/./g, (d) => d + d) : m[1];
    return '#' + digits.toLowerCase();
}

/**
 * The colours used last, newest first, with this one just used: it goes to
 * the front, once, and the oldest falls off past `max`.
 */
export function recentWith(recent: string[], hex: string, max: number): string[] {
    return [hex, ...recent.filter((colour) => colour !== hex)].slice(0, Math.max(0, max));
}

/**
 * A stored list as the toolbar can use it: colours only, each once, as a
 * colour box writes them, at most `max`. Anything else in the store (an
 * older or a hand-edited one) is left out, so a bad entry never breaks the
 * list.
 */
export function recentOf(stored: unknown, max: number): string[] {
    const out: string[] = [];
    for (const value of Array.isArray(stored) ? stored : []) {
        const m = typeof value === 'string' ? /^#[0-9a-f]{6}$/i.exec(value.trim()) : null;
        const colour = m ? m[0].toLowerCase() : '';
        if (colour && !out.includes(colour)) out.push(colour);
    }
    return out.slice(0, Math.max(0, max));
}
