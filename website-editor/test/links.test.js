// Unit tests for links in the page editor: src/links.ts, the link splices in
// src/pageEdit.ts, and the link op, pagesLinkingTo and removedPageWarning in
// src/pageEditor.ts (compiled to out/ by npm test's pretest).
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
const L = require('../../out/website-editor/src/links.js');
const P = require('../../out/website-editor/src/pageEdit.js');
const E = require('../../out/website-editor/src/pageEditor.js');
const S = require('../../out/website-editor/src/siteFiles.js');
const { HeldFiles } = require('../../out/website-editor/src/heldFiles.js');

describe('checkAddress: only https:, http: and mailto: can be typed', () => {
    it('takes the three allowed kinds as typed, in any case', () => {
        for (const ok of ['https://example.com', 'http://example.com/a?b=1&c=2#top', 'mailto:me@example.com', 'HTTPS://Example.com', 'Mailto:me@example.com']) {
            assert.deepEqual(L.checkAddress(ok), { href: ok }, ok);
        }
    });

    it('refuses every other scheme, however it is spelled', () => {
        const bad = [
            'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>x</b>', 'vbscript:msgbox(1)', 'file:///etc/passwd',
            '//evil.example', 'example.com', '', 'https:example.com', 'mailto:',
            ' javascript:alert(1)', 'javascript:alert(1) ', ' https://example.com', 'https://example.com\n',
            'java\tscript:alert(1)', 'java\nscript:alert(1)', 'java\rscript:alert(1)', '\u0001javascript:alert(1)', 'java\u0000script:x',
            'java\u200bscript:alert(1)', '&#106;avascript:alert(1)', 'javascript&colon;alert(1)', '&Tab;javascript:alert(1)',
            'https://example.com/"onmouseover="x', "https://x.example/'", 'https://x.example/<b>', 'https:\\\\evil.example',
        ];
        for (const text of bad) assert.ok('problem' in L.checkAddress(text), JSON.stringify(text));
    });

    it('says what to type instead', () => {
        assert.match(L.checkAddress('example.com').problem, /https:\/\/example\.com/);
        assert.match(L.checkAddress('javascript:alert(1)').problem, /"javascript:" addresses are not allowed/);
        assert.match(L.checkAddress('//evil.example').problem, /no scheme/);
    });

    it('each guard refuses what only it would catch', () => {
        assert.match(L.checkAddress('https://ex\u0001ample.com').problem, /control characters/);
        assert.match(L.checkAddress('https://example.com/&#106;').problem, /character references/);
        assert.match(L.checkAddress('https://ex\u200Bample.com').problem, /invisible characters/);
    });
});

describe('checkHref: the second check, where the edit is applied', () => {
    it('takes a web address, and names the page of the site a relative link goes to', () => {
        assert.deepEqual(L.checkHref('https://example.com', 'index.html'), {});
        assert.deepEqual(L.checkHref('../index.html', 'pages/a.html'), { page: 'index.html' });
        assert.deepEqual(L.checkHref('b.html#top', 'pages/a.html'), { page: 'pages/b.html', fragment: 'top' });
        assert.deepEqual(L.checkHref('b.html#', 'pages/a.html'), { page: 'pages/b.html' });
        assert.deepEqual(L.checkHref('my%20page.html', 'index.html'), { page: 'my page.html' });
    });

    it('refuses what the InputBox refuses, and anything outside the site or not a page', () => {
        for (const href of ['javascript:alert(1)', 'java\tscript:alert(1)', ' javascript:x', '//evil.example', 'data:text/html,x',
            '../../x.html', 'b/../../../x.html', '/index.html', 'styles.css', 'a.html%0a', 'a%0a.html', 'x%5c..%5c..%5cy.html', '%2e%2e/%2e%2e/x.html', '%E0%A4%A.html']) {
            assert.ok('problem' in L.checkHref(href, 'pages/a.html'), JSON.stringify(href));
        }
    });
});

describe('pageHref: a page of the site, from the current page\'s folder', () => {
    it('is relative to the page that links', () => {
        assert.equal(L.pageHref('pages/a.html', 'index.html'), '../index.html');
        assert.equal(L.pageHref('index.html', 'pages/a.html'), 'pages/a.html');
        assert.equal(L.pageHref('pages/a.html', 'pages/b.html'), 'b.html');
        assert.equal(L.pageHref('blog/2024/post.html', 'pages/a.html'), '../../pages/a.html');
        assert.equal(L.pageHref('index.html', 'index.html'), 'index.html');
    });

    it('encodes what an address cannot hold, and checkHref reads it back', () => {
        assert.equal(L.pageHref('index.html', "my bob's page.html"), 'my%20bob%27s%20page.html');
        assert.deepEqual(L.checkHref(L.pageHref('pages/a.html', "my bob's page.html"), 'pages/a.html'), { page: "my bob's page.html" });
    });
});

describe('cleanLooks: only the link looks, with plain values', () => {
    it('keeps LINK_LOOKS and drops anything else or anything that escapes the rule', () => {
        assert.deepEqual(L.cleanLooks({ color: 'rgb(0, 0, 0)', 'font-family': '"Segoe UI", Arial', position: 'fixed',
            padding: '1px; } body { display: none', border: 'url(x)', margin: '0 !important', display: 7 }), {
            color: 'rgb(0, 0, 0)', 'font-family': '"Segoe UI", Arial',
        });
        assert.deepEqual(L.cleanLooks('color: red'), {});
        assert.deepEqual(L.cleanLooks({ 'background-image': 'image-set("https://tracker.example/p.png" 1x)' }), {}, 'nothing is fetched');
    });

    it('reads back what looksText wrote', () => {
        const looks = { display: 'inline-flex', 'font-family': '"Segoe UI", Arial' };
        assert.deepEqual(L.parseLooks(L.looksText(looks)), looks);
    });
});

describe('makeLink and unlink: the page is spliced, never written again', () => {
    const page = (inner) => `<!DOCTYPE html>\n<html>\n<head></head>\n<body>\n    ${inner}\n</body>\n</html>\n`;

    it('a <button> becomes an <a> with its attributes, and back byte for byte', () => {
        const html = page('<button id="go" class="big" type="button">Go</button>');
        const linked = P.makeLink(html, { id: 'go' }, '../index.html');
        assert.match(linked.html, /<a href="..\/index.html" id="go" class="big" data-d2c-was="button type=&quot;button&quot;">Go<\/a>/);
        assert.equal(P.unlink(linked.html, { id: 'go' }).html, html);
    });

    it('a heading keeps the tag as it was written, upper case too', () => {
        const html = page('<H2 class="t">Title</H2>');
        const linked = P.makeLink(html, { path: [0] }, 'https://example.com');
        assert.match(linked.html, /<a href="https:\/\/example.com" class="t" data-d2c-was="H2">Title<\/a>/);
        assert.equal(P.unlink(linked.html, { path: [0] }).html, html);
    });

    it('escapes the href', () => {
        const linked = P.makeLink(page('<span id="s">x</span>'), { id: 's' }, 'https://x.example/?a=1&b="2"');
        assert.match(linked.html, /href="https:\/\/x.example\/\?a=1&amp;b=&quot;2&quot;"/);
    });

    it('writes the href first, so the editor finds it before an onclick\'s location.href', () => {
        const html = page('<button id="go" onclick="location.href=\'other.html\'">Go</button>');
        const linked = P.makeLink(html, { id: 'go' }, 'about.html');
        const drawn = S.rewriteUrls(linked.html, '/site', '/site', (p) => `file://${p}`);
        assert.match(drawn, /<a href="#draw2code-page:about.html" id="go" onclick=/);
        assert.equal(P.unlink(linked.html, { id: 'go' }).html, html);
    });

    it('an <a> already in the page becomes a <span>, keeping its id, class and text', () => {
        const html = page('<a id="old" class="nav" href="about.html" target="_blank" rel="noopener">About us</a>');
        assert.equal(P.unlink(html, { id: 'old' }).html, page('<span id="old" class="nav">About us</span>'));
    });

    it('a remembered tag that makeLink would not have written is not trusted', () => {
        const html = page('<a id="x" href="a.html" data-d2c-was="script">x</a>');
        assert.match(P.unlink(html, { id: 'x' }).html, /<span id="x">x<\/span>/);
    });

    it('setHref changes only the href\'s value', () => {
        const html = page('<a id="old" href="about.html" class="nav">About</a>');
        assert.equal(P.setHref(html, { id: 'old' }, 'https://example.com').html, html.replace('href="about.html"', 'href="https://example.com"'));
        assert.match(P.setHref(html, { id: 'old' }, 'https://x.example/?a=1&b="2"').html, /href="https:\/\/x.example\/\?a=1&amp;b=&quot;2&quot;"/);
    });
});

describe('linkInfo: what can be a link', () => {
    const html = '<!DOCTYPE html><html><head></head><body><img id="pic" src="x.png"><div id="box">x</div><a id="out" href="a.html"><span id="in">y</span></a><p id="p"><a href="b.html">z</a></p><ul><li id="li">open</ul><button><span id="label">Go</span></button></body></html>';

    it('refuses images, sections, the page, and what is in or around a link', () => {
        assert.match(P.linkInfo(html, { id: 'pic' }).problem, /<img> cannot be a link yet/);
        assert.match(P.linkInfo(html, { id: 'box' }).problem, /<div> cannot be a link yet/);
        assert.match(P.linkInfo(html, { body: true }).problem, /<body> cannot be a link yet/);
        assert.match(P.linkInfo(html, { id: 'in' }).problem, /inside a link already/);
        assert.match(P.linkInfo(html, { id: 'p' }).problem, /holds a link already/);
        assert.match(P.linkInfo(html, { id: 'li' }).problem, /no <\/li> in the file/);
        assert.match(P.linkInfo(html, { id: 'label' }).problem, /inside a button/);
    });

    it('refuses what holds a button or a field, and an href a browser would read first', () => {
        const at = (inner, id) => P.linkInfo(`<!DOCTYPE html><html><head></head><body>${inner}</body></html>`, { id });
        assert.match(at('<label id="l"><input type="checkbox"> Remember me</label>', 'l').problem, /holds a button or a field/);
        assert.match(at('<p id="p">Ready? <button>Go</button></p>', 'p').problem, /holds a button or a field/);
        assert.match(at('<span id="s" href="javascript:alert(1)">x</span>', 's').problem, /has its own href but is not a link/);
        assert.match(at('<p id="p" data-d2c-was="x">x</p>', 'p').problem, /has its own data-d2c-was/);
        assert.match(at('<a id="a" href="javascript:alert(1)" href="https://ok.example">x</a>', 'a').problem, /two hrefs/);
        assert.match(at('<a id="a"/href="javascript:alert(1)" href="old.html">x</a>', 'a').problem, /two hrefs/);
        assert.match(at('<a id="a" class="x"href="javascript:alert(1)" href="old.html">x</a>', 'a').problem, /two hrefs/);
    });

    it('reads an existing link', () => {
        assert.deepEqual(P.linkInfo(html, { id: 'out' }), { tag: 'a', href: 'a.html', looks: {}, selector: '#out' });
    });
});

describe('applyEdit: the link op gives back the page and its rules exactly, and checks every href again', () => {
    const PAGE = `<!DOCTYPE html>
<html>
<head>
    <title>A</title>
</head>
<body>
    <button id="go" type="button">Go</button>
    <label>Plain label</label>
    <a id="old" class="nav" href="../index.html">Home</a>
    <img id="pic" src="x.png">
</body>
</html>
`;
    const BUTTON_LOOKS = { display: 'inline-flex', 'align-items': 'center', 'justify-content': 'center', 'text-decoration': 'none',
        cursor: 'pointer', 'box-sizing': 'border-box', padding: '2px 7px', border: '1px solid rgb(118, 118, 118)', 'background-color': 'rgb(239, 239, 239)' };
    // The usual CS50 layout: an indented head, a split start tag in capitals and a form.
    const CS50_PAGE = `<!DOCTYPE html>

<html lang="en">
    <head>
        <link href="../styles.css" rel="stylesheet">
        <title>A</title>
    </head>
    <body>
        <h1 id="title">Hello</h1>
        <BUTTON
            class="big" TYPE='BUTTON'>Go</BUTTON>
        <form action="/x">
            <button type="submit">Send</button>
        </form>
        <ul>
            <li>One</li>
        </ul>
    </body>
</html>
`;
    const makeSite = (page = PAGE) => {
        const work = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-links-'));
        fs.mkdirSync(path.join(work, 'pages'));
        fs.writeFileSync(path.join(work, 'index.html'), '<!DOCTYPE html><html><head></head><body>home</body></html>');
        fs.writeFileSync(path.join(work, 'pages', 'a.html'), page);
        const read = () => fs.readFileSync(path.join(work, 'pages', 'a.html'), 'utf8');
        const rules = () => (fs.existsSync(E.overridesStore(work)) ? JSON.parse(fs.readFileSync(E.overridesStore(work), 'utf8'))['pages/a.html'] : undefined);
        const link = (ref, href, declarations) => E.applyEdit(work, 'pages/a.html', { op: 'link', ref, href, declarations });
        return { work, read, rules, link, done: () => fs.rmSync(work, { recursive: true, force: true }) };
    };

    it('button -> a -> button gives back the page byte for byte, and the looks go with it', () => {
        const { work, read, rules, link, done } = makeSite();
        assert.equal(link({ id: 'go' }, '../index.html', BUTTON_LOOKS).error, undefined);
        assert.match(read(), /<a href="..\/index.html" id="go" data-d2c-was="button stylesheet type=&quot;button&quot;" data-d2c-looks="[^"]*">Go<\/a>/);
        assert.match(read(), /<link rel="stylesheet" href="..\/draw2code\/pages\/a.css">/);
        assert.deepEqual(rules()['#go'], BUTTON_LOOKS);
        assert.match(fs.readFileSync(path.join(work, 'draw2code', 'pages', 'a.css'), 'utf8'), /#go \{\n  display: inline-flex;/);
        assert.equal(link({ id: 'go' }).error, undefined);
        assert.equal(read(), PAGE, 'byte for byte');
        assert.equal(rules(), undefined, 'exactly the declarations the link added are gone');
        assert.equal(fs.existsSync(path.join(work, 'draw2code', 'pages', 'a.css')), false);
        done();
    });

    it('on a CS50-style page, every linkable element comes back byte for byte, the indented </head> too', () => {
        const { read, link, done } = makeSite(CS50_PAGE);
        // path from <body>: h1, BUTTON, form > button, ul > li
        for (const ref of [{ id: 'title' }, { path: [1] }, { path: [2, 0] }, { path: [3, 0] }]) {
            assert.equal(link(ref, '../index.html', ref.id ? { color: 'rgb(0, 0, 0)' } : BUTTON_LOOKS).error, undefined, JSON.stringify(ref));
            assert.match(read(), /<\/a>/);
            assert.equal(link(ref).error, undefined);
            assert.equal(read(), CS50_PAGE, JSON.stringify(ref));
        }
        done();
    });

    it('a button the page sized and painted keeps its width, height and gradient as a link', () => {
        const { rules, read, link, done } = makeSite();
        const looks = { ...BUTTON_LOOKS, width: '160px', height: '44px', 'background-image': 'linear-gradient(rgb(76, 175, 80), rgb(46, 125, 50))',
            'box-shadow': 'rgba(0, 0, 0, 0.2) 0px 2px 4px 0px' };
        link({ id: 'go' }, '../index.html', looks);
        assert.deepEqual(rules()['#go'], looks);
        link({ id: 'go' });
        assert.equal(read(), PAGE);
        done();
    });

    it('a stylesheet holding rules the store does not know is kept when the link goes', () => {
        const { work, read, link, done } = makeSite(PAGE.replace('</head>', '    <link rel="stylesheet" href="../draw2code/pages/a.css">\n</head>')
            .replace('<a id="old" class="nav"', '<a id="old" class="nav" data-d2c-was="span stylesheet"'));
        const css = path.join(work, 'draw2code', 'pages', 'a.css');
        fs.mkdirSync(path.dirname(css), { recursive: true });
        fs.writeFileSync(css, '#go { color: red; }\n');
        assert.equal(link({ id: 'old' }).error, undefined);
        assert.equal(fs.readFileSync(css, 'utf8'), '#go { color: red; }\n');
        assert.match(read(), /href="..\/draw2code\/pages\/a.css"/);
        assert.match(read(), /<span id="old" class="nav">Home<\/span>/);
        done();
    });

    it('in an open project, a link made and removed before Save leaves nothing to save', () => {
        const { work, done } = makeSite();
        const held = new HeldFiles(work);
        E.applyEdit(work, 'pages/a.html', { op: 'link', ref: { id: 'go' }, href: '../index.html', declarations: BUTTON_LOOKS }, held);
        E.applyEdit(work, 'pages/a.html', { op: 'link', ref: { id: 'go' } }, held);
        assert.deepEqual(held.heldPaths(), [], 'not even an empty .draw2code/overrides.json');
        done();
    });

    it('in an open project, removing a saved link leaves a page that can still be drawn', () => {
        const { work, done } = makeSite();
        const held = new HeldFiles(work);
        held.register();
        try {
            const link = (href, declarations) => E.applyEdit(work, 'pages/a.html', { op: 'link', ref: { id: 'go' }, href, declarations }, held);
            link('../index.html', BUTTON_LOOKS);
            held.save();
            assert.equal(link().error, undefined);
            assert.deepEqual(E.heldStylesheet(work, 'pages/a.html'), [], 'the stylesheet the link took away is not shown');
            assert.equal(held.read(path.join(work, 'pages', 'a.html')), PAGE);
        } finally {
            held.unregister();
            done();
        }
    });

    it('an element with no id gets a marker for its looks, and loses it again', () => {
        const { read, rules, link, done } = makeSite();
        assert.equal(link({ path: [1] }, 'https://example.com', { color: 'rgb(0, 0, 0)' }).error, undefined);
        assert.match(read(), /<a href="https:\/\/example.com" data-d2c="1" data-d2c-was="label marker stylesheet" data-d2c-looks="color: rgb\(0, 0, 0\)">Plain label<\/a>/);
        assert.deepEqual(rules(), { '[data-d2c="1"]': { color: 'rgb(0, 0, 0)' } });
        link({ path: [1] });
        assert.equal(read(), PAGE);
        done();
    });

    it('removing keeps what the user set since, and the marker and stylesheet it needs', () => {
        const { work, read, rules, link, done } = makeSite();
        link({ path: [1] }, 'https://example.com', { color: 'rgb(0, 0, 0)', display: 'inline-block' });
        E.applyEdit(work, 'pages/a.html', { op: 'style', ref: { path: [1] }, declarations: { color: '#ff0000', width: '80px' } });
        link({ path: [1] });
        assert.deepEqual(rules(), { '[data-d2c="1"]': { color: '#ff0000', width: '80px' } }, 'only display, which the link added, is gone');
        assert.match(read(), /<label data-d2c="1">Plain label<\/label>/);
        assert.match(read(), /draw2code\/pages\/a.css/);
        done();
    });

    it('a look the element\'s own rule already sets is left to it', () => {
        const { work, rules, link, done } = makeSite();
        E.applyEdit(work, 'pages/a.html', { op: 'style', ref: { id: 'go' }, declarations: { cursor: 'help' } });
        link({ id: 'go' }, '../index.html', BUTTON_LOOKS);
        assert.equal(rules()['#go'].cursor, 'help');
        link({ id: 'go' });
        assert.deepEqual(rules(), { '#go': { cursor: 'help' } });
        done();
    });

    it('an existing link: its href changes in place, and removing it leaves a <span>', () => {
        const { read, link, done } = makeSite();
        assert.equal(link({ id: 'old' }, 'https://example.com').error, undefined);
        assert.equal(read(), PAGE.replace('href="../index.html">Home', 'href="https://example.com">Home'));
        link({ id: 'old' });
        assert.equal(read(), PAGE.replace('<a id="old" class="nav" href="../index.html">Home</a>', '<span id="old" class="nav">Home</span>'));
        done();
    });

    it('checks the href again: no javascript:, no page that is not there, nothing outside the site', () => {
        const { read, link, done } = makeSite();
        for (const href of ['javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,x', 'nope.html', '../../x.html']) {
            assert.match(link({ id: 'go' }, href).error ?? '', /the page is kept/, href);
        }
        assert.match(link({ id: 'pic' }, '../index.html').error, /<img> cannot be a link yet/);
        assert.match(link({ id: 'go' }).error, /<button> is not a link/);
        assert.equal(read(), PAGE);
        done();
    });

    it('a <span> with an href of its own is refused, not given a second one', () => {
        const page = PAGE.replace('<label>Plain label</label>', '<span id="s" href="javascript:alert(document.domain)">Click</span>');
        const { read, link, done } = makeSite(page);
        assert.match(link({ id: 's' }, 'https://ok.example').error, /has its own href/);
        assert.equal(read(), page);
        done();
    });

    it('a link made here can be deleted, and the delete undone', () => {
        const { work, read, rules, link, done } = makeSite();
        link({ id: 'go' }, '../index.html', BUTTON_LOOKS);
        const before = E.snapshotPage(work, 'pages/a.html');
        assert.equal(E.applyEdit(work, 'pages/a.html', { op: 'remove', ref: { id: 'go' } }).error, undefined);
        assert.doesNotMatch(read(), /id="go"/);
        assert.equal(rules()['#go'], undefined, 'its looks went with it');
        E.restorePage(work, before);
        assert.equal(read(), before.html);
        assert.deepEqual(rules()['#go'], BUTTON_LOOKS);
        done();
    });
});

describe('linkedFile: where a link already in a page goes', () => {
    it('resolves from the linking page\'s folder and drops #fragments and ?queries', () => {
        assert.equal(L.linkedFile('about.html', 'index.html'), 'about.html');
        assert.equal(L.linkedFile('../about.html#team', 'pages/contact.html'), 'about.html');
        assert.equal(L.linkedFile('b.html?x=1', 'pages/a.html'), 'pages/b.html');
        assert.equal(L.linkedFile('my%20page.html', 'index.html'), 'my page.html');
    });

    it('is nothing for a web address, the same page or a place outside the site', () => {
        for (const href of ['https://example.com/about.html', 'mailto:me@example.com', '//cdn.example/x.html', '#top', '?q=1', '', '../../x.html', '/about.html', '%E0%A4%A.html']) {
            assert.equal(L.linkedFile(href, 'pages/a.html'), undefined, JSON.stringify(href));
        }
    });
});

describe('pagesLinkingTo: the pages a removed page leaves with a broken link', () => {
    const makeSite = (files) => {
        const work = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-linking-'));
        for (const [file, body] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(work, file)), { recursive: true });
            fs.writeFileSync(path.join(work, file), `<!DOCTYPE html><html><head></head><body>${body}</body></html>`);
        }
        return { work, pages: Object.keys(files), done: () => fs.rmSync(work, { recursive: true, force: true }) };
    };

    it('finds nested pages, ../ links and links with a #fragment, in any case', () => {
        const { work, pages, done } = makeSite({
            'index.html': '<a href="about.html">About</a>',
            'about.html': '<a href="index.html">Home</a>',
            'pages/contact.html': '<a href="../About.html#team">Team</a>',
            'pages/deep/faq.html': '<p><a href="../../about.html?from=faq">About</a></p>',
            'pages/other.html': '<a href="about.html">pages/about.html, not this one</a>',
        });
        assert.deepEqual(E.pagesLinkingTo(work, 'about.html', pages), ['index.html', 'pages/contact.html', 'pages/deep/faq.html']);
        assert.deepEqual(E.pagesLinkingTo(work, 'pages/about.html', pages), ['pages/other.html']);
        done();
    });

    it('is empty when no page links to it, so there is no warning', () => {
        const { work, pages, done } = makeSite({
            'index.html': '<a href="#top">Top</a> <a href="contact.html">Contact</a>',
            'contact.html': '<p>about.html is only text here</p>',
            'about.html': '<a href="about.html">itself</a>',
        });
        assert.deepEqual(E.pagesLinkingTo(work, 'about.html', pages), []);
        done();
    });

    // linkedFile's own test above is the one that guards the scheme check;
    // this is the same case from the side of a whole site.
    it('ignores external links that end in the same name', () => {
        const { work, pages, done } = makeSite({
            'index.html': '<a href="https://example.com/about.html">Theirs</a> <a href="//example.com/about.html">Also theirs</a>',
        });
        assert.deepEqual(E.pagesLinkingTo(work, 'about.html', pages), []);
        done();
    });

    it('reads pages through the held edits: a link not yet saved counts, one removed but not saved does not', () => {
        const { work, pages, done } = makeSite({
            'index.html': '<a href="about.html">About</a>',
            'contact.html': '<p>Contact</p>',
        });
        const held = new HeldFiles(work);
        held.write(path.join(work, 'index.html'), '<p>no link now</p>');
        held.write(path.join(work, 'contact.html'), '<a href="about.html">About</a>');
        assert.deepEqual(E.pagesLinkingTo(work, 'about.html', pages, held), ['contact.html']);
        assert.deepEqual(E.pagesLinkingTo(work, 'about.html', pages), ['index.html'], 'the disk alone still has the old link');
        done();
    });
});

describe('removedPageWarning: one message per removed page, with names shown as text', () => {
    it('is nothing when no page links to it', () => {
        assert.equal(E.removedPageWarning('about.html', []), undefined);
    });

    it('names one, two or three linking pages', () => {
        assert.equal(E.removedPageWarning('about.html', ['index.html']), 'about.html was removed. index.html still links to it; nothing is changed.');
        assert.equal(E.removedPageWarning('about.html', ['index.html', 'contact.html']), 'about.html was removed. index.html and contact.html still link to it; nothing is changed.');
        assert.equal(E.removedPageWarning('about.html', ['a.html', 'pages/b.html', 'c.html']), 'about.html was removed. a.html, pages/b.html and c.html still link to it; nothing is changed.');
    });

    it('never lets a file name become a link VS Code would open', () => {
        const odd = '[index.html](command:workbench.action.terminal.sendSequence?%7B%7D).html';
        const message = E.removedPageWarning(`pages/[x](https://example.com)/about.html`, [odd]);
        assert.ok(!message.includes(']('), message);
        assert.ok(message.includes('[index.html] (command:'), message);
    });
});
