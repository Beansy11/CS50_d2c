// Draw2Code Web Editor - edit a widget's text in place.
//
// Double-clicking a widget places a real text box exactly over it, styled to
// match. Enter or clicking away saves; Esc cancels. While it is open the
// canvas hides that widget's own text so the two never overlap.
//
// CS50 citation: the name Draw2Code Web Editor was chosen with help from
// Claude (Anthropic AI), and at my direction Claude renamed
// the project from its earlier name, HardHat Designer, throughout this file.

// @ts-check
(function (root) {
    'use strict';

    /** `pageTop()` gives where the page starts on the canvas (see render.js). */
    function create({ input, pageTop, onCommit, onCancel }) {
        let editingId = /** @type {number|null} */ (null);
        const R = root.D2CRender;

        function place(el) {
            const s = input.style;
            s.left = `${el.x}px`;
            s.top = `${el.y + pageTop()}px`;
            s.width = `${Math.max(el.w, 40)}px`;
            s.height = `${Math.max(el.h, 20)}px`;
            s.fontSize = `${el.fontSize}px`;
            s.fontFamily = R.FONT_FAMILY;
            s.color = el.textColor;
            s.background = el.fill === 'none' ? 'transparent' : el.fill;
            s.textAlign = el.type === 'button' ? 'center' : 'left';
            s.paddingLeft = el.type === 'input' ? `${R.TEXT_PADDING}px` : '0px';
        }

        function open(el) {
            editingId = el.id;
            input.value = el.text;
            place(el);
            input.hidden = false;
            input.focus();
            input.select();
        }

        function finish(commit) {
            if (editingId === null) return;
            const id = editingId;
            editingId = null;
            input.hidden = true;
            if (commit) onCommit(id, input.value);
            else onCancel(id);
        }

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); finish(true); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); }
        });
        input.addEventListener('blur', () => finish(true));

        return { open, finish, editingId: () => editingId };
    }

    root.D2CTextEditor = { create };
})(self);
