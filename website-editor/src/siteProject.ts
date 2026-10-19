// A website project Draw2Code made: a new design saved into a project folder,
// and Publish's clean copy of it.
//
// Plain Node - no vscode import - so the tests can run it.
//
// CS50 citation: the name Draw2Code Web Editor was chosen with help from
// Claude (Anthropic AI), and at my direction Claude renamed
// the project from its earlier name, HardHat Designer, throughout this file.

import * as fs from 'fs';
import * as path from 'path';
import type { Design } from './design';
import { ensureStylesheet, Overrides, PHONE_BASE, phoneBlock, ruleBlocks, stripDraw2Code } from './pageEdit';
import { phoneKey, readOverrides } from './pageEditor';
import { pageWidthOf, setViewportWidth } from './pageWidth';
import { filesUnder, isEmptyFolder, projectNameProblem, PROJECT_FILE, PROJECT_FORMAT, PROJECT_VERSION, ProjectFile } from '../../src/projectFormat';
import { PHONE_MAP_SUFFIX } from './siteFiles';

/**
 * Does the design hold any work? A blank design is exactly what New Design
 * starts with: one empty page called index.html, titled Home, on white.
 * Anything else - an element, a second page, a new title or colour - is a
 * real edit. Which page is SHOWING never counts.
 */
export function isBlankDesign(design: Design): boolean {
    const pages = design.pages;
    if (!pages) return (design.elements ?? []).length === 0;
    if (pages.length !== 1) return false;
    const page = pages[0];
    return page.name === 'index.html'
        && page.title === 'Home'
        && String(page.color).toLowerCase() === '#ffffff'
        && page.elements.length === 0
        && page.open !== false;
}

// ---------------------------------------------------------------------------
// Saving: where the project goes
// ---------------------------------------------------------------------------

/**
 * Where a save goes: the file name typed in
 * VS Code's Save dialog names the project, and the project is always made in
 * a new folder of that name, inside the folder the dialog was in - so it
 * never mixes with what was there. An empty folder of that name is used.
 */
export function planSaveAs(file: string): { root: string; name: string } | { problem: string } {
    const folder = path.dirname(path.resolve(file));
    const name = path.basename(file).replace(/\.d2c$/i, '').trim();
    const problem = projectNameProblem(name);
    if (problem) return { problem };
    const root = path.join(folder, name);
    if (fs.existsSync(root) && !(fs.statSync(root).isDirectory() && isEmptyFolder(root))) {
        return { problem: `${name} already exists in ${path.basename(folder)}.` };
    }
    return { root, name };
}

/** The generator, as saving needs it (media/generators/html.js). */
export interface ProjectGenerator {
    generateProject(design: Design, options?: { cssPath?: string }): { pages: { name: string; html: string }[]; css: string; cssPath: string };
}

/**
 * Write a new project: every page into <name>-dev with one shared
 * stylesheet, and the label. <name>-prod is not made here - it is output,
 * built on Publish. Refuses to write over a project folder that already
 * holds something.
 */
export function writeProject(root: string, name: string, design: Design, generator: ProjectGenerator, savedWith: string): { dev: string; files: string[] } {
    const devName = `${name}-dev`;
    const dev = path.join(root, devName);
    for (const taken of [dev, path.join(root, PROJECT_FILE)]) {
        if (fs.existsSync(taken) && !(fs.statSync(taken).isDirectory() && isEmptyFolder(taken))) {
            throw new Error(`${path.relative(path.dirname(root), taken)} already exists`);
        }
    }
    const out = generator.generateProject(design);
    const written: string[] = [];
    const write = (file: string, content: string): void => {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content, 'utf8');
        written.push(file);
    };
    for (const page of out.pages) write(path.join(dev, page.name), page.html);
    write(path.join(dev, out.cssPath), out.css);
    // Draw2Code's working state inside -dev stays out of git, as for an import.
    write(path.join(dev, '.draw2code', '.gitignore'), '*\n');
    const label: ProjectFile = {
        format: PROJECT_FORMAT,
        version: PROJECT_VERSION,
        name,
        dev: devName,
        prod: `${name}-prod`,
        created: new Date().toISOString(),
        savedWith,
        stylesheet: out.cssPath,
        // The width the generator laid the pages out for.
        pageWidth: pageWidthOf(design.pageWidth),
        design,
    };
    write(path.join(root, PROJECT_FILE), JSON.stringify(label, null, 2) + '\n');
    return { dev, files: written };
}

// ---------------------------------------------------------------------------
// Publishing: <name>-prod, the clean copy
// ---------------------------------------------------------------------------

/**
 * A page's scope class: "about.html" -> "page-about". The SAME rule as
 * media/generators/html.js pageScope (a unit test holds them together).
 */
export function pageScope(name: string): string {
    const slug = String(name || '').replace(/\.html?$/i, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
    return `page-${slug || 'home'}`;
}

/**
 * A website's clean copy (Publish, the rules for -prod): <name>-prod made
 * from <name>-dev as a site that could be hosted as it is - no Draw2Code
 * markers, no Draw2Code stylesheets, no "generated by" notes - that still
 * LOOKS exactly like -dev. The rules Draw2Code wrote per page move into the
 * shared stylesheet, scoped to their page. src/publish.ts checks the project
 * and clears the old copy first. With `pageWidth`, each page's viewport
 * meta asks a phone for that width (setViewportWidth).
 */
export function buildSiteProd(dev: string, prod: string, stylesheet: string, pageWidth?: number): { prod: string; pages: string[]; files: string[] } {
    const overrides = readOverrides(dev);
    const written: string[] = [];
    const pages: string[] = [];
    const moved: string[] = [];
    const write = (rel: string, content: string | Buffer): void => {
        const file = path.join(prod, rel);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, content);
        written.push(file);
    };

    let sheet: string | null = null;
    for (const rel of filesUnder(dev, ['.draw2code', 'draw2code'])) {
        if (rel === stylesheet) {
            sheet = fs.readFileSync(path.join(dev, rel), 'utf8');
            continue;
        }
        if (!/\.html?$/i.test(rel)) {
            write(rel, fs.readFileSync(path.join(dev, rel)));
            continue;
        }
        const scope = pageScope(rel);
        const stripped = stripDraw2Code(fs.readFileSync(path.join(dev, rel), 'utf8'), scope);
        // A phone shrinks a page with no phone layout to fit, at the width
        // the project has now (a page keeps the meta it was made with).
        let html = pageWidth === undefined ? stripped.html : setViewportWidth(stripped.html, pageWidth);
        // Each rule scoped to its page; a marker selector now points at the id the element was given.
        // One rule at a time: a marker's and an id's rules for the same element stay two.
        const scoped = (rules: Overrides): string[] => Object.entries(rules).flatMap(([selector, declarations]) =>
            ruleBlocks({ [`.${scope} ${selector.replace(/\[data-d2c="([^"]+)"\]/g, (m, n: string) => (stripped.idsFor[n] ? `#${stripped.idsFor[n]}` : m))}`]: declarations }));
        // The page's phone layout after its own rules, in one @media block, as in its Draw2Code stylesheet.
        const blocks = [...scoped(overrides[rel] ?? {}), ...phoneBlock(scoped(overrides[phoneKey(rel)] ?? {}))];
        if (blocks.length) {
            moved.push(`/* ${rel} */\n${blocks.join('\n\n')}`);
            // The page must reach the shared stylesheet its rules now live in.
            const depth = rel.split('/').length - 1;
            html = ensureStylesheet(html, '../'.repeat(depth) + stylesheet).html;
        }
        write(rel, html);
        pages.push(rel);
    }

    const cleanSheet = (sheet ?? '').replace(/^\s*\/\*\s*Generated by Draw2Code Web Editor\s*\*\/\s*\r?\n?/i, '');
    // A page with a phone layout needs the phone block (PHONE_BASE): a
    // stylesheet made before phones has none, so it is written once here.
    const phones = Object.keys(overrides).some((key) => key.endsWith(PHONE_MAP_SUFFIX));
    const base = phones && !Object.keys(PHONE_BASE).every((selector) => cleanSheet.includes(`${selector} {`)) ? phoneBlock(ruleBlocks(PHONE_BASE)) : [];
    if (sheet !== null || moved.length) {
        write(stylesheet, [cleanSheet.trimEnd(), ...base, ...moved].filter(Boolean).join('\n\n') + '\n');
    }
    // -prod is only the site: Draw2Code's .draw2code/ folder is not copied.
    return { prod, pages, files: written };
}
