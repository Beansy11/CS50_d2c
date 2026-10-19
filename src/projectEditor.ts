// `.d2c` files open in the Designer: double-clicking a project's label
// (`<root>/.draw2code/project.d2c`) opens that project, the way a text file
// opens in a text editor. VS Code owns the tab; DesignerPanel fills it.
//
// The label is the project's DOCUMENT: while it is open, edits are held
// (website-editor/src/heldFiles.ts) and the tab shows ●; Save writes them into -dev, closing
// asks "Save changes?", and VS Code keeps a backup of unsaved edits when the
// window closes - all VS Code's own safeguards.
//
// A new design is an UNTITLED `.d2c` (New Design): the same safeguards, and
// saving it makes the project - named by the name typed in the Save dialog.
//
// CS50 citation: The desktop app builder's project tabs were removed from this
// file with Claude (Anthropic AI), at my direction, when that
// builder was taken out of this project.
//
// CS50 citation: the name Draw2Code Web Editor was chosen with help from
// Claude (Anthropic AI), and at my direction Claude renamed
// the project from its earlier name, HardHat Designer, throughout this file.

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Design, emptyDesign } from '../website-editor/src/design';
import { DesignerPanel } from '../website-editor/src/designerPanel';
import { HeldFiles } from '../website-editor/src/heldFiles';
import * as history from '../website-editor/src/history';
import { projectRootOf, writeEditorState } from './projectFormat';
import { escapeHtml } from '../website-editor/src/pageShell';
import { SiteProject } from '../website-editor/src/site';
import { workRoot } from '../website-editor/src/siteFiles';
import { SitePreviewPanel } from '../website-editor/src/sitePreviewPanel';

/** How a new design's unsaved drawing is kept by VS Code's hot exit. */
const DESIGN_BACKUP = 'draw2code-design';

class ProjectDocument implements vscode.CustomDocument {
    /** A new design: the drawing, as the canvas last sent it. */
    public design: Design | undefined;
    /** A design just saved: the project it became, which opens in its place. */
    public savedAs: { root: string; name: string; page: string } | undefined;

    constructor(
        public readonly uri: vscode.Uri,
        /** The site it opens; null when the file is not a project's label. */
        public readonly root: string | null,
        /** Edits not saved yet (none for a file that is not a label). */
        public readonly held: HeldFiles | undefined,
    ) {}

    public dispose(): void {
        this.held?.unregister();
    }
}

export class ProjectEditorProvider implements vscode.CustomEditorProvider<ProjectDocument> {
    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        return vscode.window.registerCustomEditorProvider(
            DesignerPanel.viewType,
            new ProjectEditorProvider(context.extensionUri),
            {
                // Keep the page alive when the tab is hidden, as the panel always has.
                webviewOptions: { retainContextWhenHidden: true },
                supportsMultipleEditorsPerDocument: false,
            });
    }

    private readonly changed = new vscode.EventEmitter<vscode.CustomDocumentEditEvent<ProjectDocument>>();
    public readonly onDidChangeCustomDocument = this.changed.event;

    private constructor(private readonly extensionUri: vscode.Uri) {}

    public async openCustomDocument(uri: vscode.Uri, context: vscode.CustomDocumentOpenContext): Promise<ProjectDocument> {
        if (uri.scheme === 'untitled') return this.openDesign(uri, context);

        // The file a new design was just saved as: it stands for the project made.
        const saved = DesignerPanel.savedAs.get(uri.toString());
        if (saved) {
            const document = new ProjectDocument(uri, null, undefined);
            document.savedAs = saved;
            return document;
        }

        const root = uri.scheme === 'file' ? projectRootOf(uri.fsPath) : null;
        if (!root) return new ProjectDocument(uri, null, undefined);
        const held = new HeldFiles(workRoot(root));
        // Reopened after VS Code closed with unsaved edits: take them back.
        const backup = readBackup(context.backupId);
        if (backup) held.restore(backup);
        const document = new ProjectDocument(uri, root, held);
        held.onDidEdit = (label) => this.changed.fire({ document, label, undo: this.step(uri, 'undo'), redo: this.step(uri, 'redo') });
        held.requestSave = async () => Boolean(await vscode.workspace.save(uri));
        held.register();
        return document;
    }

    private openDesign(uri: vscode.Uri, context: vscode.CustomDocumentOpenContext): ProjectDocument {
        const document = new ProjectDocument(uri, null, undefined);
        const backup = readBackup(context.backupId) as { format?: string; design?: Design } | null;
        document.design = backup?.format === DESIGN_BACKUP && backup.design?.pages ? backup.design : emptyDesign();
        return document;
    }

    /**
     * Each edit is one step of VS Code's undo; stepping runs Draw2Code's own
     * steps - the page snapshots (website-editor/src/history.ts) or the canvas's - which
     * were recorded in the same order.
     */
    private step(uri: vscode.Uri, direction: 'undo' | 'redo'): () => void {
        return () => DesignerPanel.forDocument(uri)?.travel(direction);
    }

    public resolveCustomEditor(document: ProjectDocument, panel: vscode.WebviewPanel): void {
        if (document.savedAs) {
            // Saving a design converts it: the project opens in its own
            // tab, and this one - named after the file typed - goes.
            const saved = document.savedAs;
            panel.webview.html = '';
            void DesignerPanel.openSite(SiteProject.use(saved.root), saved.page).then(() => {
                panel.dispose();
                const site = SiteProject.use(saved.root);
                void vscode.window.showInformationMessage(`Saved ${saved.name}. You are now editing ${site.devName}; Publish builds ${saved.name}-prod.`);
            });
            return;
        }
        if (document.design) {
            const designer = DesignerPanel.openDesign(this.extensionUri, panel, document.uri, document.design);
            designer.onDesign = (design, step) => {
                document.design = design;
                if (step) this.changed.fire({ document, label: 'Drawing', undo: this.step(document.uri, 'undo'), redo: this.step(document.uri, 'redo') });
            };
            return;
        }
        if (!document.root) {
            panel.webview.options = { enableScripts: false };
            panel.webview.html = notAProject(document.uri);
            return;
        }
        DesignerPanel.openProject(this.extensionUri, panel, document.uri, document.root);
    }

    /** Save: every held edit into the development copy. */
    public async saveCustomDocument(document: ProjectDocument): Promise<void> {
        if (!document.held) return;
        const written = document.held.save();
        // The editor's tabs and page are saved with the edits (not an edit themselves).
        const designer = DesignerPanel.forDocument(document.uri);
        const state = designer?.editorState;
        if (state && writeEditorState(document.uri.fsPath, state)) written.push(document.uri.fsPath);
        designer?.noteOwnWrites(written);
        SitePreviewPanel.current?.scheduleRender();
    }

    /**
     * Save As. A new design becomes a project, named by the file name typed;
     * a project's edits are saved where they belong, and the label is copied.
     */
    public async saveCustomDocumentAs(document: ProjectDocument, destination: vscode.Uri): Promise<void> {
        if (document.design) {
            const designer = DesignerPanel.forDocument(document.uri);
            await designer?.flushDesign();
            DesignerPanel.writeDesignAs(this.extensionUri, document.design, destination);
            return;
        }
        await this.saveCustomDocument(document);
        await vscode.workspace.fs.copy(document.uri, destination, { overwrite: true });
    }

    /** Revert: forget the unsaved edits (or the drawing) and show what is saved. */
    public async revertCustomDocument(document: ProjectDocument): Promise<void> {
        if (document.design) {
            document.design = emptyDesign();
            DesignerPanel.forDocument(document.uri)?.loadDesign(document.design);
            return;
        }
        document.held?.discard();
        // The snapshots describe edits that are gone now.
        if (document.held) history.forget(document.held.work);
        DesignerPanel.forDocument(document.uri)?.reverted();
        SitePreviewPanel.current?.render();
    }

    /** VS Code's hot exit: unsaved work is kept where VS Code asks, never in the site. */
    public async backupCustomDocument(document: ProjectDocument, context: vscode.CustomDocumentBackupContext): Promise<vscode.CustomDocumentBackup> {
        const file = context.destination.fsPath;
        const data = document.design ? { format: DESIGN_BACKUP, design: document.design } : document.held?.backup() ?? null;
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(data), 'utf8');
        return {
            id: context.destination.toString(),
            delete: () => fs.rmSync(file, { force: true }),
        };
    }
}

function readBackup(backupId: string | undefined): unknown {
    if (!backupId) return null;
    try {
        return JSON.parse(fs.readFileSync(vscode.Uri.parse(backupId).fsPath, 'utf8'));
    } catch {
        return null; // no usable backup: open what is saved
    }
}

/** Any other `.d2c`: say what Draw2Code expected, instead of a blank tab. */
function notAProject(uri: vscode.Uri): string {
    const name = escapeHtml(path.basename(uri.fsPath || uri.path));
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';">
    <style>body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 2em; }</style>
</head>
<body>
    <p><strong>${name}</strong> is not a project Draw2Code can open.</p>
    <p>A project's label lives at <code>&lt;project&gt;/.draw2code/project.d2c</code> and is written by Draw2Code when a design is saved.</p>
</body>
</html>`;
}
