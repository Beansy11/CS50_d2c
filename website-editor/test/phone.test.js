// Unit tests for a page's phone layout as it is kept: the second overrides
// map (pageEditor.ts phoneKey), written in one @media block of the page's
// Draw2Code stylesheet, and carried through every edit that changes a
// page's rules - remove, revert, a section named, a link taken away, undo,
// held edits, copy and paste - and through Publish (compiled to out/ by
// npm test's pretest).
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
const C = require('../../out/website-editor/src/copyPaste.js');
const P = require('../../out/website-editor/src/pageEdit.js');
const E = require('../../out/website-editor/src/pageEditor.js');
const W = require('../../out/website-editor/src/pageWidth.js');
const S = require('../../out/website-editor/src/siteFiles.js');
const SP = require('../../out/website-editor/src/siteProject.js');
const { HeldFiles } = require('../../out/website-editor/src/heldFiles.js');
const M = require('../media/model.js');
const H = require('../media/generators/html.js');

// A project of two pages made in Draw2Code: two rectangles and a button on
// the home page, nothing yet on about.html.
const DESIGN = {
    version: 2,
    pages: [
        { name: 'index.html', title: 'Home', color: '#ffffff', open: true, elements: [
            M.createElement(1, 'rect', { x: 0, y: 0, w: 1440, h: 400 }, M.DEFAULT_STYLE),
            M.createElement(2, 'rect', { x: 100, y: 100, w: 200, h: 80 }, M.DEFAULT_STYLE),
            M.createElement(1, 'button', { x: 1200, y: 40, w: 160, h: 48 }, M.WIDGET_DEFAULTS.button),
        ] },
        { name: 'about.html', title: 'About', color: '#ffffff', elements: [] },
    ],
};
const PHONE = {
    '#rect-1': { left: '0px', top: '0px', width: '390px', height: '600px' },
    '#rect-2': { left: '16px', top: '120px', width: '358px' },
    '#button-1': { left: '16px', top: '520px' },
    '#button-1:hover': { color: 'red' },
};

function makeProject() {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-phone-'));
    const out = H.generateProject(DESIGN);
    fs.mkdirSync(path.join(work, 'css'), { recursive: true });
    fs.writeFileSync(path.join(work, out.cssPath), out.css);
    for (const page of out.pages) fs.writeFileSync(path.join(work, page.name), page.html);
    return work;
}
const read = (work, file) => fs.readFileSync(path.join(work, file), 'utf8');
const store = (work, io) => E.readOverrides(work, io);
/** A project whose home page has a phone layout, and a rule of its own for rect-2. */
function withPhone(phone = PHONE) {
    const work = makeProject();
    E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'rect-2' }, declarations: { left: '120px' } });
    const result = E.applyEdit(work, 'index.html', { op: 'phoneLayout', ref: {}, phone });
    assert.equal(result.error, undefined);
    return work;
}
const MEDIA = `@media (max-width: ${M.PHONE_BREAKPOINT}px) {`;

describe('the phone layout\'s constants in the extension', () => {
    it('are the model\'s', () => {
        assert.equal(W.PHONE_BREAKPOINT, M.PHONE_BREAKPOINT);
        assert.equal(W.PHONE_LAYOUT_CLASS, M.PHONE_LAYOUT_CLASS);
        assert.equal(E.phoneKey('pages/about.html'), `pages/about.html${S.PHONE_MAP_SUFFIX}`);
        assert.equal(S.PHONE_MAP_SUFFIX, '@phone');
        assert.equal(S.isPage(E.phoneKey('index.html')), false, 'never taken for a page');
    });
});

describe('renderOverrides: the page\'s rules, then its phone layout\'s', () => {
    const BASE = '  html.has-phone-layout body {\n    min-width: 0;\n  }\n\n  html.has-phone-layout .page {\n    width: 100%;\n  }\n\n'
        + '  html.has-phone-layout .page > svg > * {\n    vector-effect: non-scaling-stroke;\n  }';
    it('writes the phone block\'s own rules, then the phone rules, last, in one @media block; nothing for no phone layout', () => {
        const desktop = { '#a': { left: '10px' } };
        const head = '/* Written by Draw2Code Web Editor. Edit the design, not this file. */\n\n#a {\n  left: 10px;\n}\n';
        assert.equal(P.renderOverrides(desktop), P.renderOverrides(desktop, undefined));
        assert.equal(P.renderOverrides(desktop), head);
        assert.equal(P.renderOverrides(desktop, {}), `${head}\n${MEDIA}\n${BASE}\n}\n`, 'an empty phone layout: the window\'s width only');
        assert.equal(P.renderOverrides(desktop, { '#b': {} }), P.renderOverrides(desktop, {}), 'a rule that says nothing writes nothing');
        assert.equal(P.renderOverrides(desktop, { '#a': { left: '0px' }, '#a:hover': { color: 'red' } }),
            `${head}\n${MEDIA}\n${BASE}\n\n  #a {\n    left: 0px;\n  }\n\n  #a:hover {\n    color: red;\n  }\n}\n`);
    });

    it('the phone block\'s own rules are the generator\'s, rule for rule', () => {
        const block = (css) => {
            const from = css.slice(css.indexOf(MEDIA));
            return from.slice(0, from.indexOf('\n}') + 2).split('\n').filter((line) => line.trim()).join('\n');
        };
        const generated = block(H.generateSite(DESIGN).css);
        assert.match(generated, /html\.has-phone-layout \.page > svg > \*/);
        assert.equal(block(P.phoneBlock(P.ruleBlocks(P.PHONE_BASE))[0]), generated);
    });
});

describe('setPhoneLayout: the class and the viewport', () => {
    const generated = H.generate(M.makeDesign([{ ...M.makePage('index.html'), elements: [] }], 'index.html'));

    it('gives <html> the class and asks for the phone\'s own width; taking it away leaves the viewport for Publish', () => {
        const on = P.setPhoneLayout(generated, true);
        assert.equal(on.changed, true);
        assert.match(on.html, new RegExp(`<html lang="en" class="${M.PHONE_LAYOUT_CLASS}">`));
        assert.match(on.html, /<meta name="viewport" content="width=device-width, initial-scale=1\.0">/);
        assert.equal(P.hasPhoneLayout(on.html), true);
        assert.deepEqual(P.setPhoneLayout(on.html, true), { html: on.html, changed: false });
        const off = P.setPhoneLayout(on.html, false);
        assert.equal(off.html, generated.replace('content="width=1440"', `content="${P.PHONE_VIEWPORT}"`));
        assert.equal(P.hasPhoneLayout(off.html), false);
        assert.equal(W.setViewportWidth(off.html, 1440), generated, 'Publish puts the page width back');
    });

    it('keeps the page\'s other classes, and adds a viewport where there is none', () => {
        const page = '<!DOCTYPE html>\n<html class="dark"><head><title>x</title></head><body></body></html>';
        const on = P.setPhoneLayout(page, true).html;
        assert.match(on, /<html class="dark has-phone-layout">/);
        assert.match(on, /<head>\n  <meta name="viewport" content="width=device-width, initial-scale=1\.0"><title>/);
        assert.match(P.setPhoneLayout(on, false).html, /<html class="dark">/);
    });
});

describe('applyEdit phoneLayout: giving a page one and taking it away', () => {
    it('keeps the map beside the page\'s rules, writes it after them, and marks the page', () => {
        const work = withPhone();
        const s = store(work);
        assert.deepEqual(s['index.html@phone'], PHONE);
        assert.deepEqual(s['index.html'], { '#rect-2': { left: '120px' } }, 'the desktop rules are left as they were');
        const css = read(work, 'draw2code/index.css');
        assert.ok(css.indexOf('#rect-2 {\n  left: 120px;') < css.indexOf(MEDIA));
        assert.match(css, /\n {2}#rect-2 \{\n {4}left: 16px;\n {4}top: 120px;\n {4}width: 358px;\n {2}\}/);
        const html = read(work, 'index.html');
        assert.equal(P.hasPhoneLayout(html), true);
        assert.match(html, /href="draw2code\/index\.css"/);
        assert.equal(P.hasPhoneLayout(read(work, 'about.html')), false, 'one page at a time');
    });

    it('an empty phone layout is still one: the page keeps its class, with nothing in the @media block', () => {
        const work = makeProject();
        E.applyEdit(work, 'about.html', { op: 'phoneLayout', ref: {}, phone: {} });
        assert.deepEqual(store(work)['about.html@phone'], {});
        assert.equal(P.hasPhoneLayout(read(work, 'about.html')), true);
        const css = read(work, 'draw2code/about.css');
        assert.doesNotMatch(css.slice(css.indexOf(MEDIA)), /#/, 'only the phone block\'s own rules');
    });

    it('taking it away takes its rules, its block and the class, and keeps the desktop rules', () => {
        const work = withPhone();
        E.applyEdit(work, 'index.html', { op: 'phoneLayout', ref: {}, phone: null });
        assert.equal(store(work)['index.html@phone'], undefined);
        assert.deepEqual(store(work)['index.html'], { '#rect-2': { left: '120px' } });
        assert.doesNotMatch(read(work, 'draw2code/index.css'), /@media/);
        assert.equal(P.hasPhoneLayout(read(work, 'index.html')), false);
    });
});

describe('every edit of a page with a phone layout keeps it', () => {
    it('a style edit changes the desktop rules and leaves the phone layout\'s', () => {
        const work = withPhone();
        E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'rect-1' }, declarations: { background: 'blue' } });
        assert.deepEqual(store(work)['index.html@phone'], PHONE);
        const css = read(work, 'draw2code/index.css');
        assert.ok(css.indexOf('\n  #rect-1 {') > css.indexOf(MEDIA) && css.indexOf(MEDIA) > css.indexOf('background: blue'), 'the phone rules in their block, after the page\'s');
    });

    it('remove: the element\'s rules go from both maps, its :hover too; the others stay', () => {
        const work = withPhone();
        E.applyEdit(work, 'index.html', { op: 'remove', ref: { id: 'button-1' } });
        const phone = store(work)['index.html@phone'];
        assert.deepEqual(Object.keys(phone), ['#rect-1', '#rect-2']);
        assert.doesNotMatch(read(work, 'draw2code/index.css'), /button-1/);
    });

    it('remove: an element with phone rules only still takes them with it', () => {
        const work = makeProject();
        E.applyEdit(work, 'index.html', { op: 'phoneLayout', ref: {}, phone: { '#button-1': { top: '1px' } } });
        const result = E.applyEdit(work, 'index.html', { op: 'remove', ref: { id: 'button-1' } });
        assert.ok(result.changed.some((file) => file.endsWith('overrides.json')));
        assert.deepEqual(store(work)['index.html@phone'], {}, 'the page keeps its phone layout, empty');
        assert.equal(P.hasPhoneLayout(read(work, 'index.html')), true);
    });

    it('revert element: back as the page had it, in the phone layout too', () => {
        const work = withPhone();
        E.applyEdit(work, 'index.html', { op: 'revert', ref: { id: 'rect-2' } });
        assert.equal(store(work)['index.html']['#rect-2'], undefined);
        assert.equal(store(work)['index.html@phone']['#rect-2'], undefined);
        assert.ok(store(work)['index.html@phone']['#rect-1'], 'the others stay');
    });

    it('revert element: every rule of it goes from both maps, its link stays; #button-10\'s stay; undo puts them back', () => {
        const work = makeProject();
        const file = path.join(work, 'index.html');
        fs.writeFileSync(file, read(work, 'index.html').replace('<div class="page">', '<div class="page"><button id="button-10">Go</button>'));
        E.applyEdit(work, 'index.html', { op: 'link', ref: { id: 'button-1' }, href: 'about.html', declarations: { cursor: 'pointer' } });
        E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'button-1' }, declarations: { color: 'red' },
            extraRules: [{ selector: '#button-1:hover', declarations: { opacity: '0.9' } }, { selector: '#button-1::placeholder', declarations: { color: '#999' } }],
            childDeclarations: { margin: '0px' } });
        E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'button-10' }, declarations: { width: '80px' },
            extraRules: [{ selector: '#button-10:hover', declarations: { opacity: '0.5' } }] });
        E.applyEdit(work, 'index.html', { op: 'phoneLayout', ref: {}, phone: {
            '#button-1': { top: '1px' }, '#button-1:hover': { color: 'blue' }, '#button-10': { top: '2px' }, '#button-10:hover': { color: 'green' },
        } });
        const rules = store(work)['index.html'];
        const phoneRules = store(work)['index.html@phone'];
        assert.deepEqual(Object.keys(rules).sort(),
            ['#button-1', '#button-1 > *', '#button-1::placeholder', '#button-1:hover', '#button-10', '#button-10:hover'].sort(), 'every rule is there first');
        const before = E.snapshotPage(work, 'index.html');

        assert.equal(E.applyEdit(work, 'index.html', { op: 'revert', ref: { id: 'button-1' } }).error, undefined);
        assert.deepEqual(store(work)['index.html'], { '#button-10': { width: '80px' }, '#button-10:hover': { opacity: '0.5' } });
        assert.deepEqual(store(work)['index.html@phone'], { '#button-10': { top: '2px' }, '#button-10:hover': { color: 'green' } });
        assert.doesNotMatch(read(work, 'draw2code/index.css'), /#button-1[ :{]/);
        assert.match(read(work, 'index.html'), /href="about\.html"/, 'the link stays');

        E.restorePage(work, before);
        assert.deepEqual(store(work)['index.html'], rules);
        assert.deepEqual(store(work)['index.html@phone'], phoneRules);
        assert.match(read(work, 'draw2code/index.css'), /#button-1:hover \{/);
    });

    it('revert page: every rule goes, the phone layout with them', () => {
        const work = withPhone();
        E.applyEdit(work, 'index.html', { op: 'revertPage', ref: {} });
        assert.equal(store(work)['index.html'], undefined);
        assert.equal(store(work)['index.html@phone'], undefined);
        assert.equal(P.hasPhoneLayout(read(work, 'index.html')), false);
        assert.doesNotMatch(read(work, 'draw2code/index.css'), /@media|#rect/);
    });

    it('naming a section moves its phone rules to its id with the rest', () => {
        const work = makeProject();
        const file = path.join(work, 'index.html');
        fs.writeFileSync(file, read(work, 'index.html').replace('<div class="page">', '<div class="page"><p>no id here</p>'));
        const marked = E.applyEdit(work, 'index.html', { op: 'style', ref: { path: [0, 0] }, declarations: { color: 'red' } });
        const marker = marked.selector;
        assert.match(marker, /^\[data-d2c="\d+"\]$/);
        E.applyEdit(work, 'index.html', { op: 'phoneLayout', ref: {}, phone: { [marker]: { top: '5px' }, [`${marker}:hover`]: { color: 'blue' } } });
        const linked = E.applyEdit(work, 'index.html', { op: 'link', ref: { id: 'button-1' }, href: '#intro', anchor: { path: [0, 0] }, declarations: {} });
        assert.equal(linked.error, undefined);
        assert.deepEqual(store(work)['index.html@phone'], { '#intro': { top: '5px' }, '#intro:hover': { color: 'blue' } });
        assert.deepEqual(store(work)['index.html'], { '#intro': { color: 'red' } });
        assert.match(read(work, 'draw2code/index.css'), /\n {2}#intro \{\n {4}top: 5px;/);
    });

    it('taking a link away keeps the stylesheet while the phone layout still has rules', () => {
        const work = makeProject();
        E.applyEdit(work, 'index.html', { op: 'link', ref: { id: 'button-1' }, href: 'about.html', declarations: { cursor: 'pointer' } });
        E.applyEdit(work, 'index.html', { op: 'phoneLayout', ref: {}, phone: { '#rect-1': { top: '0px' } } });
        E.applyEdit(work, 'index.html', { op: 'link', ref: { id: 'button-1' }, href: '' });
        assert.match(read(work, 'index.html'), /href="draw2code\/index\.css"/);
        assert.match(read(work, 'draw2code/index.css'), /@media/);
    });
});

describe('undo: a snapshot holds the phone layout', () => {
    it('puts back the map, its block and the class; and takes away one the page did not have', () => {
        const work = withPhone();
        const before = E.snapshotPage(work, 'index.html');
        assert.deepEqual(before.phone, PHONE);
        E.applyEdit(work, 'index.html', { op: 'remove', ref: { id: 'button-1' } });
        E.restorePage(work, before);
        assert.deepEqual(store(work)['index.html@phone'], PHONE);
        assert.match(read(work, 'draw2code/index.css'), /button-1:hover/);

        const plain = makeProject();
        const none = E.snapshotPage(plain, 'index.html');
        assert.equal('phone' in none, false);
        E.applyEdit(plain, 'index.html', { op: 'phoneLayout', ref: {}, phone: PHONE });
        E.restorePage(plain, none);
        assert.equal(store(plain)['index.html@phone'], undefined);
        assert.equal(P.hasPhoneLayout(read(plain, 'index.html')), false);
        assert.doesNotMatch(read(plain, 'draw2code/index.css'), /@media/);
    });

    it('a batch that is refused puts the phone layout back', () => {
        const work = withPhone();
        const result = E.applyEdit(work, 'index.html', { op: 'batch', ref: {}, ops: [
            { op: 'remove', ref: { id: 'button-1' } },
            { op: 'remove', ref: { id: 'nothing-here' } },
        ] });
        assert.ok(result.error);
        assert.deepEqual(store(work)['index.html@phone'], PHONE);
    });

    it('a page taken away takes its phone layout too', () => {
        const work = withPhone();
        E.restorePage(work, E.absentPage('index.html'));
        assert.equal(store(work)['index.html@phone'], undefined);
    });
});

describe('held edits: a phone layout not saved yet', () => {
    it('is the page\'s unsaved edit, and dropping the page\'s edits puts back the saved one', () => {
        const work = withPhone();
        const held = new HeldFiles(work);
        assert.equal(E.pageIsHeld(work, 'index.html', held), false);
        // Only the phone layout changes: the store is held, the page's file and stylesheet too.
        E.applyEdit(work, 'index.html', { op: 'phoneLayout', ref: {}, phone: { '#rect-1': { top: '9px' } } }, held);
        assert.equal(E.pageIsHeld(work, 'index.html', held), true);
        assert.deepEqual(store(work)['index.html@phone'], PHONE, 'nothing reaches the copy until Save');
        held.forget(path.join(work, 'index.html'));
        held.forget(path.join(work, 'draw2code', 'index.css'));
        assert.equal(E.pageIsHeld(work, 'index.html', held), true, 'the map alone counts');
        E.dropHeldPage(work, 'index.html', held);
        assert.deepEqual(store(work, held)['index.html@phone'], PHONE);
        assert.equal(E.pageIsHeld(work, 'index.html', held), false);
    });

    it('the held stylesheet is the one with the @media block', () => {
        const work = makeProject();
        const held = new HeldFiles(work);
        held.register();
        try {
            E.applyEdit(work, 'index.html', { op: 'phoneLayout', ref: {}, phone: PHONE }, held);
            const sheets = E.heldStylesheet(work, 'index.html');
            assert.equal(sheets.length, 1);
            assert.match(sheets[0].css, /@media \(max-width: 767px\)/);
        } finally {
            held.unregister();
        }
    });
});

describe('copy and paste: an element\'s phone rules go with it', () => {
    /** What DesignerPanel.onCopy keeps: the rules of both maps, from Draw2Code's own for the phone layout. */
    function copy(work, page, items) {
        const html = read(work, page);
        const all = store(work);
        const overrides = all[page] ?? {};
        const phone = all[E.phoneKey(page)];
        const sheets = [{ dir: 'css', css: read(work, 'css/style.css') }];
        const styles = { sheets, overrides, overridesDir: 'draw2code', scopes: P.bodyClasses(html) };
        const ruled = (selector) => [overrides, phone ?? {}].some((rules) => Object.keys(rules).some((rule) => rule.startsWith(selector)));
        return { page, overridesDir: 'draw2code', pasted: {}, items: items.map((item) => {
            const copied = P.copyElement(html, item.ref, ruled);
            return { ...copied, rules: C.copiedRules(copied, styles), box: item.box, full: false,
                ...(phone ? { phoneRules: C.copiedRules(copied, { ...styles, sheets: [], overrides: phone }) } : {}) };
        }) };
    }
    function paste(work, clip, page, offset) {
        const html = read(work, page);
        const pasted = C.pasteElements(clip, { page, taken: P.usedIds(html), inWrapper: P.placesInWrapper(html), wrapper: { x: 0, y: 0 }, overridesDir: 'draw2code' }, offset);
        const ops = pasted.map((one) => ({ op: 'add', ref: { id: one.id }, markup: one.markup, declarations: one.declarations, extraRules: one.extraRules, phoneRules: one.phoneRules }));
        return { pasted, result: E.applyEdit(work, page, { op: 'batch', ref: {}, label: 'Paste', ops }) };
    }
    const BUTTON = { ref: { id: 'button-1' }, box: { x: 1200, y: 40, w: 160, h: 48 } };

    it('copies them under the element\'s own selector, its :hover too', () => {
        const clip = copy(withPhone(), 'index.html', [BUTTON]);
        assert.deepEqual(clip.items[0].phoneRules, [{ '': { left: '16px', top: '520px' }, ':hover': { color: 'red' } }]);
        assert.equal('phoneRules' in copy(makeProject(), 'index.html', [BUTTON]).items[0], false, 'a page with none copies none');
    });

    it('a paste on the same page moves the copy as far in the phone layout as on the page', () => {
        const work = withPhone();
        const { pasted, result } = paste(work, copy(work, 'index.html', [BUTTON]), 'index.html', 16);
        assert.equal(result.error, undefined);
        assert.equal(pasted[0].id, 'button-2');
        const phone = store(work)['index.html@phone'];
        assert.deepEqual(phone['#button-2'], { left: '32px', top: '536px' });
        assert.deepEqual(phone['#button-2:hover'], { color: 'red' });
        assert.deepEqual(phone['#button-1'], PHONE['#button-1'], 'the original stays');
    });

    it('a page with no phone layout takes the copy without its phone rules', () => {
        const work = withPhone();
        const { result } = paste(work, copy(work, 'index.html', [BUTTON]), 'about.html', 0);
        assert.equal(result.error, undefined);
        assert.equal(store(work)['about.html@phone'], undefined);
        assert.equal(P.hasPhoneLayout(read(work, 'about.html')), false);
        assert.doesNotMatch(read(work, 'draw2code/about.css'), /@media/);
    });

    it('another page with a phone layout takes them', () => {
        const work = withPhone();
        E.applyEdit(work, 'about.html', { op: 'phoneLayout', ref: {}, phone: {} });
        paste(work, copy(work, 'index.html', [BUTTON]), 'about.html', 0);
        assert.deepEqual(store(work)['about.html@phone'], { '#button-1': { left: '16px', top: '520px' }, '#button-1:hover': { color: 'red' } });
    });
});

describe('Publish: the phone layout in the shared stylesheet', () => {
    it('moves it after the page\'s own rules, in one @media block, scoped to the page', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-phone-prod-'));
        const dev = path.join(root, 'Shop-dev');
        fs.renameSync(withPhone(), dev);
        const { prod } = SP.buildSiteProd(dev, path.join(root, 'Shop-prod'), 'css/style.css', 1440);
        const css = fs.readFileSync(path.join(prod, 'css', 'style.css'), 'utf8');
        const own = css.indexOf('.page-index #rect-2 {\n  left: 120px;');
        const media = css.lastIndexOf(MEDIA);
        assert.ok(own > 0 && media > own, 'after the page\'s own rules');
        assert.equal(css.split('left: 120px;').length, 2, 'the desktop rule once, outside the block');
        assert.match(css.slice(media), /^@media \(max-width: 767px\) \{\n {2}\.page-index #rect-1 \{\n {4}left: 0px;/);
        assert.match(css.slice(media), /\n {2}\.page-index #button-1:hover \{\n {4}color: red;\n {2}\}\n\}/);
        const html = fs.readFileSync(path.join(prod, 'index.html'), 'utf8');
        assert.equal(P.hasPhoneLayout(html), true, 'the class stays: the shared phone rules wait for it');
        assert.match(html, /content="width=device-width, initial-scale=1\.0"/, 'a page with a phone layout keeps the phone\'s width');
        assert.match(fs.readFileSync(path.join(prod, 'about.html'), 'utf8'), /content="width=1440"/);
    });

    it('a marker selector in the phone layout points at the id the element was given', () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-phone-prod-'));
        const dev = path.join(root, 'Shop-dev');
        fs.renameSync(makeProject(), dev);
        fs.writeFileSync(path.join(dev, 'index.html'), read(dev, 'index.html').replace('<div class="page">', '<div class="page"><p>no id here</p>'));
        const marker = E.applyEdit(dev, 'index.html', { op: 'style', ref: { path: [0, 0] }, declarations: { color: 'red' } }).selector;
        E.applyEdit(dev, 'index.html', { op: 'phoneLayout', ref: {}, phone: { [marker]: { top: '5px' } } });
        const { prod } = SP.buildSiteProd(dev, path.join(root, 'Shop-prod'), 'css/style.css', 1440);
        const css = fs.readFileSync(path.join(prod, 'css', 'style.css'), 'utf8');
        const id = /<p id="([^"]+)">no id here/.exec(fs.readFileSync(path.join(prod, 'index.html'), 'utf8'))[1];
        assert.match(css, new RegExp(`\\n {2}\\.page-index #${id} \\{\\n {4}top: 5px;`));
        assert.doesNotMatch(css, /data-d2c/);
    });

    it('a stylesheet made before phones gets the phone block once; one that has it, not again; a site with no phone layout, never', () => {
        const build = (sheet, phone) => {
            const root = fs.mkdtempSync(path.join(os.tmpdir(), 'd2c-phone-prod-'));
            const dev = path.join(root, 'Shop-dev');
            fs.renameSync(phone ? withPhone() : makeProject(), dev);
            if (sheet !== null) fs.writeFileSync(path.join(dev, 'css', 'style.css'), sheet);
            const { prod } = SP.buildSiteProd(dev, path.join(root, 'Shop-prod'), 'css/style.css', 1440);
            return fs.readFileSync(path.join(prod, 'css', 'style.css'), 'utf8');
        };
        const old = 'body {\n  min-width: max-content;\n}\n';
        const count = (css) => css.split('html.has-phone-layout body {').length - 1;
        const upgraded = build(old, true);
        assert.equal(count(upgraded), 1);
        assert.ok(upgraded.indexOf('html.has-phone-layout body {') < upgraded.indexOf('.page-index #rect-1 {', upgraded.indexOf(MEDIA)), 'before the page\'s phone rules');
        assert.equal(count(build(null, true)), 1, 'the generator\'s own sheet has it already');
        assert.equal(count(build(old, false)), 0);
    });
});

describe('held edits: undo of a page\'s first phone layout leaves nothing to save', () => {
    it('takes the stylesheet and the store it made away again', () => {
        const work = makeProject();
        const held = new HeldFiles(work);
        const before = E.snapshotPage(work, 'about.html', held);
        E.applyEdit(work, 'about.html', { op: 'phoneLayout', ref: {}, phone: PHONE }, held);
        assert.equal(held.dirty, true);
        E.restorePage(work, before, held);
        assert.equal(held.exists(path.join(work, 'draw2code', 'about.css')), false);
        assert.equal(held.read(path.join(work, 'about.html')), read(work, 'about.html'));
        assert.equal(held.exists(E.overridesStore(work)), false);
    });
});

describe('applyEdit phoneLayout: only a map of rules', () => {
    it('refuses anything else and keeps the page', () => {
        const work = makeProject();
        const before = read(work, 'index.html');
        for (const phone of [[], 'x', { '#a': 'left: 0' }, { '#a': { left: 0 } }, { '#a': [] }]) {
            const result = E.applyEdit(work, 'index.html', { op: 'phoneLayout', ref: {}, phone });
            assert.match(result.error, /not a phone layout/, JSON.stringify(phone));
        }
        assert.equal(read(work, 'index.html'), before);
        assert.equal(store(work)['index.html@phone'], undefined);
    });

    it('a remove that only changes the phone layout adds no empty entry for the page', () => {
        const work = makeProject();
        E.applyEdit(work, 'index.html', { op: 'phoneLayout', ref: {}, phone: { '#button-1': { top: '1px' } } });
        E.applyEdit(work, 'index.html', { op: 'remove', ref: { id: 'button-1' } });
        assert.equal('index.html' in store(work), false);
    });
});

// ---- step 2: the phone view ------------------------------------------------

const D = require('../../out/website-editor/src/phoneDraft.js');

describe('what is per width and what is shared', () => {
    it('moves and sizes, font size, alignment and hidden are per width; the rest is shared', () => {
        assert.deepEqual([...E.PER_WIDTH], ['left', 'top', 'width', 'height', 'min-height', 'font-size', 'text-align', 'justify-content', 'display']);
        assert.deepEqual(E.byWidth({ left: '1px', color: 'red', 'font-size': '20px', 'font-weight': 'bold', 'border-radius': '4px', display: 'none' }),
            { perWidth: { left: '1px', 'font-size': '20px', display: 'none' }, shared: { color: 'red', 'font-weight': 'bold', 'border-radius': '4px' } });
    });

    it('the phone view marks its style and add edits, a batch\'s too, and nothing else', () => {
        const op = E.inPhoneView({ op: 'batch', ref: {}, ops: [{ op: 'style', ref: { id: 'a' } }, { op: 'add', ref: { id: 'b' } }, { op: 'remove', ref: { id: 'c' } }, { op: 'text', ref: { id: 'd' } }] });
        assert.deepEqual(op.ops.map((one) => one.media), ['phone', 'phone', undefined, undefined]);
        assert.equal(E.inPhoneView({ op: 'fullWidth', ref: { id: 'a' } }).media, undefined);
    });
});

describe('applyEdit in the phone view', () => {
    it('a move, a resize and a font size go to the phone layout; a colour to the page\'s own rules', () => {
        const work = withPhone();
        E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'rect-2' }, media: 'phone', declarations: { left: '40px', width: '300px', 'font-size': '18px', background: 'gold' } });
        assert.deepEqual(store(work)['index.html@phone']['#rect-2'], { left: '40px', top: '120px', width: '300px', 'font-size': '18px' });
        assert.deepEqual(store(work)['index.html']['#rect-2'], { left: '120px', background: 'gold' });
    });

    it('a drawing resized there is not drawn again: it is stretched to its phone box', () => {
        const work = withPhone();
        const before = /<svg id="rect-2"[^>]*>/.exec(read(work, 'index.html'))[0];
        assert.match(before, /preserveAspectRatio="none"/, 'stretched since the page has a phone layout');
        E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'rect-2' }, media: 'phone', declarations: { width: '50px', height: '50px' } });
        assert.equal(/<svg id="rect-2"[^>]*>/.exec(read(work, 'index.html'))[0], before);
        E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'rect-2' }, declarations: { width: '50px', height: '50px' } });
        assert.match(/<svg id="rect-2"[^>]*>/.exec(read(work, 'index.html'))[0], /viewBox="0 0 50 50"/, 'at desktop width it is');
    });

    it('an element added there has its place in both layouts; its colour once', () => {
        const work = withPhone();
        const markup = '<button id="button-2">New</button>';
        E.applyEdit(work, 'index.html', { op: 'add', ref: { id: 'button-2' }, markup, media: 'phone', declarations: { left: '16px', top: '700px', width: '120px', color: 'red' } });
        assert.deepEqual(store(work)['index.html']['#button-2'], { left: '16px', top: '700px', width: '120px', color: 'red' });
        assert.deepEqual(store(work)['index.html@phone']['#button-2'], { left: '16px', top: '700px', width: '120px' });
    });

    it('on a page with no phone layout the mark changes nothing: it is a desktop edit', () => {
        const work = makeProject();
        E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'rect-2' }, media: 'phone', declarations: { left: '40px' } });
        assert.deepEqual(store(work)['index.html']['#rect-2'], { left: '40px' });
        assert.equal(store(work)['index.html@phone'], undefined);
    });

    it('Hide on phone is display: none in the phone layout, and showing it again takes that away', () => {
        const work = withPhone();
        E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'button-1' }, media: 'phone', declarations: { display: 'none' } });
        assert.equal(store(work)['index.html@phone']['#button-1'].display, 'none');
        assert.equal(store(work)['index.html']['#button-1'], undefined, 'shown at desktop width');
        assert.deepEqual(E.phoneHidden(store(work), 'index.html'), ['#button-1']);
        assert.match(read(work, 'draw2code/index.css'), /\n {2}#button-1 \{\n {4}left: 16px;\n {4}top: 520px;\n {4}display: none;/);
        E.applyEdit(work, 'index.html', { op: 'style', ref: { id: 'button-1' }, media: 'phone', declarations: { display: '' } });
        assert.deepEqual(E.phoneHidden(store(work), 'index.html'), []);
    });
});

describe('the editor\'s two views of a page with a phone layout', () => {
    const s = {
        'index.html': { '#a': { left: '100px', color: 'red' } },
        'index.html@phone': { '#a': { left: '10px' }, '#b': { display: 'none', top: '5px' }, '#b:hover': { display: 'none' } },
    };

    it('desktop: the page\'s own rules, never the phone layout\'s', () => {
        assert.equal(E.viewStylesheet(s, 'index.html', 'desktop'), P.renderOverrides(s['index.html']));
    });

    it('phone: the phone rules after them, outside any @media block, a hidden element shown faintly', () => {
        const css = E.viewStylesheet(s, 'index.html', 'phone');
        assert.doesNotMatch(css, /@media|display: none/);
        assert.ok(css.indexOf('left: 100px') < css.indexOf('#a {\n  left: 10px;\n}'));
        assert.match(css, new RegExp(`#b \\{\\n {2}top: 5px;\\n {2}opacity: ${E.PHONE_HIDDEN_OPACITY};\\n\\}`));
        assert.deepEqual(E.phoneHidden(s, 'index.html'), ['#b'], 'its own rule, not a :hover');
    });

    it('lays the page out at the phone\'s width, a full-width element as wide as the column', () => {
        const css = E.phoneViewCss(M.PHONE_WIDTH);
        assert.match(css, /^html \{ width: 390px; \}/);
        assert.match(css, /html \.page \{ width: 100%; \}/);
        assert.match(css, /html \.page > \.full-width \{ left: 0 !important; width: 100% !important; \}/);
        assert.match(css, /html body \{ min-width: 0; \}/);
    });

    it('the desktop view takes the class away, and only the class', () => {
        const page = '<!DOCTYPE html>\n<html lang="en" class="dark has-phone-layout"><head></head><body></body></html>';
        assert.equal(P.withoutPhoneClass(page), page.replace(' has-phone-layout', ''));
        assert.equal(P.withoutPhoneClass(page.replace('dark ', '')), page.replace(' class="dark has-phone-layout"', ''));
        assert.equal(P.withoutPhoneClass('<html lang="en"><body></body></html>'), '<html lang="en"><body></body></html>');
    });
});

describe('drawings on a page with a phone layout', () => {
    it('are stretched to their box, and no longer once it has none; a full-width one stays stretched', () => {
        const work = makeProject();
        E.applyEdit(work, 'index.html', { op: 'fullWidth', ref: { id: 'rect-1' }, full: true });
        E.applyEdit(work, 'index.html', { op: 'phoneLayout', ref: {}, phone: {} });
        const svgs = () => [...read(work, 'index.html').matchAll(/<svg id="(rect-\d)"[^>]*>/g)].map((m) => [m[1], /preserveAspectRatio="none"/.test(m[0])]);
        assert.deepEqual(svgs(), [['rect-1', true], ['rect-2', true]]);
        E.applyEdit(work, 'index.html', { op: 'fullWidth', ref: { id: 'rect-1' }, full: false });
        assert.deepEqual(svgs(), [['rect-1', true], ['rect-2', true]], 'back in the column, still stretched');
        E.applyEdit(work, 'index.html', { op: 'phoneLayout', ref: {}, phone: null });
        assert.deepEqual(svgs(), [['rect-1', false], ['rect-2', false]]);
    });

    it('one added later is stretched too', () => {
        const work = withPhone();
        const markup = '<svg id="rect-3" width="40" height="40" viewBox="0 0 40 40"><rect x="0" y="0" width="40" height="40" fill="#fff" stroke="none"/></svg>';
        E.applyEdit(work, 'index.html', { op: 'add', ref: { id: 'rect-3' }, markup, declarations: { left: '0px' } });
        assert.match(/<svg id="rect-3"[^>]*>/.exec(read(work, 'index.html'))[0], /preserveAspectRatio="none"/);
    });
});

describe('phoneDraft: a page\'s first phone layout, from its geometry', () => {
    const SIZES = { pageWidth: 1440, phoneWidth: M.PHONE_WIDTH, fontMin: M.PHONE_FONT_MIN };
    // Shaped like Pulsewise's hero: a band, a pill, text, two buttons and the dashboard mock; then the next band.
    const HERO = [
        { id: 'hero', x: 0, y: 0, w: 1440, h: 720, kind: 'shape', full: true },
        { id: 'pill', x: 600, y: 96, w: 240, h: 32, kind: 'widget', fontSize: 14, lineHeight: 20 },
        { id: 'title', x: 220, y: 160, w: 1000, h: 136, kind: 'widget', fontSize: 56, lineHeight: 68, grows: true },
        { id: 'lede', x: 370, y: 320, w: 700, h: 56, kind: 'widget', fontSize: 18, lineHeight: 28, grows: true },
        { id: 'cta', x: 540, y: 410, w: 170, h: 52, kind: 'widget', fontSize: 16 },
        { id: 'demo', x: 730, y: 410, w: 170, h: 52, kind: 'widget', fontSize: 16 },
        { id: 'mock', x: 320, y: 490, w: 800, h: 210, kind: 'shape' },
        { id: 'bar1', x: 360, y: 530, w: 300, h: 20, kind: 'shape' },
        { id: 'stat', x: 700, y: 530, w: 200, h: 24, kind: 'widget', fontSize: 16, lineHeight: 24 },
        { id: 'features', x: 0, y: 720, w: 1440, h: 500, kind: 'shape' },
        { id: 'h2', x: 120, y: 780, w: 600, h: 44, kind: 'widget', fontSize: 36, lineHeight: 44, grows: true },
    ];
    const rules = D.phoneDraft(HERO, SIZES);
    const n = (v) => Number(String(v).replace('px', ''));
    const box = (id) => { const r = rules[`#${id}`]; return { x: n(r.left), y: n(r.top), w: n(r.width), h: n(r.height ?? r['min-height']) }; };
    const inside = (inner, outer) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
    const apart = (a, b) => a.y + a.h <= b.y || b.y + b.h <= a.y || a.x + a.w <= b.x || b.x + b.w <= a.x;

    it('has a rule for every element, and nothing wider than the phone', () => {
        assert.deepEqual(Object.keys(rules).sort(), HERO.map((el) => `#${el.id}`).sort());
        for (const el of HERO) {
            const b = box(el.id);
            assert.ok(b.x >= 0 && b.x + b.w <= 390, `${el.id} within the phone: ${JSON.stringify(b)}`);
        }
    });

    it('a band is as wide as the phone, as tall as what is in it, and bands that touched still touch', () => {
        assert.deepEqual(box('hero'), { x: 0, y: 0, w: 390, h: box('hero').h });
        for (const id of ['pill', 'title', 'lede', 'cta', 'demo', 'mock', 'bar1', 'stat']) assert.ok(inside(box(id), box('hero')), `${id} is in the hero`);
        assert.equal(box('features').y, box('hero').y + box('hero').h);
        assert.ok(inside(box('h2'), box('features')));
        assert.deepEqual([box('features').x, box('features').w], [0, 390]);
    });

    it('what is in a band is stacked top to bottom, nothing on top of anything else', () => {
        const order = ['pill', 'title', 'lede', 'cta', 'mock'];
        for (let i = 1; i < order.length; i++) assert.ok(box(order[i]).y >= box(order[i - 1]).y + box(order[i - 1]).h, `${order[i]} below ${order[i - 1]}`);
        const blocks = ['pill', 'title', 'lede', 'cta', 'demo', 'mock'];
        for (const a of blocks) for (const b of blocks) if (a < b) assert.ok(apart(box(a), box(b)), `${a} and ${b} apart`);
    });

    it('buttons side by side stay side by side while they fit, centred as they were', () => {
        assert.equal(box('cta').y, box('demo').y);
        assert.ok(box('cta').x + box('cta').w < box('demo').x);
        assert.equal(Math.round((box('cta').x + box('demo').x + box('demo').w) / 2), 195);
        assert.equal(box('pill').x + box('pill').w / 2, 195, 'the pill was centred: so it is');
    });

    it('a smaller shape that holds others is one picture: scaled down, what is in it with it', () => {
        assert.ok(box('mock').w <= 390 - 32);
        assert.ok(inside(box('bar1'), box('mock')) && inside(box('stat'), box('mock')));
        const s = box('mock').w / 800;
        assert.ok(Math.abs(box('bar1').w - 300 * s) <= 1, 'scaled as the mock is');
    });

    it('text is never under the least size, never bigger than it was; Text and Heading get a least height', () => {
        for (const [selector, rule] of Object.entries(rules)) {
            if (!rule['font-size']) continue;
            const el = HERO.find((one) => `#${one.id}` === selector);
            assert.ok(n(rule['font-size']) >= 14 && n(rule['font-size']) <= el.fontSize, `${selector}: ${rule['font-size']}`);
        }
        assert.equal(rules['#title']['font-size'], '36px');
        for (const id of ['title', 'lede', 'h2']) {
            assert.equal(rules[`#${id}`].height, undefined, `${id} has no height`);
            assert.ok(n(rules[`#${id}`]['min-height']) > 0);
        }
        assert.ok(box('title').h >= 2 * 68 * (36 / 56), 'its words take more lines at the phone\'s width');
        assert.ok(rules['#cta'].height && !rules['#cta']['min-height'], 'a button keeps a height');
    });

    it('elements in no band are blocks of their own, within the margins; an element with no usable id or box is left out', () => {
        const free = D.phoneDraft([
            { id: 'logo', x: 40, y: 20, w: 120, h: 40, kind: 'shape' },
            { id: 'note', x: 900, y: 30, w: 400, h: 24, kind: 'widget', fontSize: 16, lineHeight: 24, grows: true },
            { id: '', x: 0, y: 0, w: 1, h: 1 },
            { id: 'bad', x: NaN, y: 0, w: 1, h: 1 },
        ], SIZES);
        assert.deepEqual(Object.keys(free), ['#logo', '#note']);
        for (const id of ['logo', 'note']) assert.ok(n(free[`#${id}`].left) >= 16 && n(free[`#${id}`].left) + n(free[`#${id}`].width) <= 374, `${id} within the margins`);
        assert.ok(n(free['#note'].top) >= n(free['#logo'].top) + n(free['#logo'].height), 'side by side, too wide for one line: the second on the next');
        assert.equal(M.PHONE_FONT_MIN, 14);
    });
});

describe('phoneDraft: what Pulsewise\'s hero showed on the emulated iPhone', () => {
    const SIZES = { pageWidth: 1440, phoneWidth: M.PHONE_WIDTH, fontMin: M.PHONE_FONT_MIN };
    const n = (v) => Number(String(v).replace('px', ''));
    const boxOf = (rules) => (id) => { const r = rules[`#${id}`]; return { x: n(r.left), y: n(r.top), w: n(r.width), h: n(r.height ?? r['min-height']) }; };
    const inside = (inner, outer) => inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;

    // The hero: a nav row, a headline and its paragraph, and a dashboard mock
    // with its cards; circles, one mostly behind the headline, one behind the
    // mock, one over the mock's top and round both stat cards, one bigger
    // than the mock round one of its cards, and one in that one.
    const HERO = [
        { id: 'hero', x: 0, y: 0, w: 1440, h: 900, kind: 'shape', drawing: true, full: true },
        { id: 'free', x: 1260, y: 24, w: 140, h: 40, kind: 'widget', fontSize: 15 },
        { id: 'mark', x: 40, y: 28, w: 32, h: 32, kind: 'shape', drawing: true },
        { id: 'name', x: 82, y: 30, w: 120, h: 28, kind: 'widget', fontSize: 20 },
        { id: 'pricing', x: 600, y: 32, w: 70, h: 20, kind: 'widget', fontSize: 15 },
        { id: 'customers', x: 690, y: 32, w: 90, h: 20, kind: 'widget', fontSize: 15 },
        { id: 'blob1', x: 1100, y: 400, w: 300, h: 300, kind: 'shape', drawing: true },
        { id: 'blob2', x: 300, y: 100, w: 250, h: 250, kind: 'shape', drawing: true },
        { id: 'title', x: 220, y: 140, w: 1000, h: 136, kind: 'widget', fontSize: 56, lineHeight: 68, grows: true },
        { id: 'lede', x: 370, y: 300, w: 700, h: 56, kind: 'widget', fontSize: 18, lineHeight: 28, grows: true },
        { id: 'mock', x: 700, y: 480, w: 640, h: 380, kind: 'shape', drawing: true },
        { id: 'circle', x: 820, y: 420, w: 420, h: 420, kind: 'shape', drawing: true },
        { id: 'stat1', x: 840, y: 600, w: 160, h: 80, kind: 'widget', fontSize: 16 },
        { id: 'stat2', x: 1040, y: 600, w: 160, h: 80, kind: 'widget', fontSize: 16 },
        // Bigger than the mock, crossing it, and round one of its cards and the next one.
        { id: 'circle600', x: 560, y: 380, w: 600, h: 600, kind: 'shape', drawing: true },
        // In that circle, over the mock's corner only a little.
        { id: 'blob240', x: 580, y: 700, w: 240, h: 240, kind: 'shape', drawing: true },
        // A card of the mock's that starts 36px left of it.
        { id: 'wide', x: 664, y: 760, w: 400, h: 60, kind: 'widget', fontSize: 16 },
        { id: 'logos', x: 0, y: 900, w: 1440, h: 160, kind: 'shape', drawing: true },
        ...['Acme', 'Globex', 'Initech', 'Umbrella', 'Hooli', 'Vandelay'].map((name, i) => (
            { id: `logo${i}`, x: 210 + i * 180, y: 960, w: 120, h: 36, kind: 'widget', fontSize: 24 })),
    ];
    const rules = D.phoneDraft(HERO, SIZES);
    const box = boxOf(rules);

    it('a drawing over others that holds nothing is decoration: hidden, within the phone, and no block in the stack', () => {
        for (const id of ['blob1', 'blob2', 'circle', 'circle600', 'blob240']) {
            assert.equal(rules[`#${id}`].display, 'none', `${id} is hidden on phones`);
            assert.ok(box(id).x >= 0 && box(id).x + box(id).w <= 390, `${id} within the phone, shown again`);
        }
        assert.equal(rules['#mark'].display, undefined, 'a logo mark on its band is not decoration');
        assert.equal(rules['#mock'].display, undefined, 'the mock holds more of what the circles round its cards hold: it is the content');
        assert.ok(box('hero').h < 900, `the hero is no taller for its circles: ${box('hero').h}`);
    });

    it('nothing is past either side of the phone, a mock-up\'s card that stuck out of it neither', () => {
        for (const el of HERO) {
            const b = box(el.id);
            assert.ok(b.x >= 0 && b.x + b.w <= 390, `${el.id} within the phone: ${JSON.stringify(b)}`);
        }
        assert.ok(box('wide').x < box('mock').x, 'it sticks out of the mock as it did');
        assert.ok(Math.abs(box('wide').y - (box('mock').y + (760 - 480) * box('mock').w / 640)) <= 1, 'scaled with the mock');
    });

    it('a circle round a mock-up\'s cards does not take them out of it', () => {
        for (const id of ['stat1', 'stat2']) assert.ok(inside(box(id), box('mock')), `${id} in the mock`);
        const s = box('mock').w / 640;
        assert.ok(Math.abs(box('stat1').x - (box('mock').x + (840 - 700) * s)) <= 1, 'placed as the mock is scaled');
        assert.ok(Math.abs(box('stat2').y - (box('mock').y + (600 - 480) * s)) <= 1);
    });

    it('a row is in reading order, in lines, centred as a whole', () => {
        const order = ['mark', 'name', 'pricing', 'customers', 'free'];
        const at = order.map(box);
        for (let i = 1; i < at.length; i++) {
            const prev = at[i - 1], one = at[i];
            assert.ok(one.y > prev.y || (one.y + one.h > prev.y && one.x >= prev.x + prev.w), `${order[i]} after ${order[i - 1]}`);
        }
        // Each line is centred, so its first and last are as far from the sides.
        const lines = [];
        for (const one of at) {
            const line = lines.find((l) => l.some((o) => o.y < one.y + one.h && one.y < o.y + o.h));
            if (line) line.push(one); else lines.push([one]);
        }
        assert.ok(lines.length > 1, 'too wide for one line');
        for (const line of lines) {
            const from = Math.min(...line.map((o) => o.x)), to = Math.max(...line.map((o) => o.x + o.w));
            assert.ok(Math.abs(from - (390 - to)) <= 1, `a line centred: ${from} to ${to}`);
        }
        assert.ok(box('mark').y + box('mark').h / 2 - (box('name').y + box('name').h / 2) <= 1, 'centred on its line, as it was');
    });

    it('the logos strip is lines of names side by side, each line centred', () => {
        const at = [0, 1, 2, 3, 4, 5].map((i) => box(`logo${i}`));
        assert.ok(at[1].y === at[0].y, 'two names on a line');
        for (const one of at) assert.ok(inside(one, box('logos')));
        const firstLine = at.filter((one) => one.y === at[0].y);
        const from = firstLine[0].x, to = firstLine[firstLine.length - 1].x + firstLine[firstLine.length - 1].w;
        assert.ok(Math.abs(from - (390 - to)) <= 1);
    });

    it('a Text or Heading takes the height the overlay measured for its words, and what is below starts after it', () => {
        const asked = D.wordsToMeasure(HERO, rules);
        assert.deepEqual(asked.map((one) => one.id), ['title', 'lede']);
        assert.deepEqual(asked[0], { id: 'title', width: box('title').w, fontSize: 36 });
        const measured = D.phoneDraft(HERO, SIZES, { title: 220, lede: 104 });
        const again = boxOf(measured);
        assert.equal(measured['#title']['min-height'], '220px');
        assert.equal(measured['#lede']['min-height'], '104px');
        assert.ok(again('lede').y >= again('title').y + 220, 'the paragraph below the headline');
        assert.equal(again('title').w, box('title').w, 'the widths are the same: what was measured is what is used');
        assert.ok(again('hero').h > box('hero').h, 'the band grows with it');
    });
});

describe('phoneDraft: Pulsewise\'s hero circles, on its own boxes', () => {
    const SIZES = { pageWidth: 1440, phoneWidth: M.PHONE_WIDTH, fontMin: M.PHONE_FONT_MIN };
    const n = (v) => Number(String(v).replace('px', ''));
    const shape = (id, x, y, w, h) => ({ id, x, y, w, h, kind: 'shape', drawing: true });
    const words = (id, x, y, w, h) => ({ id, x, y, w, h, kind: 'widget', fontSize: 15, wraps: true });
    // The hero band; the 600px circle with the 420px one inside it, both
    // crossing the dashboard mock; the 240px circle in the band's empty space,
    // just over the email field's box; the headline; then a band of cards.
    const PAGE = [
        shape('hero', 0, 0, 1440, 754),
        shape('c600', 820, 60, 600, 600),
        shape('c420', 960, 190, 420, 420),
        shape('c240', 40, 520, 240, 240),
        { id: 'headline', x: 160, y: 200, w: 600, h: 150, kind: 'widget', fontSize: 56, grows: true },
        shape('field', 160, 486, 300, 52),
        shape('mock', 760, 130, 520, 540),
        words('inAll', 1000, 300, 136, 35),
        words('alsoInAll', 1150, 400, 100, 20),
        words('in600', 800, 600, 200, 20),
        words('mockOnly', 780, 140, 136, 18),
        shape('features', 0, 754, 1440, 600),
        shape('card', 100, 800, 400, 300),
        shape('icon', 130, 830, 48, 48),
        words('cardTitle', 130, 900, 300, 30),
        shape('divider', 200, 1300, 600, 2),
    ];
    const rules = D.phoneDraft(PAGE, SIZES);
    const box = (id) => { const r = rules[`#${id}`]; return { x: n(r.left), y: n(r.top), w: n(r.width), h: n(r.height ?? r['min-height']) }; };
    const inside = (a, b) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

    it('a circle inside a circle, both round some of the mock\'s cards: both are decoration, and the mock stays', () => {
        assert.equal(rules['#c600'].display, 'none');
        assert.equal(rules['#c420'].display, 'none');
        assert.equal(rules['#mock'].display, undefined);
        for (const id of ['inAll', 'alsoInAll', 'in600', 'mockOnly']) assert.ok(inside(box(id), box('mock')), `${id} in the mock`);
    });

    it('an empty circle in the band\'s empty space, wider and taller than any words in the band, is decoration', () => {
        assert.equal(rules['#c240'].display, 'none');
        assert.equal(rules['#field'].display, undefined, 'the email field\'s box is not: it is not as tall as the headline');
        assert.ok(box('hero').h < 1000, `the hero is no taller for its circles: ${box('hero').h}`);
    });

    it('an icon in a card and a thin divider stay', () => {
        for (const id of ['icon', 'divider', 'card']) assert.equal(rules[`#${id}`].display, undefined, id);
        assert.ok(inside(box('icon'), box('card')));
    });
});

describe('phoneDraft: what the Draw2Code site showed on the emulated iPhone', () => {
    const SIZES = { pageWidth: 1440, phoneWidth: M.PHONE_WIDTH, fontMin: M.PHONE_FONT_MIN };
    const n = (v) => Number(String(v).replace('px', ''));
    const box = (rules, id) => { const r = rules[`#${id}`]; return { x: n(r.left), y: n(r.top), w: n(r.width), h: n(r['min-height'] ?? r.height) }; };
    // How it works: three steps side by side, each a number, a title and a text.
    const STEPS = [{ id: 'band', x: 0, y: 0, w: 1440, h: 600, kind: 'shape', drawing: true }];
    for (let i = 0; i < 3; i++) {
        const x = 160 + i * 400;
        STEPS.push({ id: `num${i}`, x: x + 130, y: 120, w: 64, h: 64, kind: 'widget', fontSize: 28, wraps: true },
            { id: `title${i}`, x, y: 210, w: 320, h: 32, kind: 'widget', fontSize: 22, wraps: true },
            { id: `text${i}`, x, y: 260, w: 320, h: 72, kind: 'widget', fontSize: 16, lineHeight: 24, grows: true });
    }

    it('steps in a grid are read one step at a time: its number, its title, its text, each centred as it was', () => {
        const rules = D.phoneDraft(STEPS, SIZES);
        const order = [0, 1, 2].flatMap((i) => [`num${i}`, `title${i}`, `text${i}`]);
        for (let k = 1; k < order.length; k++) assert.ok(box(rules, order[k]).y >= box(rules, order[k - 1]).y + box(rules, order[k - 1]).h, `${order[k]} below ${order[k - 1]}`);
        const middle = (b) => b.x + b.w / 2;
        assert.ok(Math.abs(middle(box(rules, 'num1')) - 195) <= 1, 'centred over its step, so on the phone');
    });

    it('rows that fit on a line stay rows, grid or not', () => {
        const strip = [0, 1].flatMap((r) => [0, 1, 2].map((i) => ({ id: `l${r}${i}`, x: 400 + i * 220, y: 100 + r * 60, w: 100, h: 30, kind: 'widget', fontSize: 16, wraps: true })));
        const rules = D.phoneDraft(strip, SIZES);
        assert.equal(box(rules, 'l00').y, box(rules, 'l02').y);
        assert.ok(box(rules, 'l10').y > box(rules, 'l00').y);
    });

    it('a label too long for the phone has its words on more lines, as tall as the overlay measured them', () => {
        const footer = [{ id: 'credit', x: 400, y: 40, w: 640, h: 24, kind: 'widget', fontSize: 16, wraps: true },
            { id: 'field', x: 400, y: 100, w: 640, h: 40, kind: 'widget', fontSize: 16 }];
        const first = D.phoneDraft(footer, SIZES);
        assert.deepEqual(first['#credit'], { left: '16px', top: '16px', width: '358px', height: 'auto', 'min-height': first['#credit']['min-height'], 'font-size': '14px', 'white-space': 'normal' });
        assert.ok(n(first['#credit']['min-height']) >= 2 * 24 * 14 / 16, 'more lines than one, estimated');
        assert.equal(first['#field']['white-space'], undefined, 'an input field keeps its one line');
        assert.deepEqual(D.wordsToMeasure(footer, first), [{ id: 'credit', width: 358, fontSize: 14, wrap: true }]);
        const again = D.phoneDraft(footer, SIZES, { credit: 40 });
        assert.equal(again['#credit']['min-height'], '40px');
        assert.equal(D.phoneDraft(footer, SIZES, { credit: 10 })['#credit']['min-height'], `${Math.round(24 * 14 / 16)}px`, 'never shorter than its box');
    });
});

describe('paste and duplicate in the phone view', () => {
    function copy(work, page, items, view) {
        const html = read(work, page);
        const all = store(work);
        const overrides = all[page] ?? {};
        const phone = all[E.phoneKey(page)];
        const styles = { sheets: [{ dir: 'css', css: read(work, 'css/style.css') }], overrides, overridesDir: 'draw2code', scopes: P.bodyClasses(html) };
        const ruled = (selector) => [overrides, phone ?? {}].some((rules) => Object.keys(rules).some((rule) => rule.startsWith(selector)));
        return { page, overridesDir: 'draw2code', pasted: {}, ...(view ? { view } : {}), items: items.map((item) => {
            const copied = P.copyElement(html, item.ref, ruled);
            return { ...copied, rules: C.copiedRules(copied, styles), box: item.box, full: false,
                ...(phone ? { phoneRules: C.copiedRules(copied, { ...styles, sheets: [], overrides: phone }) } : {}) };
        }) };
    }
    /** As DesignerPanel.paste makes the edit, in the view given. */
    function paste(work, clip, page, offset, view) {
        const html = read(work, page);
        const pasted = C.pasteElements(clip, { page, taken: P.usedIds(html), inWrapper: true, wrapper: { x: 0, y: 0, width: view === 'phone' ? 390 : 1440 }, overridesDir: 'draw2code' }, offset);
        const phoneView = view === 'phone';
        const ops = pasted.map((one) => ({ op: 'add', ref: { id: one.id }, markup: one.markup, extraRules: one.extraRules, phoneRules: one.phoneRules,
            declarations: !phoneView && clip.view === 'phone' && one.desktop ? one.desktop : one.declarations,
            ...(phoneView && one.desktop ? { desktopDeclarations: one.desktop } : {}) }));
        const op = { op: 'batch', ref: {}, label: 'Paste', ops };
        return { pasted, result: E.applyEdit(work, page, phoneView ? E.inPhoneView(op) : op) };
    }
    // button-1 is at 1200, 40 at desktop width, 16, 520 on the phone.
    const PHONE_BOX = { ref: { id: 'button-1' }, box: { x: 16, y: 520, w: 160, h: 48 } };
    const DESKTOP_BOX = { ref: { id: 'button-1' }, box: { x: 1200, y: 40, w: 160, h: 48 } };

    it('Ctrl+D there: the copy is 16px off the original in both layouts', () => {
        const work = withPhone();
        const { pasted, result } = paste(work, copy(work, 'index.html', [PHONE_BOX], 'phone'), 'index.html', 16, 'phone');
        assert.equal(result.error, undefined);
        const id = `#${pasted[0].id}`;
        assert.equal(store(work)['index.html'][id].left, '1216px');
        assert.equal(store(work)['index.html'][id].top, '56px');
        assert.equal(store(work)['index.html@phone'][id].left, '32px');
        assert.equal(store(work)['index.html@phone'][id].top, '536px');
    });

    it('copied there and pasted at desktop width: placed from the original\'s desktop rule', () => {
        const work = withPhone();
        const { pasted } = paste(work, copy(work, 'index.html', [PHONE_BOX], 'phone'), 'index.html', 16, 'desktop');
        const id = `#${pasted[0].id}`;
        assert.deepEqual([store(work)['index.html'][id].left, store(work)['index.html'][id].top], ['1216px', '56px']);
    });

    it('copied and pasted at desktop width: as before', () => {
        const work = withPhone();
        const { pasted } = paste(work, copy(work, 'index.html', [DESKTOP_BOX]), 'index.html', 16, 'desktop');
        const id = `#${pasted[0].id}`;
        assert.deepEqual([store(work)['index.html'][id].left, store(work)['index.html'][id].top], ['1216px', '56px']);
        assert.deepEqual([store(work)['index.html@phone'][id].left, store(work)['index.html@phone'][id].top], ['32px', '536px']);
    });
});
