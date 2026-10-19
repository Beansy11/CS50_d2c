// Noticing when a website shows up in the open folder.
//
// Two moments matter: a site folder being pasted in
// while the editor is open, and opening a folder that already holds one.
// Both offer the same thing: draw that site in the editor, or keep what is
// on the canvas. "Keep" is remembered per folder, so it is asked once.
//
// CS50 citation: the name Draw2Code Web Editor was chosen with help from
// Claude (Anthropic AI), and at my direction Claude renamed
// the project from its earlier name, HardHat Designer, throughout this file.

import * as path from 'path';
import * as vscode from 'vscode';
import { DesignerPanel } from './designerPanel';
import { SiteProject } from './site';
import { hasWorkingCopy, originalDiffers } from './siteFiles';
import { isProject } from '../../src/projectFormat';

const IGNORED_KEY = 'draw2code.sitesToIgnore';
/** Paste drops many files at once; wait for the burst to finish. */
const SETTLE_MS = 700;

export class ImportWatcher {
    private timer: NodeJS.Timeout | undefined;
    /** An import question is waiting for an answer (it can wait in the notification centre). */
    private asking = false;
    /** A sync from the original is running (it may be asking about conflicts). */
    private syncing = false;

    constructor(private readonly context: vscode.ExtensionContext) {}

    public start(): vscode.Disposable[] {
        const watcher = vscode.workspace.createFileSystemWatcher('**/*');
        const subscriptions = [
            watcher,
            watcher.onDidCreate((uri) => this.schedule(uri)),
            watcher.onDidChange((uri) => this.schedule(uri)),
            watcher.onDidDelete((uri) => this.schedule(uri)),
            vscode.workspace.onDidChangeWorkspaceFolders(() => this.schedule()),
        ];
        this.schedule(); // a folder opened with a site in it counts too
        return subscriptions;
    }

    /** Files Draw2Code itself writes are not news. */
    private touched: string[] = [];

    private schedule(uri?: vscode.Uri): void {
        if (uri) {
            const file = uri.fsPath;
            if (file.includes(`${path.sep}.draw2code${path.sep}`)) return;
            this.touched.push(file);
        }
        clearTimeout(this.timer);
        this.timer = setTimeout(() => void this.check(), SETTLE_MS);
    }

    private ignored(): string[] {
        return this.context.workspaceState.get<string[]>(IGNORED_KEY, []);
    }

    private async ignore(root: string): Promise<void> {
        await this.context.workspaceState.update(IGNORED_KEY, [...this.ignored(), key(root)]);
    }

    /** Offer again for a site the user chose to keep quiet about. */
    public async forget(root: string): Promise<void> {
        const left = this.ignored().filter((entry) => entry !== key(root));
        await this.context.workspaceState.update(IGNORED_KEY, left);
    }

    private async check(): Promise<void> {
        // The site being edited follows its original first, whatever else is
        // waiting: an unanswered import question must not stop the sync.
        const touched = this.touched;
        this.touched = [];
        await this.syncEdits(touched);
        if (this.asking) return;
        const editing = DesignerPanel.current?.siteRoot;
        // A project Draw2Code made is not an import: it was saved here on purpose,
        // and Open Editor lists it. Only sites that arrived from elsewhere are news.
        const candidates = SiteProject.scan().filter((root) =>
            !isProject(root) && !this.ignored().includes(key(root)) && key(root) !== key(editing ?? ''));
        if (candidates.length === 0) return;

        this.asking = true;
        try {
            const names = candidates.map((root) => path.basename(root));
            const message = candidates.length === 1
                ? `Detected import of ${names[0]}.`
                : `Detected ${candidates.length} sites: ${names.join(', ')}.`;
            const redraw = candidates.length === 1 ? 'Redraw' : 'Choose site...';
            const answer = await vscode.window.showInformationMessage(
                `${message} Draw it in the editor?`, redraw, 'Keep current contents');

            if (answer === 'Keep current contents') {
                for (const root of candidates) await this.ignore(root);
                return;
            }
            if (answer !== redraw) return; // dismissed: ask again next time

            const root = candidates.length === 1 ? candidates[0] : await pickSite(candidates);
            if (!root) return;
            await this.redraw(root);
        } finally {
            this.asking = false;
        }
    }

    /** Switch the editor to that site, warning before dropping a drawing. */
    private async redraw(root: string): Promise<void> {
        const drawn = DesignerPanel.current?.canvasElementCount ?? 0;
        if (drawn > 0) {
            const go = await vscode.window.showWarningMessage(
                `Draw ${path.basename(root)} in the editor?`,
                { modal: true, detail: `${drawn} element${drawn === 1 ? '' : 's'} on the canvas will be discarded. Designs cannot be saved yet.` },
                'Discard and draw');
            if (go !== 'Discard and draw') return;
        }
        await DesignerPanel.openSite(SiteProject.use(root));
    }

    /**
     * The original changed on disk - the user edited their own files by hand.
     * Take those edits into the development copy straight away: asking every
     * time would be noise, and the copy is the only place being edited, so
     * there is usually nothing to weigh up. SiteProject.syncFromOriginal
     * speaks up only when the same file changed on both sides.
     */
    private async syncEdits(touched: string[]): Promise<void> {
        const root = DesignerPanel.current?.siteRoot;
        if (!root || !hasWorkingCopy(root)) return;
        // Only the site being edited, and only its own files: a change
        // somewhere else in the workspace is not this site changing.
        const inThisSite = touched.some((file) => key(file).startsWith(key(root) + path.sep));
        // And only against the fingerprint taken when it was copied: making
        // the copy is itself a burst of file events.
        if (this.syncing || !inThisSite || !originalDiffers(root)) return;
        this.syncing = true;
        try {
            const site = SiteProject.use(root);
            if (await site.syncFromOriginal()) DesignerPanel.current?.reload();
        } finally {
            this.syncing = false;
        }
    }
}

async function pickSite(roots: string[]): Promise<string | undefined> {
    const picked = await vscode.window.showQuickPick(
        roots.map((root) => ({ label: path.basename(root), detail: root, root })),
        { title: 'Which site should the editor draw?' });
    return picked?.root;
}

function key(root: string): string {
    return path.normalize(root).toLowerCase();
}
