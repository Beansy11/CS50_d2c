// The site project as the extension sees it: which workspace folder is the
// site, its development copy, and the user-facing Apply / Sync / Reset flows.
//
// CS50 citation: The desktop app builder's Publish message was removed from
// this file with Claude (Anthropic AI), at my direction, when
// that builder was taken out of this project.
//
// CS50 citation: the name Draw2Code Web Editor was chosen with help from
// Claude (Anthropic AI), and at my direction Claude renamed
// the project from its earlier name, HardHat Designer, throughout this file.

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import * as files from './siteFiles';
import { clearOverrides } from './pageEditor';
import { forget } from './history';
import { HeldFiles } from './heldFiles';
import { isProject, PROJECT_FILE, readProject, writeImportLabel } from '../../src/projectFormat';
import { buildProd } from '../../src/publish';

export class SiteProject {
    private constructor(public readonly root: string) {}

    /** The development copy: `<site>-dev`, beside the site. */
    public get work(): string {
        return files.workRoot(this.root);
    }

    public get name(): string {
        return path.basename(this.root);
    }

    public get devName(): string {
        return path.basename(this.work);
    }

    /** A project Draw2Code made (from New Design), rather than an imported site. */
    public get isCreated(): boolean {
        return isProject(this.root);
    }

    /**
     * The project's label, which opens it: a saved project's own
     * `.draw2code/project.d2c`, or the one an import keeps in its -dev copy.
     */
    public get labelFile(): string {
        return path.join(this.isCreated ? this.root : this.work, PROJECT_FILE);
    }

    /** An import's -dev says which site it is a copy of (never the original). */
    private labelImport(): void {
        const version = String(vscode.extensions.getExtension('beansy.draw2code-web-editor')?.packageJSON?.version ?? '');
        writeImportLabel(this.root, this.work, version);
    }

    /** What Publish updates: a saved project's -prod, or an import's own folder. */
    public get finalName(): string {
        return readProject(this.root)?.prod ?? this.name;
    }

    /** The site chosen this session; Generate writes into this one. */
    private static chosen: SiteProject | undefined;

    public static get current(): SiteProject | undefined {
        return SiteProject.chosen;
    }

    /**
     * Adopt a known folder as the chosen site. Picking `homepage-dev` means
     * `homepage`: the copy is not a site of its own, and treating it as one
     * would make `homepage-dev-dev` and edit a copy of a copy.
     */
    public static use(root: string): SiteProject {
        SiteProject.chosen = new SiteProject(files.originalOf(root) ?? root);
        return SiteProject.chosen;
    }

    /** Sites found in the open folders, nearest the top first. */
    public static scan(): string[] {
        const found: string[] = [];
        for (const folder of vscode.workspace.workspaceFolders ?? []) {
            found.push(...files.findSites(folder.uri.fsPath));
        }
        return found;
    }

    /**
     * Ask which folder is the site. Always asks, so a project with several
     * sites (or none) is never guessed at, and always offers to browse.
     */
    public static async choose(): Promise<SiteProject | undefined> {
        const roots = SiteProject.scan();
        const workspace = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        const items: (vscode.QuickPickItem & { root?: string; browse?: boolean })[] = roots.map((root) => ({
            label: path.basename(root),
            description: workspace ? (path.relative(workspace, root) || '.') : root,
            detail: root,
            root,
            picked: root === SiteProject.chosen?.root,
        }));
        items.push({ label: '$(folder-opened) Choose another folder...', description: 'Pick any folder with pages in it', browse: true });

        const picked = await vscode.window.showQuickPick(items, {
            title: 'Draw2Code: which folder is the site?',
            placeHolder: roots.length ? 'Folders with pages in them' : 'No pages found in the open folder',
        });
        if (!picked) return undefined;

        let root = picked.root;
        if (picked.browse) {
            const chosen = await vscode.window.showOpenDialog({
                canSelectFolders: true, canSelectFiles: false, canSelectMany: false,
                openLabel: 'Use as site', title: 'Choose the site folder (its pages may be in templates/, views/, pages/, public/ or www/)',
            });
            root = chosen?.[0]?.fsPath;
            if (!root) return undefined;
            if (!files.isSite(root)) {
                void vscode.window.showWarningMessage(`${path.basename(root)} has no pages Draw2Code can open (.html here, or in templates/, views/, pages/, public/ or www/).`);
                return undefined;
            }
        }
        if (!root) return undefined;
        // Browsing can reach a development copy that the list itself hides.
        const original = files.originalOf(root);
        if (original) {
            void vscode.window.showInformationMessage(
                `${path.basename(root)} is Draw2Code's copy of ${path.basename(original)}. Editing ${path.basename(original)}.`);
        }
        return SiteProject.use(root);
    }

    /** The chosen site, asking the first time. */
    public static async require(): Promise<SiteProject | undefined> {
        return SiteProject.chosen ?? await SiteProject.choose();
    }

    /** Make the development copy the first time; leave it alone after that. */
    public ensureCopy(): 'created' | 'existing' {
        // A saved project's -dev IS the site; there is nothing to copy it from.
        if (this.isCreated) return 'existing';
        if (files.hasWorkingCopy(this.root)) {
            files.ensureSnapshot(this.root); // a copy made by hand has none
            this.labelImport();
            return 'existing';
        }
        files.createWorkingCopy(this.root);
        clearOverrides(this.work); // a fresh copy has no markers; old rules would misfire
        forget(this.work);
        this.labelImport();
        return 'created';
    }

    /**
     * The original changed on disk: take it into the copy without asking,
     * because the copy is where the work happens and the original is only
     * read. A file edited in BOTH places is the one case worth a question.
     * Returns true when the copy changed, so the page can be reloaded.
     */
    public async syncFromOriginal(): Promise<boolean> {
        if (this.isCreated || !files.hasWorkingCopy(this.root)) return false;
        const { synced, conflicts } = files.syncFromOriginal(this.root);
        let resolved: string[] = [];
        if (conflicts.length > 0) {
            const listed = conflicts.slice(0, 10).join('\n');
            const more = conflicts.length > 10 ? `\n… and ${conflicts.length - 10} more` : '';
            const choice = await vscode.window.showWarningMessage(
                `${conflicts.length} file${conflicts.length === 1 ? '' : 's'} changed in both ${this.name} and ${this.devName}.`,
                {
                    modal: true,
                    detail: `${listed}${more}\n\nKeep the edits in ${this.devName}, or replace them with ${this.name}'s version?`,
                },
                `Keep ${this.devName}`, `Take ${this.name}`);
            if (choice === `Take ${this.name}`) {
                resolved = files.syncFromOriginal(this.root, conflicts).synced;
            } else if (choice === `Keep ${this.devName}`) {
                files.keepMine(this.root, conflicts); // seen; do not ask again
            }
        }
        const changed = [...synced, ...resolved];
        if (changed.length > 0) {
            vscode.window.setStatusBarMessage(
                `Draw2Code: ${changed.length} file${changed.length === 1 ? '' : 's'} synced from ${this.name}`, 4000);
        }
        return changed.length > 0;
    }

    public pages(source: 'copy' | 'original'): string[] {
        return files.listPages(source === 'copy' ? this.work : this.root);
    }

    public pagePath(source: 'copy' | 'original', page: string): string {
        return path.join(source === 'copy' ? this.work : this.root, page);
    }

    public writeToCopy(rel: string, content: string): string {
        this.ensureCopy();
        const dest = path.join(this.work, rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, content, 'utf8');
        return dest;
    }

    /**
     * Publish: the only thing that ever writes into the user's own folder.
     * Everything up to here happened in `<site>-dev`, so this is a deliberate
     * "make it final", listed file by file and confirmed.
     */
    public async apply(): Promise<void> {
        // Publishing takes what is SAVED; unsaved edits are saved first, if
        // the person agrees.
        const held = HeldFiles.for(this.work);
        if (held?.dirty) {
            const choice = await vscode.window.showInformationMessage(
                `${this.devName} has edits that are not saved. Publishing uses the saved copy, so they are saved first.`,
                'Save and Publish');
            if (choice !== 'Save and Publish') return;
            if (!held.requestSave || !await held.requestSave() || held.dirty) return;
        }
        if (this.isCreated) {
            // A saved project publishes to its own -prod: output, rebuilt
            // every time, never edited by hand - so nothing to confirm.
            try {
                const result = buildProd(this.root);
                void vscode.window.showInformationMessage(
                    `Published ${result.pages.length} page${result.pages.length === 1 ? '' : 's'} to ${path.basename(result.prod)} - ready to host.`);
            } catch (err) {
                void vscode.window.showErrorMessage(`Draw2Code could not publish: ${err instanceof Error ? err.message : String(err)}`);
            }
            return;
        }
        if (!files.hasWorkingCopy(this.root)) {
            void vscode.window.showInformationMessage(`There is no ${this.devName} folder yet. Open the editor first.`);
            return;
        }
        const diff = files.diffCopy(this.root).filter((d) => d.status !== 'unchanged');
        if (diff.length === 0) {
            void vscode.window.showInformationMessage(`${this.devName} matches ${this.name}. Nothing to publish.`);
            return;
        }
        const lines = diff.map((d) => `${d.status === 'added' ? '+' : '~'} ${d.file}`);
        const shown = lines.slice(0, 20).join('\n') + (lines.length > 20 ? `\n… and ${lines.length - 20} more` : '');
        const choice = await vscode.window.showWarningMessage(
            `Publish ${diff.length} file${diff.length === 1 ? '' : 's'} from ${this.devName} into ${this.name}?`,
            {
                modal: true,
                detail: `${shown}\n\n+ added   ~ changed\n${this.name} is your final copy; this is the only thing that writes to it. Files it has that ${this.devName} does not are left alone.`,
            },
            'Publish');
        if (choice !== 'Publish') return;
        const written = files.applyCopy(this.root);
        void vscode.window.showInformationMessage(`Published ${written.length} file${written.length === 1 ? '' : 's'} to ${this.name}.`);
    }

    /** Reset: throw the development copy away and copy the original again. */
    public async reset(): Promise<boolean> {
        if (this.isCreated) {
            void vscode.window.showInformationMessage(`${this.name} was made in Draw2Code, so there is no original to copy it from again. Ctrl+Z undoes edits.`);
            return false;
        }
        const choice = await vscode.window.showWarningMessage(
            `Make ${this.devName} again from ${this.name}? Everything in ${this.devName} that has not been applied, and every edit Draw2Code has recorded for it, will be lost.`,
            { modal: true }, 'Reset');
        if (choice !== 'Reset') return false;
        files.createWorkingCopy(this.root);
        clearOverrides(this.work);
        forget(this.work);
        this.labelImport();
        // Unsaved edits were for the copy that is gone: drop them, and saving
        // nothing marks the open project clean again.
        const held = HeldFiles.for(this.work);
        if (held) {
            held.discard();
            await held.requestSave?.();
        }
        void vscode.window.showInformationMessage(`${this.devName} made again from ${this.name}.`);
        return true;
    }
}
