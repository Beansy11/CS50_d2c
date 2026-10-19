// Site preview: renders a page of the working copy (or the original) with
// its real CSS, scripts and images, and refreshes when files change.
//
// The page IS the webview document. Two things forced that shape:
//   - VS Code serves local files to the webview itself, not to an
//     <iframe srcdoc> inside it (every asset 404s), so the page cannot be
//     framed.
//   - A <base href> cannot be used either: it makes VS Code's own webview
//     frame resolve against the resource origin, which its outer CSP blocks
//     ("Framing ... violates frame-src 'self'") and the tab renders blank.
// So every relative URL in the page's HTML is rewritten to a webview URI
// before it is shown. A small bar (page dropdown, Copy/Original switch,
// Refresh) is injected in a shadow root so the page's own CSS cannot restyle
// it, and clicks on links to other pages of the site become page switches.
//
// CS50 citation: the name Draw2Code Web Editor was chosen with help from
// Claude (Anthropic AI), and at my direction Claude renamed
// the project from its earlier name, HardHat Designer, throughout this file.

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { SiteProject } from './site';
// The two panels import each other; each uses the other only inside methods.
import { DesignerPanel } from './designerPanel';
import { applyEdit, EditOp, heldStylesheet, snapshotPage } from './pageEditor';
import { disk, FileAccess, HeldFiles } from './heldFiles';
import * as history from './history';
import { buildPageHtml, escapeHtml } from './pageShell';

type Source = 'copy' | 'original';
type BarMessage =
    | { type: 'page'; page: string }
    | { type: 'source'; source: Source }
    | { type: 'refresh' }
    | { type: 'edit'; op: EditOp }
    | { type: 'status'; text: string };

export class SitePreviewPanel {
    public static current: SitePreviewPanel | undefined;

    private readonly panel: vscode.WebviewPanel;
    private readonly disposables: vscode.Disposable[] = [];
    private source: Source = 'copy';
    private page = 'index.html';
    private refreshTimer: NodeJS.Timeout | undefined;
    /** Files we just wrote ourselves, so our own writes do not reload the page
     *  and throw away the selection. */
    private selfWrites = new Map<string, number>();
    /** Watcher events before this moment are ours: an edit writes several
     *  files, and the first event can arrive before the write even returns. */
    private ignoreWatcherUntil = 0;

    public static show(site: SiteProject, page?: string): SitePreviewPanel {
        // Another site's preview is closed: a panel may only load its own site's files.
        if (SitePreviewPanel.current && SitePreviewPanel.current.site.root !== site.root) SitePreviewPanel.current.dispose();
        if (page && SitePreviewPanel.current) SitePreviewPanel.current.page = page;
        if (SitePreviewPanel.current) {
            SitePreviewPanel.current.panel.reveal(undefined, true);
            SitePreviewPanel.current.render();
            return SitePreviewPanel.current;
        }
        SitePreviewPanel.current = new SitePreviewPanel(site, page);
        return SitePreviewPanel.current;
    }

    private constructor(private readonly site: SiteProject, page?: string) {
        if (page) this.page = page;
        this.panel = vscode.window.createWebviewPanel(
            'draw2code.sitePreview',
            'Site Preview',
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                // The page may load anything under the site or its working copy.
                localResourceRoots: [vscode.Uri.file(site.root), vscode.Uri.file(site.work)],
            });

        this.panel.webview.onDidReceiveMessage((msg: BarMessage) => this.onMessage(msg), null, this.disposables);
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // Refresh on save: any file under the site (originals or working copy).
        const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(site.root, '**/*'));
        const refresh = (uri: vscode.Uri) => {
            if (!this.isSelfWrite(uri.fsPath)) this.scheduleRender();
        };
        watcher.onDidChange(refresh, null, this.disposables);
        watcher.onDidCreate(refresh, null, this.disposables);
        watcher.onDidDelete(refresh, null, this.disposables);
        this.disposables.push(watcher);

        this.render();
    }

    private onMessage(msg: BarMessage): void {
        if (msg.type === 'edit') {
            this.onEdit(msg.op);
            return;
        }
        // A word from the overlay ("<body> ... cannot be removed"): nothing to draw again.
        if (msg.type === 'status') {
            vscode.window.setStatusBarMessage(`Draw2Code: ${msg.text}`, 3000);
            return;
        }
        if (msg.type === 'page') this.page = msg.page;
        else if (msg.type === 'source') this.source = msg.source;
        // Anything else is meant for the editor (undo, copy, a link...):
        // drawing the page again for it would only lose the selection.
        else if (msg.type !== 'refresh') return;
        this.render();
    }

    /** The working copy as the open project has it, unsaved edits included. */
    private get io(): FileAccess {
        return HeldFiles.for(this.site.work) ?? disk;
    }

    /** An edit from the overlay: always into the working copy, never the original. */
    private onEdit(op: EditOp): void {
        this.site.ensureCopy();
        // Claim the next moment before writing: a created file can be
        // reported by the watcher before applyEdit() has even returned, and
        // reloading then would throw away what the user has selected.
        const before = snapshotPage(this.site.work, this.page, this.io);
        this.ignoreWatcherUntil = Date.now() + 1500;
        const result = applyEdit(this.site.work, this.page, op, this.io);
        if (result.error) {
            void vscode.window.showWarningMessage(`Draw2Code: ${result.error}`);
            // The overlay took the element(s) out before asking: draw what is really there.
            if (op.op === 'remove' || op.op === 'batch') this.render();
            return;
        }
        // Recorded only once the edit is made: a refused one changed nothing,
        // and a step for it would make the next Ctrl+Z undo nothing.
        if (before) history.record(this.site.work, before);
        const now = Date.now();
        this.ignoreWatcherUntil = now + 1500;
        for (const file of result.changed) this.selfWrites.set(selfWriteKey(file), now);
        const held = HeldFiles.for(this.site.work);
        held?.edited('Edit');
        // Held edits never reach the designer's disk watcher: it is told here.
        if (held) DesignerPanel.pageEdited(held, this.page);
        // The overlay already shows the change; reloading would lose the
        // selection, so the page is left as it is.
        this.panel.webview.postMessage({ type: 'edited', selector: result.selector });
    }

    /** Did we write this file ourselves a moment ago? */
    private isSelfWrite(file: string): boolean {
        if (Date.now() < this.ignoreWatcherUntil) return true;
        const key = selfWriteKey(file);
        const at = this.selfWrites.get(key);
        if (at === undefined) return false;
        if (Date.now() - at > 2000) {
            this.selfWrites.delete(key);
            return false;
        }
        return true;
    }

    /** Files change in bursts (save, build); render once when they stop. */
    public scheduleRender(): void {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => this.render(), 200);
    }

    public render(): void {
        const pages = this.site.pages(this.source);
        if (this.source === 'copy') {
            for (const added of HeldFiles.for(this.site.work)?.added() ?? []) {
                if (/.html?$/i.test(added) && !pages.includes(added)) pages.push(added);
            }
        }
        if (!pages.includes(this.page)) this.page = pages[0] ?? 'index.html';
        this.panel.title = `Site Preview · ${this.page}${this.source === 'original' ? ' (original)' : ''}`;
        this.panel.webview.html = this.buildHtml(pages);
    }

    private buildHtml(pages: string[]): string {
        const file = this.site.pagePath(this.source, this.page);
        let html: string;
        try {
            html = this.source === 'copy' ? this.io.read(file) : fs.readFileSync(file, 'utf8');
        } catch {
            html = `<!DOCTYPE html><html><head></head><body style="font-family:sans-serif;padding:2em">Cannot read <code>${escapeHtml(this.page)}</code>.</body></html>`;
        }

        const options = pages.map((p) =>
            `<option value="${escapeHtml(p)}"${p === this.page ? ' selected' : ''}>${escapeHtml(p)}</option>`).join('');
        const bar = /* html */ `
            <label>Page <select id="page">${options}</select></label>
            <span><button id="src-copy" class="${this.source === 'copy' ? 'on' : ''}" title="The development copy: ${escapeHtml(this.site.devName)}">Working copy</button><button id="src-original" class="${this.source === 'original' ? 'on' : ''}" title="Your untouched files">Original</button></span>
            <button id="edit" title="Select, move, resize and retype parts of this page">Edit</button>
            <button id="revert" title="Undo Draw2Code's changes to the selected element">Revert element</button>
            <button id="revert-page" title="Undo every Draw2Code change on this page">Revert page</button>
            <span class="hint" id="hint"></span>
            <span class="spacer"></span>
            <button id="refresh" title="Re-render">Refresh</button>`;

        return buildPageHtml(this.panel.webview, {
            html,
            file,
            siteRoot: this.source === 'copy' ? this.site.work : this.site.root,
            bar,
            editable: this.source === 'copy',
            alwaysEditing: false,
            heldStylesheets: this.source === 'copy' ? heldStylesheet(this.site.work, this.page) : [],
        });
    }

    public dispose(): void {
        SitePreviewPanel.current = undefined;
        clearTimeout(this.refreshTimer);
        this.panel.dispose();
        while (this.disposables.length) this.disposables.pop()?.dispose();
    }
}

/**
 * Paths from the file watcher and from Node do not match literally: VS Code
 * hands back a lower-case drive letter ("c:\\...") where Node wrote "C:\\...".
 * Compared as-is, our own writes look like someone else's and reload the
 * page, throwing away the selection mid-edit.
 */
function selfWriteKey(file: string): string {
    return path.normalize(file).toLowerCase();
}


