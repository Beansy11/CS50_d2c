// Site template on disk: detect a site, make the development copy, list
// pages, compare copy against original, apply. Plain Node - no `vscode`
// import - so test/site.test.js can run it against temp folders.
//
// WHAT COUNTS AS A SITE - borrowed from how a web server answers a request
// (browsers and servers solved this long ago, so use their
// rules rather than inventing one):
//   - a DOCUMENT ROOT: the folder a site is served from. "/static/x.css" means
//     the document root, which is why the root has to be the PROJECT folder
//     and not the folder the page happens to sit in.
//   - an INDEX FILE LIST: a server given a directory serves the first name it
//     recognizes - index.html, index.htm, default.html... - see INDEX_FILES.
//   - pages are recognized BY EXTENSION (.html/.htm), the way a server picks a
//     content type, not by being called index.
// So: a folder is a site when it holds pages, either directly or in a pages
// folder (templates/, views/, ...) - and then the folder, not the pages
// folder, is the document root. An app-shaped project (Flask: app.py +
// templates/ + static/) is therefore one site, rooted where app.py is.
//
// The template (docs/SITE-TEMPLATE.md) is how Draw2Code ORGANIZES WHAT IT
// GENERATES, not a rule an existing site has to follow:
//   index.html          the entry page (this is what makes a folder a site)
//   pages/*.html        more pages (any .html in the site is listed anyway)
//   css/  js/  assets/  stylesheets, scripts, images and fonts
//
// Draw2Code edits a DEVELOPMENT COPY beside the site - homepage -> homepage-dev
// (the user's folder is their final copy, and nothing at
// all is written into it, not even a hidden folder, until they Apply).
//
// The development copy holds EVERYTHING in the site folder, whatever its
// layout, so importing a real site never loses a file.
//
// CS50 citation: The two checks for folders loaded into the desktop app
// builder were removed from this file with Claude (Anthropic AI) at my
// direction, when that builder was taken out of this project.
//
// CS50 citation: the name Draw2Code Web Editor was chosen with help from
// Claude (Anthropic AI), and at my direction Claude renamed
// the project from its earlier name, HardHat Designer, throughout this file.

import * as crypto from 'crypto';
import { isProject, readProject } from '../../src/projectFormat';
import * as fs from 'fs';
import * as path from 'path';

export const TEMPLATE = {
    entry: 'index.html',
    pagesDir: 'pages',
    /** Where a picture or a video added in the page editor is copied to. */
    assetsDir: 'assets',
    /** Where a shared stylesheet or script goes, such as the video player's. */
    stylesDir: 'css',
    scriptsDir: 'js',
    folders: ['pages', 'css', 'js', 'assets'],
} as const;

/**
 * A page's phone layout is kept in the overrides store beside its desktop
 * rules, under the page's name and this: "index.html" -> "index.html@phone"
 * (src/pageEditor.ts phoneKey). No page name ends with it.
 */
export const PHONE_MAP_SUFFIX = '@phone';

/** A page, by extension - how a server decides what it is serving. */
export function isPage(file: string): boolean {
    return /\.html?$/i.test(file);
}

/** A server's index file list: the first of these is a folder's entry page. */
export const INDEX_FILES = ['index.html', 'index.htm', 'default.html', 'home.html'];

/**
 * Folders that hold a project's pages while the project root stays the
 * document root: Flask and Django keep templates/, Express views/, and our
 * own template uses pages/. public/ and www/ are the usual static roots.
 */
export const PAGE_DIRS = ['templates', 'views', 'pages', 'public', 'www'];

/** The development copy sits beside the site: homepage -> homepage-dev. */
export const DEV_SUFFIX = '-dev';

/** Draw2Code's own state, kept inside the development copy. */
export const STATE_DIR = '.draw2code';

/** Never copied, never scanned: our own state, version control, dependencies. */
export const IGNORED_DIRS = [STATE_DIR, '.git', 'node_modules', '.svn', '.hg', '__pycache__', '.venv', 'venv'];

/** How deep to look for a site inside an opened folder. */
export const SCAN_DEPTH = 4;

export type FileStatus = 'added' | 'changed' | 'unchanged';
export interface FileDiff { file: string; status: FileStatus; }

/** The .html files directly in a folder, in name order. */
function pagesDirectlyIn(dir: string): string[] {
    try {
        return fs.readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isFile() && isPage(e.name))
            .map((e) => e.name)
            .sort();
    } catch {
        return [];
    }
}

/**
 * A folder is a site when pages can be served from it: .html directly in it,
 * or in one of its PAGE_DIRS. Either way THIS folder is the document root.
 */
export function isSite(root: string): boolean {
    return isProject(root) || entryPage(root) !== null;
}

/**
 * The page a site opens at, site-relative: the first index file a server
 * would serve, else the first page there is. null when it is not a site.
 */
export function entryPage(root: string): string | null {
    const here = pagesDirectlyIn(root);
    for (const name of INDEX_FILES) {
        const hit = here.find((f) => f.toLowerCase() === name);
        if (hit) return hit;
    }
    for (const dir of PAGE_DIRS) {
        const inside = pagesDirectlyIn(path.join(root, dir));
        for (const name of INDEX_FILES) {
            const hit = inside.find((f) => f.toLowerCase() === name);
            if (hit) return `${dir}/${hit}`;
        }
    }
    // No index file: the first page there is, so a folder of pages still opens.
    if (here.length) return here[0];
    for (const dir of PAGE_DIRS) {
        const inside = pagesDirectlyIn(path.join(root, dir));
        if (inside.length) return `${dir}/${inside[0]}`;
    }
    return null;
}

/**
 * Folders containing an index.html, nearest the top first. The opened folder
 * itself counts, so a site opened directly still works. Draw2Code's own
 * development copies are not sites in their own right, so they are skipped.
 */

export function findSites(root: string, maxDepth: number = SCAN_DEPTH): string[] {
    const found: string[] = [];
    const visit = (dir: string, depth: number): void => {
        if (isDevCopy(dir)) return;
        // A project Draw2Code made is one site: its -dev and -prod belong to it.
        if (isProject(dir)) { found.push(dir); return; }
        const site = isSite(dir);
        if (site) found.push(dir);
        if (depth >= maxDepth) return;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const entry of entries) {
            if (!entry.isDirectory() || IGNORED_DIRS.includes(entry.name)) continue;
            // A site's pages folder belongs to it: templates/ is not a second
            // site, it is where this one keeps its pages. Anything else under
            // a site is still scanned, so projects nested in a folder are found.
            if (site && PAGE_DIRS.includes(entry.name.toLowerCase())) continue;
            visit(path.join(dir, entry.name), depth + 1);
        }
    };
    visit(root, 0);
    return found;
}

/**
 * Where Draw2Code edits: a full copy of the site beside it, `<name>-dev`.
 * A real folder, not a hidden one, because it is the user's development
 * copy - they can open its files, run it, and put it in git.
 */
export function workRoot(root: string): string {
    // A project Draw2Code made keeps its -dev INSIDE it, as its label says.
    const project = readProject(root);
    if (project) return path.join(root, project.dev);
    return path.join(path.dirname(root), path.basename(root) + DEV_SUFFIX);
}

/** The site a development copy belongs to, or undefined. */
export function originalOf(dir: string): string | undefined {
    const name = path.basename(dir);
    // The -dev or -prod of a project Draw2Code made means the project.
    const parent = path.dirname(dir);
    const project = readProject(parent);
    if (project && (name === project.dev || name === project.prod)) return parent;
    if (!name.endsWith(DEV_SUFFIX)) return undefined;
    const original = path.join(path.dirname(dir), name.slice(0, -DEV_SUFFIX.length));
    return isSite(original) ? original : undefined;
}

/** Is this folder Draw2Code's development copy of the site beside it? */
export function isDevCopy(dir: string): boolean {
    return originalOf(dir) !== undefined;
}

export function hasWorkingCopy(root: string): boolean {
    if (isProject(root)) return entryPage(workRoot(root)) !== null;
    const entry = entryPage(root);
    return entry !== null && fs.existsSync(path.join(workRoot(root), entry));
}

/**
 * Copy the whole site into `<name>-dev`, and remember what the original
 * looked like at that moment (see originalChanges). Nothing is written into
 * the original. Returns the copied files, relative to the copy's root.
 */
export function createWorkingCopy(root: string): string[] {
    const work = workRoot(root);
    fs.rmSync(work, { recursive: true, force: true });
    fs.mkdirSync(work, { recursive: true });
    for (const rel of siteFiles(root)) {
        const dest = path.join(work, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(root, rel), dest);
    }
    // Draw2Code's own state, kept out of the user's git.
    fs.mkdirSync(path.join(work, STATE_DIR), { recursive: true });
    fs.writeFileSync(path.join(work, STATE_DIR, '.gitignore'), '*\n');
    writeSnapshot(root, snapshotOf(root));
    return siteFiles(work);
}

/** Every page in the site, the entry page first, then the rest by path. */
export function listPages(dir: string): string[] {
    const entry = entryPage(dir);
    return siteFiles(dir).filter(isPage).sort((a, b) => {
        if (a === entry) return -1;
        if (b === entry) return 1;
        return a.localeCompare(b);
    });
}

/**
 * Every file in the site, relative to `dir`, with forward slashes.
 * Whatever the site's layout: nothing is lost when it is copied.
 */
export function siteFiles(dir: string): string[] {
    const out: string[] = [];
    walk(dir, dir, out);
    return out.sort();
}

function walk(abs: string, base: string, out: string[]): void {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(abs, entry.name);
        if (entry.isDirectory()) {
            if (!IGNORED_DIRS.includes(entry.name)) walk(full, base, out);
        } else if (entry.isFile()) {
            out.push(path.relative(base, full).split(path.sep).join('/'));
        }
    }
}

// ---------------------------------------------------------------------------
// Keeping the copy in step with the original
//
// Comparing the two folders cannot answer "did the ORIGINAL change?": once
// the copy is the place you work, every edit makes them differ. So the
// original is fingerprinted when it is copied (.draw2code/source.json inside
// the copy), and a change is measured against THAT.
//
//   original moved on, copy untouched -> pull it in, silently
//   both moved on                     -> a conflict, and only then a question
// ---------------------------------------------------------------------------

export type ChangeStatus = 'added' | 'changed' | 'removed';
export interface OriginalChange {
    file: string;
    status: ChangeStatus;
    /** The copy changed this file too, so taking the original would lose work. */
    conflict: boolean;
}

function snapshotFile(root: string): string {
    return path.join(workRoot(root), STATE_DIR, 'source.json');
}

function hashOf(file: string): string {
    return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
}

/** What every file in a folder looks like right now. */
function snapshotOf(dir: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const file of siteFiles(dir)) out[file] = hashOf(path.join(dir, file));
    return out;
}

function readSnapshot(root: string): Record<string, string> {
    try {
        return JSON.parse(fs.readFileSync(snapshotFile(root), 'utf8')) as Record<string, string>;
    } catch {
        return {};
    }
}

function writeSnapshot(root: string, snapshot: Record<string, string>): void {
    const file = snapshotFile(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(snapshot, null, 2), 'utf8');
}

/**
 * Write the fingerprint if there is none: a development copy made by hand
 * has no .draw2code, and without this every file in the original would read as
 * new. Taking the original AS IT IS NOW means only later changes count.
 */
export function ensureSnapshot(root: string): void {
    if (!hasWorkingCopy(root) || fs.existsSync(snapshotFile(root))) return;
    writeSnapshot(root, snapshotOf(root));
}

/** What has happened to the ORIGINAL since it was copied. */
export function originalChanges(root: string): OriginalChange[] {
    // A project Draw2Code made has no original to follow: -dev IS the site.
    if (isProject(root) || !hasWorkingCopy(root)) return [];
    const work = workRoot(root);
    const before = readSnapshot(root);
    const now = snapshotOf(root);
    const inCopy = (file: string): string | undefined => {
        const copied = path.join(work, file);
        return fs.existsSync(copied) ? hashOf(copied) : undefined;
    };

    const changes: OriginalChange[] = [];
    for (const [file, hash] of Object.entries(now)) {
        const was = before[file];
        if (was === hash) continue;
        const mine = inCopy(file);
        changes.push(was === undefined
            ? { file, status: 'added', conflict: mine !== undefined && mine !== hash }
            : { file, status: 'changed', conflict: mine !== was });
    }
    for (const [file, was] of Object.entries(before)) {
        if (now[file] !== undefined) continue;
        changes.push({ file, status: 'removed', conflict: inCopy(file) !== was });
    }
    return changes.sort((a, b) => a.file.localeCompare(b.file));
}

/** Has the ORIGINAL moved on since it was copied? */
export function originalDiffers(root: string): boolean {
    return originalChanges(root).length > 0;
}

export interface SyncResult { synced: string[]; conflicts: string[]; }

/**
 * Pull the original's changes into the development copy. Files the copy has
 * also changed are left alone and named, unless `takeOriginal` lists them.
 */
export function syncFromOriginal(root: string, takeOriginal: string[] = []): SyncResult {
    const work = workRoot(root);
    const snapshot = readSnapshot(root);
    const synced: string[] = [];
    const conflicts: string[] = [];
    for (const change of originalChanges(root)) {
        if (change.conflict && !takeOriginal.includes(change.file)) {
            conflicts.push(change.file);
            continue;
        }
        const dest = path.join(work, change.file);
        if (change.status === 'removed') {
            fs.rmSync(dest, { force: true });
            delete snapshot[change.file];
        } else {
            fs.mkdirSync(path.dirname(dest), { recursive: true });
            fs.copyFileSync(path.join(root, change.file), dest);
            snapshot[change.file] = hashOf(dest);
        }
        synced.push(change.file);
    }
    writeSnapshot(root, snapshot);
    return { synced, conflicts };
}

/**
 * Keep the copy's version of these files: the original is written down as
 * seen, so the same change is never asked about twice.
 */
export function keepMine(root: string, files: string[]): void {
    const snapshot = readSnapshot(root);
    for (const file of files) {
        const original = path.join(root, file);
        if (fs.existsSync(original)) snapshot[file] = hashOf(original);
        else delete snapshot[file];
    }
    writeSnapshot(root, snapshot);
}

/** Status of every file in the development copy against the original. */
export function diffCopy(root: string): FileDiff[] {
    const work = workRoot(root);
    return siteFiles(work).map((file) => {
        const original = path.join(root, file);
        if (!fs.existsSync(original)) return { file, status: 'added' as const };
        const same = fs.readFileSync(original).equals(fs.readFileSync(path.join(work, file)));
        return { file, status: same ? 'unchanged' as const : 'changed' as const };
    });
}

/**
 * Apply: the one moment the original is written to. Its added and changed
 * files are taken from the development copy; files that exist only in the
 * original are never touched. The fingerprint is updated with them, so what
 * we just wrote is not read back as "the original changed".
 */
export function applyCopy(root: string): string[] {
    const work = workRoot(root);
    const snapshot = readSnapshot(root);
    const written: string[] = [];
    for (const { file, status } of diffCopy(root)) {
        if (status === 'unchanged') continue;
        const dest = path.join(root, file);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(path.join(work, file), dest);
        snapshot[file] = hashOf(dest);
        written.push(file);
    }
    writeSnapshot(root, snapshot);
    return written;
}

/** Links the browser must fetch itself, or that are not file paths at all. */
function isExternalUrl(value: string): boolean {
    return value.trim() === '' || /^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i.test(value.trim());
}

/** Marker put on links to other pages of the site; the preview bar's script
 * turns a click on one into a page switch instead of a navigation. */
export const PAGE_LINK_PREFIX = '#draw2code-page:';

/**
 * Turn every relative URL in the page into a webview URI.
 *
 * Only the HTML needs this: a stylesheet is already loaded from a webview
 * URI, so its own relative url()s resolve correctly on their own.
 * A leading "/" means the site root, as it would on a web server.
 *
 * Links to another .html page INSIDE the site become
 * `#draw2code-page:<relative path>` instead, with the "#section" of that
 * page they go to, if any: navigating the webview to a file URI leaves a
 * blank tab, and carrying the page name in the href is exact, where
 * matching webview URIs by prefix is guesswork. A link to a section of the
 * same page ("#prices") is left as it is.
 */
export function rewriteUrls(html: string, pageDir: string, siteRoot: string, toUri: (p: string) => string): string {
    const insideSite = (abs: string): string | null => {
        const rel = path.relative(siteRoot, abs).split(path.sep).join('/');
        return rel && !rel.startsWith('../') ? rel : null;
    };

    const resolve = (value: string, isLink = false): string => {
        const raw = value.trim();
        if (isExternalUrl(raw)) return value;
        const [pathPart, suffix = ''] = splitSuffix(raw);
        const abs = pathPart.startsWith('/')
            ? path.join(siteRoot, decodeURIComponent(pathPart))
            : path.resolve(pageDir, decodeURIComponent(pathPart));
        if (isLink && /\.html?$/i.test(pathPart)) {
            const rel = insideSite(abs);
            // A section of that page ("about.html#team") goes with it, for the editor to scroll to.
            const hash = suffix.includes('#') ? suffix.slice(suffix.indexOf('#')) : '';
            if (rel) return PAGE_LINK_PREFIX + rel + hash;
        }
        return toUri(abs) + suffix;
    };

    return html
        // <a href> may point at another page of the site
        .replace(/(<a\b[^>]*?\bhref\s*=\s*)(["'])([^"']*)\2/gi,
            (_m, head: string, quote: string, value: string) => `${head}${quote}${resolve(value, true)}${quote}`)
        // href / src / poster on any other tag
        .replace(/(\b(?:href|src|poster)\s*=\s*)(["'])([^"']*)\2/gi,
            (_m, head: string, quote: string, value: string) =>
                value.startsWith(PAGE_LINK_PREFIX) ? `${head}${quote}${value}${quote}`
                    : `${head}${quote}${resolve(value)}${quote}`)
        // srcset: "url 1x, url 2x"
        .replace(/(\bsrcset\s*=\s*)(["'])([^"']*)\2/gi, (_m, head: string, quote: string, value: string) => {
            const rewritten = value.split(',').map((part) => {
                const trimmed = part.trim();
                if (!trimmed) return trimmed;
                const [url, ...rest] = trimmed.split(/\s+/);
                return [resolve(url), ...rest].join(' ');
            }).join(', ');
            return `${head}${quote}${rewritten}${quote}`;
        })
        // url(...) inside <style> blocks and style attributes
        .replace(/url\(\s*(["']?)([^)"']+)\1\s*\)/gi,
            (_m, quote: string, value: string) => `url(${quote}${resolve(value)}${quote})`);
}

/** Split "file.html?q#frag" into ["file.html", "?q#frag"]. */
function splitSuffix(value: string): [string, string] {
    const at = value.search(/[?#]/);
    return at === -1 ? [value, ''] : [value.slice(0, at), value.slice(at)];
}

