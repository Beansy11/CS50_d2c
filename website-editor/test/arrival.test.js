// Unit tests for a page drawn again being shown where it was, at once:
// src/arrival.ts (compiled to out/ by npm test's pretest).
//
// CS50 citation: I did not write these tests. I had an AI coding agent read
// my code and write tests for it, to save time, and it put this file in
// website-editor/test/. The code it tests is mine; the tests are the agent's.
// I run them with npm test.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const A = require('../../out/website-editor/src/arrival.js');
const M = require('../media/model.js');
const H = require('../media/generators/html.js');
const { shellHtml } = require('./shellHtml.js');

/**
 * A page's window as far as the functions use it: its load event calls the
 * listeners in the order they were added, and a timer or an animation frame
 * runs only when run() or frame() is called, after whatever is running now.
 */
function page(readyState = 'loading') {
    const listeners = [];
    const timers = [];
    const frames = [];
    const attributes = new Set();
    const win = {
        document: { readyState },
        setTimeout: (run) => { timers.push(run); },
        requestAnimationFrame: (run) => { frames.push(run); },
        addEventListener: (type, listener) => { if (type === 'load') listeners.push(listener); },
    };
    const html = { setAttribute: (name) => attributes.add(name) };
    return {
        win, html, attributes, listeners,
        load() { win.document.readyState = 'complete'; for (const l of listeners.splice(0)) l(); },
        run() { for (const t of timers.splice(0)) t(); },
        frame() { for (const f of frames.splice(0)) f(); },
    };
}

describe('arriveAfterLoad: the page scrolls at once until VS Code has put it back', () => {
    it('is marked arrived only after every listener of the load event, also ones added later', () => {
        const p = page();
        A.arriveAfterLoad(p.win, p.html, A.ARRIVED_ATTR, () => {});
        // VS Code adds its own listener once the page is written: it scrolls the page there.
        let whenVsCodeScrolled = null;
        p.win.addEventListener('load', () => { whenVsCodeScrolled = p.attributes.has(A.ARRIVED_ATTR); });
        assert.equal(p.attributes.size, 0, 'not before the page has loaded');
        p.load();
        assert.equal(whenVsCodeScrolled, false, 'VS Code scrolled it while it still scrolls at once');
        assert.equal(p.attributes.has(A.ARRIVED_ATTR), false, 'not during the load event');
        p.run();
        assert.equal(p.attributes.has(A.ARRIVED_ATTR), true, 'right after it');
    });

    it('a page already loaded is marked once what is running now is done', () => {
        const p = page('complete');
        A.arriveAfterLoad(p.win, p.html, A.ARRIVED_ATTR, () => {});
        assert.equal(p.attributes.size, 0);
        p.run();
        assert.equal(p.attributes.has(A.ARRIVED_ATTR), true);
    });

    it('runs on its own, as it is copied into the overlay', () => {
        // src/pageShell.ts writes the function's text into the page script.
        const copied = new Function(`return (${A.arriveAfterLoad.toString()});`)();
        const p = page();
        copied(p.win, p.html, 'data-x', () => {});
        p.load();
        p.run();
        assert.deepEqual([...p.attributes], ['data-x']);
    });
});

describe('arriveAfterLoad: the page is put where it should be just before', () => {
    it('settles once, in the first frame or timer after the load, whichever is first, and then marks it', () => {
        for (const first of ['frame', 'run']) {
            const p = page();
            const seen = [];
            A.arriveAfterLoad(p.win, p.html, A.ARRIVED_ATTR, () => seen.push(p.attributes.has(A.ARRIVED_ATTR)));
            p.load();
            assert.deepEqual(seen, [], 'not during the load event, where VS Code scrolls it');
            p[first]();
            assert.deepEqual(seen, [false], 'settled while it still scrolls at once');
            assert.equal(p.attributes.has(A.ARRIVED_ATTR), true);
            p.frame();
            p.run();
            assert.deepEqual(seen, [false], 'only once');
        }
    });
});

describe('arrivalScroll: where a page drawn again is put', () => {
    const page = 'index.html';

    it('the same page goes back as far across as it was, as far down as VS Code put it', () => {
        assert.deepEqual(A.arrivalScroll({ scrollPage: page, scrollX: 240 }, page, { x: 0, y: 3000 }, false), { left: 240, top: 3000 });
    });

    it('is left alone where it is already', () => {
        assert.equal(A.arrivalScroll({ scrollPage: page, scrollX: 0 }, page, { x: 0, y: 3000 }, false), null);
        assert.equal(A.arrivalScroll({ scrollPage: page }, page, { x: 0, y: 120 }, false), null);
        assert.equal(A.arrivalScroll({ scrollPage: 'about.html', scrollX: 50 }, page, { x: 0, y: 0 }, false), null);
    });

    it('another page starts at its top-left, not where VS Code scrolled it to', () => {
        assert.deepEqual(A.arrivalScroll({ scrollPage: 'about.html', scrollX: 240 }, page, { x: 0, y: 3000 }, false), { left: 0, top: 0 });
    });

    it('a section it goes to wins', () => {
        assert.equal(A.arrivalScroll({ scrollPage: 'about.html', scrollX: 240 }, page, { x: 0, y: 3000 }, true), null);
        assert.equal(A.arrivalScroll({ scrollPage: page, scrollX: 240 }, page, { x: 0, y: 3000 }, true), null);
    });

    it('with nothing kept (an older webview), it is left where VS Code put it', () => {
        assert.equal(A.arrivalScroll({}, page, { x: 0, y: 3000 }, false), null);
    });

    it('runs on its own, as it is copied into the overlay', () => {
        const copied = new Function(`return (${A.arrivalScroll.toString()});`)();
        assert.deepEqual(copied({ scrollPage: page, scrollX: 9 }, page, { x: 0, y: 5 }, false), { left: 9, top: 5 });
    });
});

describe('ARRIVING_RULE: over the smooth scrolling a page made in Draw2Code asks for', () => {
    it('wins over the page\'s own rule, which is not !important', () => {
        const page = { ...M.makePage(M.ENTRY_PAGE), elements: [] };
        const css = H.generateProject({ version: 2, active: page.name, pages: [page] }).css;
        assert.match(css, /scroll-behavior: smooth;/);
        assert.doesNotMatch(css, /scroll-behavior:[^;]*!important/);
    });
});

describe('the overlay puts all this in the page (src/pageShell.ts)', () => {
    const html = shellHtml({ editor: true });
    const head = html.slice(0, html.indexOf('</head>'));
    const script = html.slice(html.lastIndexOf('<script'));

    it('the rule is in the reset style in <head>, before the page\'s own stylesheets', () => {
        const reset = head.slice(head.indexOf('<style data-draw2code-ui>'));
        assert.ok(reset.slice(0, reset.indexOf('</style>')).includes(A.ARRIVING_RULE));
    });

    it('the script marks the page arrived and settles it, keeping how far across it is', () => {
        assert.ok(script.includes(`const arriveAfterLoad = ${A.arriveAfterLoad.toString()};`));
        assert.ok(script.includes(`const arrivalScroll = ${A.arrivalScroll.toString()};`));
        assert.ok(script.includes(`arriveAfterLoad(window, document.documentElement, ${JSON.stringify(A.ARRIVED_ATTR)}, () => {`));
        assert.match(script, /keepState\(\{ scrollPage: PAGE_NAME,/);
        assert.match(script, /keepState\(\{ scrollX: window\.scrollX \}\)/);
    });

    it('so does the Site Preview\'s', () => {
        const preview = shellHtml();
        assert.ok(preview.slice(0, preview.indexOf('</head>')).includes(A.ARRIVING_RULE));
        assert.ok(preview.includes(`arriveAfterLoad(window, document.documentElement, ${JSON.stringify(A.ARRIVED_ATTR)}, () => {`));
    });
});
