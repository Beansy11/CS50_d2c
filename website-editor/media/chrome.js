// Draw2Code Web Editor - the browser bar, ONE implementation for both modes.
//
// New Design and Open Editor are the same editor; only where the pages come
// from differs. So the tab strip, the
// address bar and back/forward are built here once and mounted by both:
// media/main.js mounts it above the canvas, src/pageShell.ts mounts it in the
// shadow root over a real page. The look lives in media/chrome.css.
//
// This file knows nothing about pages or files. It draws what `render()` is
// given and reports what the user did through the handlers.
//
// CS50 citation: the name Draw2Code Web Editor was chosen with help from
// Claude (Anthropic AI), and at my direction Claude renamed
// the project from its earlier name, HardHat Designer, throughout this file.

// @ts-check
(function (root) {
    'use strict';

    /**
     * @typedef {{ name: string, title: string, active?: boolean, closable?: boolean }} TabView
     * @typedef {{
     *   pages: TabView[],
     *   address: string,
     *   canBack?: boolean,
     *   canForward?: boolean,
     *   addable?: boolean,
     *   suggestions?: string[],
     *   tools?: string,
     * }} ChromeView
     * @typedef {{
     *   onShow?: (name: string) => void,
     *   onClose?: (name: string) => void,
     *   onAdd?: () => void,
     *   onRename?: (name: string, title: string) => void,
     *   onAddress?: (value: string) => void,
     *   onBack?: () => void,
     *   onForward?: () => void,
     *   onReload?: () => void,
     * }} ChromeHandlers
     */

    function make(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function iconButton(id, label, title) {
        const button = /** @type {HTMLButtonElement} */ (make('button', 'd2c-icon', label));
        button.type = 'button';
        button.id = id;
        button.title = title;
        return button;
    }

    /**
     * Build the bar inside `container` and wire it to `handlers`. Returns
     * `render(view)`, which redraws the bar from what it is given.
     * @param {HTMLElement} container
     * @param {ChromeHandlers} handlers
     */
    function mount(container, handlers) {
        container.classList.add('d2c-chrome');
        container.textContent = '';

        const tabs = make('div', 'd2c-tabs');
        const nav = make('div', 'd2c-nav');
        const back = iconButton('d2c-back', '←', 'Back');
        const forward = iconButton('d2c-forward', '→', 'Forward');
        const reload = iconButton('d2c-reload', '↻', 'Reload the page');
        const address = /** @type {HTMLInputElement} */ (make('input', 'd2c-address'));
        address.id = 'd2c-address';
        address.spellcheck = false;
        address.placeholder = 'Search or enter address';
        address.title = 'The page. Type another page to go to it.';
        const list = /** @type {HTMLDataListElement} */ (make('datalist'));
        list.id = 'd2c-pages';
        address.setAttribute('list', list.id);
        const tools = make('span', 'd2c-tools');
        nav.append(back, forward, reload, address, list, tools);
        container.append(tabs, nav);

        /** What the address shows when the user is not typing in it. */
        let shown = '';
        const restore = () => { address.value = shown; };

        // A click on a tab shows its page; a DOUBLE-click renames it. Showing
        // another page can redraw everything (the editor loads the page
        // again), which would swallow the second click - so switching waits a
        // moment that a second click cancels. The page already showing needs
        // no wait: there is nothing to switch to.
        const DOUBLE_CLICK_MS = 250;
        let showTimer = 0;

        tabs.addEventListener('click', (e) => {
            const target = /** @type {HTMLElement} */ (e.target);
            if (target.classList.contains('d2c-tab-add')) { if (handlers.onAdd) handlers.onAdd(); return; }
            if (target.classList.contains('d2c-tab-close')) {
                if (!(/** @type {HTMLButtonElement} */ (target)).disabled && handlers.onClose) handlers.onClose(target.dataset.page || '');
                return;
            }
            const tab = target.closest ? /** @type {HTMLElement|null} */ (target.closest('.d2c-tab')) : null;
            if (!tab) return;
            if (e.detail >= 2) {
                clearTimeout(showTimer);
                startRename(tab);
                return;
            }
            if (tab.classList.contains('active') || !handlers.onShow) return;
            const name = tab.dataset.page || '';
            clearTimeout(showTimer);
            showTimer = setTimeout(() => { if (handlers.onShow) handlers.onShow(name); }, DOUBLE_CLICK_MS);
        });

        /** Swap the tab's title for a text box; Enter or clicking away keeps it, Esc does not. */
        function startRename(tab) {
            const title = /** @type {HTMLElement|null} */ (tab.querySelector('.d2c-tab-title'));
            if (!title || !handlers.onRename) return;
            const before = title.textContent || '';
            const input = /** @type {HTMLInputElement} */ (make('input', 'd2c-tab-edit'));
            input.value = before;
            input.spellcheck = false;
            input.setAttribute('aria-label', 'Page title');
            title.replaceWith(input);
            input.focus();
            input.select();
            let done = false;
            const finish = (/** @type {boolean} */ keep) => {
                if (done) return;
                done = true;
                const value = input.value.trim();
                input.replaceWith(title);
                if (keep && value && value !== before) {
                    title.textContent = value;
                    if (handlers.onRename) handlers.onRename(tab.dataset.page || '', value);
                }
            };
            input.addEventListener('keydown', (e) => {
                // Every key is the text box's: none reach the page or the canvas.
                e.stopPropagation();
                if (e.key === 'Enter') { e.preventDefault(); finish(true); }
                else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
            });
            input.addEventListener('blur', () => finish(true));
            input.addEventListener('click', (e) => e.stopPropagation());
        }

        address.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (handlers.onAddress) handlers.onAddress(address.value);
                address.blur();
            } else if (e.key === 'Escape') {
                // Ours to handle: the page behind must not take it as "deselect".
                e.preventDefault();
                e.stopPropagation();
                restore();
                address.blur();
            }
        });
        // Picking from the drop-down list fires change without a key.
        address.addEventListener('change', () => {
            if (address.value !== shown && handlers.onAddress) handlers.onAddress(address.value);
        });
        address.addEventListener('blur', () => { if (address.value !== shown) restore(); });

        back.addEventListener('click', () => { if (handlers.onBack) handlers.onBack(); });
        forward.addEventListener('click', () => { if (handlers.onForward) handlers.onForward(); });
        reload.addEventListener('click', () => { if (handlers.onReload) handlers.onReload(); });

        /** @param {ChromeView} view */
        function render(view) {
            tabs.textContent = '';
            for (const page of view.pages) {
                const tab = make('span', 'd2c-tab' + (page.active ? ' active' : ''));
                tab.dataset.page = page.name;
                tab.title = handlers.onRename ? `${page.name} - double-click to rename` : page.name;
                const close = /** @type {HTMLButtonElement} */ (make('button', 'd2c-tab-close', '×'));
                close.type = 'button';
                close.dataset.page = page.name;
                close.disabled = page.closable === false;
                close.title = close.disabled
                    ? 'The last page stays open'
                    : `Close ${page.name} (the page is kept; type its name to bring it back)`;
                tab.append(make('span', 'd2c-tab-title', page.title || page.name), close);
                tabs.append(tab);
            }
            if (view.addable) {
                const add = /** @type {HTMLButtonElement} */ (make('button', 'd2c-tab-add', '+'));
                add.type = 'button';
                add.title = 'Add a page';
                tabs.append(add);
            }
            shown = view.address;
            address.value = view.address;
            back.disabled = !view.canBack;
            forward.disabled = !view.canForward;
            list.textContent = '';
            for (const name of view.suggestions || []) {
                const option = /** @type {HTMLOptionElement} */ (make('option'));
                option.value = name;
                list.append(option);
            }
            if (view.tools !== undefined) tools.innerHTML = view.tools;
        }

        return { render, address, tools };
    }

    root.D2CChrome = { mount };
})(typeof self !== 'undefined' ? self : this);
