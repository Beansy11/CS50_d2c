// The keys a field keeps to itself in the page editor: the toolbar's
// fields, the address bar, text being retyped, a page's own text box.
//
// VS Code's webview passes every key pressed in it on to VS Code, which then
// runs its own command for it. For Undo and Redo that is VS Code's undo of
// the whole page, not the field's. Select All is worse: the field selects
// all at once, as it should, and VS Code's Select All then selects all in
// the page a second time, as soon as VS Code gets to it - a few ms later
// when VS Code is idle, more when it is busy (just after a click, or while
// an edit is being written). Typing straight after Ctrl+A, the first digit
// lands in between: "16" in Corner rounding, the "1" is selected again and
// the "6" replaces it. So these keys are stopped in the page before VS Code
// hears of them, and the field does what it does in a browser, once.
//
// Copy, cut and paste are left alone: VS Code stops the field's own and
// does them once itself. Every other shortcut (Ctrl+S, Ctrl+F) is VS Code's.
//
// The function is copied into the overlay as it is (src/pageShell.ts), so it
// uses nothing outside itself.
//
// Plain Node - no vscode import - so test/fieldKeys.test.js can run it.

/**
 * Is this key press one a field keeps from VS Code? Ctrl (Cmd on a Mac) with
 * Z, Y or A, Shift or not; never with Alt, which makes it another shortcut.
 */
export function fieldKey(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean }): boolean {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return false;
    return ['z', 'y', 'a'].includes(String(e.key).toLowerCase());
}
