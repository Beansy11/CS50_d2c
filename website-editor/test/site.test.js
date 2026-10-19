// Unit tests for website-editor/src/siteFiles.ts (compiled to out/website-editor/src/siteFiles.js by `npm test`'s pretest).
//
// CS50 citation: the name Draw2Code Web Editor was chosen with help from
// Claude (Anthropic AI), and at my direction Claude renamed
// the project from its earlier name, HardHat Designer, throughout this file.
//
// I did not write these tests. I had an AI coding agent read my code and
// write tests for it, to save time, and it put this file in
// website-editor/test/. The code it tests is mine; the tests are the agent's.
// I run them with npm test.

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const S = require('../../out/website-editor/src/siteFiles.js');

let root;
const write = (rel, text) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
// The development copy: a sibling folder, `<site>-dev`.
const dev = (rel) => path.join(S.workRoot(root), rel || '');
const writeDev = (rel, text) => { const p = dev(rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const readDev = (rel) => fs.readFileSync(dev(rel), 'utf8');

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-site-'));
    write('index.html', '<h1>home</h1>');
    write('pages/about.html', '<h1>about</h1>');
    write('pages/notes.txt', 'not a page');
    write('css/style.css', 'body{}');
    write('assets/img/logo.png', 'PNG');
    write('README.md', 'not part of the template');
});
afterEach(() => {
    fs.rmSync(S.workRoot(root), { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
});

describe('detect and list', () => {
    it('a site is a folder with index.html', () => {
        assert.equal(S.isSite(root), true);
        assert.equal(S.isSite(path.join(root, 'css')), false);
    });

    it('lists index first, then pages/*.html only', () => {
        assert.deepEqual(S.listPages(root), ['index.html', 'pages/about.html']);
    });

    it('finds sites nested in an opened folder, top first', () => {
        write('projects/trivia/index.html', '<h1>trivia</h1>');
        write('node_modules/pkg/index.html', 'should be skipped');
        assert.deepEqual(S.findSites(root), [root, path.join(root, 'projects', 'trivia')]);
    });

    it('finds a nested site even when the opened folder is not one', () => {
        fs.rmSync(path.join(root, 'index.html'));
        fs.rmSync(path.join(root, 'pages'), { recursive: true }); // no pages of its own either
        write('trivia/index.html', '<h1>trivia</h1>');
        assert.deepEqual(S.findSites(root), [path.join(root, 'trivia')]);
    });

    it('an app-shaped project is ONE site, rooted where the project is', () => {
        // Flask: app.py + templates/ + static/. "/static/x.css" only resolves
        // if the PROJECT is the document root, not templates/.
        fs.rmSync(path.join(root, 'index.html'));
        fs.rmSync(path.join(root, 'pages'), { recursive: true });
        write('birthdays/app.py', 'from flask import Flask');
        write('birthdays/templates/index.html', '<link href="/static/styles.css" rel="stylesheet">');
        write('birthdays/static/styles.css', 'body{}');
        assert.deepEqual(S.findSites(root), [path.join(root, 'birthdays')], 'the project, and templates/ is not a second site');
        assert.equal(S.entryPage(path.join(root, 'birthdays')), 'templates/index.html');
        assert.deepEqual(S.listPages(path.join(root, 'birthdays')), ['templates/index.html']);
    });

    it('a folder of pages with no index is still a site, opening at its first page', () => {
        fs.rmSync(path.join(root, 'index.html'));
        fs.rmSync(path.join(root, 'pages'), { recursive: true });
        write('notes/zebra.html', '<h1>z</h1>');
        write('notes/about.html', '<h1>a</h1>');
        assert.deepEqual(S.findSites(root), [path.join(root, 'notes')]);
        assert.equal(S.entryPage(path.join(root, 'notes')), 'about.html', 'first by name when there is no index');
    });

    it('knows a server\'s index names, in order', () => {
        fs.rmSync(path.join(root, 'index.html'));
        write('shop/home.html', '<h1>h</h1>');
        assert.equal(S.entryPage(path.join(root, 'shop')), 'home.html');
        write('shop/default.html', '<h1>d</h1>');
        assert.equal(S.entryPage(path.join(root, 'shop')), 'default.html');
        write('shop/index.htm', '<h1>i</h1>');
        assert.equal(S.entryPage(path.join(root, 'shop')), 'index.htm');
        write('shop/index.html', '<h1>I</h1>');
        assert.equal(S.entryPage(path.join(root, 'shop')), 'index.html');
    });

    it('is not a site when there are no pages at all', () => {
        fs.rmSync(path.join(root, 'index.html'));
        fs.rmSync(path.join(root, 'pages'), { recursive: true });
        assert.equal(S.isSite(root), false);
        assert.equal(S.entryPage(root), null);
        assert.deepEqual(S.findSites(root), []);
    });

    it('the entry page is what listPages puts first', () => {
        write('about.html', '<h1>flat</h1>');
        assert.equal(S.entryPage(root), 'index.html');
        assert.deepEqual(S.listPages(root), ['index.html', 'about.html', 'pages/about.html']);
    });

    it('lists every .html page, index first', () => {
        write('about.html', '<h1>flat</h1>');
        assert.deepEqual(S.listPages(root), ['index.html', 'about.html', 'pages/about.html']);
    });

    it('covers every file in the site, whatever the layout', () => {
        write('styles.css', 'h1{}');
        write('data/quiz.json', '{}');
        assert.deepEqual(S.siteFiles(root), ['README.md', 'assets/img/logo.png', 'css/style.css', 'data/quiz.json', 'index.html', 'pages/about.html', 'pages/notes.txt', 'styles.css']);
    });

    it('skips our own state, git and dependencies', () => {
        write('.git/config', 'x');
        write('node_modules/pkg/index.js', 'x');
        S.createWorkingCopy(root);
        const listed = S.siteFiles(S.workRoot(root));
        assert.equal(listed.some((f) => f.startsWith('.git/') || f.startsWith('node_modules/') || f.startsWith('.draw2code/')), false);
    });

    it('does not list a development copy as a site of its own', () => {
        fs.rmSync(path.join(root, 'index.html'));
        fs.rmSync(path.join(root, 'pages'), { recursive: true });
        write('homepage/index.html', '<h1>home</h1>');
        write('homepage-dev/index.html', '<h1>home</h1>');
        assert.equal(S.isDevCopy(path.join(root, 'homepage-dev')), true);
        assert.deepEqual(S.findSites(root), [path.join(root, 'homepage')]);
        assert.equal(S.originalOf(path.join(root, 'homepage-dev')), path.join(root, 'homepage'),
            'choosing the copy has to mean the site, or it would copy a copy');
    });

    it('the fingerprint is adopted for a copy someone made by hand', () => {
        // No .draw2code in it: without a fingerprint every file would read as new.
        const copied = S.workRoot(root);
        fs.mkdirSync(copied, { recursive: true });
        for (const file of S.siteFiles(root)) { const p = path.join(copied, file); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.copyFileSync(path.join(root, file), p); }
        assert.equal(S.hasWorkingCopy(root), true);
        S.ensureSnapshot(root);
        assert.deepEqual(S.originalChanges(root), []);
        write('index.html', '<h1>later</h1>');
        assert.equal(S.originalChanges(root)[0].file, 'index.html', 'later changes still count');
    });

    it('a -dev folder with no site beside it is an ordinary site', () => {
        fs.rmSync(path.join(root, 'index.html'));
        fs.rmSync(path.join(root, 'pages'), { recursive: true });
        write('sandbox-dev/index.html', '<h1>home</h1>');
        assert.equal(S.isDevCopy(path.join(root, 'sandbox-dev')), false);
        assert.equal(S.originalOf(path.join(root, 'sandbox-dev')), undefined);
        assert.deepEqual(S.findSites(root), [path.join(root, 'sandbox-dev')]);
    });
});

describe('development copy', () => {
    it('copies the whole site into <site>-dev, leaving the original alone', () => {
        write('styles.css', 'h1{}');
        assert.equal(S.hasWorkingCopy(root), false);
        const before = S.siteFiles(root);
        const copied = S.createWorkingCopy(root);
        assert.equal(S.workRoot(root), root + '-dev');
        assert.equal(S.hasWorkingCopy(root), true);
        assert.equal(readDev('pages/about.html'), '<h1>about</h1>');
        assert.equal(readDev('styles.css'), 'h1{}', 'a stylesheet beside index.html is copied too');
        assert.equal(readDev('README.md'), 'not part of the template', 'nothing in the site folder is left behind');
        assert.deepEqual(copied, before);
        assert.deepEqual(S.siteFiles(root), before, 'not one file is added to the original');
        assert.equal(fs.existsSync(path.join(root, '.draw2code')), false, 'not even a hidden folder');
    });

    it('keeps its own state out of the user\'s git', () => {
        S.createWorkingCopy(root);
        assert.equal(readDev('.draw2code/.gitignore'), '*\n');
    });

    it('reports added, changed and unchanged files', () => {
        S.createWorkingCopy(root);
        writeDev('index.html', '<h1>edited</h1>');
        writeDev('pages/contact.html', '<h1>new</h1>');
        const byFile = Object.fromEntries(S.diffCopy(root).map((d) => [d.file, d.status]));
        assert.equal(byFile['index.html'], 'changed');
        assert.equal(byFile['pages/contact.html'], 'added');
        assert.equal(byFile['css/style.css'], 'unchanged');
    });

    it('apply overwrites only added and changed files, never deletes', () => {
        S.createWorkingCopy(root);
        writeDev('index.html', '<h1>edited</h1>');
        writeDev('pages/contact.html', '<h1>new</h1>');
        fs.rmSync(dev('pages/about.html'));
        const written = S.applyCopy(root).sort();
        assert.deepEqual(written, ['index.html', 'pages/contact.html']);
        assert.equal(read('index.html'), '<h1>edited</h1>');
        assert.equal(read('pages/contact.html'), '<h1>new</h1>');
        assert.equal(read('pages/about.html'), '<h1>about</h1>', 'deleting in the copy never deletes the original');
        assert.equal(read('README.md'), 'not part of the template');
    });

    it('applying is not read back as the original changing', () => {
        S.createWorkingCopy(root);
        writeDev('index.html', '<h1>edited</h1>');
        S.applyCopy(root);
        assert.deepEqual(S.originalChanges(root), []);
    });

    it('re-creating the copy starts over from the original', () => {
        S.createWorkingCopy(root);
        writeDev('index.html', '<h1>edited</h1>');
        S.createWorkingCopy(root);
        assert.equal(readDev('index.html'), '<h1>home</h1>');
    });
});

describe('rewriting a page for the preview', () => {
    const R = S.rewriteUrls;
    const uri = (p) => 'webview:' + p.replace(/\\/g, '/');
    const run = (html, dir) => R(html, dir || path.join(root, 'pages'), root, uri);

    it('rewrites href, src and poster to webview URIs', () => {
        const out = run('<link href="../css/style.css"><img src="../assets/logo.png"><video poster="../assets/p.jpg">');
        assert.match(out, new RegExp('href="webview:' + uri(root).slice(8) + '/css/style.css"'));
        assert.match(out, /src="webview:.*\/assets\/logo\.png"/);
        assert.match(out, /poster="webview:.*\/assets\/p\.jpg"/);
    });

    it('rewrites each <source src> of a video, and a video\'s own src as an older page has it', () => {
        const out = run('<video poster="../assets/p.jpg"><source src="../assets/intro.webm" type="video/webm"><source src=\'../assets/intro.mp4\' type="video/mp4"></video><video src="../assets/old.webm"></video>');
        assert.match(out, /<source src="webview:[^"]*\/assets\/intro\.webm" type="video\/webm"><source src='webview:[^']*\/assets\/intro\.mp4' type="video\/mp4">/);
        assert.match(out, /<video src="webview:[^"]*\/assets\/old\.webm">/);
        assert.doesNotMatch(out, /src="\.\.\//);
    });

    it('treats a leading slash as the site root', () => {
        assert.match(run('<img src="/assets/logo.png">'), new RegExp('src="' + uri(path.join(root, 'assets', 'logo.png')) + '"'));
    });

    it('leaves absolute, protocol-relative, data and anchor URLs alone', () => {
        const html = '<a href="https://example.com/x"><img src="//cdn/x.png"><img src="data:image/png;base64,AAA"><a href="#top">';
        assert.equal(run(html), html);
    });

    it('marks links to other pages of the site instead of navigating', () => {
        assert.match(run('<a href="../index.html">Home</a>'), /href="#draw2code-page:index\.html"/);
        assert.match(run('<a href="about.html?x=1#top">'), /href="#draw2code-page:pages\/about\.html#top"/, 'with the section it goes to');
        assert.match(run('<a href="about.html">'), /href="#draw2code-page:pages\/about\.html"/);
        assert.equal(S.PAGE_LINK_PREFIX, '#draw2code-page:');
    });

    it('still rewrites links to files that are not pages', () => {
        assert.match(run('<a href="../assets/logo.png">'), /href="webview:[^"]*\/assets\/logo\.png"/);
    });

    it('rewrites srcset entries and url() in styles', () => {
        assert.match(run('<img srcset="../assets/a.png 1x, ../assets/b.png 2x">'), /srcset="webview:[^"]*\/assets\/a\.png 1x, webview:[^"]*\/assets\/b\.png 2x"/);
        assert.match(run('<style>body{background:url("../assets/bg.png")}</style>'), /url\("webview:[^"]*\/assets\/bg\.png"\)/);
    });
});

describe('changes to the original', () => {
    const byFile = () => Object.fromEntries(S.originalChanges(root).map((c) => [c.file, c]));

    it('is nothing right after copying, and notices the original moving on', () => {
        S.createWorkingCopy(root);
        assert.deepEqual(S.originalChanges(root), [], 'copying is not a change');
        write('styles.css', 'h1{ color: red }');
        assert.equal(byFile()['styles.css'].status, 'added', 'a new file in the original counts');
        S.createWorkingCopy(root);
        assert.deepEqual(S.originalChanges(root), []);
        write('index.html', '<h1>edited</h1>');
        assert.equal(byFile()['index.html'].status, 'changed', 'an edited file counts');
        fs.rmSync(path.join(root, 'README.md'));
        assert.equal(byFile()['README.md'].status, 'removed');
    });

    it('ignores edits made in the development copy', () => {
        S.createWorkingCopy(root);
        writeDev('index.html', '<h1>edited in the copy</h1>');
        assert.deepEqual(S.originalChanges(root), [], 'the copy is where the work happens');
        assert.equal(S.originalDiffers(root), false);
    });

    it('is nothing when there is no copy yet', () => {
        assert.deepEqual(S.originalChanges(root), []);
        assert.equal(S.originalDiffers(root), false);
    });
});

describe('syncing the original into the copy', () => {
    it('takes changes the copy has not touched', () => {
        S.createWorkingCopy(root);
        write('index.html', '<h1>edited by hand</h1>');
        write('pages/contact.html', '<h1>new page</h1>');
        fs.rmSync(path.join(root, 'README.md'));
        const result = S.syncFromOriginal(root);
        assert.deepEqual(result.synced.sort(), ['README.md', 'index.html', 'pages/contact.html']);
        assert.deepEqual(result.conflicts, []);
        assert.equal(readDev('index.html'), '<h1>edited by hand</h1>');
        assert.equal(readDev('pages/contact.html'), '<h1>new page</h1>');
        assert.equal(fs.existsSync(dev('README.md')), false, 'deleted in the original, deleted in the copy');
        assert.deepEqual(S.originalChanges(root), [], 'and nothing is offered twice');
    });

    it('leaves a file edited in both places alone, and names it', () => {
        S.createWorkingCopy(root);
        writeDev('index.html', '<h1>mine</h1>');
        write('index.html', '<h1>theirs</h1>');
        write('css/style.css', 'body{margin:0}');
        const result = S.syncFromOriginal(root);
        assert.deepEqual(result.conflicts, ['index.html']);
        assert.deepEqual(result.synced, ['css/style.css'], 'the rest still comes across');
        assert.equal(readDev('index.html'), '<h1>mine</h1>');
    });

    it('takes the original for a conflict when asked to', () => {
        S.createWorkingCopy(root);
        writeDev('index.html', '<h1>mine</h1>');
        write('index.html', '<h1>theirs</h1>');
        assert.deepEqual(S.syncFromOriginal(root, ['index.html']).synced, ['index.html']);
        assert.equal(readDev('index.html'), '<h1>theirs</h1>');
        assert.deepEqual(S.originalChanges(root), []);
    });

    it('keepMine stops the same conflict being raised again', () => {
        S.createWorkingCopy(root);
        writeDev('index.html', '<h1>mine</h1>');
        write('index.html', '<h1>theirs</h1>');
        S.keepMine(root, ['index.html']);
        assert.deepEqual(S.originalChanges(root), []);
        assert.equal(readDev('index.html'), '<h1>mine</h1>');
    });
});
