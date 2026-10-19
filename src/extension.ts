// Draw2Code Web Editor - VS Code extension entry point.
//
// CS50 citation: The commands of the separate desktop app builder were removed
// from this file with Claude (Anthropic AI), at my direction,
// when that builder was taken out of this project.
//
// CS50 citation: the name Draw2Code Web Editor was chosen with help from
// Claude (Anthropic AI), and at my direction Claude renamed
// the project from its earlier name, HardHat Designer, throughout this file.

import * as vscode from 'vscode';
import { DesignerPanel } from '../website-editor/src/designerPanel';
import { ImportWatcher } from '../website-editor/src/importWatcher';
import { ProjectEditorProvider } from './projectEditor';
import { SiteProject } from '../website-editor/src/site';
import { SitePreviewPanel } from '../website-editor/src/sitePreviewPanel';

// Called by VS Code the first time one of our commands runs.
export function activate(context: vscode.ExtensionContext): void {
    // An unsaved new design is kept here, out of the workspace.
    DesignerPanel.storage = context.globalState;
    // Watches for a website appearing in the open folder.
    const imports = new ImportWatcher(context);
    context.subscriptions.push(...imports.start());
    // Commands that need an open design say so instead of failing silently.
    const withDesign = (run: (panel: DesignerPanel) => void) => () => {
        if (!DesignerPanel.current) {
            void vscode.window.showInformationMessage('Open a design first: Draw2Code: New Design');
            return;
        }
        run(DesignerPanel.current);
    };

    context.subscriptions.push(
        // Double-clicking a project's .draw2code/project.d2c opens the project.
        ProjectEditorProvider.register(context),
        // A new design is an untitled .d2c, protected by VS Code like any unsaved file.
        vscode.commands.registerCommand('draw2code.newDesign', () => DesignerPanel.newDesign()),
        vscode.commands.registerCommand('draw2code.saveDesign', withDesign((p) => void p.saveProject())),
        vscode.commands.registerCommand('draw2code.showPreview', withDesign((p) => p.showPreview())),
        vscode.commands.registerCommand('draw2code.generateHtml', withDesign((p) => void p.generate())),
        vscode.commands.registerCommand('draw2code.generateHtmlAs', withDesign((p) => void p.saveHtml(true))),
        // How wide every page of a project Draw2Code made is; asked, then confirmed.
        vscode.commands.registerCommand('draw2code.pageWidth', withDesign((p) => void p.changePageWidth())),

        // The canvas bound to a site: edits go to the development copy, and
        // the preview sits beside it. Originals change only on Apply.
        vscode.commands.registerCommand('draw2code.openEditor', async () => {
            const site = await SiteProject.require();
            if (!site) return;
            const created = site.ensureCopy() === 'created';
            // The editor shows the real page itself; the preview stays
            // available as the clean view with the Original toggle.
            await DesignerPanel.openSite(site);
            if (created) {
                void vscode.window.showInformationMessage(
                    `Editing ${site.devName}. Your ${site.name} folder is not written to at all until you Apply.`);
            }
        }),

        // Site mode: preview an existing site's working copy, apply, reset.
        vscode.commands.registerCommand('draw2code.openSitePreview', async () => {
            const site = await SiteProject.choose();
            if (!site) return;
            if (site.ensureCopy() === 'created') {
                void vscode.window.showInformationMessage(`Editing ${site.devName}. Edits and Generate go there; use Publish when ready.`);
            }
            SitePreviewPanel.show(site);
        }),
        vscode.commands.registerCommand('draw2code.applySiteChanges', async () => {
            const site = await SiteProject.require();
            if (site) await site.apply();
        }),
        vscode.commands.registerCommand('draw2code.importSite', async () => {
            const site = await SiteProject.choose();
            if (!site) return;
            await imports.forget(site.root); // asked for it: offer it again later
            await DesignerPanel.openSite(site);
        }),
        vscode.commands.registerCommand('draw2code.resetSiteCopy', async () => {
            const site = await SiteProject.require();
            if (!site || !await site.reset()) return;
            SitePreviewPanel.current?.render();
            DesignerPanel.current?.reload();
        }),
    );
}

export function deactivate(): void {
    // Nothing to clean up yet; subscriptions handle it.
}
