// Unit tests for siteProject.ts and the shared project label (src/projectFormat.ts):
// a website project Draw2Code made, on disk.
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
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = { ...require('../../out/src/projectFormat.js'), ...require('../../out/website-editor/src/siteProject.js'), ...require('../../out/src/publish.js') };
const S = require('../../out/website-editor/src/siteFiles.js');
const H = require('../media/generators/html.js');
const M = require('../media/model.js');
const E = require('../../out/website-editor/src/pageEditor.js');
const PE = require('../../out/website-editor/src/pageEdit.js');

const blankPage = () => ({ name: 'index.html', title: 'Home', color: '#ffffff', elements: [], open: true });
const design = (pages, active = 'index.html') => ({ version: 2, active, pages });

describe('isBlankDesign: is there any work to lose?', () => {
    it('what New Design starts with is blank', () => {
        assert.equal(P.isBlankDesign(design([blankPage()])), true);
    });

    it('an element is work', () => {
        assert.equal(P.isBlankDesign(design([{ ...blankPage(), elements: [{ id: 1, type: 'rect' }] }])), false);
    });

    it('a second page is work, even an empty one', () => {
        assert.equal(P.isBlankDesign(design([blankPage(), { ...blankPage(), name: 'page2.html' }])), false);
    });

    it('a new title, colour or file name is work', () => {
        assert.equal(P.isBlankDesign(design([{ ...blankPage(), title: 'Welcome' }])), false);
        assert.equal(P.isBlankDesign(design([{ ...blankPage(), color: '#000000' }])), false);
        assert.equal(P.isBlankDesign(design([{ ...blankPage(), name: 'start.html' }])), false);
    });

    it('colour case does not matter, and which page is showing never counts', () => {
        assert.equal(P.isBlankDesign(design([{ ...blankPage(), color: '#FFFFFF' }], 'elsewhere.html')), true);
    });

    it('an old single-page design is blank when it has no elements', () => {
        assert.equal(P.isBlankDesign({ version: 1, page: { color: '#fff' }, elements: [] }), true);
        assert.equal(P.isBlankDesign({ version: 1, page: { color: '#fff' }, elements: [{ id: 1 }] }), false);
    });
});

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-proj-'));
const drawn = () => {
    const home = { ...M.makePage('index.html'), title: 'Birthdays', elements: [M.createElement(1, 'rect', { x: 10, y: 20, w: 30, h: 40 }, M.DEFAULT_STYLE)] };
    const about = { ...M.makePage('about.html'), color: '#112233', elements: [M.createElement(1, 'button', { x: 5, y: 5, w: 120, h: 40 }, M.WIDGET_DEFAULTS.button)] };
    return M.makeDesign([home, about], 'about.html');
};

describe('generateProject: every page, one stylesheet', () => {
    const out = H.generateProject(drawn());

    it('writes a page per page, each linking the one stylesheet', () => {
        assert.deepEqual(out.pages.map((p) => p.name), ['index.html', 'about.html']);
        for (const page of out.pages) assert.match(page.html, /<link rel="stylesheet" href="css\/style.css">/);
        assert.equal(out.cssPath, 'css/style.css');
    });

    it('scopes each page by its body class, so two rect-1s never collide', () => {
        assert.match(out.pages[0].html, /<body class="page-index">/);
        assert.match(out.pages[1].html, /<body class="page-about">/);
        assert.match(out.css, /:where\(\.page-index\) #rect-1 \{/);
        assert.match(out.css, /:where\(\.page-about\) #button-1 \{/);
        assert.doesNotMatch(out.css, /^\.page-index #rect-1/m, 'the scope must add no specificity, or edits lose to it');
        assert.match(out.css, /body\.page-about \{\n  background: #112233;/);
    });

    it('titles each page, and a page in a folder reaches the stylesheet', () => {
        assert.match(out.pages[0].html, /<title>Birthdays<\/title>/);
        const nested = H.generateProject(M.makeDesign([{ ...M.makePage('blog/post.html') }], 'blog/post.html'));
        assert.match(nested.pages[0].html, /href="\.\.\/css\/style.css"/);
    });
});

describe('where a save goes', () => {
    it('the name typed in the Save dialog names the project, made in a new folder there', () => {
        const dir = tmp();
        fs.writeFileSync(path.join(dir, 'notes.txt'), 'mine');
        assert.deepEqual(P.planSaveAs(path.join(dir, 'Shop.d2c')), { root: path.join(dir, 'Shop'), name: 'Shop' });
        assert.deepEqual(P.planSaveAs(path.join(dir, 'Shop')), { root: path.join(dir, 'Shop'), name: 'Shop' }, 'without the extension too');
    });

    it('an empty folder of that name is used; anything else there is refused, saying why', () => {
        const dir = tmp();
        fs.mkdirSync(path.join(dir, 'Empty'));
        fs.writeFileSync(path.join(dir, 'Empty', 'desktop.ini'), ''); // OS clutter does not count
        assert.deepEqual(P.planSaveAs(path.join(dir, 'Empty.d2c')), { root: path.join(dir, 'Empty'), name: 'Empty' });
        fs.mkdirSync(path.join(dir, 'Used'));
        fs.writeFileSync(path.join(dir, 'Used', 'a.txt'), 'x');
        assert.match(P.planSaveAs(path.join(dir, 'Used.d2c')).problem, /already exists/);
        fs.writeFileSync(path.join(dir, 'notes'), 'a file, not a folder');
        assert.match(P.planSaveAs(path.join(dir, 'notes.d2c')).problem, /already exists/);
        assert.match(P.planSaveAs(path.join(dir, 'CON.d2c')).problem, /Windows/);
    });

    it('refuses names a folder cannot have', () => {
        assert.equal(P.projectNameProblem('Birthdays'), null);
        assert.match(P.projectNameProblem('   '), /name/);
        assert.match(P.projectNameProblem('a/b'), /cannot contain/);
        assert.match(P.projectNameProblem('site.'), /end with/);
        assert.match(P.projectNameProblem('CON'), /Windows/);
    });
});

describe('writeProject: the saved project on disk', () => {
    it('writes <name>-dev with every page and one stylesheet, and the label', () => {
        const root = path.join(tmp(), 'Birthdays');
        fs.mkdirSync(root);
        const result = P.writeProject(root, 'Birthdays', drawn(), H, '0.5.0');
        const dev = path.join(root, 'Birthdays-dev');
        assert.equal(result.dev, dev);
        assert.equal(fs.existsSync(path.join(dev, 'index.html')), true);
        assert.equal(fs.existsSync(path.join(dev, 'about.html')), true);
        assert.equal(fs.existsSync(path.join(dev, 'css', 'style.css')), true);
        assert.equal(fs.readFileSync(path.join(dev, '.draw2code', '.gitignore'), 'utf8'), '*\n');
        assert.equal(fs.existsSync(path.join(root, 'Birthdays-prod')), false, '-prod is output: built on Publish, not on save');

        const label = P.readProject(root);
        assert.equal(label.format, 'draw2code-project');
        assert.equal(label.name, 'Birthdays');
        assert.equal(label.dev, 'Birthdays-dev');
        assert.equal(label.prod, 'Birthdays-prod');
        assert.equal(label.savedWith, '0.5.0');
        assert.match(label.created, /^\d{4}-\d\d-\d\dT/);
        assert.equal(label.design.pages.length, 2, 'the drawing is kept as a keepsake');
    });

    it('never writes over a project that is already there', () => {
        const root = tmp();
        P.writeProject(root, 'Shop', drawn(), H, '0.5.0');
        assert.throws(() => P.writeProject(root, 'Shop', drawn(), H, '0.5.0'), /already exists/);
    });

    it('reads a label with fields it does not know, and fills in ones that are missing', () => {
        const root = tmp();
        fs.mkdirSync(path.join(root, '.draw2code'));
        fs.writeFileSync(path.join(root, P.PROJECT_FILE), JSON.stringify({ format: 'draw2code-project', name: 'Old', fromTheFuture: 42 }));
        const label = P.readProject(root);
        assert.equal(label.dev, 'Old-dev');
        assert.equal(label.prod, 'Old-prod');
        assert.equal(label.fromTheFuture, 42, 'future fields survive');
        fs.writeFileSync(path.join(root, P.PROJECT_FILE), '{ not json');
        assert.equal(P.readProject(root), null);
    });

    it('finds the project a .d2c file labels, and nothing for any other .d2c', () => {
        const root = path.join(tmp(), 'Shop');
        fs.mkdirSync(root);
        P.writeProject(root, 'Shop', drawn(), H, '0.7.0');
        assert.equal(P.projectRootOf(path.join(root, '.draw2code', 'project.d2c')), root);
        const stray = path.join(root, 'notes.d2c');
        fs.writeFileSync(stray, '{}');
        assert.equal(P.projectRootOf(stray), null, 'a .d2c outside .draw2code labels nothing');
        const broken = path.join(tmp(), '.draw2code', 'project.d2c');
        fs.mkdirSync(path.dirname(broken));
        fs.writeFileSync(broken, '{ not json');
        assert.equal(P.projectRootOf(broken), null, 'a label that does not read is not a project');
    });
});

describe('a label remembers where the editor was left', () => {
    it('writes the tabs and the page, keeping everything else in the label', () => {
        const root = path.join(tmp(), 'Shop');
        fs.mkdirSync(root);
        P.writeProject(root, 'Shop', drawn(), H, '0.7.0');
        const file = path.join(root, P.PROJECT_FILE);
        assert.equal(P.readEditorState(file), undefined, 'nothing remembered yet');
        assert.equal(P.writeEditorState(file, { tabs: ['index.html', 'about.html'], page: 'about.html' }), true);
        assert.deepEqual(P.readEditorState(file), { tabs: ['index.html', 'about.html'], page: 'about.html' });
        const label = P.readProject(root);
        assert.equal(label.name, 'Shop');
        assert.equal(label.design.pages.length, 2, 'the keepsake drawing is still there');
        assert.equal(P.writeEditorState(file, { tabs: ['index.html', 'about.html'], page: 'about.html' }), false, 'the same state writes nothing');
    });

    it('works on an import label too, and never on a file that is not a label', () => {
        const parent = tmp();
        const site = path.join(parent, 'homepage');
        fs.mkdirSync(site);
        fs.writeFileSync(path.join(site, 'index.html'), '<html><body></body></html>');
        S.createWorkingCopy(site);
        const file = P.writeImportLabel(site, path.join(parent, 'homepage-dev'), '0.7.0');
        assert.equal(P.writeEditorState(file, { tabs: ['index.html'], page: 'index.html' }), true);
        assert.equal(P.readImportLabel(path.join(parent, 'homepage-dev')).original, '../homepage');
        const other = path.join(parent, 'notes.d2c');
        fs.writeFileSync(other, '{"hello": 1}');
        assert.equal(P.writeEditorState(other, { tabs: [], page: 'x' }), false);
        assert.equal(fs.readFileSync(other, 'utf8'), '{"hello": 1}');
    });
});

describe('an import is labelled in its -dev copy', () => {
    const setup = () => {
        const parent = tmp();
        const site = path.join(parent, 'homepage');
        fs.mkdirSync(site);
        fs.writeFileSync(path.join(site, 'index.html'), '<!DOCTYPE html><html><body>hi</body></html>');
        S.createWorkingCopy(site);
        return { parent, site, work: path.join(parent, 'homepage-dev') };
    };

    it('writes the label inside -dev, never in the original, and it opens the original', () => {
        const { site, work } = setup();
        const file = P.writeImportLabel(site, work, '0.7.0');
        assert.equal(file, path.join(work, '.draw2code', 'project.d2c'));
        assert.equal(fs.existsSync(path.join(site, '.draw2code')), false, 'the original is not written to');
        const label = P.readImportLabel(work);
        assert.equal(label.kind, 'import');
        assert.equal(label.name, 'homepage');
        assert.equal(label.original, '../homepage');
        assert.equal(P.projectRootOf(file), site);
    });

    it('is not mistaken for a project Draw2Code made, so -dev stays a copy', () => {
        const { site, work } = setup();
        P.writeImportLabel(site, work, '0.7.0');
        assert.equal(P.isProject(work), false);
        assert.equal(S.originalOf(work), site);
        assert.equal(S.workRoot(site), work);
        assert.deepEqual(S.findSites(path.dirname(site)), [site], 'listed once, by the original');
    });

    it('is written once: labelling again keeps the first label', () => {
        const { site, work } = setup();
        P.writeImportLabel(site, work, '0.7.0');
        const first = fs.readFileSync(path.join(work, P.PROJECT_FILE), 'utf8');
        P.writeImportLabel(site, work, '9.9.9');
        assert.equal(fs.readFileSync(path.join(work, P.PROJECT_FILE), 'utf8'), first);
    });

    it('opens nothing once the original is gone', () => {
        const { site, work } = setup();
        const file = P.writeImportLabel(site, work, '0.7.0');
        fs.rmSync(site, { recursive: true });
        assert.equal(P.projectRootOf(file), null);
    });
});

describe('a saved project is ONE site', () => {
    const setup = () => {
        const parent = tmp();
        const root = path.join(parent, 'Birthdays');
        fs.mkdirSync(root);
        P.writeProject(root, 'Birthdays', drawn(), H, '0.5.0');
        fs.mkdirSync(path.join(root, 'Birthdays-prod'));
        fs.writeFileSync(path.join(root, 'Birthdays-prod', 'index.html'), '<h1>published</h1>');
        return { parent, root };
    };

    it('is listed once, by its root - not as -dev and -prod', () => {
        const { parent, root } = setup();
        assert.deepEqual(S.findSites(parent), [root]);
        assert.equal(S.isSite(root), true);
    });

    it('edits its own -dev, inside it', () => {
        const { root } = setup();
        assert.equal(S.workRoot(root), path.join(root, 'Birthdays-dev'));
        assert.equal(S.hasWorkingCopy(root), true);
        assert.deepEqual(S.listPages(S.workRoot(root)), ['index.html', 'about.html']);
    });

    it('choosing its -dev or -prod folder means the project', () => {
        const { root } = setup();
        assert.equal(S.originalOf(path.join(root, 'Birthdays-dev')), root);
        assert.equal(S.originalOf(path.join(root, 'Birthdays-prod')), root);
    });

    it('has no original to follow', () => {
        const { root } = setup();
        fs.writeFileSync(path.join(root, 'stray.html'), '<p>not the site</p>');
        assert.deepEqual(S.originalChanges(root), []);
    });
});

describe('stripDraw2Code: a page with Draw2Code taken out', () => {
    const page = [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <title>About</title>',
        '  <!-- Generated by Draw2Code Web Editor -->',
        '  <link rel="stylesheet" href="css/style.css">',
        '  <link rel="stylesheet" href="draw2code/about.css">',
        '</head>',
        '<body>',
        '  <div data-d2c="3" class="card"><p id="lead" data-d2c="4">Hi</p></div>',
        '</body>',
        '</html>',
    ].join('\n');
    const out = PE.stripDraw2Code(page, 'page-about');

    it('a marker becomes an ordinary id, and says which', () => {
        assert.match(out.html, /<div id="div-3" class="card">/);
        assert.equal(out.idsFor['3'], 'div-3');
    });

    it('an element that already has an id just loses the marker', () => {
        assert.match(out.html, /<p id="lead">Hi<\/p>/);
        assert.equal(out.idsFor['4'], 'lead');
    });

    it('drops Draw2Code\'s stylesheet link and its comment, and keeps the site\'s own', () => {
        assert.doesNotMatch(out.html, /draw2code\//i);
        assert.doesNotMatch(out.html, /Draw2Code/);
        assert.doesNotMatch(out.html, /data-d2c/);
        assert.match(out.html, /<link rel="stylesheet" href="css\/style.css">\n<\/head>/);
    });

    it('gives <body> its page class, or adds to the classes it has', () => {
        assert.match(out.html, /<body class="page-about">/);
        assert.match(PE.stripDraw2Code('<html><body class="dark"></body></html>', 'page-x').html, /<body class="dark page-x">/);
        assert.match(PE.stripDraw2Code('<html><body class="page-x"></body></html>', 'page-x').html, /<body class="page-x">/);
    });

    it('a new id never collides with one the page already uses', () => {
        const r = PE.stripDraw2Code('<html><body><div id="div-1"></div><div data-d2c="1"></div></body></html>', 'page-x');
        assert.equal(r.idsFor['1'], 'div-2');
    });

    it('a link Draw2Code made keeps its href but not what it remembers', () => {
        const r = PE.stripDraw2Code('<html><body><a id="go" data-d2c-was="button type=&quot;button&quot;" href="about.html" data-d2c-looks="cursor: pointer">Go</a></body></html>', 'page-x');
        assert.match(r.html, /<a id="go" href="about.html">Go<\/a>/);
    });
});

describe('buildProd: Publish for a saved project', () => {
    const setup = () => {
        const root = path.join(tmp(), 'Shop');
        fs.mkdirSync(root);
        P.writeProject(root, 'Shop', drawn(), H, '0.5.0');
        const dev = path.join(root, 'Shop-dev');
        // edits made in the editor: a nudge on a generated element, a colour on
        // an element that had no id (marker), and a page added by +
        E.applyEdit(dev, 'index.html', { op: 'style', ref: { id: 'rect-1' }, declarations: { position: 'relative', left: '12px' } });
        fs.writeFileSync(path.join(dev, 'index.html'), fs.readFileSync(path.join(dev, 'index.html'), 'utf8').replace('<div class="page">', '<div class="page"><p>no id here</p>'));
        E.applyEdit(dev, 'index.html', { op: 'style', ref: { path: [0, 0] }, declarations: { color: '#ff0000' } });
        fs.writeFileSync(path.join(dev, 'page2.html'), PE.newPageFrom(fs.readFileSync(path.join(dev, 'index.html'), 'utf8'), 'Birthdays'));
        fs.writeFileSync(path.join(dev, 'logo.txt'), 'an asset');
        // and the about page's button made a link, its look kept
        E.applyEdit(dev, 'about.html', { op: 'link', ref: { id: 'button-1' }, href: 'index.html', declarations: { cursor: 'pointer' } });
        return { root, dev, prod: path.join(root, 'Shop-prod') };
    };
    const everyFile = (dir) => { const out = []; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else out.push(path.relative(dir, f).split(path.sep).join('/')); } }; walk(dir); return out.sort(); };

    it('every published page asks a phone for the width the project has now', () => {
        const { root, dev, prod } = setup();
        const label = path.join(root, '.draw2code', 'project.d2c');
        P.buildProd(root);
        for (const name of ['index.html', 'about.html', 'page2.html']) {
            assert.match(fs.readFileSync(path.join(prod, name), 'utf8'), /<meta name="viewport" content="width=1440">/, name);
        }
        // The width changed since the pages were made; and a page from before pages had one.
        fs.writeFileSync(label, JSON.stringify({ ...JSON.parse(fs.readFileSync(label, 'utf8')), pageWidth: 1200 }));
        const about = path.join(dev, 'about.html');
        fs.writeFileSync(about, fs.readFileSync(about, 'utf8').replace('content="width=1440"', 'content="width=device-width, initial-scale=1.0"'));
        P.buildProd(root);
        for (const name of ['index.html', 'about.html', 'page2.html']) {
            assert.match(fs.readFileSync(path.join(prod, name), 'utf8'), /<meta name="viewport" content="width=1200">/, name);
        }
        assert.match(fs.readFileSync(path.join(dev, 'index.html'), 'utf8'), /content="width=1440"/, '-dev is left as it is');
    });

    it('the published pages and files carry no trace of Draw2Code', () => {
        const { root, prod } = setup();
        const result = P.buildProd(root);
        assert.equal(result.prod, prod);
        assert.deepEqual(result.pages.sort(), ['about.html', 'index.html', 'page2.html']);
        const files = everyFile(prod);
        assert.deepEqual(files, ['about.html', 'css/style.css', 'index.html', 'logo.txt', 'page2.html']);
        for (const f of files) {
            const text = fs.readFileSync(path.join(prod, f), 'utf8');
            assert.doesNotMatch(text, /Draw2Code|data-d2c|draw2code\//i, `${f} still mentions Draw2Code`);
        }
    });

    it('a button made a link is published as a plain link, without the tag it remembers', () => {
        const { root, dev, prod } = setup();
        assert.match(fs.readFileSync(path.join(dev, 'about.html'), 'utf8'), /data-d2c-was="button/);
        P.buildProd(root);
        const html = fs.readFileSync(path.join(prod, 'about.html'), 'utf8');
        assert.match(html, /<a href="index.html" id="button-1">/);
        assert.doesNotMatch(html, /data-d2c/);
    });

    it('holds only the site: no .draw2code folder', () => {
        const { root, dev, prod } = setup();
        assert.equal(fs.existsSync(path.join(dev, '.draw2code', 'overrides.json')), true, '-dev has its state');
        P.buildProd(root);
        assert.equal(fs.existsSync(path.join(prod, '.draw2code')), false);
        assert.deepEqual(everyFile(prod).filter((f) => f.includes('.draw2code')), []);
    });

    it('a -prod an older Publish left with a .draw2code folder loses it', () => {
        const { root, prod } = setup();
        fs.mkdirSync(path.join(prod, '.draw2code'), { recursive: true });
        fs.writeFileSync(path.join(prod, '.draw2code', 'overrides.json'), '{}');
        fs.writeFileSync(path.join(prod, '.draw2code', '.gitignore'), '*\n');
        P.buildProd(root);
        assert.equal(fs.existsSync(path.join(prod, '.draw2code')), false);
    });

    it('moves every page\'s rules into the shared stylesheet, scoped to the page', () => {
        const { root, prod } = setup();
        P.buildProd(root);
        const css = fs.readFileSync(path.join(prod, 'css', 'style.css'), 'utf8');
        assert.match(css, /\.page-index #rect-1 \{\n  position: relative;\n  left: 12px;\n\}/);
        const html = fs.readFileSync(path.join(prod, 'index.html'), 'utf8');
        const id = /<p id="([^"]+)">no id here<\/p>/.exec(html)[1];
        assert.match(css, new RegExp(`\\.page-index #${id} \\{\\n  color: #ff0000;`), 'the marker rule follows the element to its new id');
        assert.match(css, /:where\(\.page-about\) #button-1 \{/, 'the generated rules are still there');
    });

    it('a page + made gets its page class and still reaches the stylesheet', () => {
        const { root, prod } = setup();
        P.buildProd(root);
        const html = fs.readFileSync(path.join(prod, 'page2.html'), 'utf8');
        assert.match(html, /<body class="page-page2">/);
        assert.match(html, /href="css\/style.css"/);
    });

    it('is rebuilt from scratch each time', () => {
        const { root, prod, dev } = setup();
        P.buildProd(root);
        fs.writeFileSync(path.join(prod, 'stale.html'), 'left over');
        fs.rmSync(path.join(dev, 'logo.txt'));
        P.buildProd(root);
        assert.equal(fs.existsSync(path.join(prod, 'stale.html')), false);
        assert.equal(fs.existsSync(path.join(prod, 'logo.txt')), false);
    });

    it('never touches -dev', () => {
        const { root, dev } = setup();
        const before = everyFile(dev).map((f) => f + ':' + fs.readFileSync(path.join(dev, f), 'utf8').length).join('|');
        P.buildProd(root);
        assert.equal(everyFile(dev).map((f) => f + ':' + fs.readFileSync(path.join(dev, f), 'utf8').length).join('|'), before);
    });

    it('refuses a folder that is not a saved project', () => {
        assert.throws(() => P.buildProd(tmp()), /not a project Draw2Code made/);
    });

    it('uses the same page class as the generator', () => {
        for (const name of ['index.html', 'about.html', 'blog/My Post.html', '', 'page2.htm']) {
            assert.equal(P.pageScope(name), H.pageScope(name), name);
        }
    });
});
