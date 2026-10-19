// Videos in the page editor: which files count as one, which links to a
// hosted video can be embedded and how, and where the site's video player
// lives.
//
// A video is either a file of the site's own, played in the site's player
// (media/site/video-player.js and .css, copied into the site beside it), or
// a YouTube or Vimeo video, played in their player in a frame. A link is
// just text, so it is read here and only ever written back as one of two
// addresses Draw2Code makes itself; the generator checks those again
// (embedSrc in media/generators/html.js).
//
// Plain Node - no vscode import - so test/videos.test.js can run it.

import * as path from 'path';
import { TEMPLATE } from './siteFiles';

import { checkImageSrc } from './images';
import { playerLinks } from './pageEdit';

export { playerLinks, usesPlayer } from './pageEdit';

/** The kinds of video file a page can play, lower case. Both play in browsers; only an .mp4 plays in VS Code's editor. */
export const VIDEO_EXTENSIONS: readonly string[] = ['webm', 'mp4'];

/** "Intro.WEBM" -> true; "clip.mov" -> false. Checked again after the Open dialog, which only filters. */
export function isVideoFile(file: string): boolean {
    return VIDEO_EXTENSIONS.includes(path.extname(file).slice(1).toLowerCase());
}

/**
 * The files picked in the Open dialog for one video, or why they cannot
 * be: one .webm, one .mp4, or one of each (the same video twice, so every
 * browser and this editor have one they play). `video` is the .webm when
 * there are both, and otherwise the one file; `mp4` is the .mp4 beside a
 * .webm. Anything else - another kind of file, two of one kind - adds
 * nothing.
 */
export function pickedVideoFiles(files: readonly string[]): { video: string; mp4?: string } | { problem: string } {
    if (!files.length) return { problem: 'no video was picked' };
    const other = files.find((file) => !isVideoFile(file));
    if (other !== undefined) return { problem: `${path.basename(other)} is not a video (.webm or .mp4)` };
    const kind = (ext: string): string[] => files.filter((file) => path.extname(file).toLowerCase() === `.${ext}`);
    const [webm, mp4] = [kind('webm'), kind('mp4')];
    for (const [ext, picked] of [['webm', webm], ['mp4', mp4]] as const) {
        if (picked.length > 1) {
            return { problem: `${picked.length} .${ext} files were picked (${picked.map((file) => path.basename(file)).join(', ')}) - pick one .webm, one .mp4, or one of each` };
        }
    }
    if (webm.length && mp4.length) return { video: webm[0], mp4: mp4[0] };
    return { video: webm[0] ?? mp4[0] };
}

/**
 * What to say after adding a video that has only one file, or nothing when
 * it has both: where that one does not play. VS Code's own browser has no
 * WebM at all (its media library reads only .mp4), and an H.264 .mp4 does
 * not play on a system without that codec, such as a default Fedora.
 */
export function oneFileNote(file: string): string | undefined {
    const name = path.basename(file);
    const again = 'to have both, add the video again with its .webm and its .mp4';
    switch (path.extname(file).toLowerCase()) {
        case '.webm': return `${name} plays in browsers but not in this editor (VS Code cannot play .webm) - ${again}`;
        case '.mp4': return `${name} plays here, but if it is H.264 it may not play on some systems, such as Fedora - ${again}`;
        default: return undefined;
    }
}

/**
 * The video player's two files, site-relative: where they are copied to,
 * in the template's folders for stylesheets and scripts.
 */
export const PLAYER = Object.freeze({
    script: `${TEMPLATE.scriptsDir}/video-player.js`,
    stylesheet: `${TEMPLATE.stylesDir}/video-player.css`,
});

/** Where the extension keeps the player's files, under its own folder. */
export function playerSource(extensionRoot: string): { script: string; stylesheet: string } {
    const dir = path.join(extensionRoot, 'website-editor', 'media', 'site');
    return { script: path.join(dir, path.posix.basename(PLAYER.script)), stylesheet: path.join(dir, path.posix.basename(PLAYER.stylesheet)) };
}

/**
 * Is this the text of one of the player's files? Both open with a comment
 * that starts "Video player for this site", in every version of them, so a
 * copy made by an older Draw2Code still counts. A site's own video-player.js
 * does not.
 */
export function isPlayerFile(text: string): boolean {
    return /^\s*(\/\/|\/\*)\s*Video player for this site\b/.test(text);
}

/**
 * The player's stylesheet and script `page` links, as playerLinks finds
 * them, but only the ones that are Draw2Code's player: `read` gives a
 * site-relative file's text, and throws when there is none. Deleting the
 * last video takes only these away, and a video added uses only these, so
 * a site's own file of that name is never unlinked or used as the player.
 */
export function ownPlayerLinks(html: string, page: string, read: (file: string) => string): { stylesheet?: string; script?: string } {
    return playerLinks(html, (link) => {
        const checked = checkImageSrc(link, page);
        if ('problem' in checked) return false;
        try {
            return isPlayerFile(read(checked.file));
        } catch {
            return false;
        }
    });
}

/** "intro_clip-2.webm" -> "intro clip 2": the name a video is offered before one is typed. */
export function videoName(file: string): string {
    return path.basename(file, path.extname(file)).replace(/[-_]+/g, ' ').trim();
}

const YOUTUBE_HOSTS: readonly string[] = ['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com', 'youtu.be'];
const VIMEO_HOSTS: readonly string[] = ['vimeo.com', 'www.vimeo.com', 'player.vimeo.com'];

/** Every YouTube video's ID is 11 of these. */
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** What a link that is not one video gets, on a site that does embed. */
const NOT_ONE = 'that link is not one video (a playlist or channel?)';

/** "90", "90s", "1m30s", "1h2m3s" -> seconds; anything else -> 0 (from the start). */
export function startTime(value: string | null): number {
    const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/.exec(value ?? '');
    if (!match || !value) return 0;
    return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

/**
 * A YouTube or Vimeo link pasted in, as the address of their player for
 * that one video - or why it cannot be:
 *   youtube.com/watch?v=ID&t=1m30s -> https://www.youtube-nocookie.com/embed/ID?start=90
 *   youtu.be/ID, youtube.com/shorts/ID, /embed/ID, /live/ID, /v/ID (also m., music., nocookie)
 *   vimeo.com/123                  -> https://player.vimeo.com/video/123?dnt=1
 *   vimeo.com/123/abc (unlisted), /channels/x/123, /groups/x/videos/123,
 *   player.vimeo.com/video/123?h=abc -> ...?h=abc&dnt=1
 * YouTube's no-cookie player and Vimeo's dnt=1 keep them from tracking the
 * site's visitors until a video is played. The host must be exactly one of
 * theirs ("youtube.com.example.com" is not), with no user name in front.
 */
export function embedOf(link: string): { embed: string; provider: 'YouTube' | 'Vimeo' } | { problem: string } {
    const text = link.trim();
    if (!text) return { problem: 'paste a YouTube or Vimeo link' };
    // "youtu.be/ID" pasted without https://; anything with another scheme (javascript:, data:) is refused below.
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
    let url: URL;
    try {
        url = new URL(withScheme);
    } catch {
        return { problem: 'that is not a web address' };
    }
    const host = url.hostname.toLowerCase();
    const web = url.protocol === 'https:' || url.protocol === 'http:';
    if (!web || url.username || url.password || ![...YOUTUBE_HOSTS, ...VIMEO_HOSTS].includes(host)) {
        return { problem: 'only YouTube and Vimeo links can be embedded' };
    }
    const parts = url.pathname.split('/').filter(Boolean);
    if (YOUTUBE_HOSTS.includes(host)) {
        let id: string | undefined;
        if (host === 'youtu.be') id = parts[0];
        else if (parts[0] === 'watch') id = url.searchParams.get('v') ?? undefined;
        else if (['shorts', 'embed', 'live', 'v'].includes(parts[0] ?? '')) id = parts[1];
        if (!id || (host === 'youtu.be' && parts.length > 1)) return { problem: NOT_ONE };
        if (!YOUTUBE_ID.test(id)) return { problem: 'that YouTube link\'s video ID is not one YouTube makes' };
        const start = startTime(url.searchParams.get('t') ?? url.searchParams.get('start'));
        return { embed: `https://www.youtube-nocookie.com/embed/${id}${start > 0 ? `?start=${start}` : ''}`, provider: 'YouTube' };
    }
    // Vimeo: the video's number, and for an unlisted video the hash after it.
    let id: string | undefined;
    let hash: string | undefined;
    if (host === 'player.vimeo.com') {
        if (parts[0] === 'video') id = parts[1];
    } else if (parts[0] === 'channels' && parts.length === 3) {
        id = parts[2];
    } else if (parts[0] === 'groups' && parts[2] === 'videos' && parts.length === 4) {
        id = parts[3];
    } else if (parts.length <= 2 && /^\d+$/.test(parts[0] ?? '')) {
        id = parts[0];
        hash = parts[1];
    }
    hash ??= url.searchParams.get('h') ?? undefined;
    if (!id || !/^\d+$/.test(id)) return { problem: NOT_ONE };
    if (hash !== undefined && !/^[0-9a-f]+$/i.test(hash)) return { problem: 'that Vimeo link\'s private part is not one Vimeo makes' };
    return { embed: `https://player.vimeo.com/video/${id}?${hash ? `h=${hash.toLowerCase()}&` : ''}dnt=1`, provider: 'Vimeo' };
}
