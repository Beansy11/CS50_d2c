// The project label the editor reads and writes: .draw2code/project.d2c.
//
//   MyProject/
//   ├── MyProject-dev/      what the editor works on
//   ├── MyProject-prod/     the clean copy, rebuilt on Publish
//   └── .draw2code/
//       └── project.d2c     the project's label (see ProjectFile)
//
// Imports keep their own shape (the original + a sibling -dev), so the shape
// itself says which kind of project a folder is. What each kind of project
// writes lives in website-editor/src/siteProject.ts.
//
// Plain Node - no vscode import - so the tests can run it.
//
// CS50 citation: The desktop app builder's project fields and its read-only
// folder rule were removed from this file with Claude (Anthropic AI) at my
// direction, when that builder was taken out of this project.
//
// CS50 citation: the name Draw2Code Web Editor was chosen with help from
// Claude (Anthropic AI), and at my direction Claude renamed
// the project from its earlier name, HardHat Designer, throughout this file.

import * as fs from 'fs';
import * as path from 'path';
import type { Design } from '../website-editor/src/design';
import { pageWidthOf } from '../website-editor/src/pageWidth';

// ---------------------------------------------------------------------------
// The label: .draw2code/project.d2c
// ---------------------------------------------------------------------------

export const PROJECT_FORMAT = 'draw2code-project';
export const PROJECT_VERSION = 1;
export const PROJECT_FILE = path.join('.draw2code', 'project.d2c');

/**
 * What a project remembers about itself. The rule: anything a
 * project must remember in future goes here, so readers accept fields they
 * do not know and cope with ones that are missing.
 */
export interface ProjectFile {
    format: typeof PROJECT_FORMAT;
    version: number;
    name: string;
    /** The folders inside the project root, by name. */
    dev: string;
    prod: string;
    created: string;
    savedWith: string;
    /** The stylesheet every page shares, site-relative. */
    stylesheet?: string;
    /**
     * How wide every page is, in px: the column each page is laid out in,
     * centred in the window (website-editor/src/pageWidth.ts). 1440 when
     * the label does not say.
     */
    pageWidth?: number;
    /** The canvas design at the moment it was first saved - a keepsake. */
    design?: Design;
    [future: string]: unknown;
}

/** The label of the project at `root`, or null when it is not one. */
export function readProject(root: string): ProjectFile | null {
    const file = path.join(root, PROJECT_FILE);
    if (!fs.existsSync(file)) return null;
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<ProjectFile>;
        if (data.format !== PROJECT_FORMAT || typeof data.name !== 'string') return null;
        // An import's label (inside its -dev) is not a project Draw2Code made.
        if (data.kind === IMPORT_KIND) return null;
        return {
            ...data,
            format: PROJECT_FORMAT,
            version: Number(data.version) || PROJECT_VERSION,
            name: data.name,
            dev: typeof data.dev === 'string' && data.dev ? data.dev : `${data.name}-dev`,
            prod: typeof data.prod === 'string' && data.prod ? data.prod : `${data.name}-prod`,
            created: String(data.created ?? ''),
            savedWith: String(data.savedWith ?? ''),
            stylesheet: typeof data.stylesheet === 'string' && data.stylesheet ? data.stylesheet : 'css/style.css',
            pageWidth: pageWidthOf(data.pageWidth),
        } as ProjectFile;
    } catch {
        return null;
    }
}

export function isProject(dir: string): boolean {
    return readProject(dir) !== null;
}

// ---------------------------------------------------------------------------
// Editor state, kept in a label (either kind)
// ---------------------------------------------------------------------------

/**
 * Where the editor was left: the pages with a tab,
 * in order, and the page shown. Not an edit - it is written on Save, and
 * when the project closes with nothing unsaved.
 */
export interface EditorState {
    tabs: string[];
    page: string;
}

/** The editor state a label remembers, if any. */
export function readEditorState(labelFile: string): EditorState | undefined {
    try {
        const editor = (JSON.parse(fs.readFileSync(labelFile, 'utf8')) as { editor?: Partial<EditorState> }).editor;
        if (!editor || typeof editor.page !== 'string') return undefined;
        const tabs = Array.isArray(editor.tabs) ? editor.tabs.filter((tab): tab is string => typeof tab === 'string') : [];
        return { tabs, page: editor.page };
    } catch {
        return undefined;
    }
}

/**
 * Remember the editor state in a label, keeping everything else in it as it
 * is. Nothing is written when it is already there, or the file is not a label.
 * Returns whether the file changed.
 */
export function writeEditorState(labelFile: string, state: EditorState): boolean {
    try {
        const data = JSON.parse(fs.readFileSync(labelFile, 'utf8')) as Record<string, unknown>;
        if (!data || data.format !== PROJECT_FORMAT) return false;
        const editor: EditorState = { tabs: [...state.tabs], page: state.page };
        if (JSON.stringify(data.editor) === JSON.stringify(editor)) return false;
        data.editor = editor;
        fs.writeFileSync(labelFile, JSON.stringify(data, null, 2) + '\n', 'utf8');
        return true;
    } catch {
        return false;
    }
}

/**
 * Remember a new page width in a project's label, keeping everything else in
 * it as it is. Returns whether the file changed; nothing is written to a
 * file that is not a project's label.
 */
export function writePageWidth(root: string, width: number): boolean {
    const file = path.join(root, PROJECT_FILE);
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
        if (!data || data.format !== PROJECT_FORMAT || data.kind === IMPORT_KIND) return false;
        if (data.pageWidth === width) return false;
        data.pageWidth = width;
        fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
        return true;
    } catch {
        return false;
    }
}

// ---------------------------------------------------------------------------
// An import's label: <site>-dev/.draw2code/project.d2c
//
// An imported site gets a label too, so both kinds of project open the same
// way. It lives in the development copy - the original is
// never written to - and says which site it is a copy of.
// ---------------------------------------------------------------------------

export const IMPORT_KIND = 'import';

export interface ImportLabel {
    format: typeof PROJECT_FORMAT;
    version: number;
    kind: typeof IMPORT_KIND;
    /** The site's own folder name. */
    name: string;
    /** The original site, relative to the -dev copy (forward slashes). */
    original: string;
    created: string;
    savedWith: string;
    [future: string]: unknown;
}

/** The import label inside a development copy, or null. */
export function readImportLabel(work: string): ImportLabel | null {
    try {
        const data = JSON.parse(fs.readFileSync(path.join(work, PROJECT_FILE), 'utf8')) as Partial<ImportLabel>;
        if (data.format !== PROJECT_FORMAT || data.kind !== IMPORT_KIND || typeof data.original !== 'string') return null;
        return {
            ...data,
            format: PROJECT_FORMAT,
            version: Number(data.version) || PROJECT_VERSION,
            kind: IMPORT_KIND,
            name: typeof data.name === 'string' && data.name ? data.name : path.basename(path.resolve(work, data.original)),
            original: data.original,
            created: String(data.created ?? ''),
            savedWith: String(data.savedWith ?? ''),
        } as ImportLabel;
    } catch {
        return null;
    }
}

/**
 * Label the development copy of the site at `root`, unless it already says
 * so. Fields a newer version wrote are kept. Returns the label's path.
 */
export function writeImportLabel(root: string, work: string, savedWith: string, extra: Record<string, unknown> = {}): string {
    const file = path.join(work, PROJECT_FILE);
    const original = path.relative(work, root).split(path.sep).join('/');
    const existing = readImportLabel(work);
    if (existing && path.resolve(work, existing.original).toLowerCase() === path.resolve(root).toLowerCase()) return file;
    const label: ImportLabel = {
        ...extra,
        format: PROJECT_FORMAT,
        version: PROJECT_VERSION,
        kind: IMPORT_KIND,
        name: path.basename(root),
        original,
        created: new Date().toISOString(),
        savedWith,
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(label, null, 2) + '\n', 'utf8');
    return file;
}

/**
 * The site a `.d2c` file opens:
 *   <root>/.draw2code/project.d2c       (a project Draw2Code made) -> <root>
 *   <site>-dev/.draw2code/project.d2c   (an import)              -> <site>
 * Null when the file is not where a label lives, does not read as one, or
 * names an original that is gone.
 */
export function projectRootOf(file: string): string | null {
    const resolved = path.resolve(file);
    if (path.basename(path.dirname(resolved)) !== '.draw2code') return null;
    const dir = path.dirname(path.dirname(resolved));
    if (path.join(dir, PROJECT_FILE).toLowerCase() !== resolved.toLowerCase()) return null;
    if (readProject(dir)) return dir;
    const label = readImportLabel(dir);
    if (!label) return null;
    const original = path.resolve(dir, label.original);
    try {
        return fs.statSync(original).isDirectory() ? original : null;
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

/** Files an OS drops into folders on its own; they do not make a folder "used". */
export const OS_CLUTTER = ['desktop.ini', 'thumbs.db', '.ds_store'];

export function isEmptyFolder(dir: string): boolean {
    try {
        return fs.readdirSync(dir).every((entry) => OS_CLUTTER.includes(entry.toLowerCase()));
    } catch {
        return false;
    }
}

/** Why a project name cannot be a folder name, or null when it can. */
export function projectNameProblem(name: string): string | null {
    const clean = name.trim();
    if (!clean) return 'Give the project a name.';
    if (/[<>:"/\\|?*\u0000-\u001f]/.test(clean)) return 'A folder name cannot contain < > : " / \\ | ? *';
    if (clean === '.' || clean === '..' || /[. ]$/.test(clean)) return 'A folder name cannot end with a dot or a space.';
    if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(clean)) return `"${clean}" is a name Windows keeps for itself.`;
    return null;
}

/** The development copy of a folder handed over: `<name>-dev`, beside it. */
export function devCopyOf(root: string): string {
    return path.join(path.dirname(root), `${path.basename(root)}-dev`);
}

// ---------------------------------------------------------------------------
// Copying
// ---------------------------------------------------------------------------

/** Every file under a folder, site-relative with forward slashes, skipping one folder name. */
export function filesUnder(dir: string, skip: string[]): string[] {
    const out: string[] = [];
    const walk = (abs: string): void => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(abs, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            const full = path.join(abs, entry.name);
            const rel = path.relative(dir, full).split(path.sep).join('/');
            if (entry.isDirectory()) {
                if (!skip.includes(rel)) walk(full);
            } else if (entry.isFile()) {
                out.push(rel);
            }
        }
    };
    walk(dir);
    return out.sort();
}

export function copyTree(from: string, to: string): void {
    if (!fs.existsSync(from)) return;
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const src = path.join(from, entry.name);
        const dest = path.join(to, entry.name);
        if (entry.isDirectory()) copyTree(src, dest);
        else if (entry.isFile()) fs.copyFileSync(src, dest);
    }
}
