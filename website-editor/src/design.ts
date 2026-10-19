// The design as the extension sees it: a plain-data copy sent by the webview.
// The source of truth stays in the webview (media/main.js).

import * as path from 'path';
import * as vscode from 'vscode';

/** One page of the design: what a tab in the browser bar stands for. */
export interface DesignPage {
    name: string;
    title: string;
    color: string;
    elements: Array<Record<string, unknown>>;
    /** Does it have a tab? Closing a page clears this; it is never dropped. */
    open: boolean;
}

export interface Design {
    version: number;
    /** The page being shown, by name. */
    active: string;
    pages: DesignPage[];
    /** How wide every page is, in px (see src/pageWidth.ts); 1440 when absent. */
    pageWidth?: number;
    /** Designs made before pages existed kept one page's data up here. */
    page?: { color: string };
    elements?: Array<Record<string, unknown>>;
}

export function emptyDesign(): Design {
    return {
        version: 2,
        active: 'index.html',
        pages: [{ name: 'index.html', title: 'Home', color: '#ffffff', elements: [], open: true }],
    };
}

/** The elements on the page being shown, whatever version the design is. */
export function activeElements(design: Design): Array<Record<string, unknown>> {
    const page = design.pages?.find((p) => p.name === design.active) ?? design.pages?.[0];
    return page?.elements ?? design.elements ?? [];
}

interface HtmlGenerator {
    generateProject(design: Design, options?: { cssPath?: string }): { pages: { name: string; html: string }[]; css: string; cssPath: string };
    generate(design: Design, options?: { title?: string }): string;
    generateSite(design: Design, options?: { title?: string; cssHref?: string }): { html: string; css: string };
    elementParts(element: Record<string, unknown>): {
        id: string;
        html: string;
        rules: Array<{ selector: string; declarations: Record<string, string> }>;
    };
}

/** The data model (media/model.js), as the editor needs it to make elements. */
export interface Model {
    DEFAULT_STYLE: Record<string, unknown>;
    /** The least font size a widget may have, in px (model.js sets it). */
    FONT_MIN: number;
    /** The most font size a widget may have, in px. */
    FONT_MAX: number;
    WIDGET_DEFAULTS: Record<string, Record<string, unknown>>;
    /** A new video's look: a black box with no border. */
    VIDEO_STYLE: Record<string, unknown>;
    /** The width a phone layout is laid out for, in px. */
    PHONE_WIDTH: number;
    /** The least font size a phone layout's first draft gives text, in px. */
    PHONE_FONT_MIN: number;
    isWidget(type: string): boolean;
    defaultSize(type: string): { w: number; h: number } | null;
    createElement(id: number, type: string, box: { x: number; y: number; w: number; h: number }, style: Record<string, unknown>): Record<string, unknown>;
    createPen(id: number, points: number[][], style: Record<string, unknown>): Record<string, unknown>;
    /** One property set by the model's rules ("alt" only on an image, "poster" only on a video); a new element. */
    setProp(element: Record<string, unknown>, prop: string, value: unknown): Record<string, unknown>;
}

export function loadModel(extensionUri: vscode.Uri): Model {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(path.join(extensionUri.fsPath, 'website-editor', 'media', 'model.js')) as Model;
}

/**
 * The generators live in media/ as plain JavaScript so the same file runs in
 * unit tests and here. Load them from the installed extension folder.
 */
export function loadHtmlGenerator(extensionUri: vscode.Uri): HtmlGenerator {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require(path.join(extensionUri.fsPath, 'website-editor', 'media', 'generators', 'html.js')) as HtmlGenerator;
}
