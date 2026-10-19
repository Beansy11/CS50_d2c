// Underline in the page editor: what the U button shows and writes.
//
// A link has the browser's underline, and text can be given one. U shows
// whether the selected element's words are underlined now and, clicked,
// writes text-decoration with the underline added or taken away. Any other
// line it has (a line-through, an overline) stays.
//
// The functions are copied into the overlay as they are (src/pageShell.ts),
// so they use nothing outside themselves.
//
// Plain Node - no vscode import - so test/underline.test.js can run it.

/** Is the text underlined? `lines` is its computed text-decoration-line: "underline", "underline line-through", "none". */
export function isUnderlined(lines: string): boolean {
    return String(lines || '').split(/\s+/).includes('underline');
}

/** What U writes: "underline" -> { 'text-decoration': 'none' }; "line-through" -> { 'text-decoration': 'line-through underline' }. */
export function underlineDeclarations(lines: string): Record<string, string> {
    const now = String(lines || '').split(/\s+/).filter((line) => line && line !== 'none');
    const next = now.includes('underline') ? now.filter((line) => line !== 'underline') : [...now, 'underline'];
    return { 'text-decoration': next.length ? next.join(' ') : 'none' };
}
