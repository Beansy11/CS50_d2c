// Unit tests for src/pageEdit.ts (compiled to out/ by npm test's pretest).
//
// CS50 citation: the name Draw2Code Web Editor was chosen with help from
// Claude (Anthropic AI), and at my direction Claude renamed
// the project from its earlier name, HardHat Designer, throughout this file.
//
// I did not write these tests. I had an AI coding agent read my code and
// write tests for it, to save time, and it put this file in
// website-editor/test/. The code it tests is mine; the tests are the agent's.
// I run them with npm test.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const P = require('../../out/website-editor/src/pageEdit.js');

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
    <link rel="stylesheet" href="styles.css">
    <title>Trivia!</title>
</head>
<body>
    <div class="header">
        <h1 id="title">Trivia!</h1>
    </div>
    <section class="container">
        <h2>Part 1</h2>
        <button data-correct="true">Memory</button>
    </section>
</body>
</html>
`;

describe('finding elements', () => {
    it('walks element children only, from body', () => {
        assert.equal(P.findByPath(PAGE, [0]).tagName, 'div');
        assert.equal(P.findByPath(PAGE, [0, 0]).tagName, 'h1');
        assert.equal(P.findByPath(PAGE, [1, 1]).tagName, 'button');
        assert.equal(P.findByPath(PAGE, [9]), null);
    });
});

describe('ensureSelector', () => {
    it('uses an existing id and changes nothing', () => {
        const out = P.ensureSelector(PAGE, { path: [0, 0] });
        assert.deepEqual([out.selector, out.changed, out.html], ['#title', false, PAGE]);
    });

    it('adds a marker only when there is no id, keeping the rest byte for byte', () => {
        const out = P.ensureSelector(PAGE, { path: [1, 1] });
        assert.equal(out.selector, '[data-d2c="1"]');
        assert.equal(out.changed, true);
        assert.match(out.html, /<button data-correct="true" data-d2c="1">Memory<\/button>/);
        assert.equal(out.html.replace(' data-d2c="1"', ''), PAGE, 'nothing else in the file moves');
    });

    it('reuses a marker it already added, and numbers new ones after it', () => {
        const once = P.ensureSelector(PAGE, { path: [1, 1] }).html;
        const again = P.ensureSelector(once, { path: [1, 1] });
        assert.deepEqual([again.selector, again.changed], ['[data-d2c="1"]', false]);
        assert.equal(P.ensureSelector(once, { path: [1, 0] }).selector, '[data-d2c="2"]');
    });

    it('takes an id given directly by the overlay', () => {
        assert.equal(P.ensureSelector(PAGE, { id: 'title' }).selector, '#title');
    });
});

describe('setText', () => {
    it('replaces only what is between the tags', () => {
        const out = P.setText(PAGE, { id: 'title' }, 'Quiz Night');
        assert.match(out.html, /<h1 id="title">Quiz Night<\/h1>/);
        assert.equal(out.html.replace('Quiz Night', 'Trivia!'), PAGE);
    });

    it('escapes text so it cannot inject markup', () => {
        const out = P.setText(PAGE, { id: 'title' }, '<script>bad()</script> & co');
        assert.match(out.html, /<h1 id="title">&lt;script&gt;bad\(\)&lt;\/script&gt; &amp; co<\/h1>/);
    });

    it('reports no change when the text is already that', () => {
        assert.equal(P.setText(PAGE, { id: 'title' }, 'Trivia!').changed, false);
    });

    it('keeps line breaks as real newlines, and still escapes the rest', () => {
        const out = P.setText(PAGE, { id: 'title' }, 'Quiz\n<b>Night</b> & co\n');
        assert.match(out.html, /<h1 id="title">Quiz\n&lt;b&gt;Night&lt;\/b&gt; &amp; co\n<\/h1>/);
        assert.doesNotMatch(out.html, /<br>/);
    });

    it('gives a <pre> whose text starts on a new line one more, since a browser drops the first', () => {
        const page = '<html><body><pre id="code">x</pre></body></html>';
        const out = P.setText(page, { id: 'code' }, '\nline two');
        assert.equal(out.html, '<html><body><pre id="code">\n\nline two</pre></body></html>');
        assert.equal(P.setText(out.html, { id: 'code' }, '\nline two').changed, false);
    });
});

describe('ensureStylesheet', () => {
    it('links the overrides last in head, after the page own styles', () => {
        const out = P.ensureStylesheet(PAGE, 'draw2code.css');
        assert.equal(out.changed, true);
        const head = out.html.slice(out.html.indexOf('<head>'), out.html.indexOf('</head>'));
        assert.ok(head.indexOf('styles.css') < head.indexOf('draw2code.css'), 'ours must come last to win');
    });

    it('does not link it twice', () => {
        const once = P.ensureStylesheet(PAGE, 'draw2code.css').html;
        const again = P.ensureStylesheet(once, 'draw2code.css');
        assert.deepEqual([again.changed, again.html], [false, once]);
    });

    it('copes with a page that has no head', () => {
        const out = P.ensureStylesheet('<body><p>hi</p></body>', 'draw2code.css');
        assert.match(out.html, /<link rel="stylesheet" href="draw2code.css">/);
    });
});

describe('adding and removing elements', () => {
    it('appends before </body>', () => {
        const out = P.appendToBody(PAGE, '<button id="d2c-1">New</button>');
        assert.match(out.html, /<button id="d2c-1">New<\/button>\n<\/body>/);
    });

    it('removes an element and its markup', () => {
        const added = P.appendToBody(PAGE, '<button id="d2c-1">New</button>').html;
        const out = P.removeElement(added, { id: 'd2c-1' });
        assert.equal(out.changed, true);
        assert.doesNotMatch(out.html, /d2c-1/);
    });
});

describe('removeElement: the page itself is never removed', () => {
    const FRAMED = '<!DOCTYPE html><html id="doc"><head id="top"><title>T</title></head><body id="page"><p>Hi</p></body></html>';

    it('refuses <html>, <head> and <body>, whatever the ref', () => {
        for (const ref of [{ body: true }, { path: [] }, { id: 'page' }, { id: 'doc' }, { id: 'top' }]) {
            assert.deepEqual(P.removeElement(FRAMED, ref), { html: FRAMED, changed: false }, JSON.stringify(ref));
        }
    });
});

describe('removeElement: the lines around a removed element stay tidy', () => {
    it('takes the line of an element alone on it, so no blank indented line is left', () => {
        const page = '<body>\r\n  <p>Keep</p>\r\n  <input id="s">\r\n  <button>Go</button>\r\n</body>';
        assert.equal(P.removeElement(page, { id: 's' }).html, '<body>\r\n  <p>Keep</p>\r\n  <button>Go</button>\r\n</body>');
        assert.equal(P.removeElement('<body>\n  <p>a <b id="s">b</b>\n</p></body>', { id: 's' }).html, '<body>\n  <p>a \n</p></body>', 'one sharing its line leaves the line');
    });
});

describe('dropRulesFor: a removed element takes its rules with it', () => {
    const RULES = {
        '#button-1': { width: '120px' },
        '#button-1::placeholder': { color: '#999' },
        '#button-1:hover': { opacity: '0.9' },
        '#button-1 > *': { fill: '#f00' },
        '#button-10': { width: '80px' },
        '#button-1x': { width: '60px' },
        '[data-d2c="1"]': { left: '4px' },
    };

    it('drops the selector and its pseudo-class, pseudo-element and child rules', () => {
        const out = P.dropRulesFor(RULES, ['#button-1'], '<body></body>');
        assert.deepEqual(Object.keys(out), ['#button-10', '#button-1x', '[data-d2c="1"]']);
    });

    it('keeps the rules of a selector still in the page (an id used twice)', () => {
        assert.equal(P.dropRulesFor(RULES, ['#button-1'], '<body><b id="button-1"></b></body>'), RULES, 'the same object: nothing changed');
    });

    it('lists the selectors of the element and everything inside it', () => {
        const page = '<body><div data-d2c="3"><b id="x">a</b><i>b</i></div><p id="y"></p></body>';
        assert.deepEqual(P.selectorsWithin(page, { path: [0] }), ['[data-d2c="3"]', '#x']);
    });
});

describe('overrides stylesheet', () => {
    it('renders one rule per selector', () => {
        const css = P.renderOverrides({ '#title': { left: '20px', top: '40px' }, '[data-d2c="1"]': { 'background-color': '#fff' } });
        assert.match(css, /#title \{\n  left: 20px;\n  top: 40px;\n\}/);
        assert.match(css, /\[data-d2c="1"\] \{\n  background-color: #fff;\n\}/);
        assert.match(css, /^\/\* Written by Draw2Code Web Editor/);
    });

    it('merges declarations and drops empty ones', () => {
        let o = P.mergeOverride({}, '#title', { left: '20px' });
        o = P.mergeOverride(o, '#title', { top: '10px' });
        assert.deepEqual(o, { '#title': { left: '20px', top: '10px' } });
        o = P.mergeOverride(o, '#title', { left: '' });
        assert.deepEqual(o, { '#title': { top: '10px' } });
        o = P.mergeOverride(o, '#title', { top: '' });
        assert.deepEqual(o, {}, 'a selector with no declarations disappears');
    });
});

describe('applying an edit to a working copy', () => {
    const fs = require('fs');
    const os = require('os');
    const E = require('../../out/website-editor/src/pageEditor.js');


    const makeSite = () => {
        const site = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-edit-'));
        const work = path.join(site, '.draw2code', 'site');
        fs.mkdirSync(path.join(work, 'pages'), { recursive: true });
        fs.writeFileSync(path.join(work, 'index.html'), PAGE);
        fs.writeFileSync(path.join(work, 'pages', 'about.html'), PAGE);
        return work;
    };

    it('writes a rule for an element with an id, and links the stylesheet', () => {
        const work = makeSite();
        const out = E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'title' }, declarations: { left: '20px', top: '40px' } });
        assert.equal(out.selector, '#title');
        const html = fs.readFileSync(path.join(work, 'index.html'), 'utf8');
        const css = fs.readFileSync(path.join(work, 'draw2code', 'index.css'), 'utf8');
        assert.match(html, /<link rel="stylesheet" href="draw2code\/index.css">/);
        assert.match(css, /#title \{\n  left: 20px;\n  top: 40px;\n\}/);
        assert.equal(html.replace(/    <link rel="stylesheet" href="draw2code\/index.css">\n/, ''), PAGE, 'the page is otherwise untouched');
    });

    it('marks an element that has no id, then reuses that marker', () => {
        const work = makeSite();
        const first = E.applyEdit(work, 'index.html', { op: 'style', ref: { path: [1, 1] }, declarations: { left: '10px' } });
        const second = E.applyEdit(work, 'index.html', { op: 'style', ref: { path: [1, 1] }, declarations: { top: '5px' } });
        assert.equal(first.selector, '[data-d2c="1"]');
        assert.equal(second.selector, '[data-d2c="1"]');
        const css = fs.readFileSync(path.join(work, 'draw2code', 'index.css'), 'utf8');
        assert.match(css, /\[data-d2c="1"\] \{\n  left: 10px;\n  top: 5px;\n\}/, 'declarations accumulate on one rule');
    });

    it('gives every page its own stylesheet, linked at the right depth', () => {
        const work = makeSite();
        E.applyEdit(work, 'pages/about.html', { op: 'style', ref: { id: 'title' }, declarations: { left: '1px' } });
        assert.match(fs.readFileSync(path.join(work, 'pages', 'about.html'), 'utf8'), /href="\.\.\/draw2code\/pages\/about\.css"/);
        assert.equal(fs.existsSync(path.join(work, 'draw2code', 'pages', 'about.css')), true);
        assert.equal(E.hrefFromPage('index.html'), 'draw2code/index.css');
        assert.equal(E.hrefFromPage('a/b/c.html'), '../../draw2code/a/b/c.css');
    });

    it('one page edit never overwrites another page rules', () => {
        const work = makeSite();
        E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'title' }, declarations: { left: '1px' } });
        E.applyEdit(work, 'pages/about.html', { op: 'style', ref: { id: 'title' }, declarations: { left: '2px' } });
        assert.match(fs.readFileSync(path.join(work, 'draw2code', 'index.css'), 'utf8'), /left: 1px/);
        assert.match(fs.readFileSync(path.join(work, 'draw2code', 'pages', 'about.css'), 'utf8'), /left: 2px/);
    });

    it('keeps each page overrides apart', () => {
        const work = makeSite();
        E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'title' }, declarations: { left: '1px' } });
        E.applyEdit(work, 'pages/about.html', { op: 'style', ref: { id: 'title' }, declarations: { left: '2px' } });
        const store = JSON.parse(fs.readFileSync(E.overridesStore(work), 'utf8'));
        assert.deepEqual(Object.keys(store).sort(), ['index.html', 'pages/about.html']);
        assert.equal(store['index.html']['#title'].left, '1px');
        assert.equal(store['pages/about.html']['#title'].left, '2px');
    });

    it('stores overrides outside the copied site, so Apply never carries them', () => {
        const work = makeSite();
        E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'title' }, declarations: { left: '1px' } });
        assert.equal(fs.existsSync(path.join(work, 'overrides.json')), false);
        assert.equal(fs.existsSync(E.overridesStore(work)), true);
    });

    it('changes text in the page itself', () => {
        const work = makeSite();
        E.applyEdit(work, 'index.html', { op: 'text', ref: { id: 'title' }, text: 'Quiz Night' });
        const html = fs.readFileSync(path.join(work, 'index.html'), 'utf8');
        assert.match(html, /<h1 id="title">Quiz Night<\/h1>/);
        assert.doesNotMatch(html, /draw2code\//, 'a text edit alone needs no stylesheet');
    });

    it('reports an element it cannot find instead of writing anything', () => {
        const work = makeSite();
        const before = fs.readFileSync(path.join(work, 'index.html'), 'utf8');
        const out = E.applyEdit(work, 'index.html', { op: 'style', ref: { path: [42] }, declarations: { left: '1px' } });
        assert.match(out.error, /no longer in the page/);
        assert.equal(fs.readFileSync(path.join(work, 'index.html'), 'utf8'), before);
    });
});

describe('reverting and resetting', () => {
    const fs = require('fs');
    const os = require('os');
    const E = require('../../out/website-editor/src/pageEditor.js');

    const makeSite = () => {
        const site = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-revert-'));
        const work = path.join(site, '.draw2code', 'site');
        fs.mkdirSync(work, { recursive: true });
        fs.writeFileSync(path.join(work, 'index.html'), PAGE);
        return work;
    };
    const store = (work) => JSON.parse(fs.readFileSync(E.overridesStore(work), 'utf8'));

    it('revert drops one element rule and leaves the others', () => {
        const work = makeSite();
        E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'title' }, declarations: { left: '20px' } });
        E.applyEdit(work, 'index.html', { op: 'style', ref: { path: [1, 1] }, declarations: { width: '80px' } });
        E.applyEdit(work, 'index.html', { op: 'revert', ref: { id: 'title' } });
        const rules = store(work)['index.html'];
        assert.deepEqual(Object.keys(rules), ['[data-d2c="1"]']);
        assert.doesNotMatch(fs.readFileSync(path.join(work, 'draw2code', 'index.css'), 'utf8'), /#title/);
    });

    it('revertPage drops every rule for that page only', () => {
        const work = makeSite();
        fs.mkdirSync(path.join(work, 'pages'), { recursive: true });
        fs.writeFileSync(path.join(work, 'pages', 'about.html'), PAGE);
        E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'title' }, declarations: { left: '20px' } });
        E.applyEdit(work, 'pages/about.html', { op: 'style', ref: { id: 'title' }, declarations: { left: '9px' } });
        E.applyEdit(work, 'index.html', { op: 'revertPage', ref: {} });
        const all = store(work);
        assert.equal(all['index.html'], undefined);
        assert.equal(all['pages/about.html']['#title'].left, '9px');
    });

    it('clearOverrides forgets everything, so fresh markers cannot inherit old rules', () => {
        const work = makeSite();
        E.applyEdit(work, 'index.html', { op: 'style', ref: { path: [1, 1] }, declarations: { width: '80px' } });
        assert.equal(fs.existsSync(E.overridesStore(work)), true);
        E.clearOverrides(work);
        assert.equal(fs.existsSync(E.overridesStore(work)), false);
    });
});

describe('newPageFrom', () => {
    const site = [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="UTF-8">',
        '  <title>Home</title>',
        '  <link rel="stylesheet" href="styles.css">',
        '  <link rel="stylesheet" href="draw2code/index.css">',
        '</head>',
        '<body>',
        '  <header class="header"><a href="index.html">~/homepage</a></header>',
        '  <main><h1>Home</h1><p>lots of words</p></main>',
        '  <script src="script.js"></script>',
        '</body>',
        '</html>',
    ].join('\n');

    const made = P.newPageFrom(site, 'Page2');

    it('keeps the site\'s stylesheets and meta', () => {
        assert.match(made, /<meta charset="UTF-8">/);
        assert.match(made, /<link rel="stylesheet" href="styles.css">/);
    });

    it('leaves out Draw2Code\'s own stylesheet', () => {
        assert.doesNotMatch(made, /draw2code\//, 'the new page has no overrides, and that file is another page\'s');
    });

    it('names itself', () => {
        assert.match(made, /<title>Page2<\/title>/);
        assert.doesNotMatch(made, /<title>Home<\/title>/);
    });

    it('brings the banner, so the page belongs to the site', () => {
        assert.match(made, /<header class="header"><a href="index.html">~\/homepage<\/a><\/header>/);
    });

    it('brings nothing else from the body', () => {
        assert.doesNotMatch(made, /lots of words/);
        assert.doesNotMatch(made, /<main>/);
        assert.doesNotMatch(made, /script\.js/, 'a page-specific script is not the new page\'s');
    });

    it('is a whole document, and parses back', () => {
        assert.match(made, /^<!DOCTYPE html>\n<html lang="en">/);
        assert.match(made, /<\/html>\n$/);
        assert.equal(P.nextMarker(made), 1, 'no markers in a page nothing has edited');
    });

    it('copes with a page that has no head, banner or lang', () => {
        const bare = P.newPageFrom('<body><p>hi</p></body>', 'Page3');
        assert.match(bare, /<title>Page3<\/title>/);
        assert.match(bare, /<body>\n<\/body>/);
    });
});

describe('appendInto + usedIds (adding a real element)', () => {
    const page = '<!DOCTYPE html><html><body>\n<main id="m"><h1>Hi</h1></main>\n<img src="a.png">\n</body></html>';

    it('puts the markup last inside the named section, byte for byte otherwise', () => {
        const out = P.appendInto(page, { id: 'm' }, '<button id="button-1">B</button>');
        assert.equal(out.html, page.replace('</main>', '<button id="button-1">B</button></main>'));
        assert.equal(out.changed, true);
    });

    it('takes a path as well as an id', () => {
        const out = P.appendInto(page, { path: [0] }, '<p id="p1">x</p>');
        assert.match(out.html, /<h1>Hi<\/h1><p id="p1">x<\/p><\/main>/);
    });

    it('the body itself is a section too', () => {
        const out = P.appendInto(page, { body: true }, '<p id="p1">x</p>');
        assert.match(out.html, /<p id="p1">x<\/p>\n<\/body>/);
    });

    it('a tag that cannot hold children falls back to the end of body', () => {
        const out = P.appendInto(page, { path: [1] }, '<p id="p1">x</p>');
        assert.match(out.html, /<img src="a.png">\n    <p id="p1">x<\/p>\n<\/body>/);
    });

    it('lists every id, so a new one can be chosen', () => {
        assert.deepEqual([...P.usedIds(page)], ['m']);
        assert.deepEqual([...P.usedIds('<div id="rect-1"></div><div id="rect-2"></div>')], ['rect-1', 'rect-2']);
    });
});

describe('applyEdit: add into a section', () => {
    const fs = require('fs'); const os = require('os');
    const E = require('../../out/website-editor/src/pageEditor.js');
    it('writes the element inside the section and its rules without a position', () => {
        const site = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-add-'));
        const work = path.join(site, 'site-dev');
        fs.mkdirSync(work, { recursive: true });
        fs.writeFileSync(path.join(work, 'index.html'), '<!DOCTYPE html><html><head></head><body><main id="m"><h1>Hi</h1></main></body></html>');
        const result = E.applyEdit(work, 'index.html', {
            op: 'add', ref: { id: 'button-1' }, markup: '<button id="button-1" type="button">Go</button>',
            declarations: { width: '120px', height: '40px', background: '#3b82f6' },
            into: { id: 'm' },
            extraRules: [{ selector: '#button-1:hover', declarations: { opacity: '0.9' } }],
        });
        assert.equal(result.error, undefined);
        const html = fs.readFileSync(path.join(work, 'index.html'), 'utf8');
        assert.match(html, /<h1>Hi<\/h1><button id="button-1" type="button">Go<\/button><\/main>/);
        assert.match(html, /<link rel="stylesheet" href="draw2code\/index.css">/);
        const css = fs.readFileSync(path.join(work, 'draw2code', 'index.css'), 'utf8');
        assert.match(css, /#button-1 \{[^}]*width: 120px/);
        assert.doesNotMatch(css, /left:|top:|position:/);
        assert.match(css, /#button-1:hover \{[^}]*opacity: 0.9/);
        fs.rmSync(site, { recursive: true, force: true });
    });
});

describe('appendToPage: placing freely', () => {
    const M = require('../media/model.js');
    const H = require('../media/generators/html.js');
    const rect = M.createElement(1, 'rect', { x: 10, y: 20, w: 100, h: 50 }, M.DEFAULT_STYLE);
    const made = (elements) => H.generateProject({ version: 2, pages: [{ name: 'index.html', title: 'Home', color: '#ffffff', open: true, elements }] }).pages[0].html;

    it('on a page made in Draw2Code, goes last inside its wrapper, byte for byte otherwise', () => {
        const page = made([rect]);
        const out = P.appendToPage(page, '<button id="button-1" type="button">Go</button>');
        assert.equal(out.changed, true);
        assert.equal(out.html, page.replace('  </div>\n</body>', '    <button id="button-1" type="button">Go</button>\n  </div>\n</body>'));
        assert.deepEqual(P.findByPath(out.html, [0, 1]).attrs, [{ name: 'id', value: 'button-1' }, { name: 'type', value: 'button' }]);
    });

    it('an empty page made in Draw2Code has its wrapper too', () => {
        const out = P.appendToPage(made([]), '<p id="paragraph-1">Hi</p>');
        assert.match(out.html, /<div class="page">\n\n {4}<p id="paragraph-1">Hi<\/p>\n {2}<\/div>\n<\/body>/);
    });

    it('a wrapper with its </div> on the same line takes the markup just before it', () => {
        const page = '<html><head><!-- Generated by Draw2Code Web Editor --></head><body><div class="page"><svg id="rect-1"></svg></div></body></html>';
        assert.equal(P.appendToPage(page, '<p id="p1">x</p>').html, page.replace('</svg></div>', '</svg><p id="p1">x</p></div>'));
    });

    it('an imported page goes before </body> as before, even with a div.page of its own', () => {
        const page = '<!DOCTYPE html><html><head><title>Shop</title></head><body>\n<div class="page"><h1>Shop</h1></div>\n</body></html>';
        assert.equal(P.appendToPage(page, '<p id="p1">x</p>').html, P.appendToBody(page, '<p id="p1">x</p>').html);
        assert.equal(P.appendToPage(PAGE, '<p id="p1">x</p>').html, P.appendToBody(PAGE, '<p id="p1">x</p>').html);
    });

    it('only the generator\'s own comment, and only a wrapper that comes first, count', () => {
        const words = '<html><head></head><body><div class="page"><p>Generated by Draw2Code Web Editor</p></div></body></html>';
        assert.match(P.appendToPage(words, '<p id="p1">x</p>').html, /<\/div>\s*<p id="p1">x<\/p>\n<\/body>/);
        const later = made([rect]).replace('<body class="page-index">', '<body class="page-index">\n  <nav>Menu</nav>');
        assert.match(P.appendToPage(later, '<p id="p1">x</p>').html, /<\/div>\n {4}<p id="p1">x<\/p>\n<\/body>/);
        const other = made([rect]).replace('<div class="page">', '<div class="page wide">');
        assert.match(P.appendToPage(other, '<p id="p1">x</p>').html, /<\/div>\n {4}<p id="p1">x<\/p>\n<\/body>/);
    });

    it('a page that already has an element placed after the wrapper gets the new one after it, so it stays on top', () => {
        const older = P.appendToBody(made([rect]), '<svg id="rect-2"></svg>').html;
        const out = P.appendToPage(older, '<button id="button-1" type="button">B</button>').html;
        assert.equal(out, P.appendToBody(older, '<button id="button-1" type="button">B</button>').html);
        assert.ok(out.indexOf('button-1') > out.indexOf('rect-2'));
        const scripted = P.appendToBody(made([rect]), '<script src="app.js"></script>').html;
        assert.ok(P.appendToPage(scripted, '<p id="p1">x</p>').html.indexOf('p1') < scripted.indexOf('app.js'), 'a script after it does not count');
    });

    it('a page added with + from a page made in Draw2Code gets an empty wrapper to place into', () => {
        const added = P.newPageFrom(made([rect]), 'Page2');
        assert.match(added, /<body>\n {2}<div class="page">\n {2}<\/div>\n<\/body>/);
        assert.doesNotMatch(added, /rect-1/, 'the elements stay on their own page');
        assert.match(P.appendToPage(added, '<p id="p1">x</p>').html, /<div class="page">\n {4}<p id="p1">x<\/p>\n {2}<\/div>/);
    });
});

describe('applyEdit: add placed freely', () => {
    const fs = require('fs'); const os = require('os');
    const E = require('../../out/website-editor/src/pageEditor.js');
    const M = require('../media/model.js');
    const H = require('../media/generators/html.js');
    it('on a page made in Draw2Code, writes the element in the wrapper and its rules as drawn', () => {
        const site = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-free-'));
        const work = path.join(site, 'site-dev');
        fs.mkdirSync(work, { recursive: true });
        const design = { version: 2, pages: [{ name: 'index.html', title: 'Home', color: '#ffffff', open: true, elements: [] }] };
        fs.writeFileSync(path.join(work, 'index.html'), H.generateProject(design).pages[0].html);
        // As the editor sends it: the generator's parts, placed where they were drawn.
        const parts = H.elementParts(M.createElement(1, 'button', { x: 40, y: 900, w: 120, h: 40 }, M.WIDGET_DEFAULTS.button));
        const result = E.applyEdit(work, 'index.html', { op: 'add', ref: { id: parts.id }, markup: parts.html, declarations: { ...parts.rules[0].declarations, position: 'absolute' } });
        assert.equal(result.error, undefined);
        const html = fs.readFileSync(path.join(work, 'index.html'), 'utf8');
        assert.match(html, /<div class="page">\n\n {4}<button id="button-1" type="button">Button<\/button>\n {2}<\/div>/);
        const css = fs.readFileSync(path.join(work, 'draw2code', 'index.css'), 'utf8');
        assert.match(css, /#button-1 \{\n {2}left: 40px;\n {2}top: 900px;\n {2}width: 120px;\n {2}height: 40px;[^}]*position: absolute;/);
        fs.rmSync(site, { recursive: true, force: true });
    });
});

describe('applyEdit: colours on a drawing go to its shape', () => {
    const fs = require('fs'); const os = require('os');
    const E = require('../../out/website-editor/src/pageEditor.js');
    it('writes child declarations under "<selector> > *"', () => {
        const site = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-fill-'));
        const work = path.join(site, 'site-dev');
        fs.mkdirSync(work, { recursive: true });
        fs.writeFileSync(path.join(work, 'index.html'), '<!DOCTYPE html><html><head></head><body><svg id="rect-1" width="10" height="10"><rect width="10" height="10" fill="#3b82f6"/></svg></body></html>');
        const result = E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'rect-1' }, declarations: {}, childDeclarations: { fill: '#ff0000' } });
        assert.equal(result.error, undefined);
        const css = fs.readFileSync(path.join(work, 'draw2code', 'index.css'), 'utf8');
        assert.match(css, /#rect-1 > \* \{\n  fill: #ff0000;\n\}/);
        assert.doesNotMatch(css, /#rect-1 \{/, 'nothing for the svg itself');
        E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'rect-1' }, declarations: {}, childDeclarations: { stroke: 'none', 'stroke-width': '' } });
        const css2 = fs.readFileSync(path.join(work, 'draw2code', 'index.css'), 'utf8');
        assert.match(css2, /fill: #ff0000;\n  stroke: none;/, 'later rules merge into the same block; an empty value removes a property');
        fs.rmSync(site, { recursive: true, force: true });
    });
});

describe('setTitle: renaming a page from its tab', () => {
    it('changes only the text between the tags', () => {
        const page = '<!DOCTYPE html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <title>Home</title>\n</head><body></body></html>';
        const out = P.setTitle(page, 'Welcome');
        assert.equal(out.html, page.replace('<title>Home</title>', '<title>Welcome</title>'));
        assert.equal(out.changed, true);
    });

    it('escapes what is typed', () => {
        assert.match(P.setTitle('<html><head><title>x</title></head></html>', 'Tom & <Jerry>').html, /<title>Tom &amp; &lt;Jerry&gt;<\/title>/);
    });

    it('the same title is no change', () => {
        const page = '<html><head><title>Home</title></head></html>';
        assert.deepEqual(P.setTitle(page, 'Home'), { html: page, changed: false });
    });

    it('a page with no title gets one at the top of its head', () => {
        const out = P.setTitle('<html><head><meta charset="utf-8"></head><body></body></html>', 'New');
        assert.match(out.html, /<head>\n    <title>New<\/title><meta charset="utf-8">/);
    });

    it('a page with no head gets one at the very top', () => {
        assert.match(P.setTitle('<p>hi</p>', 'Bare').html, /^<title>Bare<\/title>\n<p>hi<\/p>/);
    });
});

describe('applyEdit: the title op', () => {
    const fs = require('fs'); const os = require('os');
    const E = require('../../out/website-editor/src/pageEditor.js');
    it('writes the page and nothing else, and says so', () => {
        const site = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-title-'));
        const work = path.join(site, 'site-dev');
        fs.mkdirSync(work, { recursive: true });
        fs.writeFileSync(path.join(work, 'about.html'), '<html><head><title>About</title></head><body></body></html>');
        const result = E.applyEdit(work, 'about.html', { op: 'title', ref: {}, text: 'My story' });
        assert.equal(result.changed.length, 1);
        assert.match(fs.readFileSync(path.join(work, 'about.html'), 'utf8'), /<title>My story<\/title>/);
        assert.equal(fs.existsSync(path.join(work, 'draw2code')), false, 'no stylesheet for a title');
        assert.deepEqual(E.applyEdit(work, 'about.html', { op: 'title', ref: {}, text: 'My story' }).changed, [], 'the same title writes nothing');
        fs.rmSync(site, { recursive: true, force: true });
    });
});

describe('applyEdit: remove', () => {
    const fs = require('fs'); const os = require('os');
    const E = require('../../out/website-editor/src/pageEditor.js');
    const makeSite = (html) => {
        const site = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-remove-'));
        const work = path.join(site, 'site-dev');
        fs.mkdirSync(work, { recursive: true });
        fs.writeFileSync(path.join(work, 'index.html'), html);
        return { site, work, read: () => fs.readFileSync(path.join(work, 'index.html'), 'utf8') };
    };

    it('refuses <body>, <html> and <head>, and leaves the page as it was', () => {
        const page = '<!DOCTYPE html><html id="doc"><head id="top"><title>T</title></head><body id="page"><p>Hi</p></body></html>';
        const { site, work, read } = makeSite(page);
        for (const ref of [{ body: true }, { path: [] }, { id: 'page' }, { id: 'doc' }, { id: 'top' }]) {
            const result = E.applyEdit(work, 'index.html', { op: 'remove', ref });
            assert.match(result.error ?? '', /is the page itself and cannot be removed/, JSON.stringify(ref));
            assert.deepEqual(result.changed, []);
        }
        assert.equal(read(), page, 'byte for byte');
        assert.equal(fs.existsSync(E.overridesStore(work)), false, 'no rules written either');
        fs.rmSync(site, { recursive: true, force: true });
    });

    it('removes an element without an id by its path, and the next edit finds its sibling one place earlier', () => {
        const { site, work, read } = makeSite(PAGE);
        const removed = E.applyEdit(work, 'index.html', { op: 'remove', ref: { path: [1, 0] } });
        assert.equal(removed.error, undefined);
        assert.doesNotMatch(read(), /Part 1/);
        assert.doesNotMatch(read(), /data-d2c/, 'no marker added to an element only to remove it');
        assert.equal(read(), PAGE.replace('        <h2>Part 1</h2>\n', ''), 'nothing else in the file moves: only its line goes');
        // The button was [1, 1]; the overlay, drawn again, now calls it [1, 0].
        E.applyEdit(work, 'index.html', { op: 'text', ref: { path: [1, 0] }, text: 'Recall' });
        assert.match(read(), /<button data-correct="true"[^>]*>Recall<\/button>/);
        assert.match(read(), /<h1 id="title">Trivia!<\/h1>/, 'the heading before it is untouched');
        fs.rmSync(site, { recursive: true, force: true });
    });

    it('takes the element\'s rules out of the overrides, and leaves #button-10 alone', () => {
        const { site, work } = makeSite('<!DOCTYPE html><html><head></head><body><input id="button-1"><button id="button-10">Go</button><p id="button-1x">x</p></body></html>');
        E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'button-1' }, declarations: { width: '120px' },
            extraRules: [{ selector: '#button-1::placeholder', declarations: { color: '#999' } }, { selector: '#button-1:focus', declarations: { outline: 'none' } }],
            childDeclarations: { fill: '#f00' } });
        E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'button-10' }, declarations: { width: '80px' } });
        E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'button-1x' }, declarations: { color: 'red' } });
        assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(E.overridesStore(work), 'utf8'))['index.html']),
            ['#button-1', '#button-1::placeholder', '#button-1:focus', '#button-1 > *', '#button-10', '#button-1x'], 'every rule is there first');
        const result = E.applyEdit(work, 'index.html', { op: 'remove', ref: { id: 'button-1' } });
        assert.equal(result.error, undefined);
        const rules = JSON.parse(fs.readFileSync(E.overridesStore(work), 'utf8'))['index.html'];
        assert.deepEqual(Object.keys(rules), ['#button-10', '#button-1x']);
        const css = fs.readFileSync(path.join(work, 'draw2code', 'index.css'), 'utf8');
        assert.doesNotMatch(css, /#button-1[ :{]/, 'the stylesheet is written again without them');
        assert.match(css, /#button-10 \{\n  width: 80px;/);
        fs.rmSync(site, { recursive: true, force: true });
    });

    it('takes the rules of what was inside it too, so a new element given that id starts clean', () => {
        const { site, work } = makeSite('<!DOCTYPE html><html><head></head><body><section><b id="rect-1">a</b></section></body></html>');
        E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'rect-1' }, declarations: { color: 'red' } });
        E.applyEdit(work, 'index.html', { op: 'style', ref: { path: [0] }, declarations: { width: '10px' } });
        E.applyEdit(work, 'index.html', { op: 'remove', ref: { path: [0] } });
        assert.deepEqual(JSON.parse(fs.readFileSync(E.overridesStore(work), 'utf8'))['index.html'], {});
        fs.rmSync(site, { recursive: true, force: true });
    });

    it('reports an element that is not there instead of writing anything', () => {
        const { site, work, read } = makeSite(PAGE);
        const result = E.applyEdit(work, 'index.html', { op: 'remove', ref: { id: 'nobody' } });
        assert.equal(result.error, 'that element is no longer in the page; the page is kept');
        assert.equal(read(), PAGE);
        fs.rmSync(site, { recursive: true, force: true });
    });

    it('removes the second of two elements sharing an id by its path, and keeps the first', () => {
        const page = '<!DOCTYPE html><html><head></head><body><div id="dup">first</div><div id="dup">second</div></body></html>';
        const { site, work, read } = makeSite(page);
        E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'dup' }, declarations: { color: 'red' } });
        const styled = read();
        E.applyEdit(work, 'index.html', { op: 'remove', ref: { path: [1] } });
        assert.equal(read(), styled.replace('<div id="dup">second</div>', ''));
        assert.deepEqual(JSON.parse(fs.readFileSync(E.overridesStore(work), 'utf8'))['index.html'], { '#dup': { color: 'red' } }, 'the first still wears the rule');
        fs.rmSync(site, { recursive: true, force: true });
    });
});

describe('ensureScript and unlinkScript: the video player\'s script', () => {
    it('links a script last in <head>, deferred, once', () => {
        const out = P.ensureScript(PAGE, 'js/video-player.js');
        assert.equal(out.changed, true);
        assert.equal(out.html, PAGE.replace('</head>', '    <script src="js/video-player.js" defer></script>\n</head>'));
        const again = P.ensureScript(out.html, 'js/video-player.js');
        assert.deepEqual([again.changed, again.html], [false, out.html]);
    });

    it('escapes the address', () => {
        assert.match(P.ensureScript(PAGE, 'js/a"b&c.js').html, /<script src="js\/a&quot;b&amp;c.js" defer><\/script>/);
    });

    it('copes with a page that has no head', () => {
        assert.match(P.ensureScript('<body><p>hi</p></body>', 'v.js').html, /^<script src="v.js" defer><\/script>\n<body>/);
    });

    it('takes it out again exactly as it was put in, with its line', () => {
        const linked = P.ensureScript(PAGE, 'js/video-player.js').html;
        assert.deepEqual(P.unlinkScript(linked, 'js/video-player.js'), { html: PAGE, changed: true });
        assert.deepEqual(P.unlinkScript(PAGE, 'js/video-player.js'), { html: PAGE, changed: false });
    });

    it('a stylesheet and a script added one after the other come out in either order, byte for byte', () => {
        const both = P.ensureStylesheet(P.ensureScript(P.ensureStylesheet(PAGE, 'css/video-player.css').html, 'js/video-player.js').html, 'draw2code/index.css').html;
        const withOurs = P.ensureStylesheet(PAGE, 'draw2code/index.css').html;
        assert.equal(P.unlinkScript(P.unlinkStylesheet(both, 'css/video-player.css').html, 'js/video-player.js').html, withOurs);
        assert.equal(P.unlinkStylesheet(P.unlinkScript(both, 'js/video-player.js').html, 'css/video-player.css').html, withOurs);
    });

    it('keeps the indentation of an indented </head>, whichever comes out first', () => {
        const page = PAGE.replace('</head>', '  </head>');
        const both = P.ensureStylesheet(P.ensureScript(P.ensureStylesheet(page, 'css/video-player.css').html, 'js/video-player.js').html, 'draw2code/index.css').html;
        const withOurs = P.ensureStylesheet(page, 'draw2code/index.css').html;
        assert.equal(P.unlinkScript(P.unlinkStylesheet(both, 'css/video-player.css').html, 'js/video-player.js').html, withOurs);
        assert.equal(P.unlinkStylesheet(P.unlinkScript(both, 'js/video-player.js').html, 'css/video-player.css').html, withOurs);
        assert.equal(P.unlinkStylesheet(P.unlinkScript(withOurs, 'x.js').html, 'draw2code/index.css').html, page);
    });

    it('keeps the indentation of an indented <body> on a page with no head', () => {
        const page = '<html>\n  <body>\n    <p>hi</p>\n  </body>\n</html>\n';
        assert.equal(P.unlinkStylesheet(P.ensureStylesheet(page, 'draw2code/index.css').html, 'draw2code/index.css').html, page);
        assert.equal(P.unlinkScript(P.ensureScript(page, 'js/video-player.js').html, 'js/video-player.js').html, page);
    });
});

describe('usesPlayer and playerLinks: does the page still need the video player?', () => {
    it('is true while a <div class="video-player"> is in the page', () => {
        assert.equal(P.usesPlayer('<body><div id="video-1" class="video-player"><video></video></div></body>'), true);
        assert.equal(P.usesPlayer('<body><div class="big video-player"></div></body>'), true);
        assert.equal(P.usesPlayer('<body><div class="video-embed"><iframe></iframe></div></body>'), false, 'a hosted video has no player of ours');
        assert.equal(P.usesPlayer('<body><p class="video-player-note">x</p><div class="video-players"></div></body>'), false);
        assert.equal(P.usesPlayer(PAGE), false);
    });

    it('finds the player\'s stylesheet and script the page links already, as written', () => {
        const page = '<html><head><link rel="stylesheet" href="../css/video-player-2.css?v=1"><script src="../js/video-player.js" defer></script></head><body></body></html>';
        assert.deepEqual(P.playerLinks(page), { stylesheet: '../css/video-player-2.css?v=1', script: '../js/video-player.js' });
        assert.deepEqual(P.playerLinks(PAGE), {});
        assert.deepEqual(P.playerLinks('<link rel="preload" href="css/video-player.css"><script src="js/my-video-player.js"></script>'), {}, 'only a stylesheet, and only the player\'s name');
    });
});

describe('full width: an element of a page made in Draw2Code across the whole window', () => {
    const fs = require('fs'); const os = require('os');
    const E = require('../../out/website-editor/src/pageEditor.js');
    const M = require('../media/model.js');
    const H = require('../media/generators/html.js');
    const rect = M.createElement(1, 'rect', { x: 10, y: 20, w: 100, h: 50 }, M.DEFAULT_STYLE);
    const button = M.createElement(1, 'button', { x: 40, y: 90, w: 120, h: 40 }, M.WIDGET_DEFAULTS.button);
    const made = (elements) => H.generateProject({ version: 2, pages: [{ name: 'index.html', title: 'Home', color: '#ffffff', open: true, elements }] }).pages[0].html;

    it('a button gets the class, and loses it again byte for byte', () => {
        const page = made([button]);
        const on = P.setFullWidth(page, { id: 'button-1' }, true);
        assert.equal(on.changed, true);
        assert.equal(on.html, page.replace('<button id="button-1" type="button">', '<button id="button-1" type="button" class="full-width">'));
        const off = P.setFullWidth(on.html, { id: 'button-1' }, false);
        assert.deepEqual(off, { html: page, changed: true });
    });

    it('the same as the generator writes for a full-width element, apart from where the class goes', () => {
        const on = P.setFullWidth(made([rect]), { id: 'rect-1' }, true).html;
        const generated = made([{ ...rect, fullWidth: true }]);
        const attrs = (html) => P.findByPath(html, [0, 0]).attrs.map((a) => `${a.name}=${a.value}`).sort();
        assert.deepEqual(attrs(on), attrs(generated));
    });

    it('a drawing is stretched with its box, and drawn as it was again after', () => {
        const page = made([rect]);
        const on = P.setFullWidth(page, { path: [0, 0] }, true).html;
        assert.match(on, /<svg id="rect-1" width="100" height="50" viewBox="0 0 100 50" class="full-width" preserveAspectRatio="none">/);
        assert.equal(P.setFullWidth(on, { path: [0, 0] }, false).html, page);
    });

    it('classes it has already stay', () => {
        const page = made([button]).replace('<button id="button-1"', '<button class="cta big" id="button-1"');
        const on = P.setFullWidth(page, { id: 'button-1' }, true).html;
        assert.match(on, /<button class="cta big full-width" id="button-1"/);
        assert.equal(P.setFullWidth(on, { id: 'button-1' }, false).html, page);
    });

    it('already so is no change', () => {
        const page = made([{ ...button, fullWidth: true }]);
        assert.deepEqual(P.setFullWidth(page, { id: 'button-1' }, true), { html: page, changed: false });
        assert.deepEqual(P.setFullWidth(made([button]), { id: 'button-1' }, false), { html: made([button]), changed: false });
    });

    it('only an element in the wrapper of a page made in Draw2Code; anything else says why', () => {
        assert.match(P.setFullWidth(PAGE, { id: 'title' }, true).problem, /only an element placed freely on a page made in Draw2Code/);
        const page = made([button]);
        assert.match(P.setFullWidth(page, { path: [0] }, true).problem, /only an element placed freely/, 'not the wrapper itself');
        const outside = P.appendToBody(page, '<p id="p1">x</p>').html;
        assert.match(P.setFullWidth(outside, { id: 'p1' }, true).problem, /only an element placed freely/, 'not one after it');
        assert.match(P.setFullWidth(page, { id: 'nope' }, true).problem, /no longer in the page/);
    });

    it('applyEdit writes it into the page and nothing else; refused, nothing is written', () => {
        const site = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-full-'));
        const work = path.join(site, 'site-dev');
        fs.mkdirSync(work, { recursive: true });
        const page = made([rect]);
        fs.writeFileSync(path.join(work, 'index.html'), page);
        const result = E.applyEdit(work, 'index.html', { op: 'fullWidth', ref: { id: 'rect-1' }, full: true });
        assert.deepEqual(result, { changed: [path.join(work, 'index.html')] });
        assert.match(fs.readFileSync(path.join(work, 'index.html'), 'utf8'), /class="full-width" preserveAspectRatio="none"/);
        assert.equal(fs.existsSync(path.join(work, 'draw2code')), false, 'no rule: its own left and width stay as they are');
        E.applyEdit(work, 'index.html', { op: 'fullWidth', ref: { id: 'rect-1' }, full: false });
        assert.equal(fs.readFileSync(path.join(work, 'index.html'), 'utf8'), page);
        fs.writeFileSync(path.join(work, 'other.html'), PAGE);
        assert.match(E.applyEdit(work, 'other.html', { op: 'fullWidth', ref: { id: 'title' }, full: true }).error, /only an element placed freely/);
        assert.equal(fs.readFileSync(path.join(work, 'other.html'), 'utf8'), PAGE);
        fs.rmSync(site, { recursive: true, force: true });
    });
});

describe('placesInWrapper: where left and top of an element placed freely are measured from', () => {
    const H = require('../media/generators/html.js');
    const made = H.generateProject({ version: 2, pages: [{ name: 'index.html', title: 'Home', color: '#ffffff', open: true, elements: [] }] }).pages[0].html;

    it('on a page made in Draw2Code, from its wrapper, which appendToPage puts it in', () => {
        assert.equal(P.placesInWrapper(made), true);
        assert.equal(P.placesInWrapper(P.newPageFrom(made, 'Page2')), true);
    });

    it('anywhere else, from the page, as before', () => {
        assert.equal(P.placesInWrapper(PAGE), false);
        assert.equal(P.placesInWrapper(P.appendToBody(made, '<svg id="rect-2"></svg>').html), false, 'an element already placed after the wrapper');
    });
});
