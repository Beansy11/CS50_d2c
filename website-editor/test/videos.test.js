// Unit tests for videos in the page editor: src/videos.ts, the page's
// Content-Security-Policy (src/csp.ts) and the site's video player
// (media/site/video-player.js and .css), compiled to out/ by npm test's
// pretest.
//
// CS50 citation: I did not write these tests. I had an AI coding agent read
// my code and write tests for it, to save time, and it put this file in
// website-editor/test/. The code it tests is mine; the tests are the agent's.
// I run them with npm test.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const V = require('../../out/website-editor/src/videos.js');
const C = require('../../out/website-editor/src/csp.js');
const H = require('../media/generators/html.js');

const ID = 'dQw4w9WgXcQ';
const embed = (link) => {
    const found = V.embedOf(link);
    assert.ok('embed' in found, `${link}: ${found.problem}`);
    return found.embed;
};
// The repository's root, where the extension's own folder starts.
const ROOT = path.join(__dirname, '..', '..');
const PLAYER = V.playerSource(ROOT);
const PLAYER_JS = fs.readFileSync(PLAYER.script, 'utf8');
const PLAYER_CSS = fs.readFileSync(PLAYER.stylesheet, 'utf8');

describe('isVideoFile: only the videos a page can play, whatever the case', () => {
    it('takes .webm and .mp4', () => {
        for (const ok of ['intro.webm', 'Intro.WEBM', 'clip.mp4', 'folder.mp4/a.Mp4']) assert.equal(V.isVideoFile(ok), true, ok);
    });

    it('refuses anything else', () => {
        for (const bad of ['clip.mov', 'clip.avi', 'clip.mkv', 'notes.txt', 'webm', 'clip.webm.exe']) assert.equal(V.isVideoFile(bad), false, bad);
    });

    it('offers the file\'s own name, in words, before one is typed', () => {
        assert.equal(V.videoName('/home/me/Videos/product_tour-2.webm'), 'product tour 2');
        assert.equal(V.videoName('intro.webm'), 'intro');
    });
});

describe('pickedVideoFiles: one video\'s files, from the Open dialog', () => {
    it('takes a .webm, an .mp4, or one of each, the .webm as the video and the .mp4 beside it', () => {
        assert.deepEqual(V.pickedVideoFiles(['/v/intro.webm']), { video: '/v/intro.webm' });
        assert.deepEqual(V.pickedVideoFiles(['/v/intro.MP4']), { video: '/v/intro.MP4' });
        assert.deepEqual(V.pickedVideoFiles(['/v/intro.mp4', '/v/intro.webm']), { video: '/v/intro.webm', mp4: '/v/intro.mp4' }, 'in either order');
        assert.deepEqual(V.pickedVideoFiles(['/v/a.WEBM', '/v/b.mp4']), { video: '/v/a.WEBM', mp4: '/v/b.mp4' }, 'two names are the user\'s to choose');
    });

    it('refuses two of one kind, or any file that is not one, and says which', () => {
        assert.deepEqual(V.pickedVideoFiles(['/v/a.webm', '/v/b.webm']), { problem: '2 .webm files were picked (a.webm, b.webm) - pick one .webm, one .mp4, or one of each' });
        assert.deepEqual(V.pickedVideoFiles(['/v/a.mp4', '/v/b.webm', '/v/c.mp4']), { problem: '2 .mp4 files were picked (a.mp4, c.mp4) - pick one .webm, one .mp4, or one of each' });
        assert.deepEqual(V.pickedVideoFiles(['/v/a.webm', '/v/clip.mov']), { problem: 'clip.mov is not a video (.webm or .mp4)' });
        assert.deepEqual(V.pickedVideoFiles(['/v/a.webm.exe']), { problem: 'a.webm.exe is not a video (.webm or .mp4)' });
        assert.deepEqual(V.pickedVideoFiles([]), { problem: 'no video was picked' });
    });

    it('says where a video with only one file will not play', () => {
        assert.match(V.oneFileNote('/v/intro.webm'), /^intro\.webm plays in browsers but not in this editor \(VS Code cannot play \.webm\)/);
        assert.match(V.oneFileNote('/v/intro.mp4'), /^intro\.mp4 plays here, but if it is H\.264 it may not play on some systems, such as Fedora/);
        for (const file of ['/v/intro.webm', '/v/intro.MP4']) assert.match(V.oneFileNote(file), /add the video again with its \.webm and its \.mp4$/);
    });
});

describe('embedOf: a YouTube link becomes its no-cookie player', () => {
    const player = `https://www.youtube-nocookie.com/embed/${ID}`;

    it('takes every way YouTube writes one video', () => {
        for (const link of [
            `https://www.youtube.com/watch?v=${ID}`,
            `https://youtube.com/watch?feature=share&v=${ID}`,
            `https://m.youtube.com/watch?v=${ID}`,
            `https://music.youtube.com/watch?v=${ID}&list=RDAMVM`,
            `https://youtu.be/${ID}`,
            `youtu.be/${ID}`,
            `www.youtube.com/watch?v=${ID}`,
            `https://www.youtube.com/shorts/${ID}`,
            `https://www.youtube.com/embed/${ID}`,
            `https://www.youtube.com/live/${ID}`,
            `https://www.youtube.com/v/${ID}`,
            `https://www.youtube-nocookie.com/embed/${ID}`,
            `https://youtube-nocookie.com/embed/${ID}`,
            `  http://youtube.com/watch?v=${ID}  `,
        ]) assert.equal(embed(link), player, link);
    });

    it('keeps a start time, however it is written', () => {
        assert.equal(embed(`https://www.youtube.com/watch?v=${ID}&t=1m30s`), `${player}?start=90`);
        assert.equal(embed(`https://youtu.be/${ID}?t=42`), `${player}?start=42`);
        assert.equal(embed(`https://youtu.be/${ID}?t=90s`), `${player}?start=90`);
        assert.equal(embed(`https://youtu.be/${ID}?t=1h2m3s`), `${player}?start=3723`);
        assert.equal(embed(`https://www.youtube.com/embed/${ID}?start=30`), `${player}?start=30`);
        assert.equal(embed(`https://youtu.be/${ID}?t=0`), player, 'from the start: no start time');
        assert.equal(embed(`https://youtu.be/${ID}?t=soon`), player, 'one it cannot read starts at the beginning');
    });

    it('refuses a channel, a playlist or a page that is not one video', () => {
        for (const link of ['https://www.youtube.com/@chan', 'https://www.youtube.com/playlist?list=PL123', 'https://www.youtube.com/', `https://www.youtube.com/watch?list=PL123`, 'https://youtu.be/']) {
            const found = V.embedOf(link);
            assert.equal(found.problem, 'that link is not one video (a playlist or channel?)', link);
        }
    });

    it('refuses an ID YouTube would not make', () => {
        assert.ok('problem' in V.embedOf('https://youtu.be/dQw4w9WgXc'), 'ten characters');
        assert.ok('problem' in V.embedOf(`https://youtu.be/${ID}x`), 'twelve');
        assert.ok('problem' in V.embedOf('https://www.youtube.com/watch?v=dQw4w9W%22Xc'), 'a quote');
    });
});

describe('embedOf: a Vimeo link becomes its player, without tracking', () => {
    it('takes a video, an unlisted one, and one in a channel or a group', () => {
        assert.equal(embed('https://vimeo.com/76979871'), 'https://player.vimeo.com/video/76979871?dnt=1');
        assert.equal(embed('vimeo.com/76979871'), 'https://player.vimeo.com/video/76979871?dnt=1');
        assert.equal(embed('https://vimeo.com/76979871/abcdef'), 'https://player.vimeo.com/video/76979871?h=abcdef&dnt=1');
        assert.equal(embed('https://vimeo.com/channels/staffpicks/76979871'), 'https://player.vimeo.com/video/76979871?dnt=1');
        assert.equal(embed('https://vimeo.com/groups/shortfilms/videos/76979871'), 'https://player.vimeo.com/video/76979871?dnt=1');
        assert.equal(embed('https://player.vimeo.com/video/1?h=ab'), 'https://player.vimeo.com/video/1?h=ab&dnt=1');
        assert.equal(embed('https://www.vimeo.com/1/AB12'), 'https://player.vimeo.com/video/1?h=ab12&dnt=1');
    });

    it('refuses a page that is not one video, and a private part that is not hex', () => {
        assert.equal(V.embedOf('https://vimeo.com/user/abc').problem, 'that link is not one video (a playlist or channel?)');
        assert.equal(V.embedOf('https://vimeo.com/channels/staffpicks').problem, 'that link is not one video (a playlist or channel?)');
        assert.ok('problem' in V.embedOf('https://vimeo.com/1/not-hex'));
    });
});

describe('embedOf: nothing else is embedded', () => {
    it('refuses another site, one dressed as YouTube, and a user name in front', () => {
        for (const link of [
            'https://example.com/watch?v=dQw4w9WgXcQ',
            `https://youtube.com.evil.com/watch?v=${ID}`,
            `https://evilyoutube.com/watch?v=${ID}`,
            `https://youtube.com@evil.com/watch?v=${ID}`,
            `https://me@youtube.com/watch?v=${ID}`,
            `https://me:pw@vimeo.com/1`,
            'https://vimeo.com.evil.com/1',
        ]) assert.equal(V.embedOf(link).problem, 'only YouTube and Vimeo links can be embedded', link);
    });

    it('refuses any scheme but https and http', () => {
        for (const link of [`javascript:alert(1)//youtu.be/${ID}`, 'data:text/html,<script>alert(1)</script>', `ftp://youtube.com/watch?v=${ID}`, `file:///youtu.be/${ID}`]) {
            assert.ok('problem' in V.embedOf(link), link);
        }
    });

    it('says what is wrong with an empty link or one that is not an address', () => {
        assert.ok('problem' in V.embedOf(''));
        assert.ok('problem' in V.embedOf('   '));
        assert.ok('problem' in V.embedOf('https://'));
    });

    it('everything it accepts gets past the generator\'s own check, and nothing else does', () => {
        for (const link of [`https://youtu.be/${ID}?t=42`, `youtu.be/${ID}`, `https://www.youtube.com/shorts/${ID}`, 'https://vimeo.com/76979871', 'https://vimeo.com/1/abcdef', 'https://player.vimeo.com/video/1?h=AB']) {
            const address = embed(link);
            assert.equal(H.embedSrc(address), address, link);
        }
        for (const bad of ['', 'https://www.youtube.com/embed/' + ID, `https://www.youtube-nocookie.com/embed/${ID}?autoplay=1`, 'https://player.vimeo.com/video/1', 'javascript:alert(1)', `https://www.youtube-nocookie.com/embed/${ID}"onload="x`]) {
            assert.equal(H.embedSrc(bad), '', bad);
        }
    });
});

describe('the player\'s files: where they live and go', () => {
    it('are copied into the template\'s css and js folders', () => {
        assert.deepEqual({ ...V.PLAYER }, { script: 'js/video-player.js', stylesheet: 'css/video-player.css' });
    });

    it('ship with the extension, outside the draw2code folder that Publish leaves out', () => {
        for (const file of [PLAYER.script, PLAYER.stylesheet]) {
            assert.equal(fs.existsSync(file), true, file);
            assert.doesNotMatch(path.relative(ROOT, file).split(path.sep).join('/'), /(^|\/)draw2code\//);
        }
    });

    it('say nothing of Draw2Code, carry no markers and no citation', () => {
        for (const text of [PLAYER_JS, PLAYER_CSS]) {
            assert.doesNotMatch(text, /data-d2c|Draw2Code|CS50/i);
        }
    });
});

describe('video-player.js: the player\'s script', () => {
    it('is a script a browser can read, and leaves nothing behind in the page\'s names', () => {
        assert.doesNotThrow(() => new vm.Script(PLAYER_JS));
        assert.match(PLAYER_JS, /^\(function \(\) \{\n {4}'use strict';/m);
        assert.match(PLAYER_JS.trimEnd(), /\}\)\(\);$/);
    });

    it('never adds, moves or removes an element: the editor finds them by their place', () => {
        for (const word of ['appendChild', 'insertBefore', 'innerHTML', 'outerHTML', '.remove(', 'replaceWith', 'createElement', 'insertAdjacent', '.append(', '.prepend(', 'document.write']) {
            assert.equal(PLAYER_JS.includes(word), false, word);
        }
    });

    it('sets up each player once, so the script loaded twice does nothing twice', () => {
        assert.match(PLAYER_JS, /querySelectorAll\('\.video-player:not\(\[data-ready\]\)'\)/);
    });

    it('listens for keys on the player only, never on the whole page', () => {
        assert.doesNotMatch(PLAYER_JS, /(document|window)\.addEventListener\('key/);
        assert.match(PLAYER_JS, /box\.addEventListener\('keydown'/);
    });

    it('runs in a page: plays, pauses, seeks, mutes and says the time', () => {
        // A small stand-in for the browser: just enough of the DOM for the
        // player's own markup, as the generator writes it.
        const page = fakePage(H.renderElement({ id: 1, type: 'video', x: 0, y: 0, w: 480, h: 270, fill: '#000000', stroke: '#000000', strokeWidth: 0, src: 'a.webm', poster: '', embed: '', title: 'Intro' }).html);
        vm.runInNewContext(PLAYER_JS, page.context);
        const { box, video, find } = page;
        assert.equal(box.hasAttribute('data-ready'), true);
        assert.equal(video.hasAttribute('controls'), false, 'the browser\'s own controls go');
        video.duration = 200;
        video.fire('loadedmetadata');
        assert.equal(find('video-time').textContent, '0:00 / 3:20');
        find('video-big-play').fire('click');
        assert.equal(video.paused, false);
        assert.equal(box.hasAttribute('data-playing'), true);
        assert.equal(find('video-play').getAttribute('aria-label'), 'Pause');
        video.currentTime = 65;
        video.fire('timeupdate');
        assert.equal(find('video-seek').getAttribute('aria-valuetext'), '1:05 of 3:20');
        assert.equal(find('video-seek').value, '325');
        find('video-seek').value = '500';
        find('video-seek').fire('input');
        assert.equal(video.currentTime, 100);
        find('video-play').fire('click');
        assert.equal(video.paused, true);
        assert.equal(box.hasAttribute('data-playing'), false);
        find('video-mute').fire('click');
        assert.equal(video.muted, true);
        assert.equal(box.hasAttribute('data-muted'), true);
        assert.equal(find('video-mute').getAttribute('aria-label'), 'Unmute');
        find('video-volume').value = '0.5';
        find('video-volume').fire('input');
        assert.deepEqual([video.muted, video.volume], [false, 0.5]);
        box.fire('keydown', { key: 'ArrowRight', target: find('video-play') });
        assert.equal(video.currentTime, 105);
        box.fire('keydown', { key: 'ArrowDown', target: find('video-play') });
        assert.equal(video.volume, 0.4);
        box.fire('keydown', { key: 'End', target: find('video-play') });
        assert.equal(video.currentTime, 200);
        video.fire('error');
        assert.equal(find('video-message').textContent, 'This browser cannot play this video');
    });

    // The generator's markup for a video with both files.
    const twoFiles = () => fakePage(H.renderElement({ id: 1, type: 'video', x: 0, y: 0, w: 480, h: 270, fill: '#000000', stroke: '#000000', strokeWidth: 0, src: 'a.webm', srcMp4: 'a.mp4', poster: '', embed: '', title: 'Intro' }).html);

    it('with a .webm and an .mp4, says it cannot play only once neither can, and tells the time of the one that plays', () => {
        const page = twoFiles();
        vm.runInNewContext(PLAYER_JS, page.context);
        const { video, sources, find } = page;
        assert.deepEqual(sources.map((source) => source.getAttribute('src')), ['a.webm', 'a.mp4']);
        // VS Code's editor: no WebM, so the .webm fails at its <source>, and the .mp4 plays.
        video.networkState = 2;
        sources[0].fire('error');
        assert.equal(find('video-message').textContent, '', 'the .mp4 is still to come');
        video.duration = 10;
        video.readyState = 1;
        video.fire('loadedmetadata');
        assert.equal(find('video-time').textContent, '0:00 / 0:10');
        assert.equal(find('video-message').textContent, '');
    });

    it('with a .webm and an .mp4, both failing: the last <source>\'s error, or no source left, says so', () => {
        for (const last of [true, false]) {
            const page = twoFiles();
            vm.runInNewContext(PLAYER_JS, page.context);
            const { video, sources, find } = page;
            sources[0].fire('error');
            assert.equal(find('video-message').textContent, '');
            video.networkState = 3;
            (last ? sources[1] : sources[0]).fire('error');
            assert.equal(find('video-message').textContent, 'This browser cannot play this video', last ? 'the last one' : 'none left');
        }
    });

    it('a video that failed before the script ran says so: at once with an error, after a moment with no source left', () => {
        const failed = twoFiles();
        failed.video.error = { code: 4 };
        vm.runInNewContext(PLAYER_JS, failed.context);
        assert.equal(failed.find('video-message').textContent, 'This browser cannot play this video');
        for (const [later, says] of [[3, 'This browser cannot play this video'], [2, '']]) {
            const page = twoFiles();
            const timers = [];
            page.context.setTimeout = (fn) => { timers.push(fn); return timers.length; };
            page.video.networkState = 3;
            vm.runInNewContext(PLAYER_JS, page.context);
            assert.equal(page.find('video-message').textContent, '', 'not yet: it may only be starting');
            page.video.networkState = later;
            for (const fn of timers) fn();
            assert.equal(page.find('video-message').textContent, says, later === 3 ? 'still none left' : 'it was only starting');
        }
    });

    it('a page from before, with the video\'s own src, still says when it cannot play', () => {
        const markup = H.renderElement({ id: 1, type: 'video', x: 0, y: 0, w: 480, h: 270, fill: '#000000', stroke: '#000000', strokeWidth: 0, src: 'a.webm', poster: '', embed: '', title: '' }).html
            .replace(/<video ([^>]*)><source src="a\.webm" type="video\/webm"><\/video>/, '<video src="a.webm" $1></video>');
        assert.match(markup, /<video src="a.webm" preload/);
        const page = fakePage(markup);
        vm.runInNewContext(PLAYER_JS, page.context);
        assert.equal(page.sources.length, 0);
        page.video.networkState = 3;
        page.video.fire('error');
        assert.equal(page.find('video-message').textContent, 'This browser cannot play this video');
    });
});

describe('video-player.css: the player\'s look', () => {
    // Every selector, comments taken out, from the plain rules and those
    // inside @container and @media.
    const selectors = PLAYER_CSS.replace(/\/\*[\s\S]*?\*\//g, '')
        .split('{').slice(0, -1)
        .map((part) => part.split('}').pop().trim())
        .filter((selector) => selector && !selector.startsWith('@'))
        .flatMap((selector) => selector.split(',').map((one) => one.trim()));

    it('adds no weight of its own: every selector starts with :where()', () => {
        assert.ok(selectors.length > 15);
        for (const selector of selectors) assert.match(selector, /^:where\(/, selector);
    });

    it('never sets what the editor writes on the box: its place, size, colours, border and corners', () => {
        const boxRules = [...PLAYER_CSS.matchAll(/:where\(\.video-player\) \{([^}]*)\}/g)].map((m) => m[1]);
        assert.ok(boxRules.length > 0);
        for (const body of boxRules) assert.doesNotMatch(body, /\b(left|top|width|height|background|border|border-radius)\s*:/);
    });

    it('styles or uses every part the generator writes, by the names the script finds them by', () => {
        const parts = H.renderElement({ id: 1, type: 'video', x: 0, y: 0, w: 480, h: 270, fill: '#000000', stroke: '#000000', strokeWidth: 0, src: 'a.webm', poster: '', embed: '', title: '' }).html;
        const classes = [...new Set([...parts.matchAll(/class="([^"]+)"/g)].map((m) => m[1]))];
        assert.ok(classes.length >= 14);
        for (const cls of classes) assert.ok(PLAYER_CSS.includes(`.${cls}`) || PLAYER_JS.includes(`'${cls}'`), `${cls} is styled or used`);
        // And no name in the stylesheet that the generator does not write.
        for (const [, cls] of PLAYER_CSS.matchAll(/\.(video-[\w-]+)/g)) assert.ok(classes.includes(cls), `${cls} is in the markup`);
        for (const cls of ['video-big-play', 'video-play', 'video-seek', 'video-time', 'video-mute', 'video-volume', 'video-full', 'video-message', 'video-player']) {
            assert.ok(PLAYER_JS.includes(`'${cls}'`) || PLAYER_JS.includes(`.${cls}`), `${cls} in the script`);
        }
        for (const attr of ['data-ready', 'data-playing', 'data-muted', 'data-fullscreen', 'data-idle']) {
            assert.ok(PLAYER_JS.includes(attr) && PLAYER_CSS.includes(attr), attr);
        }
    });
});

describe('pageCsp: what a page shown in the editor may load', () => {
    const csp = C.pageCsp('X');

    it('lets frames come from YouTube\'s and Vimeo\'s players only', () => {
        assert.ok(csp.split('; ').includes('frame-src https://www.youtube-nocookie.com https://player.vimeo.com'));
        assert.equal(csp.split('; ').filter((d) => d.startsWith('frame-src')).length, 1);
    });

    it('plays a video and shows its poster from the site, as before', () => {
        assert.ok(csp.split('; ').includes('media-src X data:'));
        assert.ok(csp.split('; ').includes('img-src X data: https:'));
        assert.ok(csp.split('; ').includes('script-src X \'unsafe-inline\''), 'the player\'s script loads');
        assert.ok(csp.startsWith('default-src \'none\''));
    });
});

/**
 * A page holding one video player, as small as the player needs: elements
 * that keep their attributes and listeners, a query by class, and a video
 * that plays and pauses.
 */
function fakePage(markup) {
    const all = [];
    const listeners = new WeakMap();
    const make = (tag, attrs) => {
        const el = {
            localName: tag,
            attrs: new Map(attrs),
            textContent: '',
            value: attrs.find(([n]) => n === 'value')?.[1] ?? '',
            getAttribute: (n) => (el.attrs.has(n) ? el.attrs.get(n) : null),
            setAttribute: (n, v) => el.attrs.set(n, String(v)),
            removeAttribute: (n) => el.attrs.delete(n),
            hasAttribute: (n) => el.attrs.has(n),
            addEventListener: (type, fn) => {
                const map = listeners.get(el) ?? {};
                (map[type] ??= []).push(fn);
                listeners.set(el, map);
            },
            fire: (type, extra = {}) => {
                const event = { type, target: el, preventDefault() {}, ctrlKey: false, metaKey: false, altKey: false, ...extra };
                for (const fn of (listeners.get(el) ?? {})[type] ?? []) fn(event);
            },
            querySelector: (selector) => all.find((one) => one !== el && matches(one, selector)) ?? null,
            querySelectorAll: (selector) => all.filter((one) => one !== el && matches(one, selector)),
            matches: (selector) => matches(el, selector),
        };
        return el;
    };
    const matches = (el, selector) => {
        if (selector === 'video' || selector === 'source') return el.localName === selector;
        const cls = /^\.([\w-]+)(:not\(\[data-ready\]\))?$/.exec(selector);
        if (!cls) throw new Error(`the stand-in cannot find ${selector}`);
        return (el.getAttribute('class') ?? '').split(' ').includes(cls[1]) && !(cls[2] && el.hasAttribute('data-ready'));
    };
    for (const m of markup.matchAll(/<([a-z]+)\b([^>]*)>/g)) {
        const attrs = [...m[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)].map((a) => [a[1], a[2] ?? '']);
        all.push(make(m[1], attrs));
    }
    const box = all[0];
    const video = all.find((el) => el.localName === 'video');
    Object.assign(video, {
        paused: true, ended: false, currentTime: 0, duration: NaN, volume: 1, muted: false,
        // Choosing a file to play, as a browser starts: nothing loaded, no error.
        networkState: 2, readyState: 0, error: null,
        play() { this.paused = false; this.fire('play'); return Promise.resolve(); },
        pause() { this.paused = true; this.fire('pause'); },
    });
    // Setting the volume or muting tells the page, as a browser does.
    for (const prop of ['volume', 'muted']) {
        let value = video[prop];
        Object.defineProperty(video, prop, { get: () => value, set: (v) => { value = v; video.fire('volumechange'); } });
    }
    const document = {
        readyState: 'complete',
        fullscreenElement: null,
        querySelectorAll: (selector) => all.filter((el) => matches(el, selector)),
        addEventListener() {},
    };
    return {
        box, video, sources: all.filter((el) => el.localName === 'source'),
        find: (cls) => all.find((el) => (el.getAttribute('class') ?? '').split(' ').includes(cls)),
        context: { document, setTimeout: () => 0, clearTimeout() {}, Number, String, Math },
    };
}
