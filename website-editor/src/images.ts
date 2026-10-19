// Pictures in the page editor: which files count as one, where a picked
// file goes in the development copy, how a page writes its address, and
// which copies made this session are left over once a page changes. A video,
// its poster and the video player's files are copied the same way.
//
// An <img src> is just text in the page, so it is checked here before it is
// written: it must stay inside the site. No scheme ("javascript:", "data:",
// "http:", "C:"), no absolute path, no backslash, and no ".." that climbs out
// of the site root.
//
// Plain Node - no vscode import - so test/images.test.js can run it.

import * as fs from 'fs';
import * as path from 'path';
import { IGNORED_DIRS, TEMPLATE } from './siteFiles';

/** The kinds of picture a page can show, lower case. */
export const IMAGE_EXTENSIONS: readonly string[] = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

/** "Logo.PNG" -> true; "notes.txt" -> false. Checked again after the Open dialog, which only filters. */
export function isImageFile(file: string): boolean {
    return IMAGE_EXTENSIONS.includes(path.extname(file).slice(1).toLowerCase());
}

/** "logo.png" -> "logo-2.png" when logo.png is taken, then "logo-3.png", ... */
export function freeName(name: string, taken: (name: string) => boolean): string {
    const ext = path.extname(name);
    const base = name.slice(0, name.length - ext.length);
    let candidate = name;
    for (let n = 2; taken(candidate); n++) candidate = `${base}-${n}${ext}`;
    return candidate;
}

/**
 * Where a picked picture goes, site-relative: a file already inside the
 * development copy is used where it is; anything else is copied into the
 * template's assets folder under a free name. `taken` says whether a
 * site-relative path is in use, and `same` whether that file holds the very
 * picture picked: then it is used again rather than copied twice. `earlier`
 * are the copies made this session, which count whatever name they got.
 */
export function placeImage(work: string, picked: string, taken: (file: string) => boolean,
    same: (file: string) => boolean = () => false, earlier: readonly string[] = []): { file: string; copy: boolean } {
    return placeFile(work, picked, TEMPLATE.assetsDir, taken, same, earlier);
}

/**
 * placeImage for any folder of the site: a video goes to the assets folder
 * too, the video player's stylesheet and script to the template's css and
 * js folders. A site with a different js/video-player.js of its own (or an
 * older one of ours) gets js/video-player-2.js beside it.
 */
export function placeFile(work: string, picked: string, dir: string, taken: (file: string) => boolean,
    same: (file: string) => boolean = () => false, earlier: readonly string[] = []): { file: string; copy: boolean } {
    const rel = path.relative(work, picked).split(path.sep).join('/');
    // Draw2Code's own folder and the ones like node_modules are never published.
    const inside = rel !== '' && !rel.startsWith('../') && !path.isAbsolute(rel) && !IGNORED_DIRS.includes(rel.split('/')[0]);
    if (inside) return { file: rel, copy: false };
    // logo.png, logo-2.png, ... in turn: one holding this picture is the one to use.
    let reuse: string | undefined;
    const name = freeName(path.basename(picked), (candidate) => {
        const file = `${dir}/${candidate}`;
        if (!taken(file)) return false;
        if (same(file)) reuse = file;
        return reuse === undefined;
    });
    reuse ??= earlier.find(same);
    if (reuse !== undefined) return { file: reuse, copy: false };
    return { file: `${dir}/${name}`, copy: true };
}

/**
 * Do two files hold the same bytes? The sizes first, then a piece at a
 * time, so a video of hundreds of MB is never read whole, let alone twice.
 * A file that cannot be read is not the same.
 */
export function sameFile(a: string, b: string): boolean {
    let one: number | undefined;
    let two: number | undefined;
    try {
        if (fs.statSync(a).size !== fs.statSync(b).size) return false;
        one = fs.openSync(a, 'r');
        two = fs.openSync(b, 'r');
        const size = 1 << 20;
        const left = Buffer.alloc(size);
        const right = Buffer.alloc(size);
        for (;;) {
            const read = fs.readSync(one, left, 0, size, null);
            const also = fs.readSync(two, right, 0, size, null);
            if (read !== also) return false;
            if (read === 0) return true;
            if (!left.subarray(0, read).equals(right.subarray(0, read))) return false;
        }
    } catch {
        return false;
    } finally {
        if (one !== undefined) fs.closeSync(one);
        if (two !== undefined) fs.closeSync(two);
    }
}

/**
 * An <img src> on `page`, checked: one that stays inside the site -> { file }
 * it points at, site-relative ("../assets/x.png" from "pages/a.html" ->
 * "assets/x.png"). Anything else -> { problem }.
 */
export function checkImageSrc(src: string, page: string): { file: string } | { problem: string } {
    // Any colon is refused, not only a known scheme: a browser drops a tab or
    // line break inside "java\tscript:", and "C:" is a drive.
    if (src.includes(':')) return { problem: 'a picture\'s address cannot have a scheme (javascript:, data:, http:) or a drive' };
    if (src.startsWith('/')) return { problem: 'a picture\'s address cannot start with / - it is written relative to the page' };
    let decoded = '';
    try {
        decoded = decodeURIComponent(src.split(/[?#]/)[0]);
    } catch {
        return { problem: 'that picture\'s address is not a file name' };
    }
    // Checked again decoded: "%5c" or "%0a" is the backslash or control character spelled out.
    if (!decoded || /[\\\u0000-\u001F\u007F-\u009F]/.test(src + decoded) || decoded.startsWith('/')) {
        return { problem: 'a picture\'s address cannot hold backslashes or control characters' };
    }
    const dir = path.posix.dirname(page);
    const file = path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, decoded));
    if (file === '..' || file.startsWith('../')) return { problem: 'that picture is outside the site' };
    return { file };
}

/**
 * The site-relative files a page points at, lower case: any src (a picture,
 * a video, a script), a video's poster, and any href (the video player's
 * stylesheet). Counting a link to a page as well only ever makes a file
 * look used, and only copies made this session are ever removed.
 */
export function imagesUsed(page: string, html: string): string[] {
    const out: string[] = [];
    for (const match of html.matchAll(/\b(?:src|poster|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi)) {
        const src = (match[1] ?? match[2] ?? match[3]).replace(/&amp;/g, '&');
        const checked = checkImageSrc(src, page);
        if ('file' in checked) out.push(checked.file.toLowerCase());
    }
    return out;
}

/**
 * After a page changed: what to do with the pictures copied in THIS session
 * (`copies`, site-relative). One no page uses any more is removed from disk;
 * one used again (a redo, an undone Delete) is written back if it is missing.
 * PURE: it only decides. Files that were not copied this session are not in
 * `copies`, so they are never touched.
 */
export function planCopies(copies: string[], pages: Array<{ page: string; html: string }>,
    onDisk: (file: string) => boolean): { remove: string[]; restore: string[] } {
    const used = new Set(pages.flatMap((p) => imagesUsed(p.page, p.html)));
    return {
        remove: copies.filter((file) => !used.has(file.toLowerCase()) && onDisk(file)),
        restore: copies.filter((file) => used.has(file.toLowerCase()) && !onDisk(file)),
    };
}
