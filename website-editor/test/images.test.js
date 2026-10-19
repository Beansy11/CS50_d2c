// Unit tests for pictures in the page editor: src/images.ts, the image
// element in media/model.js and media/generators/html.js, and Publish
// (compiled to out/ by npm test's pretest).
//
// CS50 citation: I did not write these tests. I had an AI coding agent read
// my code and write tests for it, to save time, and it put this file in
// website-editor/test/. The code it tests is mine; the tests are the agent's.
// I run them with npm test.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const I = require('../../out/website-editor/src/images.js');
const L = require('../../out/website-editor/src/links.js');
const E = require('../../out/website-editor/src/pageEditor.js');
const S = require('../../out/website-editor/src/siteFiles.js');
const P = { ...require('../../out/src/projectFormat.js'), ...require('../../out/website-editor/src/siteProject.js'), ...require('../../out/src/publish.js') };
const M = require('../media/model.js');
const H = require('../media/generators/html.js');

const image = (id, src, alt) => M.setProp(M.setProp(M.createElement(id, 'image', { x: 10, y: 20, w: 200, h: 150 }, M.DEFAULT_STYLE), 'src', src), 'alt', alt);
// A few bytes that are not text: a picture must arrive byte for byte.
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe, 0x80]);

describe('isImageFile: only pictures, whatever the case', () => {
    it('takes the six kinds of picture', () => {
        for (const ok of ['a.png', 'b.JPG', 'c.jpeg', 'd.Gif', 'e.webp', 'f.SVG', 'folder.png/logo.png']) assert.equal(I.isImageFile(ok), true, ok);
    });

    it('refuses anything else', () => {
        for (const bad of ['notes.txt', 'page.html', 'logo.png.exe', 'png', 'logo', 'script.svg.js']) assert.equal(I.isImageFile(bad), false, bad);
    });
});

describe('checkImageSrc: a picture stays inside the site', () => {
    it('takes an address inside the site and says which file it is', () => {
        assert.deepEqual(I.checkImageSrc('../assets/x.png', 'pages/a.html'), { file: 'assets/x.png' });
        assert.deepEqual(I.checkImageSrc('assets/x.png', 'index.html'), { file: 'assets/x.png' });
        assert.deepEqual(I.checkImageSrc('assets/my%20logo.png', 'index.html'), { file: 'assets/my logo.png' });
    });

    it('refuses absolute paths, schemes, // and backslashes', () => {
        const bad = [
            '/etc/x.png', 'C:\\x.png', 'C:/x.png', 'assets\\x.png', '//evil.example/x.png',
            'javascript:alert(1)', 'data:image/png;base64,AAAA', 'http://example.com/x.png', 'file:///etc/x.png',
            'java\tscript:alert(1)', ' javascript:alert(1)', 'assets%5cx.png', 'assets/x%0a.png', '%2fetc/x.png', '',
        ];
        for (const src of bad) assert.ok('problem' in I.checkImageSrc(src, 'pages/a.html'), JSON.stringify(src));
    });

    it('refuses .. that climbs out of the site root', () => {
        assert.ok('problem' in I.checkImageSrc('../x.png', 'index.html'));
        assert.ok('problem' in I.checkImageSrc('../../x.png', 'pages/a.html'));
        assert.ok('problem' in I.checkImageSrc('assets/../../x.png', 'index.html'));
        assert.ok('problem' in I.checkImageSrc('%2e%2e/x.png', 'index.html'));
    });

    it('is the address the editor writes: relative to the page\'s folder', () => {
        assert.equal(L.pageHref('pages/a.html', 'assets/logo.png'), '../assets/logo.png');
        assert.equal(L.pageHref('index.html', 'assets/logo.png'), 'assets/logo.png');
        assert.deepEqual(I.checkImageSrc(L.pageHref('pages/a.html', 'assets/my logo.png'), 'pages/a.html'), { file: 'assets/my logo.png' });
    });
});

describe('placeImage: where a picked picture goes', () => {
    const work = path.join(os.tmpdir(), 'd2c-place', 'site-dev');

    it('copies a file from outside into the assets folder, under its own name', () => {
        assert.deepEqual(I.placeImage(work, path.join(os.tmpdir(), 'Downloads', 'logo.png'), () => false), { file: `${S.TEMPLATE.assetsDir}/logo.png`, copy: true });
    });

    it('takes a free name when the name is in use: logo.png -> logo-2.png -> logo-3.png', () => {
        const taken = new Set(['assets/logo.png', 'assets/logo-2.png']);
        assert.equal(I.placeImage(work, path.join(os.tmpdir(), 'logo.png'), (f) => taken.has(f)).file, 'assets/logo-3.png');
        assert.equal(I.freeName('logo.png', (n) => n === 'logo.png'), 'logo-2.png');
        assert.equal(I.freeName('photo', (n) => n === 'photo'), 'photo-2');
    });

    it('uses a file already inside the development copy where it is', () => {
        assert.deepEqual(I.placeImage(work, path.join(work, 'img', 'cat.png'), () => true), { file: 'img/cat.png', copy: false });
    });

    it('copies one from Draw2Code\'s own folder, which is never published', () => {
        assert.deepEqual(I.placeImage(work, path.join(work, S.STATE_DIR, 'x.png'), () => false), { file: 'assets/x.png', copy: true });
    });

    it('copies one from a folder beside the copy whose name starts the same', () => {
        assert.equal(I.placeImage(work, path.join(`${work}2`, 'x.png'), () => false).copy, true);
    });

    it('uses the same picture again instead of copying it twice', () => {
        const taken = new Set(['assets/logo.png']);
        const place = I.placeImage(work, path.join(os.tmpdir(), 'logo.png'), (f) => taken.has(f), (f) => f === 'assets/logo.png');
        assert.deepEqual(place, { file: 'assets/logo.png', copy: false });
    });

    it('still gives a different picture with the same name a new name', () => {
        const taken = new Set(['assets/logo.png']);
        assert.deepEqual(I.placeImage(work, path.join(os.tmpdir(), 'logo.png'), (f) => taken.has(f), () => false), { file: 'assets/logo-2.png', copy: true });
    });

    it('finds the same picture further along the names: logo.png differs, logo-2.png is it', () => {
        const taken = new Set(['assets/logo.png', 'assets/logo-2.png']);
        const place = I.placeImage(work, path.join(os.tmpdir(), 'logo.png'), (f) => taken.has(f), (f) => f === 'assets/logo-2.png');
        assert.deepEqual(place, { file: 'assets/logo-2.png', copy: false });
    });

    it('uses a copy made earlier this session, whatever name it got', () => {
        const taken = new Set(['assets/brand.png']);
        const place = I.placeImage(work, path.join(os.tmpdir(), 'logo (1).png'), (f) => taken.has(f), (f) => f === 'assets/brand.png', ['assets/brand.png']);
        assert.deepEqual(place, { file: 'assets/brand.png', copy: false });
    });
});

describe('planCopies: copies made this session are tidied after every change', () => {
    const pages = (...htmls) => htmls.map(([page, html]) => ({ page, html }));
    const present = (...files) => (file) => files.includes(file);

    it('removes a copy no page uses any more', () => {
        const plan = I.planCopies(['assets/logo.png'], pages(['index.html', '<p>no picture</p>']), present('assets/logo.png'));
        assert.deepEqual(plan, { remove: ['assets/logo.png'], restore: [] });
    });

    it('writes one back when a page uses it again (redo, an undone Delete)', () => {
        const plan = I.planCopies(['assets/logo.png'], pages(['pages/a.html', '<img id="image-1" src="../assets/logo.png" alt="">']), present());
        assert.deepEqual(plan, { remove: [], restore: ['assets/logo.png'] });
    });

    it('keeps one that any page uses, however the address is written', () => {
        const used = pages(['index.html', '<p>x</p>'], ['pages/b.html', "<img src='../assets/My%20Logo.png?v=2'>"]);
        assert.deepEqual(I.planCopies(['assets/My Logo.png'], used, present('assets/My Logo.png')), { remove: [], restore: [] });
    });

    it('never touches files that were already there: only copies are decided about', () => {
        const plan = I.planCopies([], pages(['index.html', '<p>the old logo is gone</p>']), present('assets/old.png'));
        assert.deepEqual(plan, { remove: [], restore: [] });
    });

    it('does not count an address that leaves the site as a use', () => {
        const plan = I.planCopies(['assets/x.png'], pages(['index.html', '<img src="../assets/x.png">']), present('assets/x.png'));
        assert.deepEqual(plan.remove, ['assets/x.png']);
    });
});

describe('an image through Delete and undo', () => {
    it('Delete leaves its copy unused, and undo makes it used again', () => {
        const work = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-image-'));
        fs.writeFileSync(path.join(work, 'index.html'), '<!DOCTYPE html><html><head></head><body><h1>Shop</h1></body></html>');
        const parts = H.elementParts(image(1, 'assets/logo.png', 'Our logo'));
        const add = E.applyEdit(work, 'index.html', { op: 'add', ref: { id: parts.id }, markup: parts.html, declarations: parts.rules[0].declarations });
        assert.equal(add.error, undefined);
        const read = () => [{ page: 'index.html', html: fs.readFileSync(path.join(work, 'index.html'), 'utf8') }];
        const onDisk = () => false;
        assert.deepEqual(I.planCopies(['assets/logo.png'], read(), onDisk).restore, ['assets/logo.png']);

        const before = E.snapshotPage(work, 'index.html');
        E.applyEdit(work, 'index.html', { op: 'remove', ref: { id: 'image-1' } });
        assert.deepEqual(I.planCopies(['assets/logo.png'], read(), () => true).remove, ['assets/logo.png']);

        E.restorePage(work, before);
        assert.deepEqual(I.planCopies(['assets/logo.png'], read(), onDisk).restore, ['assets/logo.png']);
    });
});

describe('image: the element the page editor adds', () => {
    it('is made by the model with an empty src and alt, at a default size', () => {
        const el = M.createElement(1, 'image', { x: 0, y: 0, w: 0, h: 0 }, M.DEFAULT_STYLE);
        assert.equal(el.src, '');
        assert.equal(el.alt, '');
        assert.deepEqual(M.defaultSize('image'), { w: 200, h: 150 });
        assert.equal(M.isWidget('image'), false);
    });

    it('takes src and alt, and only an image does', () => {
        const el = image(1, 'assets/a.png', 'A cat');
        assert.deepEqual([el.src, el.alt], ['assets/a.png', 'A cat']);
        const rect = M.createElement(2, 'rect', { x: 0, y: 0, w: 10, h: 10 }, M.DEFAULT_STYLE);
        assert.equal(M.setProp(rect, 'src', 'x.png'), rect, 'refused: the same object');
    });

    it('becomes an <img> fitted in its box', () => {
        const parts = H.elementParts(image(3, '../assets/logo.png', 'Our logo'));
        assert.equal(parts.id, 'image-3');
        assert.equal(parts.html, '<img id="image-3" src="../assets/logo.png" alt="Our logo">');
        assert.deepEqual(parts.rules[0].declarations, { left: '10px', top: '20px', width: '200px', height: '150px', 'object-fit': 'contain' });
        assert.equal(H.renderElement(image(3, 'a.png', '')).html, '<img id="image-3" src="a.png" alt="">');
    });

    it('escapes the alt text and the address', () => {
        const html = H.elementParts(image(1, 'a"b<c>.png', '"><script>alert(1)</script> & \'')).html;
        assert.equal(html, '<img id="image-1" src="a&quot;b&lt;c&gt;.png" alt="&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; &#39;">');
    });

    it('refuses an address with a scheme, a leading slash or a backslash', () => {
        for (const src of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'http://x.example/a.png', '/etc/x.png', '//x.example/a.png', 'C:\\x.png', 'a\\b.png', ' java\tscript:x', 'JAVASCRIPT:x']) {
            assert.match(H.elementParts(image(1, src, '')).html, /src="" /, JSON.stringify(src));
        }
    });
});

describe('Publish takes the pictures with it', () => {
    it('a saved project\'s -prod gets the copied picture, byte for byte', () => {
        const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-publish-')), 'Shop');
        fs.mkdirSync(root);
        const design = { version: 2, active: 'index.html', pages: [{ name: 'index.html', title: 'Home', color: '#ffffff', elements: [], open: true }] };
        P.writeProject(root, 'Shop', design, H, '0.9.0');
        const dev = path.join(root, 'Shop-dev');
        fs.mkdirSync(path.join(dev, S.TEMPLATE.assetsDir));
        fs.writeFileSync(path.join(dev, 'assets', 'logo.png'), PNG);
        P.buildProd(root);
        assert.deepEqual(fs.readFileSync(path.join(root, 'Shop-prod', 'assets', 'logo.png')), PNG);
    });

    it('an import\'s Publish copies it into the original folder', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-import-'));
        fs.writeFileSync(path.join(root, 'index.html'), '<h1>home</h1>');
        S.createWorkingCopy(root);
        const work = S.workRoot(root);
        fs.mkdirSync(path.join(work, 'assets'));
        fs.writeFileSync(path.join(work, 'assets', 'logo.png'), PNG);
        assert.ok(S.applyCopy(root).includes('assets/logo.png'));
        assert.deepEqual(fs.readFileSync(path.join(root, 'assets', 'logo.png')), PNG);
        fs.rmSync(work, { recursive: true, force: true });
    });
});

describe('a video on a page: the player\'s files linked, copied once, and taken away with the last one', () => {
    const V = require('../../out/website-editor/src/videos.js');
    const ROOT = path.join(__dirname, '..', '..');
    const PLAYER = V.playerSource(ROOT);
    // A few bytes standing in for a video: like a picture, it must arrive byte for byte.
    const WEBM = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x00, 0xff]);
    // And an .mp4 of the same video: its first bytes, "ftyp".
    const MP4 = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0xfe]);
    const video = (id, extra) => H.elementParts({ ...M.createElement(id, 'video', { x: 10, y: 20, w: 480, h: 270 }, M.VIDEO_STYLE), title: 'Intro', ...extra });
    const site = () => {
        const work = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-video-'));
        fs.writeFileSync(path.join(work, 'index.html'), '<!DOCTYPE html>\n<html>\n<head>\n    <title>Shop</title>\n</head>\n<body>\n    <h1>Shop</h1>\n</body>\n</html>\n');
        return { work, read: () => fs.readFileSync(path.join(work, 'index.html'), 'utf8') };
    };
    const HEAD = { stylesheets: ['css/video-player.css'], scripts: ['js/video-player.js'] };
    const add = (work, parts, head = HEAD) => E.applyEdit(work, 'index.html', {
        op: 'add', ref: { id: parts.id }, markup: parts.html, declarations: { ...parts.rules[0].declarations, position: 'absolute' }, extraRules: parts.rules.slice(1), head,
    });

    it('an add links the player\'s stylesheet and script, and Draw2Code\'s own stylesheet still comes', () => {
        const { work, read } = site();
        const result = add(work, video(1, { src: 'assets/intro.webm' }));
        assert.equal(result.error, undefined);
        const html = read();
        assert.match(html, /<head>\n {4}<title>Shop<\/title>\n {4}<link rel="stylesheet" href="css\/video-player.css">\n {4}<script src="js\/video-player.js" defer><\/script>\n {4}<link rel="stylesheet" href="draw2code\/index.css">\n<\/head>/);
        assert.match(html, /<div id="video-1" class="video-player"/);
        // A second video uses the links the first one made.
        assert.equal(add(work, video(2, { src: 'assets/intro.webm' })).error, undefined);
        assert.equal(read().match(/video-player\.(css|js)/g).length, 2);
        fs.rmSync(work, { recursive: true, force: true });
    });

    it('refuses a head link that is not a stylesheet or script inside the site, and writes nothing', () => {
        const { work, read } = site();
        const before = read();
        for (const head of [
            { scripts: ['https://evil.example/x.js'] }, { scripts: ['javascript:alert(1)'] }, { stylesheets: ['../outside.css'] },
            { scripts: ['/etc/x.js'] }, { scripts: ['js/x.txt'] }, { stylesheets: ['js/video-player.js'] }, { scripts: ['data:text/javascript,alert(1)'] },
        ]) {
            const result = add(work, video(1, { src: 'assets/intro.webm' }), head);
            assert.match(result.error ?? '', /is not a (stylesheet|script) inside the site; nothing is added/, JSON.stringify(head));
            assert.deepEqual(result.changed, []);
        }
        assert.equal(read(), before);
        assert.equal(fs.existsSync(E.overridesStore(work)), false);
        fs.rmSync(work, { recursive: true, force: true });
    });

    // The player's files copied into the site, as adding a video file does.
    const withPlayer = (work) => {
        for (const file of ['script', 'stylesheet']) {
            fs.mkdirSync(path.join(work, path.dirname(V.PLAYER[file])), { recursive: true });
            fs.copyFileSync(PLAYER[file], path.join(work, V.PLAYER[file]));
        }
    };

    it('Delete on the last video takes both links away, and undo puts them back', () => {
        const { work, read } = site();
        withPlayer(work);
        add(work, video(1, { src: 'assets/intro.webm' }));
        add(work, video(2, { src: 'assets/intro.webm' }));
        add(work, video(3, { embed: 'https://player.vimeo.com/video/1?dnt=1' }), undefined);
        E.applyEdit(work, 'index.html', { op: 'remove', ref: { id: 'video-1' } });
        assert.match(read(), /video-player\.css[\s\S]*video-player\.js/, 'one is left, and it still needs them');
        const before = E.snapshotPage(work, 'index.html');
        E.applyEdit(work, 'index.html', { op: 'remove', ref: { id: 'video-2' } });
        const html = read();
        assert.doesNotMatch(html, /video-player/);
        assert.match(html, /<head>\n {4}<title>Shop<\/title>\n {4}<link rel="stylesheet" href="draw2code\/index.css">\n<\/head>/, 'their lines go with them');
        assert.match(html, /<div id="video-3" class="video-embed">/, 'a hosted video needs none of it');
        E.restorePage(work, before);
        assert.match(read(), /<div id="video-2"[\s\S]*/);
        assert.match(read(), /href="css\/video-player.css"[\s\S]*src="js\/video-player.js"/);
        fs.rmSync(work, { recursive: true, force: true });
    });

    it('Delete on the last video leaves a site\'s own video-player.js and .css linked', () => {
        const { work, read } = site();
        fs.mkdirSync(path.join(work, 'js'));
        fs.mkdirSync(path.join(work, 'css'));
        fs.writeFileSync(path.join(work, V.PLAYER.script), '// the site\'s own\n');
        fs.writeFileSync(path.join(work, V.PLAYER.stylesheet), '/* the site\'s own */\n');
        add(work, video(1, { src: 'assets/intro.webm' }));
        E.applyEdit(work, 'index.html', { op: 'remove', ref: { id: 'video-1' } });
        assert.match(read(), /href="css\/video-player.css"[\s\S]*src="js\/video-player.js"/, 'Draw2Code did not write them, so they stay');
        fs.rmSync(work, { recursive: true, force: true });
    });

    it('ownPlayerLinks: only a linked file that is the player counts, an older copy of ours too', () => {
        const page = '<html><head><link rel="stylesheet" href="../css/video-player.css"><script src="../js/video-player.js" defer></script><script src="../js/video-player-2.js" defer></script></head><body></body></html>';
        const files = { 'css/video-player.css': '/* Video player for this site: an older one */', 'js/video-player.js': '// the site\'s own', 'js/video-player-2.js': fs.readFileSync(PLAYER.script, 'utf8') };
        const read = (file) => { if (!(file in files)) throw new Error('ENOENT'); return files[file]; };
        assert.deepEqual(V.ownPlayerLinks(page, 'pages/a.html', read), { stylesheet: '../css/video-player.css', script: '../js/video-player-2.js' });
        assert.deepEqual(V.ownPlayerLinks(page, 'pages/a.html', () => { throw new Error('ENOENT'); }), {}, 'a file that is not there is not ours');
        assert.deepEqual(V.ownPlayerLinks('<script src="../../js/video-player.js"></script>', 'index.html', () => files['js/video-player-2.js']), {}, 'nor one outside the site');
    });

    it('both of the player\'s files say they are the player', () => {
        assert.equal(V.isPlayerFile(fs.readFileSync(PLAYER.script, 'utf8')), true);
        assert.equal(V.isPlayerFile(fs.readFileSync(PLAYER.stylesheet, 'utf8')), true);
        assert.equal(V.isPlayerFile('// my video player\n'), false);
    });

    it('Delete takes a hosted video\'s rule for its frame away with its box', () => {
        const { work } = site();
        add(work, video(1, { embed: 'https://player.vimeo.com/video/1?dnt=1' }), undefined);
        const rules = () => Object.keys(JSON.parse(fs.readFileSync(E.overridesStore(work), 'utf8'))['index.html'] ?? {});
        assert.deepEqual(rules(), ['#video-1', '#video-1 > *']);
        E.applyEdit(work, 'index.html', { op: 'remove', ref: { id: 'video-1' } });
        assert.deepEqual(rules(), []);
        fs.rmSync(work, { recursive: true, force: true });
    });

    it('Delete on the last video takes the links away with both of its files\' sources, and on a page with an older single src too', () => {
        const { work, read } = site();
        withPlayer(work);
        add(work, video(1, { src: 'assets/intro.webm', srcMp4: 'assets/intro.mp4' }));
        assert.match(read(), /<video preload="metadata" playsinline controls><source src="assets\/intro.webm" type="video\/webm"><source src="assets\/intro.mp4" type="video\/mp4"><\/video>/);
        E.applyEdit(work, 'index.html', { op: 'remove', ref: { id: 'video-1' } });
        assert.doesNotMatch(read(), /video-player|<source/);
        // A page from before: <video src>, with no <source>.
        const older = read().replace('<h1>Shop</h1>', '<div id="video-9" class="video-player"><video src="assets/old.webm" controls></video></div>')
            .replace('</head>', '<link rel="stylesheet" href="css/video-player.css"><script src="js/video-player.js" defer></script></head>');
        fs.writeFileSync(path.join(work, 'index.html'), older);
        E.applyEdit(work, 'index.html', { op: 'remove', ref: { id: 'video-9' } });
        assert.doesNotMatch(read(), /video-player|old\.webm/);
        fs.rmSync(work, { recursive: true, force: true });
    });

    it('planCopies counts both of a video\'s <source> files as used, and lets both go with it', () => {
        const copies = ['assets/intro.webm', 'assets/intro.mp4'];
        const page = (html) => [{ page: 'pages/a.html', html }];
        const both = '<video><source src="../assets/intro.webm" type="video/webm"><source src="../assets/intro.mp4" type="video/mp4"></video>';
        assert.deepEqual(I.planCopies(copies, page(both), () => true), { remove: [], restore: [] });
        assert.deepEqual(I.planCopies(copies, page('<p>no video</p>'), () => true), { remove: copies, restore: [] }, 'deleted: both go');
        assert.deepEqual(I.planCopies(copies, page(both), () => false), { remove: [], restore: copies }, 'undone: both come back');
    });

    it('planCopies counts a poster and the player\'s stylesheet as used', () => {
        const pages = [{ page: 'pages/a.html', html: '<link rel="stylesheet" href="../css/video-player.css"><video src="../assets/intro.webm" poster="../assets/intro.png"></video><script src="../js/video-player.js"></script>' }];
        const copies = ['css/video-player.css', 'js/video-player.js', 'assets/intro.webm', 'assets/intro.png', 'assets/gone.png'];
        assert.deepEqual(I.planCopies(copies, pages, () => true), { remove: ['assets/gone.png'], restore: [] });
        assert.deepEqual(I.imagesUsed('pages/a.html', '<a href="../index.html">Home</a>'), ['index.html'], 'a page linked to only ever looks used');
    });

    it('the same video added twice is copied once; a different one with its name gets another', () => {
        const { work } = site();
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-picked-'));
        const picked = path.join(outside, 'intro.webm');
        fs.writeFileSync(picked, WEBM);
        const onDisk = (file) => fs.existsSync(path.join(work, file));
        const place = () => I.placeFile(work, picked, S.TEMPLATE.assetsDir, onDisk, (file) => I.sameFile(picked, path.join(work, file)));
        assert.deepEqual(place(), { file: 'assets/intro.webm', copy: true });
        fs.mkdirSync(path.join(work, 'assets'));
        fs.copyFileSync(picked, path.join(work, 'assets', 'intro.webm'));
        assert.deepEqual(place(), { file: 'assets/intro.webm', copy: false }, 'the second time it is used again');
        fs.writeFileSync(picked, Buffer.concat([WEBM, Buffer.from([1])]));
        assert.deepEqual(place(), { file: 'assets/intro-2.webm', copy: true }, 'another video of that name');
        fs.rmSync(work, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    });

    it('a .webm and an .mp4 picked together each go into assets, and each is used again when it is there already', () => {
        const { work } = site();
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-picked-'));
        const webm = path.join(outside, 'intro.webm');
        const mp4 = path.join(outside, 'intro.mp4');
        fs.writeFileSync(webm, WEBM);
        fs.writeFileSync(mp4, MP4);
        const onDisk = (file) => fs.existsSync(path.join(work, file));
        const place = (picked) => I.placeFile(work, picked, S.TEMPLATE.assetsDir, onDisk, (file) => I.sameFile(picked, path.join(work, file)));
        assert.deepEqual([place(webm), place(mp4)], [{ file: 'assets/intro.webm', copy: true }, { file: 'assets/intro.mp4', copy: true }]);
        fs.mkdirSync(path.join(work, 'assets'));
        fs.copyFileSync(webm, path.join(work, 'assets', 'intro.webm'));
        assert.deepEqual([place(webm), place(mp4)], [{ file: 'assets/intro.webm', copy: false }, { file: 'assets/intro.mp4', copy: true }], 'only the .mp4 is new');
        fs.copyFileSync(mp4, path.join(work, 'assets', 'intro.mp4'));
        assert.deepEqual(place(mp4), { file: 'assets/intro.mp4', copy: false });
        // One copied this session and taken away by an undo still counts, under the name it got.
        fs.rmSync(path.join(work, 'assets', 'intro.mp4'));
        const kept = (file) => file === 'assets/intro.mp4' ? I.sameFile(mp4, mp4) : I.sameFile(mp4, path.join(work, file));
        assert.deepEqual(I.placeFile(work, mp4, S.TEMPLATE.assetsDir, (file) => onDisk(file) || file === 'assets/intro.mp4', kept, ['assets/intro.mp4']), { file: 'assets/intro.mp4', copy: false });
        fs.rmSync(work, { recursive: true, force: true });
        fs.rmSync(outside, { recursive: true, force: true });
    });

    it('the player goes in the template\'s css and js folders; a site\'s own video-player.js of that name is left alone', () => {
        const { work } = site();
        const onDisk = (file) => fs.existsSync(path.join(work, file));
        const place = (from, file) => I.placeFile(work, from, path.posix.dirname(file), onDisk, (f) => I.sameFile(from, path.join(work, f)));
        assert.deepEqual(place(PLAYER.script, V.PLAYER.script), { file: 'js/video-player.js', copy: true });
        assert.deepEqual(place(PLAYER.stylesheet, V.PLAYER.stylesheet), { file: 'css/video-player.css', copy: true });
        fs.mkdirSync(path.join(work, 'js'));
        fs.writeFileSync(path.join(work, 'js', 'video-player.js'), '// the site\'s own\n');
        assert.deepEqual(place(PLAYER.script, V.PLAYER.script), { file: 'js/video-player-2.js', copy: true });
        fs.copyFileSync(PLAYER.script, path.join(work, 'js', 'video-player-2.js'));
        assert.deepEqual(place(PLAYER.script, V.PLAYER.script), { file: 'js/video-player-2.js', copy: false }, 'ours, copied before, is used again');
        fs.rmSync(work, { recursive: true, force: true });
    });

    it('sameFile compares the bytes a piece at a time, and a missing file is never the same', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-same-'));
        const big = Buffer.alloc((1 << 20) * 2 + 5, 7);
        const write = (name, bytes) => { fs.writeFileSync(path.join(dir, name), bytes); return path.join(dir, name); };
        const a = write('a.webm', big);
        const b = write('b.webm', big);
        const other = Buffer.from(big);
        other[other.length - 1] = 8;
        const c = write('c.webm', other);
        const short = write('d.webm', big.subarray(0, 10));
        assert.equal(I.sameFile(a, b), true);
        assert.equal(I.sameFile(a, c), false, 'the last byte differs, in the third piece');
        assert.equal(I.sameFile(a, short), false);
        assert.equal(I.sameFile(a, path.join(dir, 'missing.webm')), false);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('Publish takes the video\'s .webm and .mp4, its poster and the player with it, and the page still links them', () => {
        const root = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-publish-video-')), 'Shop');
        fs.mkdirSync(root);
        const design = { version: 2, active: 'index.html', pages: [{ name: 'index.html', title: 'Home', color: '#ffffff', elements: [], open: true }] };
        P.writeProject(root, 'Shop', design, H, '0.9.0');
        const dev = path.join(root, 'Shop-dev');
        fs.mkdirSync(path.join(dev, 'assets'));
        fs.writeFileSync(path.join(dev, 'assets', 'intro.webm'), WEBM);
        fs.writeFileSync(path.join(dev, 'assets', 'intro.mp4'), MP4);
        fs.writeFileSync(path.join(dev, 'assets', 'intro.png'), PNG);
        fs.mkdirSync(path.join(dev, 'js'));
        fs.copyFileSync(PLAYER.script, path.join(dev, V.PLAYER.script));
        fs.copyFileSync(PLAYER.stylesheet, path.join(dev, V.PLAYER.stylesheet));
        assert.equal(add(dev, video(1, { src: 'assets/intro.webm', srcMp4: 'assets/intro.mp4', poster: 'assets/intro.png' })).error, undefined);
        assert.equal(add(dev, video(2, { embed: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' }), undefined).error, undefined);
        P.buildProd(root);
        const prod = path.join(root, 'Shop-prod');
        assert.deepEqual(fs.readFileSync(path.join(prod, 'assets', 'intro.webm')), WEBM);
        assert.deepEqual(fs.readFileSync(path.join(prod, 'assets', 'intro.mp4')), MP4);
        assert.deepEqual(fs.readFileSync(path.join(prod, 'assets', 'intro.png')), PNG);
        assert.equal(fs.readFileSync(path.join(prod, V.PLAYER.script), 'utf8'), fs.readFileSync(PLAYER.script, 'utf8'));
        assert.equal(fs.readFileSync(path.join(prod, V.PLAYER.stylesheet), 'utf8'), fs.readFileSync(PLAYER.stylesheet, 'utf8'));
        const html = fs.readFileSync(path.join(prod, 'index.html'), 'utf8');
        assert.doesNotMatch(html, /data-d2c|draw2code\//);
        assert.match(html, /<link rel="stylesheet" href="css\/video-player.css">/);
        assert.match(html, /<script src="js\/video-player.js" defer><\/script>/);
        assert.match(html, /<div id="video-1" class="video-player"[^>]*><video poster="assets\/intro.png" preload="metadata" playsinline controls><source src="assets\/intro.webm" type="video\/webm"><source src="assets\/intro.mp4" type="video\/mp4"><\/video>/);
        const css = fs.readFileSync(path.join(prod, 'css', 'style.css'), 'utf8');
        assert.match(css, /\.page-index #video-1 \{\n {2}left: 10px;[^}]*position: absolute;/);
        assert.match(css, /\.page-index #video-2 > \* \{\n {2}position: absolute;/);
        fs.rmSync(path.dirname(root), { recursive: true, force: true });
    });
});
