// Undo and redo for the editor: one history per site, shared by every
// panel that edits it, made of page snapshots (see pageEditor.PageSnapshot).
//
// Before an edit, the page as it is goes on the undo stack. Undo swaps the
// current page for that one and keeps the current one for redo. A new edit
// after an undo throws the redo stack away, like any editor.
//
// Plain data and arrays, no vscode import, so test/history.test.js can run
// it directly.

import { PageSnapshot } from './pageEditor';

/** How far back undo goes, per site. */
export const HISTORY_LIMIT = 100;

interface Stacks { undo: PageSnapshot[]; redo: PageSnapshot[] }

const histories = new Map<string, Stacks>();

function stacksFor(site: string): Stacks {
    const key = site.toLowerCase();
    let stacks = histories.get(key);
    if (!stacks) {
        stacks = { undo: [], redo: [] };
        histories.set(key, stacks);
    }
    return stacks;
}

/** Remember the page as it is, before it changes. */
export function record(site: string, before: PageSnapshot): void {
    const stacks = stacksFor(site);
    stacks.undo.push(before);
    if (stacks.undo.length > HISTORY_LIMIT) stacks.undo.shift();
    stacks.redo.length = 0;
}

/** The page to go back to, given the page as it is now (kept for redo). */
export function undo(site: string, current: PageSnapshot | null): PageSnapshot | undefined {
    const stacks = stacksFor(site);
    const before = stacks.undo.pop();
    if (before && current) stacks.redo.push(current);
    return before;
}

/** The page to go forward to, given the page as it is now (kept for undo). */
export function redo(site: string, current: PageSnapshot | null): PageSnapshot | undefined {
    const stacks = stacksFor(site);
    const after = stacks.redo.pop();
    if (after && current) stacks.undo.push(current);
    return after;
}

/** The page the next undo (or redo) would change, without taking it. */
export function peek(site: string, direction: 'undo' | 'redo'): PageSnapshot | undefined {
    const stack = stacksFor(site)[direction];
    return stack[stack.length - 1];
}

export function canUndo(site: string): boolean {
    return stacksFor(site).undo.length > 0;
}

export function canRedo(site: string): boolean {
    return stacksFor(site).redo.length > 0;
}

/** Forget a site's history (its copy was made again). */
export function forget(site: string): void {
    histories.delete(site.toLowerCase());
}
