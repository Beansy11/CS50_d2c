// For the tests: the page as the extension writes it into a webview
// (src/pageShell.ts buildPageHtml, compiled to out/ by npm test's pretest),
// with a stand-in for the vscode module it imports. Not a test of its own.

const Module = require('module');
const path = require('path');

/** A vscode.Uri as far as the shell uses it. */
const uri = (fsPath) => ({ fsPath, toString: () => `vscode-resource:${fsPath}` });
const VSCODE = { Uri: { file: uri, joinPath: (base, ...parts) => uri(path.join(base.fsPath, ...parts)) } };

/**
 * The whole page: a plain one, in the Site Preview's shell, or with
 * editor: true in the editor's (its browser bar and toolbar).
 */
function shellHtml({ editor = false } = {}) {
    const load = Module._load;
    Module._load = function (request, ...rest) {
        return request === 'vscode' ? VSCODE : load.call(this, request, ...rest);
    };
    try {
        const S = require('../../out/website-editor/src/pageShell.js');
        const webview = { cspSource: 'vscode-resource:', asWebviewUri: (u) => u };
        const chrome = editor ? {
            extensionUri: uri(path.join(__dirname, '..', '..')),
            tabs: [{ name: 'index.html', title: 'Home' }], page: 'index.html', pages: ['index.html'],
            canBack: false, canForward: false, addable: true,
        } : undefined;
        return S.buildPageHtml(webview, {
            html: '<!DOCTYPE html><html><head><title>Home</title></head><body><p>Hi</p></body></html>',
            file: '/site/index.html', siteRoot: '/site', bar: '', editable: true,
            alwaysEditing: editor, toolbar: editor, chrome, copyPaste: editor,
        });
    } finally {
        Module._load = load;
    }
}

module.exports = { shellHtml };
