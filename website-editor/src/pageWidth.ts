// The page width of a project Draw2Code made: how wide the column every page
// is laid out in is, centred in the window (see media/generators/html.js).
//
// It is kept once per project, in its label (.draw2code/project.d2c,
// src/projectFormat.ts), and written into the one rule that uses it: the
// `.page` rule of the stylesheet every page shares. Changing it lays every
// page out for the new width at once. Elements keep their x, y and size.
//
// Plain Node - no vscode import - so test/pageWidth.test.js can run it.

/** The width a project has until it is changed, in px. The SAME as media/model.js PAGE_WIDTH (a test holds them together). */
export const PAGE_WIDTH = 1440;
/** The least a page may be: a phone's width. */
export const PAGE_WIDTH_MIN = 320;
/** The most a page may be: a 4K screen's width. */
export const PAGE_WIDTH_MAX = 3840;

/**
 * A width as typed: "1200", "1200px" or " 1200 px " -> { width: 1200 }.
 * Anything else, a width with a fraction, or one outside the limits says
 * why it cannot be one.
 */
export function checkPageWidth(text: string): { width: number } | { problem: string } {
    const match = /^\s*(\d+(?:\.\d+)?)\s*(?:px)?\s*$/i.exec(String(text ?? ''));
    if (!match) return { problem: 'Type a width in px, like 1440' };
    const width = Number(match[1]);
    if (!Number.isInteger(width)) return { problem: 'Type a whole number of px, like 1440' };
    if (width < PAGE_WIDTH_MIN || width > PAGE_WIDTH_MAX) {
        return { problem: `A page can be ${PAGE_WIDTH_MIN} to ${PAGE_WIDTH_MAX} px wide` };
    }
    return { width };
}

/**
 * A width a label or a design holds, as the generator uses it: a whole
 * number of px within the limits, and the default for anything that is not
 * a number. The SAME rule as media/model.js pageWidthOf.
 */
export function pageWidthOf(value: unknown): number {
    const n = Number(value);
    if (value === undefined || value === null || value === '' || !Number.isFinite(n)) return PAGE_WIDTH;
    return Math.max(PAGE_WIDTH_MIN, Math.min(PAGE_WIDTH_MAX, Math.round(n)));
}

/** The `.page { ... }` rule at the start of a line: where its declarations start and end. */
function pageRule(css: string): { from: number; to: number } | null {
    const match = /(^|\n)[ \t]*\.page[ \t]*\{/.exec(css);
    if (!match) return null;
    const from = match.index + match[0].length;
    const to = css.indexOf('}', from);
    return to < 0 ? null : { from, to };
}

/** The width the stylesheet's `.page` rule gives every page, in px; undefined when it gives none. */
export function stylesheetPageWidth(css: string): number | undefined {
    const rule = pageRule(css);
    const match = rule ? /(?:^|[;{\s])width\s*:\s*(\d+(?:\.\d+)?)px\s*;/.exec(css.slice(rule.from, rule.to)) : null;
    return match ? Number(match[1]) : undefined;
}

/**
 * The shared stylesheet with every page laid out for `width`: the `.page`
 * rule's width changed in place, or added with the margin that centres the
 * page, after its position, in a stylesheet from before pages had a width.
 * Nothing else in the file changes. Null when it has no `.page` rule to
 * change (a site that is not a page made in Draw2Code).
 */
export function setStylesheetPageWidth(css: string, width: number): { css: string; changed: boolean } | null {
    const rule = pageRule(css);
    if (!rule) return null;
    const body = css.slice(rule.from, rule.to);
    const line = `width: ${width}px;`;
    let next: string;
    const has = /((?:^|[;{\s]))width\s*:\s*[^;}]*;/.exec(body);
    if (has) {
        const at = has.index + has[1].length;
        next = body.slice(0, at) + line + body.slice(has.index + has[0].length);
    } else {
        // Indented like the rule's first declaration; after `position: relative;` when it is there.
        const indent = /\n([ \t]+)\S/.exec(body)?.[1] ?? '  ';
        const added = `\n${indent}${line}${/(^|[;{\s])margin\s*:/.test(body) ? '' : `\n${indent}margin: 0 auto;`}`;
        const position = /position\s*:\s*[^;}]*;/.exec(body);
        const at = position ? position.index + position[0].length : 0;
        next = body.slice(0, at) + added + body.slice(at);
    }
    if (next === body) return { css, changed: false };
    return { css: css.slice(0, rule.from) + next + css.slice(rule.to), changed: true };
}

/** The widest window a page's phone layout is shown in, in px. The SAME as media/model.js PHONE_BREAKPOINT (a test holds them together). */
export const PHONE_BREAKPOINT = 767;

/** The class a page with a phone layout has on its <html>. The SAME as media/model.js PHONE_LAYOUT_CLASS (a test holds them together). */
export const PHONE_LAYOUT_CLASS = 'has-phone-layout';

/** What a viewport meta Draw2Code wrote says: the page width (media/generators/html.js viewportMeta), or device-width before pages had one. */
const OWN_VIEWPORT = /(<meta\b[^>]*\bname\s*=\s*["']viewport["'][^>]*\bcontent\s*=\s*["'])(?:width=\d+|width=device-width, initial-scale=1\.0)(["'])/i;

/**
 * A page with no phone layout, asking a phone for a viewport as wide as the
 * page: the phone shrinks the page to fit its screen, with pinch-zoom (what
 * the generator writes; see viewportMeta there). Only a viewport meta
 * Draw2Code wrote is changed; a page with a phone layout, or with a meta of
 * its own, is returned as it is.
 */
export function setViewportWidth(html: string, width: number): string {
    const root = /<html\b[^>]*>/i.exec(html)?.[0] ?? '';
    const classes = /\bclass\s*=\s*["']([^"']*)["']/i.exec(root)?.[1] ?? '';
    if (classes.split(/\s+/).includes(PHONE_LAYOUT_CLASS)) return html;
    return html.replace(OWN_VIEWPORT, `$1width=${pageWidthOf(width)}$2`);
}
