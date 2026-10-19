// Draw2Code Web Editor - draws the model onto the canvas.
//
// Rendering never changes the model. It is called after every change and
// repaints everything from scratch: clear, grid, each element in order,
// then the selection on top.
//
// CS50 citation: the name Draw2Code Web Editor was chosen with help from
// Claude (Anthropic AI), and at my direction Claude renamed
// the project from its earlier name, HardHat Designer, throughout this file.

// @ts-check
(function (root) {
    'use strict';

    const M = root.D2CModel;
    const SELECTION_COLOR = '#22d3ee';
    const HANDLE_SIZE = 7;
    const FONT_FAMILY = 'system-ui, sans-serif';

    // The mock browser above the page. It used to be PAINTED here; it is now
    // real controls (one tab per page - see media/main.js and main.css), so
    // only its height is still the canvas's business: page coordinates start
    // below it, which is what makes them match the generated HTML.
    const CHROME = Object.freeze({
        tabStripHeight: 36,
        navHeight: 44,
    });
    const TEXT_PADDING = 8;
    const BUTTON_RADIUS = 4;

    function drawGrid(ctx, width, height, grid) {
        ctx.save();
        ctx.strokeStyle = 'rgba(128, 128, 128, 0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0.5; x < width; x += grid) { ctx.moveTo(x, 0); ctx.lineTo(x, height); }
        for (let y = 0.5; y < height; y += grid) { ctx.moveTo(0, y); ctx.lineTo(width, y); }
        ctx.stroke();
        ctx.restore();
    }

    function paint(ctx, el, closed) {
        if (closed && el.fill !== 'none') {
            ctx.fillStyle = el.fill;
            ctx.fill();
        }
        if (el.strokeWidth > 0) {
            ctx.strokeStyle = el.stroke;
            ctx.lineWidth = el.strokeWidth;
            ctx.stroke();
        }
    }

    /** Height of the browser bar, i.e. where the page starts. */
    function chromeHeight(state) {
        return state.chrome ? CHROME.tabStripHeight + CHROME.navHeight : 0;
    }

    /** Widget text, clipped to the box so long text never spills out. */
    function drawText(ctx, el) {
        if (!el.text) return;
        ctx.save();
        ctx.beginPath();
        ctx.rect(el.x, el.y, el.w, el.h);
        ctx.clip();
        ctx.font = `${el.fontSize}px ${FONT_FAMILY}`;
        ctx.fillStyle = el.textColor;
        ctx.textBaseline = 'middle';
        const centered = el.type === 'button';
        ctx.textAlign = centered ? 'center' : 'left';
        const pad = el.type === 'input' ? TEXT_PADDING : 0;
        ctx.fillText(el.text, centered ? el.x + el.w / 2 : el.x + pad, el.y + el.h / 2);
        ctx.restore();
    }

    /** The box shrunk by half the stroke, so the stroke lands inside it. */
    function insetBox(el) {
        const half = el.strokeWidth / 2;
        return { x: el.x + half, y: el.y + half, w: Math.max(0, el.w - el.strokeWidth), h: Math.max(0, el.h - el.strokeWidth) };
    }

    /** `hideText` is true while that widget's text is being edited in place. */
    function drawElement(ctx, el, hideText) {
        ctx.save();
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        switch (el.type) {
            case 'rect':
                ctx.rect(el.x, el.y, el.w, el.h);
                paint(ctx, el, true);
                break;
            case 'ellipse':
                ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, el.w / 2, el.h / 2, 0, 0, Math.PI * 2);
                paint(ctx, el, true);
                break;
            case 'line': {
                const [x1, y1, x2, y2] = M.lineEndpoints(el);
                ctx.moveTo(x1, y1);
                ctx.lineTo(x2, y2);
                paint(ctx, el, false);
                break;
            }
            case 'pen':
                M.penPoints(el).forEach(([x, y], i) => {
                    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                });
                paint(ctx, el, false);
                break;
            // Widget borders are drawn INSIDE the box, because that is what the
            // generated HTML does (box-sizing: border-box). Shapes keep their
            // stroke centred on the edge, like SVG.
            case 'button': {
                const b = insetBox(el);
                if (ctx.roundRect) ctx.roundRect(b.x, b.y, b.w, b.h, BUTTON_RADIUS);
                else ctx.rect(b.x, b.y, b.w, b.h);
                paint(ctx, el, true);
                if (!hideText) drawText(ctx, el);
                break;
            }
            case 'input':
            case 'label': {
                const b = insetBox(el);
                ctx.rect(b.x, b.y, b.w, b.h);
                paint(ctx, el, true);
                if (!hideText) drawText(ctx, el);
                break;
            }
        }
        ctx.restore();
    }

    function drawSelection(ctx, el) {
        ctx.save();
        ctx.strokeStyle = SELECTION_COLOR;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(el.x - 0.5, el.y - 0.5, el.w + 1, el.h + 1);
        ctx.setLineDash([]);
        ctx.fillStyle = '#ffffff';
        for (const h of M.handlePositions(el)) {
            const s = HANDLE_SIZE;
            ctx.fillRect(h.x - s / 2, h.y - s / 2, s, s);
            ctx.strokeRect(h.x - s / 2, h.y - s / 2, s, s);
        }
        ctx.restore();
    }

    /**
     * Repaint everything. `draft` is the element being drawn right now.
     * Element coordinates are PAGE coordinates: (0, 0) is the top-left of the
     * page, just under the mock browser, so they match the generated HTML.
     */
    function render(ctx, width, height, state) {
        const top = chromeHeight(state);
        ctx.save();
        ctx.clearRect(0, 0, width, height);
        ctx.translate(0, top);
        // The page color IS the canvas background, so the canvas matches the output.
        ctx.fillStyle = state.page.color;
        ctx.fillRect(0, 0, width, height - top);
        drawGrid(ctx, width, height - top, M.GRID);
        for (const el of state.elements) drawElement(ctx, el, el.id === state.editingId);
        if (state.draft) drawElement(ctx, state.draft, false);
        const selected = state.elements.find((e) => e.id === state.selectedId);
        if (selected) drawSelection(ctx, selected);
        ctx.restore();
    }

    root.D2CRender = { render, drawElement, drawSelection, chromeHeight, CHROME, HANDLE_SIZE, FONT_FAMILY, TEXT_PADDING };
})(self);
