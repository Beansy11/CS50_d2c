# Recipes

Step-by-step checklists for extending Draw2Code Web Editor. Each recipe lists
every file that has to change, in order. Add a recipe whenever a milestone
introduces a new kind of change.

Golden rule for all of them: **change the model, then `redraw()`**. Nothing
draws directly, and the popup and text editor never edit the model themselves.

Script load order (a new script goes in this list in `src/designerPanel.ts`):
`model.js` → `render.js` → `props.js` → `textEditor.js` → `main.js`

---

## Add a new shape type

1. `media/model.js` - add it to `SHAPE_TYPES`. If "inside its box" is the
   wrong click test, add a case to `hitTest()`.
2. `media/render.js` - add a case to `drawElement()`.
3. `media/main.js` - add it to `BOX_TOOLS` and `shortcuts`.
4. `src/designerPanel.ts` - add a toolbar button (`data-tool="..."`).
5. `test/model.test.js` - add tests.
6. `media/generators/html.js` - shapes are handled by `svgBody()`; add a
   case there, and a test in `test/html.test.js`.

## Add a new widget type

1. `media/model.js` - add it to `WIDGET_TYPES`, `WIDGET_DEFAULTS` and
   `DEFAULT_SIZES`.
2. `media/render.js` - add a case to `drawElement()` (use `drawText()`).
3. `media/main.js` - add it to `BOX_TOOLS` and `shortcuts`.
4. `src/designerPanel.ts` - add a toolbar button.
5. `test/model.test.js` - add tests.
6. `media/generators/html.js` - add a case to `renderElement()` (HTML tag
   + CSS rule), and a test in `test/html.test.js`.

## Add a style property (for example opacity)

1. `media/model.js` - add it to `DEFAULT_STYLE` (and `WIDGET_DEFAULTS` if
   widgets use it), copy it in `createElement()`, add a `case` to `setProp()`
   with its limits.
2. `media/render.js` - use it in `paint()`.
3. Toolbar: `src/designerPanel.ts` control + `media/main.js`
   `applyStyle()` / `syncStyleControls()`.
4. Popup: see *Add a property to the properties popup*.
5. `test/model.test.js` - test the `setProp` limits.
6. `media/generators/html.js` - write it into the SVG attributes or CSS rule,
   always through `color()` / `num()` so bad values cannot break the page.

## Add a property to the properties popup

1. `media/model.js` - add a `case` to `setProp()`. This is the only way the
   popup changes an element.
2. `src/designerPanel.ts` - add `<input data-prop="name">` inside a
   `props-row`. If only some types use it, give the row `data-show="key"`.
3. `media/props.js` - add `key: (type) => ...` to `SHOW` for a new
   `data-show` key.
4. `media/render.js` - use the property.
5. `test/model.test.js` - add tests.

## Change widget text alignment or padding

1. `media/render.js` - `drawText()`.
2. `media/textEditor.js` - `place()`, so the in-place editor lines up with
   what the canvas draws.

## Change what happens after drawing

`media/main.js` → `endDrag()`. Both the box tools and the pen call
`setTool('select')` there.

## Change default colors or sizes

- Shapes: `DEFAULT_STYLE` in `media/model.js`.
- Widgets: `WIDGET_DEFAULTS` and `DEFAULT_SIZES` in `media/model.js`.
- Selection colour and handle size: top of `media/render.js`.

## Change the generated HTML

1. `media/generators/html.js`:
   - page-wide CSS (body, `.page`) - `generate()` → `baseCss`
   - one element's tag or CSS - `renderElement()`
   - shape drawing - `svgBody()`
2. Anything taken from the design goes through `escapeHtml()` (text),
   `color()` (colors) or `num()` (numbers).
3. `test/html.test.js` - update or add tests.
4. If it changes where things appear, match it on the canvas in
   `media/render.js` (for example, widget borders are drawn inside the box
   because the HTML uses `box-sizing: border-box`).

## Add a design-level setting (like page color)

1. `media/model.js` - add it to `DEFAULT_PAGE` (or a new part of the design
   in `makeDesign()`).
2. `media/main.js` - keep it in `state.page`, add a toolbar control that
   updates it and calls `redraw()` (the design is sent to the extension
   automatically).
3. `media/render.js` - use it in `render()` if the canvas should show it.
4. `media/generators/html.js` - use it in `generate()`.
5. Tests in `test/model.test.js` and `test/html.test.js`.

## Change the mock browser (tab strip and address bar)

Everything is in `media/render.js`: the `CHROME` constants (heights, colors,
tab title, address text) and `drawChrome()`. `chromeHeight()` is the single
source of "where does the page start"; `main.js` uses it for the mouse,
the popup and the text editor, so a new height needs no other change. It is
never part of the generated HTML.

## Change the site template (folders, entry page)

1. `src/siteFiles.ts` - `TEMPLATE`. Everything else (copy, list, diff,
   apply) reads it.
2. `docs/SITE-TEMPLATE.md` - keep the picture in sync.
3. `test/site.test.js` - the fixture site in `beforeEach`.

## Change the site preview bar or how a page is embedded

`src/sitePreviewPanel.ts` → `buildHtml()`. The page becomes the webview
document itself (VS Code will not serve local files into an iframe, and a
`<base href>` breaks the webview's own frame), so `rewriteUrls()` converts
every relative URL to a webview URI. The bar is injected into a shadow root
at the end of `<body>`. The CSP list says what the page may load. Links to
other pages of the site are turned into page switches.

## Add a control to the browser bar

**The bar is one file.** `media/chrome.js` builds it and `media/chrome.css`
styles it, and both modes mount that same module:

- **Canvas (New Design):** `media/main.js` mounts it into `#chrome` (the
  "the browser bar" section) and feeds it from `state.pages`.
- **Editor (Open Editor):** `src/pageShell.ts` mounts it inside the shadow
  root over the real page, from the `chrome` option that
  `DesignerPanel.buildPageView` fills in.

So a new control goes in `chrome.js` (markup + the handler it calls) and
`chrome.css` (its look) **once**, and each mode decides what it means by
passing another handler. What the bar shows is a plain view object:
`{ pages, address, canBack, canForward, addable, suggestions, tools }`.

Page rules themselves are pure and live in `media/model.js`
(`addPage`, `closePage`, `renamePage`, `findPage`, `openPages`,
`activePage`), so they can be unit-tested without a webview - put new rules
there, not in the bar.

## Make a new kind of edit undoable

You already have. Undo in the editor (`src/history.ts`) is built on
**page snapshots** - `pageEditor.snapshotPage()` takes the page's file and
its overrides before an edit, `restorePage()` puts them back - so it never
needs to know what an edit was. Any new op you add to `applyEdit` is
undoable the moment it goes through `DesignerPanel.onEdit` (or the
preview's), which takes the snapshot first and records it once the edit is
made (a refused edit leaves no step).

Pass the panel's `io` (never `fs`) to `applyEdit`, `snapshotPage` and
`restorePage`: while a project is open its edits are held
(`src/heldFiles.ts`) until Save, and reading the disk directly would miss them.

The canvas works the same way with its design: `sendDesign()` in
`media/main.js` notices the design changed and keeps the previous JSON, so
any change that ends in `redraw()` is a step. Nothing to add there either.

---

*This document was drafted and written with help from AI (Claude, by Anthropic).*
