// Live preview: renders the generated HTML in a tab beside the canvas and
// refreshes whenever the design changes.
//
// CS50 citation: the name Draw2Code Web Editor was chosen with help from
// Claude (Anthropic AI), and at my direction Claude renamed
// the project from its earlier name, HardHat Designer, throughout this file.

import * as vscode from 'vscode';

export class PreviewPanel {
    private readonly panel: vscode.WebviewPanel;
    private disposed = false;

    constructor(onDispose: () => void) {
        this.panel = vscode.window.createWebviewPanel(
            'draw2code.preview',
            'Draw2Code Preview',
            { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
            // Generated pages are HTML + CSS only: no scripts, no local files.
            { enableScripts: false, localResourceRoots: [] }
        );
        this.panel.onDidDispose(() => {
            this.disposed = true;
            onDispose();
        });
    }

    public reveal(): void {
        this.panel.reveal(vscode.ViewColumn.Beside, true);
    }

    public update(html: string): void {
        if (this.disposed) {
            return;
        }
        // The generated page has an inline <style> block; allow exactly that.
        const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:;">`;
        this.panel.webview.html = html.replace('<head>', `<head>\n  ${csp}`);
    }

    public dispose(): void {
        this.panel.dispose();
    }
}
