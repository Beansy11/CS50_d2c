// The canvas tab. Owns one WebviewPanel and talks to the page inside it.
//
// CS50 citation: the name Draw2Code Web Editor was chosen with help from
// Claude (Anthropic AI), and at my direction Claude renamed
// the project from its earlier name, HardHat Designer, throughout this file.

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { activeElements, Design, emptyDesign, loadHtmlGenerator, loadModel } from './design';
import { EditorState, readEditorState, readProject, writeEditorState, writePageWidth } from '../../src/projectFormat';
import { isBlankDesign, planSaveAs, writeProject, ProjectGenerator } from './siteProject';
import { PreviewPanel } from './previewPanel';
import { SiteProject } from './site';
import { SitePreviewPanel } from './sitePreviewPanel';
import { bodyClasses, copyElement, Declarations, ElementRef, linkInfo, newPageFrom, pageStyles, placesInWrapper, SectionTarget, sectionTargets, usedIds, withoutPhoneClass } from './pageEdit';
import { phoneDraft, SeenElement, wordsToMeasure, WordsToMeasure } from './phoneDraft';
import { Clip, CopiedElement, copiedRules, Origin, pasteElements, pasteOffset, PASTE_STEP, SeenBox } from './copyPaste';
import { checkPageWidth, PAGE_WIDTH, PAGE_WIDTH_MAX, PAGE_WIDTH_MIN, setStylesheetPageWidth } from './pageWidth';
import { checkAddress, checkHref, checkSectionName, linkedFile, pageHref } from './links';
import { checkImageSrc, IMAGE_EXTENSIONS, isImageFile, placeFile, planCopies, sameFile } from './images';
import { embedOf, oneFileNote, ownPlayerLinks, PLAYER, pickedVideoFiles, playerSource, VIDEO_EXTENSIONS, videoName } from './videos';
import { entryPage, isPage, TEMPLATE } from './siteFiles';
import { absentPage, applyEdit, BATCH_LABELS, cssPathFor, dropHeldPage, EditOp, heldStylesheet, inPhoneView, pageIsHeld, pageOfFile, pagesLinkingTo, phoneHidden, phoneKey, phoneViewCss, readOverrides, removedPageWarning, restorePage, snapshotPage, viewStylesheet } from './pageEditor';
import { disk, FileAccess, HeldFiles } from './heldFiles';
import * as history from './history';
import { buildPageHtml, escapeHtml, pageTitle } from './pageShell';
import { RECENT_MAX, recentOf } from './colours';
import { drawnInColumn } from './placement';

/** A file picked to add to a page: where it is, and where it goes in the site (see placeFile). */
type PickedFile = { from: string; file: string; copy: boolean };

/**
 * A video picked to add: the site's own file (with a picture to show before
 * it plays, or none), or a hosted one. `video` is its .webm when it has an
 * .mp4 too (`mp4`), and otherwise its one file, as the model's src and srcMp4.
 */
type PickedVideo = { title: string } & ({ embed: string } | { video: PickedFile; mp4?: PickedFile; poster?: PickedFile });

/** The two kinds the toolbar's Video tool adds: the site's own file, or a YouTube or Vimeo link. */
type VideoKind = 'own' | 'hosted';

/** How long a phone layout's first draft waits for the overlay to measure its words before it estimates them. */
const MEASURE_WAIT_MS = 3000;

// Messages the webview (media/main.js) sends to us.
type WebviewMessage =
    | { type: 'ready' }
    | { type: 'status'; text: string }
    | { type: 'design'; design: Design; flushed?: boolean; step?: boolean }
    | { type: 'preview' }
    | { type: 'generate' }
    // page mode: editing someone's real page
    | { type: 'edit'; op: EditOp }
    | { type: 'page'; page: string }
    | { type: 'back' }
    | { type: 'forward' }
    | { type: 'closeTab'; page: string }
    | { type: 'addPage' }
    | { type: 'requestAddPage' }
    | { type: 'undo' }
    | { type: 'redo' }
    | { type: 'retitle'; page: string; title: string }
    | { type: 'draw'; tool: string; box: { x: number; y: number; w: number; h: number }; flip?: boolean;
        points?: number[][]; into: { ref: ElementRef; label: string } | null; kind?: VideoKind;
        style?: { fill: string; stroke: string; strokeWidth: number };
        /** Where the page's wrapper starts, measured as the box is, and how wide it is, when the page has one. */
        wrapper?: Origin }
    | { type: 'link'; ref: ElementRef; looks?: Declarations }
    // Ctrl+C and Ctrl+D: the selected elements, in the page's order, with
    // their boxes as shown; Ctrl+V: where the page's wrapper is, if any.
    | { type: 'copy' | 'duplicate'; items: Array<{ ref: ElementRef; box: SeenBox; full?: boolean }>; wrapper?: Origin }
    | { type: 'paste'; wrapper?: Origin }
    | { type: 'recentColours'; colours: string[] }
    | { type: 'pageWidth' }
    | { type: 'view'; view: 'desktop' | 'phone'; elements?: SeenElement[] }
    | { type: 'resetPhone'; elements?: SeenElement[] }
    | { type: 'wordHeights'; id: number; heights?: Record<string, number> }
    | { type: 'refresh' }
    | { type: 'apply' };

export class DesignerPanel {
    // One panel at a time for now. One per design file may come later.
    public static current: DesignerPanel | undefined;

    /**
     * Where an unsaved design is kept safe: VS Code's own storage for this
     * extension, not the workspace (nothing appears in
     * the open folder until the design is saved). Set by activate().
     */
    public static storage: vscode.Memento | undefined;
    private static readonly BACKUP_KEY = 'draw2code.unsavedDesign';
    /** The page editor's colours used last (src/colours.ts), kept in the same storage for every site. */
    private static readonly RECENT_COLOURS_KEY = 'draw2code.recentColours';

    /** The backup, if there is one worth offering. */
    public static unsavedBackup(): { savedAt: number; design: Design } | undefined {
        const backup = DesignerPanel.storage?.get<{ savedAt: number; design: Design }>(DesignerPanel.BACKUP_KEY);
        return backup && backup.design && !isBlankDesign(backup.design) ? backup : undefined;
    }

    public static async forgetBackup(): Promise<void> {
        await DesignerPanel.storage?.update(DesignerPanel.BACKUP_KEY, undefined);
    }

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];

    /** Latest copy of the design from the webview. */
    private design: Design = emptyDesign();
    private preview: PreviewPanel | undefined;
    /** Has the webview said it is listening? Messages sent before that are lost. */
    private webviewReady = false;
    /** A design to hand the canvas once it is listening (a restored backup). */
    private pendingLoad: { type: 'loadDesign'; design: Design; asStep: boolean } | undefined;
    /** Where Generate writes; asked for once (decision: save straight to a file). */
    private htmlTarget: vscode.Uri | undefined;
    /** Shown in the webview's status bar, e.g. which site is being edited. */
    private notice = 'Extension connected';

    /**
     * What this tab is showing. 'canvas' is the blank grid for a new design;
     * 'page' is someone's real page with the editing overlay on top - the
     * same view the preview shows, but always editable.
     */
    private mode: 'canvas' | 'page' = 'canvas';
    private site: SiteProject | undefined;
    /** Pages visited in page mode, and where we are in that history. */
    private history: string[] = [];
    private historyAt = -1;
    /** Pages with a tab, in the order they were opened. One tab per page. */
    private openTabs: string[] = [];
    private ignoreWatcherUntil = 0;
    private selfWrites = new Map<string, number>();
    private watcher: vscode.FileSystemWatcher | undefined;

    /**
     * The project's held edits, kept here: when the tab closes, VS Code may
     * have let go of the document already, but whether it had unsaved work
     * still matters.
     */
    private held: HeldFiles | undefined;

    /** Folders this tab is allowed to load files from. */
    private readonly roots: vscode.Uri[];

    /**
     * Files copied into a development copy this session - pictures, videos,
     * the video player's - by copy, then site-relative path. Only these are
     * ever taken away again (see reconcileImages). A picture is kept with its
     * bytes, which put it back on redo; a video, which may be hundreds of MB,
     * with the file it was copied from instead.
     */
    private static readonly copiedImages = new Map<string, Map<string, Buffer | string>>();

    /**
     * What Ctrl+C copied last, by development copy: kept here, not in the
     * page, so it is still there after the page is drawn again, on another
     * page of the site, and in a Designer opened again (src/copyPaste.ts).
     */
    private static readonly clips = new Map<string, Clip>();

    /** Ids of elements to select once the page is drawn again: what was just pasted. */
    private selectNext: string[] = [];

    /** Every Designer tab that is open (one, unless closing another was cancelled). */
    private static readonly open = new Set<DesignerPanel>();

    /** The Designer showing a document, if it is open. */
    public static forDocument(uri: vscode.Uri): DesignerPanel | undefined {
        return [...DesignerPanel.open].find((designer) => designer.documentUri?.toString() === uri.toString());
    }

    /**
     * One Designer at a time: the others close as VS Code
     * closes any tab, so one with unsaved work asks first - and stays open if
     * the question is cancelled.
     */
    private static async closeOthers(keep: DesignerPanel): Promise<void> {
        for (const other of [...DesignerPanel.open]) {
            if (other === keep) continue;
            const tab = other.documentUri && vscode.window.tabGroups.all.flatMap((group) => group.tabs).find((candidate) =>
                candidate.input instanceof vscode.TabInputCustom && candidate.input.uri.toString() === other.documentUri?.toString());
            if (tab) await vscode.window.tabGroups.close(tab);
            else other.dispose();
        }
    }

    /**
     * A project opened from its label (`<root>/.draw2code/project.d2c`): VS Code
     * made the tab, and this fills it with the editor on the project's pages.
     */
    public static openProject(extensionUri: vscode.Uri, panel: vscode.WebviewPanel, file: vscode.Uri, root: string): void {
        const site = SiteProject.use(root);
        // An import's -dev sits beside the site, outside it: both are allowed.
        const roots = [
            vscode.Uri.joinPath(extensionUri, 'website-editor', 'media'),
            ...(vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri),
            vscode.Uri.file(site.root),
            vscode.Uri.file(site.work),
        ];
        panel.webview.options = { enableScripts: true, localResourceRoots: roots };
        const designer = new DesignerPanel(panel, extensionUri, roots, file);
        const key = file.fsPath.toLowerCase();
        // A page Draw2Code asked for wins; otherwise where the project was left.
        const remembered = file.scheme === 'file' ? readEditorState(file.fsPath) : undefined;
        const page = DesignerPanel.openingPage.get(key) ?? remembered?.page;
        DesignerPanel.openingPage.delete(key);
        designer.openPage(site, page, remembered?.tabs);
        void DesignerPanel.closeOthers(designer);
    }

    /**
     * A new design: an untitled `.d2c`, so VS Code's own
     * safeguards cover it - ● while it has work, "Save changes?" on close,
     * and a backup when VS Code closes. `design` is what it starts with.
     */
    public static openDesign(extensionUri: vscode.Uri, panel: vscode.WebviewPanel, file: vscode.Uri, design: Design): DesignerPanel {
        const roots = [vscode.Uri.joinPath(extensionUri, 'website-editor', 'media')];
        panel.webview.options = { enableScripts: true, localResourceRoots: roots };
        const designer = new DesignerPanel(panel, extensionUri, roots, file);
        if (!isBlankDesign(design)) designer.loadDesign(design);
        void DesignerPanel.closeOthers(designer);
        return designer;
    }

    /** Draw2Code Web Editor: New Design - the next free Untitled-N.d2c. */
    public static async newDesign(): Promise<void> {
        const taken = new Set(vscode.window.tabGroups.all.flatMap((group) => group.tabs)
            .map((tab) => tab.input instanceof vscode.TabInputCustom ? tab.input.uri.toString() : ''));
        // Placed in the open folder, so VS Code's Save dialog starts there.
        const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
        const untitled = (n: number): vscode.Uri => folder
            ? vscode.Uri.joinPath(folder, `Untitled-${n}.d2c`).with({ scheme: 'untitled' })
            : vscode.Uri.parse(`untitled:Untitled-${n}.d2c`);
        let n = 1;
        while (taken.has(untitled(n).toString())) n++;
        await vscode.commands.executeCommand('vscode.openWith', untitled(n), DesignerPanel.viewType);
        await DesignerPanel.offerOldBackup();
    }

    /**
     * Before the .d2c editor existed, an unsaved design was kept in Draw2Code's own storage. If one is
     * still there it is offered back once, into the new design - after that,
     * VS Code's safeguards look after it.
     */
    private static async offerOldBackup(): Promise<void> {
        const backup = DesignerPanel.unsavedBackup();
        if (!backup) return;
        await DesignerPanel.forgetBackup();
        const pages = backup.design.pages?.length ?? 1;
        const elements = (backup.design.pages ?? []).reduce((n, p) => n + p.elements.length, 0);
        const when = new Date(backup.savedAt).toLocaleString();
        const choice = await vscode.window.showInformationMessage(
            `Restore the design you didn't save? ${pages} page${pages === 1 ? '' : 's'}, ${elements} element${elements === 1 ? '' : 's'} - last changed ${when}.`,
            'Restore', 'Discard');
        const designer = DesignerPanel.current;
        if (choice === 'Restore' && designer?.mode === 'canvas') designer.loadDesign(backup.design, true);
    }

    /**
     * Show `design` on the canvas. As a step (a restored backup), it is an
     * edit VS Code can undo; otherwise the canvas starts its history from it.
     */
    public loadDesign(design: Design, asStep = false): void {
        this.design = design;
        const message = { type: 'loadDesign' as const, design, asStep };
        if (this.webviewReady) void this.panel.webview.postMessage(message);
        else this.pendingLoad = message;
    }

    /**
     * The canvas's design changed. `step` is true when it is a new step of
     * its undo (not a restore or a page switch): an edit for VS Code.
     * Set by the editor that owns the document.
     */
    public onDesign: ((design: Design, step: boolean) => void) | undefined;

    /** VS Code's name for the editor that opens `.d2c` files (package.json). */
    public static readonly viewType = 'draw2code.project';

    /** A page to open on, for a project that is being opened by Draw2Code itself. */
    private static openingPage = new Map<string, string>();

    /**
     * Open a site's project tab: the way every command opens a site,
     * so a project always opens the same way as a
     * double-click on its label. An import is labelled first.
     */
    public static async openSite(site: SiteProject, page?: string): Promise<void> {
        site.ensureCopy();
        const label = vscode.Uri.file(site.labelFile);
        if (page) DesignerPanel.openingPage.set(label.fsPath.toLowerCase(), page);
        await vscode.commands.executeCommand('vscode.openWith', label, DesignerPanel.viewType);
    }

    /** The `.d2c` this tab was opened from; undefined for a plain panel. */
    public readonly documentUri: vscode.Uri | undefined;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, roots: vscode.Uri[], documentUri?: vscode.Uri) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.roots = roots;
        this.documentUri = documentUri;
        DesignerPanel.open.add(this);
        DesignerPanel.current = this;

        this.render();

        this.panel.webview.onDidReceiveMessage(
            (msg: WebviewMessage) => this.onMessage(msg),
            null,
            this.disposables
        );

        this.panel.onDidDispose(() => this.onClosed(), null, this.disposables);
    }

    private onMessage(msg: WebviewMessage): void {
        switch (msg.type) {
            case 'ready':
                // The page is only listening now; anything said earlier
                // (like which site this canvas is editing) is sent here.
                this.webviewReady = true;
                this.panel.webview.postMessage({ type: 'hello', text: this.notice });
                if (this.pendingLoad && this.mode === 'canvas') {
                    this.panel.webview.postMessage(this.pendingLoad);
                    this.pendingLoad = undefined;
                }
                break;
            case 'status':
                vscode.window.setStatusBarMessage(`Draw2Code: ${msg.text}`, 3000);
                break;
            case 'design':
                this.design = msg.design;
                if (this.mode === 'canvas') this.onDesign?.(msg.design, Boolean(msg.step));
                if (msg.flushed) this.flushWaiters.splice(0).forEach((resolve) => resolve());
                this.preview?.update(this.generateHtml());
                break;
            case 'preview':
                // A real page previews as the site does; the canvas has its own HTML preview.
                if (this.mode === 'page' && this.site) SitePreviewPanel.show(this.site, this.currentPage);
                else this.showPreview();
                break;
            case 'generate':
                void this.generate();
                break;
            case 'edit':
                this.onEdit(msg.op);
                break;
            case 'page':
                this.goTo(msg.page);
                break;
            case 'back':
                this.step(-1);
                break;
            case 'forward':
                this.step(1);
                break;
            case 'closeTab':
                this.closeTab(msg.page);
                break;
            case 'addPage':
                this.addPage();
                break;
            case 'requestAddPage':
                void this.requestAddPage();
                break;
            case 'draw':
                void this.onDraw(msg);
                break;
            case 'link':
                void this.onLink(msg);
                break;
            case 'copy':
            case 'duplicate':
                this.onCopy(msg);
                break;
            case 'paste':
                this.onPaste(msg.wrapper);
                break;
            case 'retitle':
                this.retitle(msg.page, msg.title);
                break;
            case 'undo':
            case 'redo':
                // A project's steps are VS Code's (Edit menu, ● cleared when
                // undone back to the save): ask VS Code, which calls travel.
                if (this.documentUri) void vscode.commands.executeCommand(msg.type);
                else this.travel(msg.type);
                break;
            case 'pageWidth':
                void this.changePageWidth();
                break;
            case 'view':
                void this.changeView(msg.view, msg.elements ?? []);
                break;
            case 'resetPhone':
                void this.resetPhone(msg.elements ?? []);
                break;
            case 'wordHeights':
                this.measuring.get(msg.id)?.(msg.heights && typeof msg.heights === 'object' ? msg.heights : {});
                break;
            case 'recentColours':
                // Read back at once when the page is drawn again, so the
                // edit that follows this message already shows them.
                void DesignerPanel.storage?.update(DesignerPanel.RECENT_COLOURS_KEY, recentOf(msg.colours, RECENT_MAX));
                break;
            case 'refresh':
                this.render();
                break;
            case 'apply':
                // A silently dropped promise here would look like a dead
                // button; say what went wrong instead.
                this.site?.apply().catch((err: unknown) =>
                    void vscode.window.showErrorMessage(`Draw2Code could not apply: ${String(err)}`));
                break;
        }
    }

    // ---- page mode ------------------------------------------------------

    /** Show a real page of `site` in this tab, with the editing overlay. */
    public openPage(site: SiteProject, page?: string, tabs: string[] = []): void {
        this.site = site;
        this.held = HeldFiles.for(site.work);
        site.ensureCopy();
        const pages = this.copyPages();
        const wanted = page && pages.includes(page) ? page : pages[0] ?? TEMPLATE.entry;
        this.mode = 'page';
        this.history = [wanted];
        this.historyAt = 0;
        // Tabs remembered from last time, as long as their pages are still there.
        this.openTabs = tabs.filter((tab, at) => pages.includes(tab) && tabs.indexOf(tab) === at);
        if (!this.openTabs.includes(wanted)) this.openTabs.push(wanted);
        this.watchSite(site);
        this.render();
    }

    /** Which page tabs are open and which page is shown (kept in project.d2c). */
    public get editorState(): EditorState | undefined {
        const page = this.currentPage;
        return this.mode === 'page' && page ? { tabs: [...this.openTabs], page } : undefined;
    }

    /**
     * Where this tab reads and writes the site: the open project's held
     * edits (nothing reaches -dev until Save), or the disk.
     */
    private get io(): FileAccess {
        return (this.site && HeldFiles.for(this.site.work)) ?? disk;
    }

    /** The copy's pages, with any page added since the last save. */
    private copyPages(): string[] {
        const site = this.site;
        if (!site) return [];
        const held = HeldFiles.for(site.work);
        const removed = held?.removed() ?? [];
        const pages = site.pages('copy').filter((p) => !removed.includes(p));
        for (const added of held?.added() ?? []) {
            if (isPage(added) && !pages.includes(added)) pages.push(added);
        }
        return pages;
    }

    /** Files Draw2Code itself just wrote (a save): not a reason to redraw. */
    public noteOwnWrites(files: string[]): void {
        const now = Date.now();
        this.ignoreWatcherUntil = now + 1500;
        for (const file of files) this.selfWrites.set(file.toLowerCase(), now);
    }

    /** When unsaved edits were last thrown away (Revert File, or Don't Save on close). */
    private revertedAt = 0;

    /** The document was reverted: its edits are gone, and the page is drawn from what is saved. */
    public reverted(): void {
        this.revertedAt = Date.now();
        this.reconcileImages();
        this.reload();
    }

    /** Draw the page again, after something under it changed on disk. */
    public reload(): void {
        if (this.mode === 'page') this.render();
    }

    /** The site this tab is editing, if it is showing a page. */
    public get siteRoot(): string | undefined {
        return this.mode === 'page' ? this.site?.root : undefined;
    }

    /** How much is drawn on the blank canvas (0 when showing a page). */
    public get canvasElementCount(): number {
        return this.mode === 'canvas' ? activeElements(this.design).length : 0;
    }

    public get currentPage(): string | undefined {
        return this.historyAt >= 0 ? this.history[this.historyAt] : undefined;
    }

    private goTo(page: string): void {
        if (page === this.currentPage) return;
        // A new destination truncates whatever was ahead, like a browser.
        this.history = [...this.history.slice(0, this.historyAt + 1), page];
        this.historyAt = this.history.length - 1;
        this.tabFor(page);
        this.render();
    }

    private step(direction: -1 | 1): void {
        const next = this.historyAt + direction;
        if (next < 0 || next >= this.history.length) return;
        this.historyAt = next;
        this.tabFor(this.history[next]);
        this.render();
    }

    /**
     * `+`: another page OF THIS SITE. It takes the current page's head and
     * banner so it belongs from the start, lands in the
     * development copy only, and is named like the canvas names pages -
     * page2.html, page3.html - so the address bar can rename it.
     */
    private addPage(): void {
        const site = this.site;
        const from = this.currentPage;
        if (!site || !from) return;
        // Beside the page being shown: a Flask project's pages live in
        // templates/, and a new one belongs with them, not at the root.
        const dir = path.posix.dirname(from.split(path.sep).join('/'));
        const prefix = dir === '.' ? '' : `${dir}/`;
        const taken = this.copyPages().map((p) => p.toLowerCase());
        let name = '';
        for (let n = 2; !name; n++) {
            if (!taken.includes(`${prefix}page${n}.html`.toLowerCase())) name = `${prefix}page${n}.html`;
        }
        let source = '';
        try {
            source = this.io.read(site.pagePath('copy', from));
        } catch {
            source = '<!DOCTYPE html><html><head></head><body></body></html>';
        }
        // Its title is the HOME page's: pages of one site
        // usually share its name, and double-clicking the tab renames it.
        const base = path.posix.basename(name).replace(/\.html?$/i, '');
        let title = base.charAt(0).toUpperCase() + base.slice(1);
        const home = entryPage(site.work);
        if (home) {
            try {
                title = pageTitle(this.io.read(site.pagePath('copy', home)), title);
            } catch {
                /* keep the name-based title */
            }
        }
        const file = site.pagePath('copy', name);
        // Undoable like any edit: before it, the page did not exist.
        history.record(site.work, absentPage(name));
        this.io.write(file, newPageFrom(source, title));
        if (this.io === disk) this.selfWrites.set(file.toLowerCase(), Date.now());
        this.edited('Add page');
        vscode.window.setStatusBarMessage(`Draw2Code: added ${name} to ${site.devName}`, 4000);
        this.goTo(name);
    }

    /**
     * Something was drawn on a real page. Where it goes is asked every time
     * (a default comes with Settings): placed freely -
     * exactly where it was drawn, moving nothing - or added into the section
     * it was drawn over, where the page flows around it. The element is the
     * canvas's element, made by the same model and generator, so the two
     * modes produce the same markup.
     */
    private async onDraw(msg: Extract<WebviewMessage, { type: 'draw' }>): Promise<void> {
        const site = this.site;
        const page = this.currentPage;
        if (!site || !page) return;

        type Choice = vscode.QuickPickItem & { where: 'free' | 'into' };
        const choices: Choice[] = [
            { label: '$(move) Place freely', description: 'exactly where you drew it; nothing else moves', where: 'free' },
        ];
        if (msg.into) {
            choices.push({ label: `$(list-tree) Add to ${msg.into.label}`, description: 'as part of that section; the page flows around it', where: 'into' });
        }
        const picked = await vscode.window.showQuickPick(choices, { title: `Where should this ${msg.tool} go?`, placeHolder: 'Esc adds nothing' });
        if (!picked) return;
        // A picture needs its file and its words before anything is added,
        // and a video its files or link and its name: which of the two the
        // toolbar's Video tool was set to.
        const picture = msg.tool === 'image' ? await this.pickImage(site) : undefined;
        if (msg.tool === 'image' && !picture) return;
        const film = msg.tool === 'video' ? await this.pickVideo(site, msg.kind === 'hosted' ? 'hosted' : 'own') : undefined;
        if (msg.tool === 'video' && !film) return;
        const ownVideo = film && 'video' in film ? film : undefined;
        const src = picture ? pageHref(page, picture.file) : ownVideo ? pageHref(page, ownVideo.video.file) : '';
        const srcMp4 = ownVideo?.mp4 ? pageHref(page, ownVideo.mp4.file) : '';
        const poster = ownVideo?.poster ? pageHref(page, ownVideo.poster.file) : '';
        for (const address of [src, srcMp4, poster].filter(Boolean)) {
            const checked = checkImageSrc(address, page);
            if ('problem' in checked) {
                void vscode.window.showWarningMessage(`Draw2Code: ${checked.problem}; nothing is added`);
                return;
            }
        }

        const M = loadModel(this.extensionUri);
        const H = loadHtmlGenerator(this.extensionUri);
        let html = '';
        try {
            html = this.io.read(site.pagePath('copy', page));
        } catch {
            return;
        }
        // An id nobody in the page has: rect-1, rect-2, ... per type.
        const taken = usedIds(html);
        let n = 1;
        while (taken.has(`${msg.tool}-${n}`)) n++;

        // Placed freely inside the page's wrapper, an element is measured from
        // the wrapper's top-left, which is centred in a window wider than the
        // page: the box drawn is moved by where the wrapper starts.
        const shift = picked.where === 'free' && msg.wrapper && placesInWrapper(html) ? msg.wrapper : { x: 0, y: 0 };
        const drawnBox = { ...msg.box, x: Math.round(msg.box.x - shift.x), y: Math.round(msg.box.y - shift.y) };
        const drawnPoints = (msg.points ?? []).map(([x, y]) => [Math.round(x - shift.x), Math.round(y - shift.y)]);

        // Shapes take the style chosen in the toolbar; widgets keep their own
        // per-type look, as on the canvas, and a video is a black box.
        const style = M.isWidget(msg.tool) ? M.WIDGET_DEFAULTS[msg.tool]
            : msg.tool === 'video' ? M.VIDEO_STYLE
            : { ...M.DEFAULT_STYLE, ...(msg.style ?? {}) };
        let element: Record<string, unknown>;
        if (msg.tool === 'pen') {
            element = M.createPen(n, drawnPoints, style);
        } else {
            const size = (drawnBox.w === 0 && drawnBox.h === 0) ? M.defaultSize(msg.tool) : null;
            // Kept in the page's column (src/placement.ts): a widget clicked
            // near a side, at its default size, is moved in.
            const column = shift === msg.wrapper ? Number(msg.wrapper?.width) : 0;
            const box = drawnInColumn(size ? { ...drawnBox, w: size.w, h: size.h } : drawnBox, column);
            element = M.createElement(n, msg.tool, box, style);
            if (msg.flip && msg.tool === 'line') element = { ...element, flip: true };
            if (picture) element = M.setProp(M.setProp(element, 'src', src), 'alt', picture.alt);
            if (film) {
                element = M.setProp(element, 'title', film.title);
                element = 'embed' in film ? M.setProp(element, 'embed', film.embed)
                    : M.setProp(M.setProp(M.setProp(element, 'src', src), 'srcMp4', srcMp4), 'poster', poster);
            }
        }
        const parts = H.elementParts(element);
        const [box, ...extraRules] = parts.rules;
        const declarations: Record<string, string> = { ...box.declarations };
        if (picked.where === 'free') {
            declarations.position = 'absolute';
        } else {
            delete declarations.left;
            delete declarations.top;
            // A video's player and frame are laid over its box, which must
            // be positioned for that, also in the section's flow.
            if (msg.tool === 'video') declarations.position = 'relative';
        }
        // A video file plays in the site's player, whose two files the page links.
        const player = ownVideo ? this.placePlayer(site, page, html) : undefined;
        // Copied before the element is added; one copied for an element that
        // then is not added goes again (see onEdit).
        const films = [ownVideo?.video, ownVideo?.mp4];
        const files = [picture, ...films, ownVideo?.poster, ...(player?.files ?? [])];
        for (const file of files) {
            if (!file?.copy) continue;
            if (!this.copyImage(site, file.from, file.file, films.includes(file))) {
                this.reconcileImages();
                return;
            }
        }
        const added = this.onEdit({
            op: 'add',
            ref: { id: parts.id },
            markup: parts.html,
            declarations,
            into: picked.where === 'into' && msg.into ? msg.into.ref : undefined,
            extraRules,
            head: player && (player.stylesheets.length || player.scripts.length) ? { stylesheets: player.stylesheets, scripts: player.scripts } : undefined,
        });
        const main = (picture ? [picture] : films).filter((file) => file?.copy).map((file) => file?.file);
        const copied = main.length ? ` - ${main.join(' and ')} copied into ${site.devName}` : '';
        vscode.window.setStatusBarMessage(`Draw2Code: added ${parts.id}${picked.where === 'into' && msg.into ? ` to ${msg.into.label}` : ''}${copied}`, 4000);
        // A video with one file does not play everywhere: a .webm not in this
        // editor, an H.264 .mp4 not on some systems. With both, each plays one.
        const note = added && ownVideo && !ownVideo.mp4 ? oneFileNote(ownVideo.video.from) : undefined;
        if (note) void vscode.window.showInformationMessage(`Draw2Code: ${note}`);
    }

    /**
     * Pick one file to add to the page, in the Open dialog: which kinds it
     * offers (`filters`), and `check`, since a typed name gets past the
     * filter, with `kinds` saying what it should have been. Esc adds
     * nothing; nothing is copied yet (see placeInSite).
     */
    private async pickFile(site: SiteProject, ask: { title: string; openLabel: string; filters: Record<string, string[]>;
        check: (file: string) => boolean; kinds: string }): Promise<PickedFile | undefined> {
        const picked = await vscode.window.showOpenDialog({ title: ask.title, openLabel: ask.openLabel, canSelectMany: false, filters: ask.filters });
        const from = picked?.[0]?.fsPath;
        if (!from) return undefined;
        if (!ask.check(from)) {
            const exts = Object.values(ask.filters).flat().map((ext) => `.${ext}`).join(' ');
            void vscode.window.showWarningMessage(`Draw2Code: ${path.basename(from)} is not ${ask.kinds} (${exts}); nothing is added`);
            return undefined;
        }
        return { from, ...this.placeInSite(site, from, TEMPLATE.assetsDir) };
    }

    /**
     * Where a file to add goes in the site (placeFile): in `dir` under a
     * free name, unless the very same file is there already. A name copied
     * earlier and taken away again is still taken: undo can bring it back.
     */
    private placeInSite(site: SiteProject, from: string, dir: string): { file: string; copy: boolean } {
        const copies = DesignerPanel.copiedImages.get(site.work);
        const onDisk = (file: string): boolean => fs.existsSync(path.join(site.work, file));
        // The same file picked again is not copied twice: one that holds its
        // bytes (on disk, or as remembered for one an undo took away) is used.
        const same = (file: string): boolean => {
            if (onDisk(file)) return sameFile(from, path.join(site.work, file));
            const kept = copies?.get(file);
            if (typeof kept === 'string') return sameFile(from, kept);
            try {
                return kept !== undefined && fs.statSync(from).size === kept.length && fs.readFileSync(from).equals(kept);
            } catch {
                return false; // copyImage says why, if it comes to copying
            }
        };
        const place = placeFile(site.work, from, dir, (file) => onDisk(file) || Boolean(copies?.has(file)), same, [...(copies?.keys() ?? [])]);
        // One used again but taken away by an undo is written back now.
        if (!place.copy && !onDisk(place.file)) place.copy = true;
        return place;
    }

    /** Image: which picture, and what it shows. Esc at either question adds nothing. */
    private async pickImage(site: SiteProject): Promise<(PickedFile & { alt: string }) | undefined> {
        const picture = await this.pickFile(site, {
            title: 'Add a picture to the page',
            openLabel: 'Add picture',
            filters: { Pictures: [...IMAGE_EXTENSIONS] },
            check: isImageFile,
            kinds: 'a picture',
        });
        if (!picture) return undefined;
        const alt = await vscode.window.showInputBox({
            title: `Describe ${path.basename(picture.from)}`,
            prompt: 'What the picture shows, for people who cannot see it. Leave it empty if it is only decoration - Esc adds nothing',
        });
        if (alt === undefined) return undefined;
        return { ...picture, alt: alt.trim() };
    }

    /**
     * Video, of the kind the toolbar's Video tool was set to: the user's own
     * files, with a name and a picture to show before it plays (or none:
     * then its first frame shows), or a YouTube or Vimeo link and its name.
     * Esc at any question adds nothing; nothing is copied yet.
     */
    private async pickVideo(site: SiteProject, kind: VideoKind): Promise<PickedVideo | undefined> {
        const nameIt = (title: string, value: string): Thenable<string | undefined> => vscode.window.showInputBox({
            title,
            prompt: 'What the video is, in a few words - screen readers say it. Esc adds nothing',
            value,
        });

        if (kind === 'hosted') {
            const typed = await vscode.window.showInputBox({
                title: 'Embed a hosted video',
                prompt: 'Paste a YouTube or Vimeo link (youtube.com/watch?v=..., youtu.be/..., youtube.com/shorts/..., vimeo.com/123...) - Esc adds nothing',
                placeHolder: 'https://youtu.be/...',
                // Empty is not wrong yet, only unfinished: Enter on it adds nothing.
                validateInput: (value) => {
                    const found = embedOf(value);
                    return value.trim() === '' || 'embed' in found ? undefined : found.problem;
                },
            });
            if (!typed) return undefined;
            const found = embedOf(typed);
            if ('problem' in found) return undefined;
            const fallback = `${found.provider} video`;
            const title = await nameIt(`Name this ${found.provider} video`, fallback);
            if (title === undefined) return undefined;
            // A frame must have a title, so an empty one is the provider's.
            return { embed: found.embed, title: title.trim() || fallback };
        }

        // One dialog for both files: a .webm, an .mp4, or (best) the same video as each.
        const chosen = await vscode.window.showOpenDialog({
            title: 'Add a video to the page - its .webm and its .mp4 (the other one can be added next) play everywhere',
            openLabel: 'Add video',
            canSelectMany: true,
            filters: { Videos: [...VIDEO_EXTENSIONS] },
        });
        if (!chosen?.length) return undefined;
        // The dialog only filters: a typed name gets past it, and so do two of one kind.
        let files = chosen.map((uri) => uri.fsPath);
        let picked = pickedVideoFiles(files);
        if ('problem' in picked) {
            void vscode.window.showWarningMessage(`Draw2Code: ${picked.problem}; nothing is added`);
            return undefined;
        }
        // One file: VS Code's own Open dialog (files.simpleDialog) takes only
        // one, so the other kind is offered in a second dialog.
        if (picked.mp4 === undefined) {
            const has = path.extname(picked.video).toLowerCase() === '.webm' ? 'webm' : 'mp4';
            const other = has === 'webm' ? 'mp4' : 'webm';
            type Second = vscode.QuickPickItem & { add: boolean };
            const second = await vscode.window.showQuickPick<Second>([
                {
                    label: `$(add) Add its .${other} too...`,
                    description: other === 'mp4' ? 'plays in this editor, and in Safari and other systems that play H.264' : 'plays in browsers such as Fedora\'s',
                    add: true,
                },
                {
                    label: `$(arrow-right) Only the .${has}`,
                    description: has === 'webm' ? 'it will not play in this editor' : 'if it is H.264, it may not play on some systems, such as Fedora',
                    add: false,
                },
            ], { title: `The same video as an .${other} as well?`, placeHolder: 'Esc adds nothing' });
            if (!second) return undefined;
            if (second.add) {
                const more = await vscode.window.showOpenDialog({
                    title: `The .${other} of ${path.basename(picked.video)}`,
                    openLabel: 'Add video',
                    canSelectMany: false,
                    filters: { Videos: [other] },
                });
                if (!more?.length) return undefined;
                files = [...files, more[0].fsPath];
                picked = pickedVideoFiles(files);
                if ('problem' in picked || picked.mp4 === undefined) {
                    const problem = 'problem' in picked ? picked.problem : `${path.basename(more[0].fsPath)} is not an .${other}`;
                    void vscode.window.showWarningMessage(`Draw2Code: ${problem}; nothing is added`);
                    return undefined;
                }
            }
        }
        const video = { from: picked.video, ...this.placeInSite(site, picked.video, TEMPLATE.assetsDir) };
        const mp4 = picked.mp4 === undefined ? undefined : { from: picked.mp4, ...this.placeInSite(site, picked.mp4, TEMPLATE.assetsDir) };
        const names = [video, mp4].filter((file) => file !== undefined).map((file) => path.basename(file.from)).join(' and ');
        const title = await nameIt(`Name ${names}`, videoName(video.from));
        if (title === undefined) return undefined;
        type Poster = vscode.QuickPickItem & { choose: boolean };
        const wants = await vscode.window.showQuickPick<Poster>([
            { label: '$(circle-slash) No picture', description: 'the video\'s first frame shows', choose: false },
            { label: '$(file-media) Choose a picture...', choose: true },
        ], { title: 'A picture to show before it plays?', placeHolder: 'Esc adds nothing' });
        if (!wants) return undefined;
        // No alt text: the picture only stands in for the video, which has the name.
        const poster = wants.choose ? await this.pickFile(site, {
            title: 'A picture to show before the video plays',
            openLabel: 'Use picture',
            filters: { Pictures: [...IMAGE_EXTENSIONS] },
            check: isImageFile,
            kinds: 'a picture',
        }) : undefined;
        if (wants.choose && !poster) return undefined;
        return { video, mp4, poster, title: title.trim() || videoName(video.from) };
    }

    /**
     * The video player's stylesheet and script for a video file on `page`:
     * the ones it links already, or the extension's own, placed in the site
     * like a picture - the same file is used again, a different one of that
     * name gets video-player-2.js. What the page must link (written from
     * it), and the files to copy.
     */
    private placePlayer(site: SiteProject, page: string, html: string): { stylesheets: string[]; scripts: string[]; files: PickedFile[] } {
        // A site's own file of the player's name is not the player: ours goes beside it.
        const linked = ownPlayerLinks(html, page, (file) => this.io.read(path.join(site.work, file)));
        const source = playerSource(this.extensionUri.fsPath);
        const out = { stylesheets: [] as string[], scripts: [] as string[], files: [] as PickedFile[] };
        if (linked.stylesheet === undefined) {
            const place = this.placeInSite(site, source.stylesheet, path.posix.dirname(PLAYER.stylesheet));
            out.files.push({ from: source.stylesheet, ...place });
            out.stylesheets.push(pageHref(page, place.file));
        }
        if (linked.script === undefined) {
            const place = this.placeInSite(site, source.script, path.posix.dirname(PLAYER.script));
            out.files.push({ from: source.script, ...place });
            out.scripts.push(pageHref(page, place.file));
        }
        return out;
    }

    /**
     * Copy a picked file into the development copy, straight to disk (held
     * edits are text only), and remember it: a picture by its bytes, a
     * video (`big`) by the file it came from, so it is never held in memory.
     * False when it could not be copied (the user has been told why).
     */
    private copyImage(site: SiteProject, from: string, file: string, big = false): boolean {
        const target = path.join(site.work, file);
        try {
            fs.mkdirSync(path.dirname(target), { recursive: true });
            let kept: Buffer | string = from;
            if (big) {
                fs.copyFileSync(from, target);
            } else {
                kept = fs.readFileSync(from);
                fs.writeFileSync(target, kept);
            }
            const copies = DesignerPanel.copiedImages.get(site.work) ?? new Map<string, Buffer | string>();
            copies.set(file, kept);
            DesignerPanel.copiedImages.set(site.work, copies);
        } catch (err) {
            void vscode.window.showErrorMessage(`Draw2Code could not copy ${path.basename(from)}: ${String(err)}; nothing is added`);
            return false;
        }
        this.selfWrites.set(target.toLowerCase(), Date.now());
        return true;
    }

    /**
     * After a page changed (an edit, Delete, undo, redo, a revert): a file
     * copied this session that no page uses any more - unsaved edits
     * included - is taken off disk, and one used again is written back.
     * Files that were in the site before are never touched.
     */
    private reconcileImages(): void {
        const site = this.site;
        const copies = site && DesignerPanel.copiedImages.get(site.work);
        if (!site || !copies?.size) return;
        const pages: Array<{ page: string; html: string }> = [];
        for (const page of this.copyPages()) {
            try {
                pages.push({ page, html: this.io.read(site.pagePath('copy', page)) });
            } catch {
                return; // a page that cannot be read might use one: decide nothing
            }
        }
        const plan = planCopies([...copies.keys()], pages, (file) => fs.existsSync(path.join(site.work, file)));
        const now = Date.now();
        for (const file of plan.remove) fs.rmSync(path.join(site.work, file), { force: true });
        for (const file of plan.restore) {
            const target = path.join(site.work, file);
            const kept = copies.get(file)!;
            fs.mkdirSync(path.dirname(target), { recursive: true });
            if (typeof kept !== 'string') {
                fs.writeFileSync(target, kept);
                continue;
            }
            // A video is copied again from where it came from, if it is still there.
            try {
                fs.copyFileSync(kept, target);
            } catch {
                void vscode.window.showWarningMessage(`Draw2Code: ${file} could not be put back: ${kept} is no longer there`);
            }
        }
        for (const file of [...plan.remove, ...plan.restore]) this.selfWrites.set(path.join(site.work, file).toLowerCase(), now);
    }

    /**
     * The Desktop / Phone toggle of a page made in Draw2Code. The phone view
     * of a page with no phone layout yet asks first, then makes one from the
     * boxes the overlay measured (src/phoneDraft.ts) - one undo step, which
     * Ctrl+Z takes back to the desktop view.
     */
    private async changeView(view: 'desktop' | 'phone', elements: SeenElement[]): Promise<void> {
        const site = this.site;
        const page = this.currentPage;
        const project = site ? readProject(site.root) : null;
        if (!site || !page || !project) return;
        if (view === 'desktop' || readOverrides(site.work, this.io)[phoneKey(page)]) {
            if (view === this.view) return;
            this.view = view;
            this.render();
            return;
        }
        const make = 'Make a phone layout';
        const answer = await vscode.window.showInformationMessage(`Lay ${page} out for phones?`, {
            modal: true,
            detail: [
                `${page} gets a layout of its own for phones (windows up to 767px wide), started from its desktop layout scaled to a phone's width. Then a move, a resize, a font size or an alignment in the phone view changes it on phones only; colours, words, links and the rest still change it everywhere.`,
                'The desktop layout stays as it is. Ctrl+Z takes the phone layout away again; so does Revert page.',
            ].join('\n\n'),
        }, make);
        if (answer !== make || this.currentPage !== page) return;
        const phone = await this.draft(elements, project.pageWidth);
        if (this.currentPage !== page || readOverrides(site.work, this.io)[phoneKey(page)]) return;
        this.view = 'phone';
        if (!this.onEdit({ op: 'phoneLayout', ref: {}, phone }, 'desktop')) this.view = 'desktop';
    }

    /**
     * The first draft of a page's phone layout, from its elements as the
     * overlay measured them at desktop width: made once, then again with
     * the heights the overlay measures for the words of each Text and
     * Heading, and each label or button that wraps, at the width and size
     * the first one gave them (src/phoneDraft.ts wordsToMeasure).
     */
    private async draft(elements: SeenElement[], pageWidth: number | undefined): Promise<Record<string, Record<string, string>>> {
        const M = loadModel(this.extensionUri);
        const seen = Array.isArray(elements) ? elements : [];
        const sizes = { pageWidth: pageWidth ?? PAGE_WIDTH, phoneWidth: M.PHONE_WIDTH, fontMin: M.PHONE_FONT_MIN };
        const first = phoneDraft(seen, sizes);
        const texts = wordsToMeasure(seen, first);
        if (!texts.length) return first;
        return phoneDraft(seen, sizes, await this.measureWords(texts));
    }

    /** Requests to the overlay to measure words (measureWords), by number, while they wait. */
    private readonly measuring = new Map<number, (heights: Record<string, number>) => void>();
    private measured = 0;

    /** How tall the overlay finds each text's words at a width and size; none for any it did not answer within a few seconds. */
    private measureWords(texts: WordsToMeasure[]): Promise<Record<string, number>> {
        const id = ++this.measured;
        return new Promise((resolve) => {
            const done = (heights: Record<string, number>): void => {
                clearTimeout(timer);
                this.measuring.delete(id);
                resolve(heights);
            };
            const timer = setTimeout(() => done({}), MEASURE_WAIT_MS);
            this.measuring.set(id, done);
            void this.panel.webview.postMessage({ type: 'measureWords', id, texts });
        });
    }

    /**
     * Reset phone layout (the phone view): the page's phone layout made
     * again from its desktop layout, as the first time. Asks first: every
     * move, size and Hide on phone made there goes. One undo step.
     */
    private async resetPhone(elements: SeenElement[]): Promise<void> {
        const site = this.site;
        const page = this.currentPage;
        const project = site ? readProject(site.root) : null;
        if (!site || !page || !project || this.view !== 'phone') return;
        const reset = 'Reset phone layout';
        const answer = await vscode.window.showWarningMessage(`Make the phone layout of ${page} again?`, {
            modal: true,
            detail: `It is made again from the desktop layout, as the first time: every move, resize, font size, alignment and Hide on phone made in the phone view goes. The desktop layout stays as it is. Ctrl+Z puts the phone layout back.`,
        }, reset);
        if (answer !== reset || this.currentPage !== page || this.view !== 'phone') return;
        const phone = await this.draft(elements, project.pageWidth);
        if (this.currentPage !== page || this.view !== 'phone') return;
        this.onEdit({ op: 'phoneLayout', ref: {}, phone });
    }

    /**
     * Draw2Code: Page Width..., or the toolbar's page width button: how wide
     * every page of a project Draw2Code made is. The width typed is checked,
     * then what changes is explained in a modal, and only Change writes it:
     * the `.page` rule of the stylesheet every page shares, in the
     * development copy, and the project's label, which remembers it. A
     * setting of the project rather than an edit of a page, so it is
     * written at once and Ctrl+Z does not take it back; asking again does.
     */
    public async changePageWidth(): Promise<void> {
        const site = this.mode === 'page' ? this.site : undefined;
        const project = site ? readProject(site.root) : null;
        if (!site || !project) {
            void vscode.window.showInformationMessage(site
                ? `Draw2Code: ${site.name} is an imported site and keeps its own layout, so it has no page width to change.`
                : 'Draw2Code: the page width belongs to a saved project: save the design first, then change it in the page editor.');
            return;
        }
        const current = project.pageWidth ?? PAGE_WIDTH;
        const problem = (text: string): string | undefined => {
            const checked = checkPageWidth(text);
            return 'problem' in checked ? checked.problem : undefined;
        };
        const typed = await vscode.window.showInputBox({
            title: `Page width of ${project.name}`,
            prompt: `How wide every page is, in px (${PAGE_WIDTH_MIN} to ${PAGE_WIDTH_MAX}); now ${current}px. You are asked to confirm next - Esc changes nothing`,
            value: String(current),
            validateInput: problem,
        });
        const checked = typed === undefined ? undefined : checkPageWidth(typed);
        if (!checked || 'problem' in checked) return;
        const width = checked.width;
        if (width === current) {
            vscode.window.setStatusBarMessage(`Draw2Code: the pages are ${width}px wide already`, 3000);
            return;
        }
        const stylesheet = project.stylesheet ?? 'css/style.css';
        const sheet = path.join(site.work, stylesheet);
        let next: { css: string; changed: boolean } | null = null;
        try {
            next = setStylesheetPageWidth(fs.readFileSync(sheet, 'utf8'), width);
        } catch {
            void vscode.window.showWarningMessage(`Draw2Code: ${site.devName}/${stylesheet} cannot be read; the page width is kept`);
            return;
        }
        if (!next) {
            void vscode.window.showWarningMessage(`Draw2Code: ${site.devName}/${stylesheet} has no .page rule to give the width to; the page width is kept`);
            return;
        }
        const change = `Change to ${width}px`;
        const answer = await vscode.window.showWarningMessage(`Change the page width of ${project.name} from ${current}px to ${width}px?`, {
            modal: true,
            detail: [
                `Every page is laid out for the new width at once: each page becomes a column ${width}px wide, centred in a wider window, and a narrower window scrolls sideways.`,
                width < current
                    ? `Elements keep their x, y and size; nothing is moved or shrunk to fit. Anything further right than ${width}px is then outside the page: it is cut off, or shows only where the window is wider than the page.`
                    : `Elements keep their x, y and size; nothing is moved or stretched to fit, so the empty space to the right of your elements grows.`,
                'Full-width elements still stretch across the whole window.',
                `This is a setting of the whole project, written into ${site.devName} straight away: Ctrl+Z does not undo it. To go back, change the page width to ${current}px again.`,
            ].join('\n\n'),
        }, change);
        if (answer !== change) return;
        try {
            if (next.changed) fs.writeFileSync(sheet, next.css, 'utf8');
        } catch (err) {
            void vscode.window.showErrorMessage(`Draw2Code: could not write ${stylesheet}: ${String(err)}`);
            return;
        }
        writePageWidth(site.root, width);
        // Every tab showing this site draws its page again at the new width.
        for (const designer of DesignerPanel.open) {
            if (designer.siteRoot !== site.root) continue;
            designer.noteOwnWrites([sheet]);
            designer.render();
        }
        SitePreviewPanel.current?.scheduleRender();
        vscode.window.setStatusBarMessage(`Draw2Code: every page of ${project.name} is now ${width}px wide`, 4000);
    }

    /**
     * Link on a real page: where should the selected element go? Every page
     * of the site (written relative to this page), a section of this page or
     * of another one, a web address, and - when it is a link already -
     * Remove link, with where it links now marked. Esc changes nothing. What
     * cannot be a link (an image, a section) is refused here, with the reason.
     */
    private async onLink(msg: Extract<WebviewMessage, { type: 'link' }>): Promise<void> {
        const site = this.site;
        const page = this.currentPage;
        if (!site || !page) return;
        let html = '';
        try {
            html = this.io.read(site.pagePath('copy', page));
        } catch {
            return;
        }
        const found = linkInfo(html, msg.ref);
        if ('problem' in found) {
            void vscode.window.showWarningMessage(`Draw2Code: ${found.problem}`);
            return;
        }
        const name = `<${found.tag}>${msg.ref.id ? ` #${msg.ref.id}` : ''}`;
        const current = found.href;
        const now = 'where it links now';

        type Choice = vscode.QuickPickItem & { href?: string; action?: 'remove' | 'address' | 'section' | 'otherSection' };
        const choices: Choice[] = [];
        if (current !== undefined) {
            choices.push({
                label: '$(trash) Remove link',
                // Every href shows here, also one no item below stands for ("#top", "page.php").
                description: `${found.was ? `it goes back to the <${found.was.tag.toLowerCase()}> it was` : 'it becomes plain text (a <span>); its words and classes are kept'} - now ${current || '(empty)'}`,
                action: 'remove',
            });
        }
        choices.push({ label: 'Pages of this site', kind: vscode.QuickPickItemKind.Separator });
        // Marked by the page it reaches, however the href is written ("./about.html#team").
        const at = current !== undefined ? checkHref(current, page) : {};
        const linked = 'page' in at ? at.page : undefined;
        const fragment = 'fragment' in at ? at.fragment : undefined;
        for (const target of this.copyPages()) {
            const href = pageHref(page, target);
            choices.push({ label: `$(file) ${target}`, description: target === linked && fragment === undefined ? `${href} - ${now}` : href, href });
        }
        // A section: the element a link scrolls to, on this page or on another.
        const others = this.copyPages().filter((p) => p !== page);
        choices.push({ label: 'Sections', kind: vscode.QuickPickItemKind.Separator });
        choices.push({
            label: '$(list-tree) A section of this page...',
            description: fragment !== undefined && (linked === undefined || linked === page) ? `${current} - ${now}` : 'a heading, a part of the page or anything placed on it',
            action: 'section',
        });
        if (others.length > 0) {
            choices.push({
                label: '$(references) A section of another page...',
                description: fragment !== undefined && linked !== undefined && linked !== page ? `${current} - ${now}` : 'page.html#name',
                action: 'otherSection',
            });
        }
        const web = current !== undefined && 'href' in checkAddress(current) ? current : '';
        choices.push({ label: 'Off the site', kind: vscode.QuickPickItemKind.Separator });
        choices.push({ label: '$(globe) Web address...', description: web ? `${web} - ${now}` : 'https://, http:// or mailto:', action: 'address' });
        const picked = await vscode.window.showQuickPick(choices, {
            title: current !== undefined ? `Change or remove the link on ${name}` : `Make ${name} a link to...`,
            placeHolder: 'A page of this site or a web address - Esc changes nothing',
        });
        if (!picked) return;

        let href = picked.href ?? '';
        let anchor: ElementRef | undefined;
        if (picked.action === 'section' || picked.action === 'otherSection') {
            const section = await this.pickSection(site, page, html, msg.ref, picked.action === 'section' ? page : undefined, others, current);
            if (!section) return;
            ({ href, anchor } = section);
        }
        if (picked.action === 'address') {
            const typed = await vscode.window.showInputBox({
                title: `Link ${name} to a web address`,
                prompt: 'Only https://, http:// and mailto: addresses - Esc changes nothing',
                placeHolder: 'https://example.com',
                value: web,
                // Empty is not wrong yet, only unfinished: Enter on it changes nothing.
                validateInput: (value) => {
                    const checked = checkAddress(value);
                    return value === '' || 'href' in checked ? undefined : checked.problem;
                },
            });
            if (!typed) return;
            const checked = checkAddress(typed);
            if ('problem' in checked) return;
            href = checked.href;
        }
        if (picked.action !== 'remove' && href === current) return;
        const done = this.onEdit({ op: 'link', ref: msg.ref, href: picked.action === 'remove' ? undefined : href, declarations: msg.looks, ...(anchor ? { anchor } : {}) });
        if (!done) return;
        vscode.window.setStatusBarMessage(picked.action === 'remove'
            ? `Draw2Code: the link on ${name} is removed; its text is kept`
            : `Draw2Code: ${name} now links to ${href}`, 4000);
    }

    /**
     * Link to a section: which element should the link scroll to? On this
     * page (`onPage`), every element a reader would go to (see
     * sectionTargets); one without an id is named first - its own words
     * give the name, which can be changed before Enter - and that name is
     * written as its id by the link edit itself. On another page (picked
     * first from `others`), the elements that have an id already: naming one
     * there would be an edit to that page. Esc at any step changes nothing.
     */
    private async pickSection(site: SiteProject, page: string, html: string, linking: ElementRef, onPage: string | undefined,
        others: string[], current: string | undefined): Promise<{ href: string; anchor?: ElementRef } | undefined> {
        let target = onPage;
        let targetHtml = html;
        if (target === undefined) {
            const pickedPage = await vscode.window.showQuickPick(others.map((p) => ({ label: `$(file) ${p}`, page: p })), {
                title: 'Link to a section of which page?',
                placeHolder: 'Pick the page, then the section on it - Esc changes nothing',
            });
            if (!pickedPage) return undefined;
            target = pickedPage.page;
            try {
                targetHtml = this.io.read(site.pagePath('copy', target));
            } catch {
                return undefined;
            }
        }
        const here = target === page;
        // Not the element being linked: a link to itself goes nowhere.
        const self = linking.path?.join('/');
        const sections = sectionTargets(targetHtml).filter((s) => (!here || (s.path.join('/') !== self && (!linking.id || s.id !== linking.id))) && (here || s.id !== undefined));
        if (sections.length === 0) {
            void vscode.window.showInformationMessage(here
                ? 'Draw2Code: this page has nothing a link could scroll to yet - add a heading or a section first; the page is kept'
                : `Draw2Code: ${target} has no named sections yet - a section is named when a link on its own page goes to it; the page is kept`);
            return undefined;
        }
        const base = here ? '' : pageHref(page, target);
        const describe = (s: SectionTarget): string => s.id !== undefined
            ? `${base}#${s.id}${current === `${base}#${s.id}` ? ' - where it links now' : ''}`
            : `<${s.tag}> - is named #${s.suggested} when picked`;
        type SectionChoice = vscode.QuickPickItem & { section: SectionTarget };
        const items: SectionChoice[] = sections.map((s) => ({
            label: `${s.tag === 'svg' ? '$(symbol-color)' : /^h[1-6]$/.test(s.tag) ? '$(symbol-text)' : '$(symbol-field)'} ${s.text ? (s.text.length > 60 ? `${s.text.slice(0, 59)}…` : s.text) : `a <${s.tag}>`}`,
            description: describe(s),
            section: s,
        }));
        const picked = await vscode.window.showQuickPick(items, {
            title: here ? 'Link to which section of this page?' : `Link to which section of ${target}?`,
            placeHolder: 'Type to find it by its words or its name - Esc changes nothing',
            matchOnDescription: true,
        });
        if (!picked) return undefined;
        const section = picked.section;
        if (section.id !== undefined) return { href: `${base}#${section.id}` };
        // Named before it is linked: the name is its id, and the end of the link.
        const taken = usedIds(targetHtml);
        const name = await vscode.window.showInputBox({
            title: `Name this section (${picked.label.replace(/^\$\([^)]*\) /, '')})`,
            prompt: 'The link goes to #name, and the element is given it as its id - Esc changes nothing',
            value: section.suggested,
            validateInput: (value) => checkSectionName(value.trim(), taken),
        });
        if (name === undefined) return undefined;
        const clean = name.trim();
        if (checkSectionName(clean, taken)) return undefined;
        return { href: `#${clean}`, anchor: { path: section.path } };
    }

    /** Every page shown gets a tab; a closed one comes back when shown again. */
    private tabFor(page: string): void {
        if (!this.openTabs.includes(page)) this.openTabs.push(page);
    }

    /**
     * Close a tab: the page's file is untouched.
     * Closing the page being shown moves to its neighbour. The last tab stays.
     */
    private closeTab(page: string): void {
        const at = this.openTabs.indexOf(page);
        if (at === -1 || this.openTabs.length < 2) return;
        this.openTabs.splice(at, 1);
        if (page === this.currentPage) {
            this.goTo(this.openTabs[at] ?? this.openTabs[at - 1]);
            return;
        }
        this.render();
    }

    /** Re-render when the site changes on disk, but not for our own writes. */
    private watchSite(site: SiteProject): void {
        this.watcher?.dispose();
        // The development copy is what the tab shows - and, now that it is a
        // real folder, something the user may edit by hand. Changes to the
        // ORIGINAL are picked up by ImportWatcher, which syncs them in first.
        this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(site.work, '**/*'));
        const refresh = (uri: vscode.Uri, deleted = false): void => {
            if (Date.now() < this.ignoreWatcherUntil) return;
            const key = uri.fsPath.toLowerCase();
            const at = this.selfWrites.get(key);
            if (at !== undefined && Date.now() - at < 2000) return;
            // A page with unsaved edits is not simply replaced.
            const page = pageOfFile(site.work, uri.fsPath, this.copyPages());
            if (page && this.held && pageIsHeld(site.work, page, this.held)) {
                void this.askAboutDiskChange(page);
                return;
            }
            this.render();
            // A page deleted by hand. One held is not gone for the editor: it
            // has unsaved edits, or an undo took it away and warned already.
            const rel = path.relative(site.work, uri.fsPath).split(path.sep).join('/');
            if (deleted && isPage(rel) && !this.held?.isHeld(uri.fsPath) && !fs.existsSync(uri.fsPath)) this.warnIfLinked(rel);
        };
        this.watcher.onDidChange((uri) => refresh(uri), null, this.disposables);
        this.watcher.onDidCreate((uri) => refresh(uri), null, this.disposables);
        this.watcher.onDidDelete((uri) => refresh(uri, true), null, this.disposables);
        this.disposables.push(this.watcher);
    }

    /** Pages being asked about right now, so a burst of changes asks once. */
    private asking = new Set<string>();

    /**
     * A page changed on disk while it has unsaved edits: keep them, or take
     * what is on disk for that page. Other pages' edits stay either way.
     */
    private async askAboutDiskChange(page: string): Promise<void> {
        if (this.asking.has(page)) return;
        this.asking.add(page);
        try {
            const choice = await vscode.window.showWarningMessage(
                `${page} changed on disk, and it has edits you have not saved.`,
                'Keep mine', 'Load from disk');
            const site = this.site;
            const held = this.held;
            if (choice !== 'Load from disk' || !site || !held) return;
            dropHeldPage(site.work, page, held);
            // It was deleted on disk: taking the disk's version takes the page away.
            if (!held.exists(site.pagePath('copy', page))) this.warnIfLinked(page);
            this.reconcileImages();
            // Nothing left unsaved: saving marks the tab clean (it writes no page).
            if (!held.dirty && this.documentUri) {
                history.forget(site.work);
                await vscode.workspace.save(this.documentUri);
            }
            SitePreviewPanel.current?.scheduleRender();
            this.render();
        } finally {
            this.asking.delete(page);
        }
    }

    /** Apply one edit to the page shown. False when it was refused (the user has been told why). */
    private onEdit(op: EditOp, viewBefore: 'desktop' | 'phone' = this.view): boolean {
        const page = this.currentPage;
        if (!this.site || !page) return false;
        // The page as it is, before this edit: what Ctrl+Z goes back to, in the view it was made in.
        const before = snapshotPage(this.site.work, page, this.io);
        if (before) before.view = viewBefore;
        if (this.io === disk) this.ignoreWatcherUntil = Date.now() + 1500;
        // Made in the phone view: what moves or sizes goes to the phone layout (pageEditor.PER_WIDTH).
        const result = applyEdit(this.site.work, page, this.view === 'phone' ? inPhoneView(op) : op, this.io);
        // Also after a refusal: a picture copied for an element that was not added goes again.
        this.reconcileImages();
        if (result.error) {
            void vscode.window.showWarningMessage(`Draw2Code: ${result.error}`);
            // The overlay took the element out, or made it full width, or
            // moved or removed several, before asking: draw what is really there.
            if (op.op === 'remove' || op.op === 'fullWidth' || op.op === 'batch') this.render();
            return false;
        }
        // Recorded only once the edit is made: a refused one changed nothing,
        // and a step for it would make the next Ctrl+Z undo nothing.
        if (op.op === 'batch' && result.changed.length === 0) return true;
        if (before) history.record(this.site.work, before);
        const now = Date.now();
        // Only writes to disk come back through the watcher; held edits do not.
        if (this.io === disk) {
            this.ignoreWatcherUntil = now + 1500;
            for (const file of result.changed) this.selfWrites.set(file.toLowerCase(), now);
        }
        this.edited(editLabel(op));
        SitePreviewPanel.current?.scheduleRender();
        // Styles, text and full width the overlay already shows; a new
        // element, a removed one, rules taken away or a link (its tag
        // changes) only show once the page is drawn again.
        const redraws = (one: EditOp): boolean => ['add', 'remove', 'revert', 'revertPage', 'link', 'phoneLayout'].includes(one.op);
        if (redraws(op) || (op.op === 'batch' && (op.ops ?? []).some(redraws))) this.render();
        return true;
    }

    // ---- copy, paste and duplicate ----------------------------------------

    /**
     * Ctrl+C keeps the selected elements here (see clips); Ctrl+D pastes
     * them straight away, 16px down and right, and keeps nothing. Each is
     * read from the page file as it is now, unsaved edits included, with
     * its rules from the page's stylesheets and Draw2Code's own.
     */
    private onCopy(msg: Extract<WebviewMessage, { type: 'copy' | 'duplicate' }>): void {
        const site = this.site;
        const page = this.currentPage;
        if (!site || !page || !Array.isArray(msg.items) || msg.items.length === 0) return;
        let html = '';
        try {
            html = this.io.read(site.pagePath('copy', page));
        } catch {
            return;
        }
        const store = readOverrides(site.work, this.io);
        const overrides = store[page] ?? {};
        const phone = store[phoneKey(page)];
        const pageDir = path.posix.dirname(page);
        const sheets: Array<{ dir: string; css: string }> = [];
        for (const style of pageStyles(html)) {
            if ('css' in style) {
                sheets.push({ dir: pageDir, css: style.css });
                continue;
            }
            const file = linkedFile(style.href, page);
            if (!file) continue;
            try {
                sheets.push({ dir: path.posix.dirname(file), css: this.io.read(path.join(site.work, file)) });
            } catch {
                /* a stylesheet that is not there styles nothing */
            }
        }
        const styles = { sheets, overrides, overridesDir: path.posix.dirname(cssPathFor(page)), scopes: bodyClasses(html) };
        const items: CopiedElement[] = [];
        for (const item of msg.items) {
            const ruled = (selector: string): boolean => [overrides, phone ?? {}].some((rules) => Object.keys(rules).some((rule) => rule.startsWith(selector)));
            const copied = copyElement(html, item.ref, ruled);
            if ('problem' in copied) {
                void vscode.window.showWarningMessage(`Draw2Code: ${copied.problem}; nothing is copied`);
                return;
            }
            const box = item.box;
            const fine = [box?.x, box?.y, box?.w, box?.h].every((n) => Number.isFinite(n));
            // Its phone layout's rules come only from Draw2Code's own: no stylesheet of the page has any.
            const phoneRules = phone ? { phoneRules: copiedRules(copied, { ...styles, sheets: [], overrides: phone }) } : {};
            items.push({ ...copied, rules: copiedRules(copied, styles), box: fine ? box : { x: 0, y: 0, w: 0, h: 0 }, full: Boolean(item.full), ...phoneRules });
        }
        const clip: Clip = { page, wrapper: msg.wrapper, overridesDir: styles.overridesDir, items, pasted: {}, ...(this.view === 'phone' ? { view: 'phone' as const } : {}) };
        const count = items.length === 1 ? '1 element' : `${items.length} elements`;
        if (msg.type === 'duplicate') {
            this.paste(clip, msg.wrapper, PASTE_STEP, 'Duplicate');
            return;
        }
        DesignerPanel.clips.set(site.work.toLowerCase(), clip);
        vscode.window.setStatusBarMessage(`Draw2Code: copied ${count} - Ctrl+V pastes on any page of ${site.devName}`, 4000);
    }

    /** Ctrl+V: what Ctrl+C kept, on the page shown (see copyPaste.pasteOffset for where). */
    private onPaste(wrapper: Origin | undefined): void {
        const site = this.site;
        const page = this.currentPage;
        const clip = site && DesignerPanel.clips.get(site.work.toLowerCase());
        if (!site || !page) return;
        if (!clip) {
            vscode.window.setStatusBarMessage('Draw2Code: nothing copied yet - select elements and press Ctrl+C', 3000);
            return;
        }
        if (this.paste(clip, wrapper, pasteOffset(clip, page), 'Paste')) clip.pasted[page] = (clip.pasted[page] ?? 0) + 1;
    }

    /**
     * Add a clip's elements to the page shown, placed freely, as ONE edit;
     * the copies are selected once the page is drawn again. A video file's
     * player is linked as when one is drawn. False when nothing was added.
     */
    private paste(clip: Clip, wrapper: Origin | undefined, offset: number, label: 'Paste' | 'Duplicate'): boolean {
        const site = this.site;
        const page = this.currentPage;
        if (!site || !page) return false;
        let html = '';
        try {
            html = this.io.read(site.pagePath('copy', page));
        } catch {
            return false;
        }
        const inWrapper = placesInWrapper(html);
        const pasted = pasteElements(clip, { page, taken: usedIds(html), inWrapper, wrapper: inWrapper ? wrapper : undefined, overridesDir: path.posix.dirname(cssPathFor(page)) }, offset);
        // The boxes shown are a phone's on one side or the other: the desktop
        // rule then comes from the original's own, moved as far as the copy.
        const phoneView = this.view === 'phone';
        const ops: EditOp[] = pasted.map((one) => ({
            op: 'add', ref: { id: one.id }, markup: one.markup, extraRules: one.extraRules, phoneRules: one.phoneRules,
            declarations: !phoneView && clip.view === 'phone' && one.desktop ? one.desktop : one.declarations,
            ...(phoneView && one.desktop ? { desktopDeclarations: one.desktop } : {}),
        }));
        // One made as wide as the page's column: a drawing is drawn again at that width, as a resize draws it.
        for (const one of pasted) if (one.narrowed) ops.push({ op: 'style', ref: { id: one.id }, declarations: { width: one.declarations.width } });
        // A video file plays in the site's player, which this page may not link yet.
        if (ops.length && clip.items.some((item) => /\bclass\s*=\s*["'][^"']*\bvideo-player\b/i.test(item.markup))) {
            const player = this.placePlayer(site, page, html);
            for (const file of player.files) {
                if (file.copy && !this.copyImage(site, file.from, file.file)) {
                    this.reconcileImages();
                    return false;
                }
            }
            if (player.stylesheets.length || player.scripts.length) ops[0].head = { stylesheets: player.stylesheets, scripts: player.scripts };
        }
        this.selectNext = pasted.map((one) => one.id);
        const added = this.onEdit({ op: 'batch', ref: {}, ops, label });
        this.selectNext = [];
        if (added) {
            const count = pasted.length === 1 ? pasted[0].id : `${pasted.length} elements`;
            vscode.window.setStatusBarMessage(`Draw2Code: ${label === 'Paste' ? 'pasted' : 'duplicated'} ${count}`, 3000);
        }
        return added;
    }

    /**
     * Another panel (the site preview) edited `page` through the project's
     * held edits, which never reach the disk watcher: a tab showing it draws
     * it again. Left as it was, a removed element would still be here, and
     * the next edit by position would land one element later. A picture it
     * removed is taken off disk as after any edit here.
     */
    public static pageEdited(held: HeldFiles, page: string): void {
        for (const designer of DesignerPanel.open) {
            if (designer.mode !== 'page' || designer.io !== held) continue;
            designer.reconcileImages();
            if (designer.currentPage === page) designer.render();
        }
    }

    /**
     * Double-clicking a tab renames the page: its <title>, spliced in place.
     * Any tab, not only the one showing. An edit like any other, so undoable.
     */
    private retitle(page: string, title: string): void {
        const site = this.site;
        const clean = title.trim();
        if (!site || !clean) return;
        const before = snapshotPage(site.work, page, this.io);
        if (!before || pageTitle(before.html, '') === clean) return;
        history.record(site.work, before);
        if (this.io === disk) this.ignoreWatcherUntil = Date.now() + 1500;
        const result = applyEdit(site.work, page, { op: 'title', ref: {}, text: clean }, this.io);
        if (result.error) {
            void vscode.window.showWarningMessage(`Draw2Code: ${result.error}`);
            return;
        }
        const now = Date.now();
        // Only writes to disk come back through the watcher; held edits do not.
        if (this.io === disk) {
            this.ignoreWatcherUntil = now + 1500;
            for (const file of result.changed) this.selfWrites.set(file.toLowerCase(), now);
        }
        this.edited('Rename page');
        SitePreviewPanel.current?.scheduleRender();
        vscode.window.setStatusBarMessage(`Draw2Code: ${page} is now titled "${clean}"`, 3000);
        this.render();
    }

    /**
     * Ctrl+Z / Ctrl+Y: put a page back the way it was before an edit (or
     * forward again). Whole snapshots, so every kind of edit undoes the same
     * way. An edit made on another page takes the editor to that page.
     */
    public travel(direction: 'undo' | 'redo'): void {
        // The canvas keeps its own steps (the design as JSON): it takes this one.
        if (this.mode === 'canvas') {
            void this.panel.webview.postMessage({ type: 'travel', direction });
            return;
        }
        const site = this.site;
        const page = this.currentPage;
        if (!site || !page) return;
        // What is kept for the way back is the page the step changes - which
        // may not be the page being shown.
        const next = history.peek(site.work, direction);
        if (!next) {
            vscode.window.setStatusBarMessage(`Draw2Code: nothing to ${direction}`, 2000);
            return;
        }
        const current = snapshotPage(site.work, next.page, this.io) ?? absentPage(next.page);
        current.view = this.view;
        const target = direction === 'undo' ? history.undo(site.work, current) : history.redo(site.work, current);
        if (!target) return;
        // The step is shown in the view it was made in (the page's own view
        // decides, once drawn: one with no phone layout is shown at desktop).
        if (target.view) this.view = target.view;
        const now = Date.now();
        const restored = restorePage(site.work, target, this.io);
        this.reconcileImages();
        if (this.io === disk) {
            this.ignoreWatcherUntil = now + 1500;
            for (const file of restored) this.selfWrites.set(file.toLowerCase(), now);
        }
        SitePreviewPanel.current?.scheduleRender();
        if (target.absent) {
            this.warnIfLinked(target.page);
            // The step took a page away: its tab goes, and the editor moves off it.
            this.openTabs = this.openTabs.filter((p) => p !== target.page);
            this.history = this.history.filter((p) => p !== target.page);
            this.historyAt = Math.min(Math.max(this.historyAt, 0), this.history.length - 1);
            if (this.history.length === 0) {
                this.history = [this.openTabs[0] ?? this.copyPages()[0] ?? TEMPLATE.entry];
                this.historyAt = 0;
            }
            this.render();
        } else if (target.page !== page) this.goTo(target.page);
        else this.render();
    }

    /**
     * A page was taken away (its adding undone, or its file deleted): say
     * once which pages still link to it. Their links are left as they are -
     * the page may come back with Ctrl+Y, or a new page may take its name.
     */
    private warnIfLinked(page: string): void {
        const site = this.site;
        if (!site) return;
        const message = removedPageWarning(page, pagesLinkingTo(site.work, page, this.copyPages(), this.io));
        if (message) void vscode.window.showWarningMessage(`Draw2Code: ${message}`);
    }

    /** One edit is done: for an open project, a step on VS Code's undo stack and ●. */
    private edited(label: string): void {
        if (this.site) HeldFiles.for(this.site.work)?.edited(label);
    }

    /**
     * Which view of a page made in Draw2Code is shown: at desktop width, or
     * as a phone shows it (changeView). A page with no phone layout is
     * always shown at desktop width.
     */
    private view: 'desktop' | 'phone' = 'desktop';

    /** Counts draws, so each one differs (see render). */
    private renders = 0;

    private render(): void {
        this.webviewReady = false;
        // VS Code keeps a webview as it is when handed the same HTML again - and
        // undoing a style edit rebuilds exactly the page first drawn, while the
        // overlay still shows the edit. A counter makes every draw a new one.
        const html = this.mode === 'page' ? this.buildPageView() : this.buildHtml();
        this.panel.webview.html = `${html}\n<!-- ${++this.renders} -->`;
        this.updateTitle();
    }

    private flushWaiters: Array<() => void> = [];

    /** Ask the canvas for its design as it is right now (bounded wait). */
    public flushDesign(): Promise<void> {
        if (this.mode !== 'canvas' || !this.webviewReady) return Promise.resolve();
        return new Promise((resolve) => {
            const done = () => { clearTimeout(timer); resolve(); };
            const timer = setTimeout(() => {
                this.flushWaiters = this.flushWaiters.filter((w) => w !== done);
                resolve();
            }, 1000);
            this.flushWaiters.push(done);
            void this.panel.webview.postMessage({ type: 'flushDesign' });
        });
    }

    /**
     * Save Design / Ctrl+S. A design and a project are both documents, saved
     * by VS Code like any file: a project writes its held edits; a new design
     * gets VS Code's Save dialog, and the name typed there names the project
     * (see writeDesignAs). Returns the project a new design became, if it did.
     */
    public async saveProject(): Promise<SiteProject | undefined> {
        if (!this.documentUri) return undefined;
        await this.flushDesign();
        const saved = await vscode.workspace.save(this.documentUri);
        const project = saved ? DesignerPanel.savedAs.get(saved.toString()) : undefined;
        return project ? SiteProject.use(project.root) : undefined;
    }

    /** New designs saved this session: the file VS Code saved to, and the project made. */
    public static readonly savedAs = new Map<string, { root: string; name: string; page: string }>();

    /**
     * Write a design as a new project: the
     * name typed in VS Code's Save dialog is the project's, and the project is
     * always made in a new folder of that name inside the folder chosen.
     * Throws with the reason when it cannot be (VS Code shows it).
     */
    public static writeDesignAs(extensionUri: vscode.Uri, design: Design, destination: vscode.Uri): { root: string; name: string } {
        const plan = planSaveAs(destination.fsPath);
        if ('problem' in plan) throw new Error(plan.problem);
        const generator = loadHtmlGenerator(extensionUri) as ProjectGenerator;
        const version = String(vscode.extensions.getExtension('beansy.draw2code-web-editor')?.packageJSON?.version ?? '');
        fs.mkdirSync(plan.root, { recursive: true });
        writeProject(plan.root, plan.name, design, generator, version);
        DesignerPanel.savedAs.set(destination.toString(), { root: plan.root, name: plan.name, page: design.active ?? TEMPLATE.entry });
        return plan;
    }

    /** + on the canvas: a page added to a design is an edit like any other. */
    private async requestAddPage(): Promise<void> {
        void this.panel.webview.postMessage({ type: 'addPage' });
    }

    /**
     * Generate on the canvas. Generating makes the clean copy, and only
     * a saved project has one - so the design is saved first.
     */
    public async generate(): Promise<void> {
        if (this.mode !== 'canvas') {
            await this.site?.apply();
            return;
        }
        await this.flushDesign();
        if (!this.isUnsaved) {
            void vscode.window.showInformationMessage('Draw something first - there is nothing to generate yet.');
            return;
        }
        const choice = await vscode.window.showInformationMessage(
            'Generating builds the project\'s clean copy, so the design is saved as a project first.',
            'Save and Generate');
        if (choice !== 'Save and Generate') return;
        const site = await this.saveProject();
        if (site) await site.apply();
    }

    /** A new design with work in it. */
    public get isUnsaved(): boolean {
        return this.mode === 'canvas' && !isBlankDesign(this.design);
    }

    /** The tab's own title: a dot while there is unsaved work, as VS Code marks files. */
    private updateTitle(): void {
        // VS Code names a file's tab itself (see configurationDefaults).
        if (this.documentUri) return;
        const page = this.currentPage;
        if (this.mode === 'page' && this.site && page) {
            this.panel.title = `Draw2Code Web Editor · ${page}`;
        } else {
            this.panel.title = `${this.isUnsaved ? '● ' : ''}Draw2Code Web Editor`;
        }
    }

    /** The real page, with the mock browser bar wired up as real navigation. */
    private buildPageView(): string {
        const site = this.site!;
        const page = this.currentPage!;
        const file = site.pagePath('copy', page);
        let html: string;
        try {
            html = this.io.read(file);
        } catch {
            html = `<!DOCTYPE html><html><head></head><body style="font-family:sans-serif;padding:2em">Cannot read <code>${escapeHtml(page)}</code>.</body></html>`;
        }

        // The same browser bar as the canvas (media/chrome.js): one tab per
        // page shown, the address typed into like a real one, back and forward
        // over the pages visited. The editing controls sit to its right, where
        // a browser keeps its extensions. "Publish" is my name for
        // the one action that updates the FINAL copy - the button says what it
        // does, not which folder it is doing it to.
        const titleOf = (p: string): string => {
            if (p === page) return pageTitle(html, p);
            try {
                return pageTitle(this.io.read(site.pagePath('copy', p)), p);
            } catch {
                return p;
            }
        };
        this.tabFor(page);
        const tools = /* html */ `
            <button id="revert" title="Undo Draw2Code's changes to the selected element">Revert element</button>
            <button id="revert-page" title="Undo every Draw2Code change on this page">Revert page</button>
            <button id="preview" title="Open the clean preview">Preview</button>
            <button id="apply" class="on" title="${escapeHtml(site.isCreated
                ? `Build the clean copy: ${site.devName} without Draw2Code, into ${site.finalName} - ready to host`
                : `Update your final copy: put what is in ${site.devName} into ${site.name} - the only thing that writes to your own folder`)}">Publish</button>`;

        // A page made in Draw2Code has the two views. One with a phone layout
        // is shown with its Draw2Code stylesheet as the view needs it, never
        // the file's @media block, and in the desktop view without the class
        // the shared phone rules wait for: the panel may be as narrow as a phone.
        const project = readProject(site.root);
        const store = readOverrides(site.work, this.io);
        const layout = Boolean(project) && Boolean(store[phoneKey(page)]);
        if (!layout) this.view = 'desktop';
        const phoneView = this.view === 'phone';
        const sheets = layout
            ? [{ file: path.join(site.work, cssPathFor(page)), css: viewStylesheet(store, page, this.view) }]
            : heldStylesheet(site.work, page);

        return buildPageHtml(this.panel.webview, {
            html: layout && !phoneView ? withoutPhoneClass(html) : html,
            file,
            siteRoot: site.work,
            bar: tools,
            editable: true,
            alwaysEditing: true,
            toolbar: true,
            heldStylesheets: sheets,
            viewCss: phoneView ? phoneViewCss(loadModel(this.extensionUri).PHONE_WIDTH) : undefined,
            phone: project ? {
                on: phoneView,
                layout,
                hidden: phoneView ? phoneHidden(store, page) : [],
                ...(phoneView ? { desktopCss: viewStylesheet(store, page, 'desktop') } : {}),
            } : undefined,
            select: this.selectNext,
            copyPaste: true,
            pageWidth: project?.pageWidth,
            recentColours: recentOf(DesignerPanel.storage?.get(DesignerPanel.RECENT_COLOURS_KEY), RECENT_MAX),
            chrome: {
                extensionUri: this.extensionUri,
                tabs: this.openTabs.map((p) => ({ name: p, title: titleOf(p) })),
                page,
                pages: this.copyPages(),
                canBack: this.historyAt > 0,
                canForward: this.historyAt < this.history.length - 1,
                addable: true,
            },
        });
    }

    private generateHtml(): string {
        return loadHtmlGenerator(this.extensionUri).generate(this.design, { title: 'Draw2Code Design' });
    }

    public showPreview(): void {
        if (!this.preview) {
            this.preview = new PreviewPanel(() => { this.preview = undefined; });
        } else {
            this.preview.reveal();
        }
        this.preview.update(this.generateHtml());
    }

    /**
     * Write the generated HTML.
     *
     * In a site project (index.html at the workspace root) it writes
     * index.html + css/style.css into the DEVELOPMENT COPY (`<site>-dev`) and
     * shows the site preview; the originals are untouched until Apply.
     * Otherwise it asks for a file the first time (or when `chooseFile` is
     * true) and reuses that file on every Generate.
     */
    public async saveHtml(chooseFile: boolean): Promise<void> {
        const site = chooseFile ? undefined : SiteProject.current;
        if (site) {
            const created = site.ensureCopy() === 'created';
            if (!await confirmReplacingPage(site)) {
                return;
            }
            const out = loadHtmlGenerator(this.extensionUri).generateSite(this.design, { title: 'Draw2Code Design' });
            site.writeToCopy('index.html', out.html);
            site.writeToCopy('css/style.css', out.css);
            const note = `Generated ${site.devName}/index.html + css/style.css${created ? ' (development copy created)' : ''}`;
            vscode.window.setStatusBarMessage(`Draw2Code: ${note}`, 5000);
            this.panel.webview.postMessage({ type: 'notice', text: note });
            SitePreviewPanel.show(site);
            return;
        }
        if (chooseFile || !this.htmlTarget) {
            const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
            const suggested = this.htmlTarget
                ?? (folder ? vscode.Uri.joinPath(folder, 'design.html') : undefined);
            const picked = await vscode.window.showSaveDialog({
                defaultUri: suggested,
                filters: { HTML: ['html'] },
                saveLabel: 'Generate',
                title: 'Generate HTML',
            });
            if (!picked) {
                return;
            }
            this.htmlTarget = picked;
        }
        await vscode.workspace.fs.writeFile(this.htmlTarget, Buffer.from(this.generateHtml(), 'utf8'));
        const name = path.basename(this.htmlTarget.fsPath);
        vscode.window.setStatusBarMessage(`Draw2Code: generated ${name}`, 4000);
        this.panel.webview.postMessage({ type: 'notice', text: `Generated ${name}` });
    }

    // Builds the page. Files in media/ can't be referenced by normal paths;
    // they must be converted to special webview URIs.
    private buildHtml(): string {
        const webview = this.panel.webview;
        const mediaUri = (file: string) =>
            webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'website-editor', 'media', file));

        const styleUri = mediaUri('main.css');
        const chromeStyleUri = mediaUri('chrome.css');
        // Order matters: each script uses the ones loaded before it.
        const scripts = ['model.js', 'render.js', 'props.js', 'textEditor.js', 'chrome.js', 'main.js'].map(mediaUri);
        const nonce = getNonce();

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link href="${chromeStyleUri}" rel="stylesheet">
    <link href="${styleUri}" rel="stylesheet">
    <title>Draw2Code Web Editor</title>
</head>
<body>
    <div id="toolbar">
        <span class="brand">Draw2Code Web Editor</span>
        <button class="tool active" data-tool="select" title="Select (V)">Select</button>
        <button class="tool" data-tool="rect" title="Rectangle (R)">Rect</button>
        <button class="tool" data-tool="ellipse" title="Ellipse (E)">Ellipse</button>
        <button class="tool" data-tool="line" title="Line (L)">Line</button>
        <button class="tool" data-tool="pen" title="Pen (P)">Pen</button>
        <span class="sep"></span>
        <button class="tool" data-tool="button" title="Button (B)">Button</button>
        <button class="tool" data-tool="input" title="Input (I)">Input</button>
        <button class="tool" data-tool="label" title="Label (T)">Label</button>
        <span class="sep"></span>
        <label class="style-ctl" title="Fill color">Fill <input type="color" id="fill"></label>
        <label class="style-ctl" title="No fill"><input type="checkbox" id="no-fill"> None</label>
        <label class="style-ctl" title="Stroke color">Stroke <input type="color" id="stroke"></label>
        <label class="style-ctl" title="Stroke width">Width <input type="number" id="stroke-width" min="0" max="20"></label>
        <span class="sep"></span>
        <label class="style-ctl" title="Show a mock browser above the page (canvas only)"><input type="checkbox" id="browser-bar"> Browser bar</label>
        <label class="style-ctl" title="Page color (background of the generated page)">Page <input type="color" id="page-color"></label>
        <button class="action" id="btn-preview" title="Open the live HTML preview">Preview</button>
        <button class="action primary" id="btn-generate" title="Write the HTML file">Generate HTML</button>
    </div>
    <div id="stage">
        <!-- The browser bar: one tab per page. media/chrome.js builds it
             here (and over a real page in the editor); main.js feeds it. -->
        <div id="chrome"></div>
        <canvas id="canvas"></canvas>
        <input id="text-editor" type="text" hidden>
        <div id="props" hidden>
            <div id="props-header" title="Drag to move">
                <span id="props-title">Properties</span>
                <button id="props-close" title="Close (Esc)">×</button>
            </div>
            <div class="props-body">
                <div class="props-grid">
                    <label>X <input type="number" data-prop="x"></label>
                    <label>Y <input type="number" data-prop="y"></label>
                    <label>W <input type="number" data-prop="w" min="0"></label>
                    <label>H <input type="number" data-prop="h" min="0"></label>
                </div>
                <div class="props-row" data-show="fill">
                    <span>Fill</span>
                    <input type="color" data-prop="fill">
                    <label class="inline"><input type="checkbox" data-prop="noFill"> None</label>
                </div>
                <div class="props-row">
                    <span>Stroke</span>
                    <input type="color" data-prop="stroke">
                    <input type="number" data-prop="strokeWidth" min="0" max="20" title="Stroke width">
                </div>
                <div class="props-row" data-show="flip">
                    <span>Flip</span>
                    <label class="inline"><input type="checkbox" data-prop="flip"> Other diagonal</label>
                </div>
                <div class="props-row" data-show="text">
                    <span>Text</span>
                    <input type="text" data-prop="text">
                </div>
                <div class="props-row" data-show="text">
                    <span>Font</span>
                    <input type="number" data-prop="fontSize" min="6" max="96" title="Font size">
                    <input type="color" data-prop="textColor" title="Text color">
                </div>
            </div>
        </div>
    </div>
    <div id="statusbar">
        <span id="status-tool">Tool: select</span>
        <span id="status-pos">x: 0, y: 0</span>
        <span id="status-snap">Snap: on (G)</span>
        <span id="status-count">0 elements</span>
        <span id="status-conn">Connecting…</span>
    </div>
    ${scripts.map((src) => `<script nonce="${nonce}" src="${src}"></script>`).join('\n    ')}
</body>
</html>`;
    }

    /** Tell the webview which site it is editing (shown in its status bar). */
    public setSiteNotice(text: string): void {
        this.notice = text;
        this.panel.webview.postMessage({ type: 'notice', text });
    }

    private cleanedUp = false;

    public dispose(): void {
        this.cleanUp();
        this.panel.dispose();
    }

    private cleanUp(): void {
        if (this.cleanedUp) return;
        this.cleanedUp = true;
        DesignerPanel.open.delete(this);
        if (DesignerPanel.current === this) DesignerPanel.current = [...DesignerPanel.open].pop();
        this.preview?.dispose();
        this.watcher?.dispose();
        while (this.disposables.length) {
            this.disposables.pop()?.dispose();
        }
    }

    /** The tab was closed: VS Code has already asked about anything unsaved. */
    private onClosed(): void {
        // Closed with nothing unsaved: remember its tabs and page, without
        // asking. Unsaved edits that were dropped leave
        // the label as the last save wrote it.
        const state = this.editorState;
        const dropped = Date.now() - this.revertedAt < 2000; // Don't Save reverts, then closes
        if (this.documentUri?.scheme === 'file' && state && !this.held?.dirty && !dropped) {
            writeEditorState(this.documentUri.fsPath, state);
        }
        this.cleanUp();
    }
}

/** What VS Code's Edit menu calls an edit ("Undo Style"). */
export function editLabel(op: EditOp): string {
    switch (op.op) {
        case 'style': return 'Style';
        case 'text': return 'Text';
        case 'add': return 'Add element';
        case 'remove': return 'Remove element';
        case 'revert': return 'Revert element';
        case 'revertPage': return 'Revert page';
        case 'title': return 'Rename page';
        case 'link': return op.href ? 'Link' : 'Remove link';
        case 'fullWidth': return op.full ? 'Full width' : 'Page width again';
        case 'placeholder': return 'Placeholder';
        case 'phoneLayout': return op.phone ? 'Phone layout' : 'Remove phone layout';
        case 'batch': return op.label && BATCH_LABELS.includes(op.label) ? op.label : 'Edit elements';
    }
}

// Random token so the CSP only allows *our* script tag to run.
function getNonce(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let text = '';
    for (let i = 0; i < 32; i++) {
        text += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return text;
}

/**
 * Generating replaces index.html in the development copy. When that page was
 * not made by Draw2Code (an imported site, which the canvas cannot read back
 * yet), say so once before overwriting it. The user's ORIGINAL is untouched
 * either way, and Reset Working Copy brings the copy back.
 */
const warnedSites = new Set<string>();

async function confirmReplacingPage(site: SiteProject): Promise<boolean> {
    const page = path.join(site.work, 'index.html');
    let existing = '';
    try {
        existing = fs.readFileSync(page, 'utf8');
    } catch {
        return true; // nothing there yet
    }
    if (existing.includes('Generated by Draw2Code Web Editor') || warnedSites.has(site.root)) {
        return true;
    }
    const choice = await vscode.window.showWarningMessage(
        `Replace index.html in ${site.devName} with this design?`,
        {
            modal: true,
            detail: `The index.html in ${site.devName} was not made by Draw2Code Web Editor, and the canvas cannot read an existing page back yet, so its content would be replaced.\n\n${site.name} is not touched. "Reset Working Copy" restores the copy.`,
        },
        'Replace');
    if (choice !== 'Replace') {
        return false;
    }
    warnedSites.add(site.root);
    return true;
}
