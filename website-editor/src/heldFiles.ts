// Edits held until they are saved: in an open
// project, what the editor changes stays here - the tab shows ● - and only
// Save writes it into the development copy. Everything that reads a page
// while the project is open reads through this, so the editor, the preview
// and undo all see the same unsaved page.
//
// Plain Node - no vscode import - so test/heldFiles.test.js can run it.
//
// CS50 citation: the name Draw2Code Web Editor was chosen with help from
// Claude (Anthropic AI), and at my direction Claude renamed
// the project from its earlier name, HardHat Designer, throughout this file.

import * as fs from 'fs';
import * as path from 'path';

/** Reading and writing a site's files, on disk or through held edits. */
export interface FileAccess {
    /** The file's text; throws when there is no such file. */
    read(file: string): string;
    write(file: string, content: string): void;
    exists(file: string): boolean;
    /** Take the file away (nothing happens when it is not there). */
    remove(file: string): void;
}

/** Straight to disk: a site with no open project. */
export const disk: FileAccess = {
    read: (file) => fs.readFileSync(file, 'utf8'),
    write: (file, content) => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content, 'utf8');
    },
    exists: (file) => fs.existsSync(file),
    remove: (file) => fs.rmSync(file, { force: true }),
};

/** What a backup of held edits looks like (VS Code keeps it on hot exit). */
export interface HeldBackup {
    format: 'draw2code-held';
    version: 1;
    /** Site-relative paths (forward slashes) and their unsaved text; null = removed. */
    files: Array<{ path: string; content: string | null }>;
}

const key = (file: string): string => path.normalize(file).toLowerCase();

/** The file's text on disk, or undefined when there is none. */
function savedText(file: string): string | undefined {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        return undefined;
    }
}

export class HeldFiles implements FileAccess {
    /** The open project's held edits, by development copy. */
    private static open = new Map<string, HeldFiles>();

    /** The held edits for a development copy, while its project is open. */
    public static for(work: string): HeldFiles | undefined {
        return HeldFiles.open.get(key(work));
    }

    /** Held text by file; null is a file removed since the last save. */
    private readonly files = new Map<string, { file: string; content: string | null }>();

    /**
     * Called once per edit (after its files are written), with a name for
     * it: the editor makes it one step of VS Code's undo, and the tab unsaved.
     */
    public onDidEdit: ((label: string) => void) | undefined;
    /** Save or revert through the project's editor tab (set by the editor). */
    public requestSave: (() => Promise<boolean>) | undefined;

    constructor(public readonly work: string) {}

    /** Make these the held edits every reader of `work` uses. */
    public register(): void {
        HeldFiles.open.set(key(this.work), this);
    }

    public unregister(): void {
        if (HeldFiles.open.get(key(this.work)) === this) HeldFiles.open.delete(key(this.work));
    }

    public read(file: string): string {
        const held = this.files.get(key(file));
        if (!held) return fs.readFileSync(file, 'utf8');
        if (held.content === null) throw Object.assign(new Error(`ENOENT: ${file}`), { code: 'ENOENT' });
        return held.content;
    }

    public write(file: string, content: string): void {
        // Back to what is saved (an edit undone): nothing to hold for it.
        if (savedText(file) === content) this.files.delete(key(file));
        else this.files.set(key(file), { file: path.normalize(file), content });
    }

    public exists(file: string): boolean {
        const held = this.files.get(key(file));
        return held ? held.content !== null : fs.existsSync(file);
    }

    public remove(file: string): void {
        // A file that was never saved simply goes; a saved one goes on Save.
        if (fs.existsSync(file)) this.files.set(key(file), { file: path.normalize(file), content: null });
        else this.files.delete(key(file));
    }

    /** Stop holding a file: readers get what is saved again. */
    public forget(file: string): void {
        this.files.delete(key(file));
    }

    /** One edit is complete: tell the editor. */
    public edited(label: string): void {
        this.onDidEdit?.(label);
    }

    /** Is this file's unsaved text what readers get? */
    public isHeld(file: string): boolean {
        return this.files.has(key(file));
    }

    /** Is anything waiting to be saved? */
    public get dirty(): boolean {
        return this.files.size > 0;
    }

    /** Held files, site-relative with forward slashes. */
    public heldPaths(): string[] {
        return [...this.files.values()].map((entry) => this.relative(entry.file)).sort();
    }

    /** Held files that are not on disk yet (a page added since the last save). */
    public added(): string[] {
        return [...this.files.values()].filter((entry) => entry.content !== null && !fs.existsSync(entry.file)).map((entry) => this.relative(entry.file)).sort();
    }

    /** Saved files removed since the last save (a page whose adding was undone after a save). */
    public removed(): string[] {
        return [...this.files.values()].filter((entry) => entry.content === null).map((entry) => this.relative(entry.file)).sort();
    }

    /** Write every held file into the development copy. Returns the files written. */
    public save(): string[] {
        const written: string[] = [];
        for (const entry of this.files.values()) {
            if (entry.content === null) disk.remove(entry.file);
            else disk.write(entry.file, entry.content);
            written.push(entry.file);
        }
        this.files.clear();
        return written;
    }

    /** Forget every held edit: the copy on disk is what the project is again. */
    public discard(): void {
        this.files.clear();
    }

    public backup(): HeldBackup {
        return {
            format: 'draw2code-held',
            version: 1,
            files: [...this.files.values()].map((entry) => ({ path: this.relative(entry.file), content: entry.content })),
        };
    }

    /** Take held edits back from a backup. Anything that is not one is ignored. */
    public restore(data: unknown): void {
        const backup = data as Partial<HeldBackup> | null;
        if (!backup || backup.format !== 'draw2code-held' || !Array.isArray(backup.files)) return;
        for (const entry of backup.files) {
            if (typeof entry?.path !== 'string' || (typeof entry.content !== 'string' && entry.content !== null)) continue;
            const file = path.resolve(this.work, entry.path);
            // Only files inside the copy: a backup never writes elsewhere.
            const rel = path.relative(this.work, file);
            if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) continue;
            this.files.set(key(file), { file, content: entry.content });
        }
    }

    private relative(file: string): string {
        return path.relative(this.work, file).split(path.sep).join('/');
    }
}
