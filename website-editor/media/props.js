// Draw2Code Web Editor - the properties popup.
//
// Opens on right-click over an element. It is NOT modal: the canvas keeps
// working while it is open, and it always shows the SELECTED element, so
// dragging an element updates the X/Y boxes live. Drag it by its header.
//
// It never changes the model itself. Every edit goes out through onChange,
// and main.js applies it with D2CModel.setProp().
//
// CS50 citation: the name Draw2Code Web Editor was chosen with help from
// Claude (Anthropic AI), and at my direction Claude renamed
// the project from its earlier name, HardHat Designer, throughout this file.

// @ts-check
(function (root) {
    'use strict';

    /** Which rows each element type shows (rows marked data-show="..."). */
    const SHOW = {
        fill: (type) => type !== 'line' && type !== 'pen',
        flip: (type) => type === 'line',
        text: (type) => root.D2CModel.isWidget(type),
    };

    const OFFSET = 12; // open just below-right of the cursor

    function create({ panel, header, title, closeButton, bounds, onChange }) {
        const fields = /** @type {HTMLInputElement[]} */ (Array.from(panel.querySelectorAll('[data-prop]')));
        const rows = /** @type {HTMLElement[]} */ (Array.from(panel.querySelectorAll('[data-show]')));
        const fillColor = /** @type {HTMLInputElement} */ (panel.querySelector('[data-prop="fill"]'));
        let isOpen = false;

        for (const field of fields) {
            // 'input' fires on every keystroke, colour change and checkbox toggle.
            field.addEventListener('input', () => {
                const prop = field.dataset.prop;
                if (prop === 'noFill') onChange('fill', field.checked ? 'none' : fillColor.value);
                else if (field.type === 'checkbox') onChange(prop, field.checked);
                else onChange(prop, field.value);
            });
        }

        // Keep keys typed into the popup from reaching the canvas shortcuts.
        panel.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') { close(); e.stopPropagation(); }
        });

        // ---- position & dragging ----------------------------------------
        function moveTo(left, top) {
            const maxLeft = Math.max(0, bounds.clientWidth - panel.offsetWidth);
            const maxTop = Math.max(0, bounds.clientHeight - panel.offsetHeight);
            panel.style.left = `${Math.max(0, Math.min(maxLeft, left))}px`;
            panel.style.top = `${Math.max(0, Math.min(maxTop, top))}px`;
        }

        let grab = null;
        header.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || e.target === closeButton) return;
            header.setPointerCapture(e.pointerId);
            grab = { dx: e.clientX - panel.offsetLeft, dy: e.clientY - panel.offsetTop };
        });
        header.addEventListener('pointermove', (e) => {
            if (grab) moveTo(e.clientX - grab.dx, e.clientY - grab.dy);
        });
        const release = () => { grab = null; };
        header.addEventListener('pointerup', release);
        header.addEventListener('pointercancel', release);

        closeButton.addEventListener('click', () => close());

        // ---- public -------------------------------------------------------
        function openAt(x, y) {
            panel.hidden = false;
            isOpen = true;
            moveTo(x + OFFSET, y + OFFSET);
        }

        function close() {
            panel.hidden = true;
            isOpen = false;
        }

        /** Refresh from the selected element; closes when there is none. */
        function sync(el) {
            if (!isOpen) return;
            if (!el) { close(); return; }
            title.textContent = `${el.type} #${el.id}`;
            for (const row of rows) row.hidden = !SHOW[row.dataset.show](el.type);
            for (const field of fields) {
                // Never overwrite what the user is typing right now.
                if (field === document.activeElement && field.type !== 'checkbox') continue;
                const prop = field.dataset.prop;
                if (prop === 'noFill') {
                    field.checked = el.fill === 'none';
                } else if (prop === 'fill') {
                    if (el.fill !== 'none' && el.fill !== undefined) field.value = el.fill;
                    field.disabled = el.fill === 'none';
                } else if (field.type === 'checkbox') {
                    field.checked = Boolean(el[prop]);
                } else if (el[prop] !== undefined) {
                    field.value = String(el[prop]);
                }
            }
        }

        return { openAt, close, sync, isOpen: () => isOpen };
    }

    root.D2CProps = { create };
})(self);
