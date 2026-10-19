// Draw2Code Web Editor - runs INSIDE the webview (a sandboxed browser page).
// Owns the drawing state and turns mouse/keyboard input into model changes.
// It has no access to VS Code APIs; it can only postMessage to the extension.
//
// Load order (see designerPanel.ts):
//   model.js -> render.js -> props.js -> textEditor.js -> main.js
//
// CS50 citation: the name Draw2Code Web Editor was chosen with help from
// Claude (Anthropic AI), and at my direction Claude renamed
// the project from its earlier name, HardHat Designer, throughout this file.

// @ts-check
(function () {
    'use strict';

    const vscode = acquireVsCodeApi();
    const M = self.D2CModel;
    const R = self.D2CRender;

    const HIT_TOLERANCE = 4;
    const PEN_MIN_STEP = 2; // px between recorded pen points
    const RELEASE_JUMP = 8; // px: a buttonless move this far from the drag = released outside
    const BOX_TOOLS = ['rect', 'ellipse', 'line', 'button', 'input', 'label'];

    const $ = (id) => /** @type {any} */ (document.getElementById(id));
    const stage = $('stage');
    const canvas = /** @type {HTMLCanvasElement} */ ($('canvas'));
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));

    // ---- state ------------------------------------------------------------
    // The ONE source of truth for the drawing lives here (decision: webview
    // owns the model). Everything on screen is derived from it.
    const state = {
        elements: /** @type {any[]} */ ([]),
        selectedId: /** @type {number|null} */ (null),
        tool: 'select',
        snap: true,
        style: { ...M.DEFAULT_STYLE },
        /** design-level settings; page.color is the generated page background */
        page: { ...M.DEFAULT_PAGE },
        /**
         * The design is a SITE: every page it has, and which one has the
         * canvas. `elements` and `page` above are the ACTIVE page's, live;
         * commitActive() puts them back in the record before anything reads
         * the whole design.
         */
        pages: /** @type {any[]} */ ([M.makePage(M.ENTRY_PAGE)]),
        active: M.ENTRY_PAGE,
        /** pages visited in this tab, for back and forward */
        history: /** @type {string[]} */ ([M.ENTRY_PAGE]),
        historyAt: 0,
        /** show the browser bar above the page (canvas only, never generated) */
        chrome: true,
        /** in-progress gesture: create | pen | move | resize */
        drag: /** @type {any} */ (null),
        /** element being drawn, not yet in `elements` */
        draft: /** @type {any} */ (null),
        /** widget whose text is being edited in place */
        editingId: /** @type {number|null} */ (null),
        mouse: { x: 0, y: 0 },
    };

    const selected = () => state.elements.find((e) => e.id === state.selectedId) || null;
    const byId = (id) => state.elements.find((e) => e.id === id) || null;

    function replaceElement(next) {
        state.elements = state.elements.map((e) => (e.id === next.id ? next : e));
    }

    function addElement(el) {
        state.elements = [...state.elements, el];
        select(el.id);
        vscode.postMessage({ type: 'status', text: `added ${el.type} #${el.id}` });
    }

    // ---- pages ------------------------------------------------------------
    // One tab per page. The canvas always draws the active page; switching
    // puts the live drawing back into its record first, so nothing is lost.

    const activeRecord = () => M.findPage(state.pages, state.active) || state.pages[0];

    /** Put the live drawing back into the active page's record. */
    function commitActive() {
        const page = activeRecord();
        if (!page) return;
        state.pages = state.pages.map((p) => (p === page
            ? { ...p, elements: state.elements, color: state.page.color }
            : p));
    }

    /** Show a page: commit what is on the canvas, then load that one. */
    function showPage(name, remember) {
        const page = M.findPage(state.pages, name);
        if (!page || page.name === state.active) return;
        commitActive();
        state.pages = M.reopenPage(state.pages, page.name);
        state.active = page.name;
        const loaded = M.findPage(state.pages, page.name);
        state.elements = loaded.elements;
        state.page = { ...state.page, color: loaded.color };
        state.selectedId = null;
        state.draft = null;
        state.drag = null;
        editor.finish(false);
        props.close();
        if (remember !== false) {
            state.history = [...state.history.slice(0, state.historyAt + 1), page.name];
            state.historyAt = state.history.length - 1;
        }
        pageColorInput.value = state.page.color;
        renderChrome();
        redraw();
        vscode.postMessage({ type: 'status', text: `page ${page.name}` });
    }

    function step(by) {
        const at = state.historyAt + by;
        if (at < 0 || at >= state.history.length) return;
        const name = state.history[at];
        if (!M.findPage(state.pages, name)) return;
        showPage(name, false);
        state.historyAt = at;
        renderChrome();
    }

    function addPage() {
        const before = state.pages;
        commitActive();
        state.pages = M.addPage(state.pages, '');
        const added = state.pages[state.pages.length - 1];
        if (state.pages === before) return;
        showPage(added.name);
    }

    /**
     * Close a page: the tab goes, the page stays in the design and comes back
     * by typing its name. The last open page stays open.
     */
    function closePage(name) {
        const page = M.findPage(state.pages, name);
        if (!page) return;
        if (M.openPages(state.pages).length < 2) {
            vscode.postMessage({ type: 'status', text: 'the last page stays open' });
            return;
        }
        if (page.name === state.active) commitActive();
        const open = M.openPages(state.pages);
        const at = open.indexOf(M.findPage(state.pages, page.name));
        state.pages = M.closePage(state.pages, page.name);
        if (page.name === state.active) {
            const next = open[at + 1] || open[at - 1];
            state.active = next.name;
            state.elements = next.elements;
            state.page = { ...state.page, color: next.color };
            state.selectedId = null;
            pageColorInput.value = state.page.color;
        }
        vscode.postMessage({ type: 'status', text: `closed ${page.name} (the page is kept)` });
        renderChrome();
        redraw();
    }

    /**
     * The address bar names the page. A name another page has goes to that
     * page (reopening it if its tab was closed); anything else renames this
     * one, because on the canvas the address IS the page's name.
     */
    function addressEntered(value) {
        const name = M.normalizePageName(value);
        const hit = M.findPage(state.pages, name);
        if (!name) { renderChrome(); return; }
        if (hit && hit.name !== state.active) { showPage(hit.name); return; }
        if (hit) { renderChrome(); return; }
        const before = state.pages;
        commitActive();
        state.pages = M.renamePage(state.pages, state.active, name);
        if (state.pages === before) {
            vscode.postMessage({ type: 'status', text: `${name} is taken` });
            renderChrome();
            return;
        }
        state.history = state.history.map((h) => (h === state.active ? name : h));
        state.active = name;
        renderChrome();
        redraw();
        vscode.postMessage({ type: 'status', text: `renamed to ${name}` });
    }

    /** Double-clicking a tab: the page's title (what its tab and <title> show). */
    function retitle(name, title) {
        commitActive();
        const before = state.pages;
        state.pages = M.retitlePage(state.pages, name, title);
        if (state.pages === before) { renderChrome(); return; }
        renderChrome();
        redraw(); // a changed design is sent, and so is one undo step
        vscode.postMessage({ type: 'status', text: `${name} is now titled "${title.trim()}"` });
    }

    /** Style for a new element: widgets have their own per-type defaults. */
    function styleFor(type) {
        return M.isWidget(type) ? M.WIDGET_DEFAULTS[type] : state.style;
    }

    // ---- popups -----------------------------------------------------------
    const props = self.D2CProps.create({
        panel: $('props'),
        header: $('props-header'),
        title: $('props-title'),
        closeButton: $('props-close'),
        bounds: stage,
        onChange: (prop, value) => {
            const el = selected();
            if (!el) return;
            replaceElement(M.setProp(el, prop, value));
            syncStyleControls();
            redraw();
        },
    });

    const editor = self.D2CTextEditor.create({
        input: $('text-editor'),
        pageTop: () => R.chromeHeight(state),
        onCommit: (id, text) => {
            state.editingId = null;
            const el = byId(id);
            if (el) replaceElement(M.setProp(el, 'text', text));
            redraw();
        },
        onCancel: () => {
            state.editingId = null;
            redraw();
        },
    });

    // ---- drawing ----------------------------------------------------------
    let cssWidth = 0;
    let cssHeight = 0;

    function resizeCanvas() {
        // Match pixel size to on-screen size, scaled for high-DPI displays.
        const dpr = window.devicePixelRatio || 1;
        const rect = canvas.getBoundingClientRect();
        cssWidth = rect.width;
        cssHeight = rect.height;
        canvas.width = Math.floor(rect.width * dpr);
        canvas.height = Math.floor(rect.height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        redraw();
    }

    function redraw() {
        R.render(ctx, cssWidth, cssHeight, state);
        props.sync(selected());
        updateStatus();
        scheduleDesignSync();
    }

    // ---- design -> extension ----------------------------------------------
    // The extension keeps a COPY of the design for the preview and for
    // generating files. Send it shortly after changes stop, and only when it
    // actually changed (redraw also runs for hover and selection).
    const SYNC_DELAY_MS = 150;
    let syncTimer = 0;
    let lastSent = '';
    let lastContent = '';

    function scheduleDesignSync() {
        clearTimeout(syncTimer);
        syncTimer = setTimeout(sendDesign, SYNC_DELAY_MS);
    }

    function sendDesign() {
        commitActive();
        const design = M.makeDesign(state.pages, state.active);
        const json = JSON.stringify(design);
        if (json === lastSent) return;
        // The design changed: what it was is what Ctrl+Z goes back to. The
        // 150ms wait means a whole drag is one step, not every pixel of it.
        // Only the CONTENT counts: switching pages is not an edit,
        // so it adds no step - but each step remembers the
        // page it was on, so undoing an edit shows the page it happened on.
        const content = JSON.stringify({ ...design, active: undefined });
        const step = Boolean(lastSent && !restoring && content !== lastContent);
        if (step) {
            undoStack.push(lastSent);
            if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
            redoStack.length = 0;
        }
        lastSent = json;
        lastContent = content;
        // `step`: a new undo step, which the extension makes an edit of the
        // document (● on the tab, and one step of VS Code's undo).
        vscode.postMessage({ type: 'design', design, step });
    }

    // ---- undo / redo ---------------------------------------------------------
    // The design as plain JSON, one entry per change (see sendDesign), so
    // every kind of edit undoes the same way: drawing, moving, retyping,
    // deleting, adding or closing a page, renaming one.
    const HISTORY_LIMIT = 100;
    const undoStack = /** @type {string[]} */ ([]);
    const redoStack = /** @type {string[]} */ ([]);
    let restoring = false;

    /** Make the canvas show `design` (a plain-data design from makeDesign). */
    function loadDesign(design) {
        editor.finish(false);
        props.close();
        state.pages = design.pages.map((p) => ({ ...p, elements: p.elements.map((e) => ({ ...e })) }));
        state.active = M.findPage(state.pages, design.active) ? design.active : state.pages[0].name;
        const page = M.findPage(state.pages, state.active);
        state.elements = page.elements;
        state.page = { ...state.page, color: page.color };
        state.selectedId = null;
        state.editingId = null;
        state.draft = null;
        state.drag = null;
        state.history = state.history.filter((h) => M.findPage(state.pages, h));
        state.historyAt = Math.min(state.historyAt, state.history.length - 1);
        pageColorInput.value = state.page.color;
        renderChrome();
        redraw();
    }

    function travel(direction) {
        const from = direction === 'undo' ? undoStack : redoStack;
        const to = direction === 'undo' ? redoStack : undoStack;
        const json = from.pop();
        if (!json) { vscode.postMessage({ type: 'status', text: `nothing to ${direction}` }); return; }
        clearTimeout(syncTimer);
        commitActive();
        to.push(JSON.stringify(M.makeDesign(state.pages, state.active)));
        restoring = true;
        loadDesign(JSON.parse(json));
        lastSent = ''; // so the restored design is sent to the extension
        sendDesign();
        restoring = false;
        vscode.postMessage({ type: 'status', text: direction === 'undo' ? 'undone' : 'redone' });
    }

    function updateStatus() {
        $('status-tool').textContent = `Tool: ${state.tool}`;
        $('status-pos').textContent = `x: ${state.mouse.x}, y: ${state.mouse.y}`;
        $('status-snap').textContent = `Snap: ${state.snap ? 'on' : 'off'} (G)`;
        const sel = selected();
        $('status-count').textContent =
            `${state.active} · ${state.elements.length} element${state.elements.length === 1 ? '' : 's'}` +
            (sel ? ` · selected: ${sel.type} #${sel.id} (${sel.x}, ${sel.y}, ${sel.w}×${sel.h})` : '');
    }

    // ---- toolbar: tools ---------------------------------------------------
    const toolButtons = Array.from(document.querySelectorAll('.tool'));

    function setTool(name) {
        const btn = toolButtons.find((b) => b.dataset.tool === name);
        if (!btn || btn.disabled) return;
        state.tool = name;
        for (const b of toolButtons) b.classList.toggle('active', b.dataset.tool === name);
        canvas.style.cursor = name === 'select' ? 'default' : 'crosshair';
        redraw();
    }

    for (const btn of toolButtons) {
        btn.addEventListener('click', () => setTool(btn.dataset.tool));
    }

    // ---- toolbar: style ---------------------------------------------------
    // With something selected, the controls edit it. With nothing selected,
    // they set the style for the next SHAPE drawn (widgets use their own
    // defaults, see D2CModel.WIDGET_DEFAULTS).
    const fillInput = $('fill');
    const noFillInput = $('no-fill');
    const strokeInput = $('stroke');
    const widthInput = $('stroke-width');

    function syncStyleControls() {
        const src = selected() || state.style;
        const hasFill = src.fill !== 'none';
        noFillInput.checked = !hasFill;
        if (hasFill) fillInput.value = src.fill;
        fillInput.disabled = !hasFill;
        strokeInput.value = src.stroke;
        widthInput.value = String(src.strokeWidth);
    }

    function applyStyle(prop, value) {
        const sel = selected();
        if (sel) replaceElement(M.setProp(sel, prop, value));
        else state.style = { ...state.style, [prop]: prop === 'strokeWidth'
            ? M.setProp({ strokeWidth: 0 }, 'strokeWidth', value).strokeWidth : value };
        syncStyleControls();
        redraw();
    }

    // ---- the browser bar ---------------------------------------------------
    // One bar for both modes (media/chrome.js); this side only says what it
    // shows and what to do about clicks. On the canvas a tab IS a page.
    const chromeBar = $('chrome');
    const chrome = self.D2CChrome.mount(chromeBar, {
        onShow: (name) => showPage(name),
        onClose: (name) => closePage(name),
        // + may be a moment to save: the extension decides, then says addPage.
        onAdd: () => vscode.postMessage({ type: 'requestAddPage' }),
        onRename: (name, title) => retitle(name, title),
        onAddress: (value) => addressEntered(value),
        onBack: () => step(-1),
        onForward: () => step(1),
        onReload: () => redraw(),
    });

    function renderChrome() {
        chromeBar.hidden = !state.chrome;
        const open = M.openPages(state.pages);
        chrome.render({
            pages: open.map((p) => ({ name: p.name, title: p.title, active: p.name === state.active, closable: open.length > 1 })),
            address: state.active,
            canBack: state.historyAt > 0,
            canForward: state.historyAt < state.history.length - 1,
            addable: true,
            // Every page, closed ones too: typing a closed page's name brings it back.
            suggestions: state.pages.map((p) => p.name),
        });
    }

    // ---- toolbar: page + actions ------------------------------------------
    const chromeInput = $('browser-bar');
    chromeInput.checked = state.chrome;
    chromeInput.addEventListener('change', () => {
        state.chrome = chromeInput.checked;
        props.close();
        renderChrome();
        redraw();
    });

    const pageColorInput = $('page-color');
    pageColorInput.value = state.page.color;
    pageColorInput.addEventListener('input', () => {
        state.page = { ...state.page, color: pageColorInput.value };
        redraw();
    });

    $('btn-preview').addEventListener('click', () => {
        sendDesign();
        vscode.postMessage({ type: 'preview' });
    });
    $('btn-generate').addEventListener('click', () => {
        sendDesign();
        vscode.postMessage({ type: 'generate' });
    });

    fillInput.addEventListener('input', () => applyStyle('fill', fillInput.value));
    noFillInput.addEventListener('change', () =>
        applyStyle('fill', noFillInput.checked ? 'none' : fillInput.value));
    strokeInput.addEventListener('input', () => applyStyle('stroke', strokeInput.value));
    widthInput.addEventListener('input', () => applyStyle('strokeWidth', widthInput.value));

    // ---- mouse ------------------------------------------------------------
    /** Pointer position in PAGE coordinates (y < 0 means over the mock browser). */
    function pointerPos(e) {
        const rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top - R.chromeHeight(state) };
    }

    function select(id) {
        state.selectedId = id;
        syncStyleControls();
    }

    canvas.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const p = pointerPos(e);
        if (p.y < 0) return; // the mock browser is decoration only
        canvas.setPointerCapture(e.pointerId);
        const sx = M.snap(p.x, state.snap);
        const sy = M.snap(p.y, state.snap);

        if (state.tool === 'select') {
            const sel = selected();
            const handle = sel && M.handleAt(sel, p.x, p.y, R.HANDLE_SIZE);
            if (sel && handle) {
                state.drag = { mode: 'resize', orig: sel, handle, last: p };
            } else {
                const hit = M.topHit(state.elements, p.x, p.y, HIT_TOLERANCE);
                select(hit ? hit.id : null);
                if (hit) state.drag = { mode: 'move', orig: hit, start: p, last: p };
            }
        } else if (state.tool === 'pen') {
            // Pen points are never snapped: a snapped freehand line is jagged.
            state.drag = { mode: 'pen', points: [[p.x, p.y]], last: p };
            state.draft = M.createPen(M.nextId(state.elements), state.drag.points, state.style);
        } else if (BOX_TOOLS.includes(state.tool)) {
            state.drag = { mode: 'create', start: { x: sx, y: sy }, last: p };
            state.draft = M.createElement(M.nextId(state.elements), state.tool,
                { x: sx, y: sy, w: 0, h: 0 }, styleFor(state.tool));
        }
        redraw();
    });

    canvas.addEventListener('pointermove', (e) => {
        const p = pointerPos(e);
        state.mouse = { x: Math.round(p.x), y: Math.round(p.y) };
        const d = state.drag;

        // No button held, and the pointer is somewhere else than where the
        // drag last was: the button was released outside the webview, where
        // the canvas could not hear it (events stop at the webview's edge,
        // without even a pointerleave). Finish the drag now.
        // Not for a buttonless move at the SAME spot: one can appear mid-drag
        // while the webview takes focus, and ending there would lose the shape.
        if (d && e.buttons === 0 &&
            (d.leftCanvas || Math.hypot(p.x - d.last.x, p.y - d.last.y) > RELEASE_JUMP)) {
            endDrag();
            return;
        }
        if (d) d.last = p;

        if (!d) {
            // Hover feedback only.
            if (state.tool === 'select') {
                const sel = selected();
                const handle = sel && M.handleAt(sel, p.x, p.y, R.HANDLE_SIZE);
                canvas.style.cursor = handle ? cursorFor(handle)
                    : M.topHit(state.elements, p.x, p.y, HIT_TOLERANCE) ? 'move' : 'default';
            }
            updateStatus();
            return;
        }

        const sx = M.snap(p.x, state.snap);
        const sy = M.snap(p.y, state.snap);

        if (d.mode === 'create') {
            state.draft = M.createElement(state.draft.id, state.tool,
                { x: d.start.x, y: d.start.y, w: sx - d.start.x, h: sy - d.start.y },
                styleFor(state.tool));
        } else if (d.mode === 'pen') {
            const [lx, ly] = d.points[d.points.length - 1];
            if (Math.hypot(p.x - lx, p.y - ly) >= PEN_MIN_STEP) {
                d.points.push([p.x, p.y]);
                state.draft = M.createPen(state.draft.id, d.points, state.style);
            }
        } else if (d.mode === 'move') {
            const nx = M.snap(d.orig.x + (p.x - d.start.x), state.snap);
            const ny = M.snap(d.orig.y + (p.y - d.start.y), state.snap);
            replaceElement(M.moveTo(d.orig, nx, ny));
        } else if (d.mode === 'resize') {
            replaceElement(M.resize(d.orig, d.handle, sx, sy));
        }
        redraw();
    });

    function endDrag() {
        const d = state.drag;
        state.drag = null;
        const draft = state.draft;
        state.draft = null;

        if (d && d.mode === 'create' && draft) {
            if (Math.hypot(draft.w, draft.h) >= 4) {
                addElement(draft);
            } else {
                // A click: widgets are placed at a default size; shapes draw nothing.
                const size = M.defaultSize(draft.type);
                if (size) addElement({ ...draft, w: size.w, h: size.h });
            }
            // After drawing, every tool goes back to Select.
            setTool('select');
        } else if (d && d.mode === 'pen' && draft) {
            if (draft.points.length >= 2 && Math.hypot(draft.w, draft.h) >= 4) addElement(draft);
            setTool('select'); // like every other tool
        }
        redraw();
    }

    canvas.addEventListener('pointerup', endDrag);
    canvas.addEventListener('pointercancel', endDrag);
    // Releases outside the webview may never reach the canvas. Two fallbacks
    // keep the shape instead of losing it: the browser ending pointer capture,
    // and (in pointermove) the pointer coming back, after leaving, with no
    // button held.
    // After a normal pointerup these run again with nothing left to do.
    canvas.addEventListener('lostpointercapture', endDrag);
    canvas.addEventListener('pointerleave', () => {
        if (state.drag) state.drag.leftCanvas = true;
    });

    // Double-click a widget: edit its text in place.
    canvas.addEventListener('dblclick', (e) => {
        const p = pointerPos(e);
        if (p.y < 0) return;
        const hit = M.topHit(state.elements, p.x, p.y, HIT_TOLERANCE);
        if (!hit || !M.isWidget(hit.type)) return;
        select(hit.id);
        state.editingId = hit.id;
        editor.open(hit);
        redraw();
    });

    // Right-click an element: open the properties popup for it.
    canvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const p = pointerPos(e);
        if (p.y < 0) return;
        const hit = M.topHit(state.elements, p.x, p.y, HIT_TOLERANCE);
        if (hit) {
            select(hit.id);
            props.openAt(p.x, p.y + R.chromeHeight(state)); // popup lives in canvas space
        } else {
            select(null);
            props.close();
        }
        redraw();
    });

    function cursorFor(handle) {
        return { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize',
                 nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' }[handle];
    }

    // ---- keyboard ---------------------------------------------------------
    const shortcuts = { v: 'select', r: 'rect', e: 'ellipse', l: 'line', p: 'pen',
                        b: 'button', i: 'input', t: 'label' };

    // Ctrl+Z / Ctrl+Y: the design is a VS Code document, so its undo is VS
    // Code's, which sends the step back here as a 'travel' message. Caught
    // first and stopped: VS Code's webview would otherwise also pass the key on
    // as its own Undo, and one press would undo twice.
    window.addEventListener('keydown', (e) => {
        if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
        const k = e.key.toLowerCase();
        const t = /** @type {HTMLElement} */ (e.target);
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
            // A text box keeps its own undo; VS Code must not undo the design.
            if (k === 'z' || k === 'y') e.stopPropagation();
            return;
        }
        if (k === 'z' && !e.shiftKey) { e.preventDefault(); e.stopPropagation(); vscode.postMessage({ type: 'undo' }); }
        else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); e.stopPropagation(); vscode.postMessage({ type: 'redo' }); }
    }, true);

    window.addEventListener('keydown', (e) => {
        // Never steal keys from text boxes (toolbar, popup, in-place editor).
        const t = /** @type {HTMLElement} */ (e.target);
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
        if ((e.ctrlKey || e.metaKey) && !e.altKey) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;

        const key = e.key.toLowerCase();
        if (key === 'delete' || key === 'backspace') {
            if (state.selectedId !== null) {
                state.elements = state.elements.filter((el) => el.id !== state.selectedId);
                select(null);
                redraw();
            }
            e.preventDefault();
        } else if (key === 'escape') {
            if (props.isOpen()) { props.close(); return; }
            state.drag = null;
            state.draft = null;
            select(null);
            setTool('select');
        } else if (key === 'g') {
            state.snap = !state.snap;
            redraw();
        } else if (shortcuts[key]) {
            setTool(shortcuts[key]);
        }
    });

    // ---- messages from the extension -------------------------------------
    window.addEventListener('message', (event) => {
        const msg = event.data;
        if (msg.type === 'hello' || msg.type === 'notice') $('status-conn').textContent = msg.text;
        if (msg.type === 'addPage') { addPage(); return; }
        if (msg.type === 'flushDesign') {
            // Saving is about to happen: send the design as it is NOW, not
            // 150ms from now, so the last stroke is not left behind.
            clearTimeout(syncTimer);
            commitActive();
            vscode.postMessage({ type: 'design', design: M.makeDesign(state.pages, state.active), flushed: true });
            return;
        }
        if (msg.type === 'travel') { travel(msg.direction); return; }
        if (msg.type === 'loadDesign' && msg.design && msg.design.pages) {
            // A design handed over whole. As a step (a backup brought back
            // into this design) it can be undone like a drawing; otherwise it
            // starts a fresh history - there is nothing before it to go back to.
            clearTimeout(syncTimer);
            if (!msg.asStep) {
                undoStack.length = 0;
                redoStack.length = 0;
                restoring = true;
                lastSent = '';
                lastContent = '';
            }
            loadDesign(msg.design);
            state.history = [state.active];
            state.historyAt = 0;
            renderChrome();
            sendDesign();
            restoring = false;
            vscode.postMessage({ type: 'status', text: 'design restored' });
        }
    });

    // Read-only snapshot for debugging and automated checks. Returns a copy,
    // so nothing outside this file can change the drawing through it.
    self.__draw2code = {
        snapshot: () => JSON.parse(JSON.stringify({
            tool: state.tool,
            snap: state.snap,
            selectedId: state.selectedId,
            editingId: state.editingId,
            propsOpen: props.isOpen(),
            page: state.page,
            chrome: state.chrome,
            pageTop: R.chromeHeight(state),
            active: state.active,
            undo: undoStack.length,
            redo: redoStack.length,
            pages: state.pages.map((p) => ({ name: p.name, title: p.title, open: p.open, count: p.elements.length })),
            elements: state.elements,
        })),
    };

    // ---- start ------------------------------------------------------------
    window.addEventListener('resize', resizeCanvas);
    renderChrome();
    syncStyleControls();
    resizeCanvas();
    vscode.postMessage({ type: 'ready' });
})();
