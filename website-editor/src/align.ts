// Left, centre and right in the page editor: what each button writes, and
// which one an element shows now.
//
// The editor makes two kinds of text box. Text and Heading (<p>, <h1>) and a
// <button> are blocks: text-align moves their words. A label, and a button
// made a link, are flex boxes (their words are centred top to bottom), and
// there text-align alone moves nothing - the words sit in a box of their own
// that justify-content places. So a flex box gets both: justify-content for
// one line, text-align for the lines of a label that wraps.
//
// The functions are copied into the overlay as they are (src/pageShell.ts),
// so they use nothing outside themselves.
//
// Plain Node - no vscode import - so test/align.test.js can run it.

/** The three alignment buttons, as the toolbar names them. */
export type Align = 'left' | 'center' | 'right';

/** "flex", "right" -> { 'justify-content': 'flex-end', 'text-align': 'right' }; "block", "right" -> { 'text-align': 'right' }. */
export function alignDeclarations(display: string, align: Align): Record<string, string> {
    if (display !== 'flex' && display !== 'inline-flex') return { 'text-align': align };
    const justify = align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center';
    return { 'justify-content': justify, 'text-align': align };
}

/**
 * "flex", "row" -> "flex"; "flex", "column" -> "block". A flex box that runs
 * top to bottom (a Bootstrap card) or backwards has justify-content moving
 * its words the wrong way, so it is aligned as a block, by text-align alone.
 */
export function boxOf(display: string, direction: string): string {
    return direction === 'row' ? display : 'block';
}

/**
 * Which button shows as on, from the element's computed style: a flex box
 * by its justify-content, anything else by its text-align ("start" is the
 * browser's left). Undefined for any other value, such as "space-between"
 * or "justify": no button is on.
 */
export function alignOf(display: string, textAlign: string, justifyContent: string): Align | undefined {
    const flex = display === 'flex' || display === 'inline-flex';
    const value = flex ? justifyContent : textAlign;
    if (['left', 'start', 'flex-start', 'normal', '-webkit-left'].includes(value)) return 'left';
    if (['center', '-webkit-center'].includes(value)) return 'center';
    if (['right', 'end', 'flex-end', '-webkit-right'].includes(value)) return 'right';
    return undefined;
}
