# How it looks, and how to change it

Where each part of the editor's look lives, and what to edit to change it.
Paths are inside `website-editor/` unless they start with the repo root's
`package.json`.

Some values are written in more than one file, because two different programs
have to agree on them (the canvas and the generated page, or the canvas and the
real-page editor). Those are marked **change together**: changing only one of
them makes what you see in the editor stop matching what gets built.

---

## The canvas (New Design)

**Theme.** The canvas page takes its colours from the VS Code theme, so it
looks right in both dark and light themes. `media/main.css` maps VS Code's
colours to a few names at the top of the file (`--bg`, `--fg`, `--panel`,
`--border`, `--accent`, `--accent-fg`) and uses only those names below. To
restyle the canvas page, change what those names point to; to make it ignore
the theme, give them fixed colours instead of `var(--vscode-...)`.

**Grid.** The grid is 20px. The size is `GRID` in `media/model.js`, and it is
also what snapping rounds to, so changing it changes both. The grid line colour
is the `strokeStyle` in `drawGrid` in `media/render.js`.

**Page colour.** White by default: `DEFAULT_PAGE` in `media/model.js`. A user
can change it per page with **Page** in the toolbar, and the canvas paints the
same colour the generated page will have.

**Selection.** A cyan outline with 7px square handles: `SELECTION_COLOR` and
`HANDLE_SIZE` at the top of `media/render.js`.

## New elements

What a new element looks like before the user changes anything is set in
`media/model.js`:

| Type | Fill | Border | Text | Size when clicked |
| --- | --- | --- | --- | --- |
| Shapes (rect, ellipse, line, pen) | `#3b82f6` | `#f59e0b`, 2px | - | dragged |
| Button | `#3b82f6` | `#1d4ed8`, 1px | "Button", 14px, `#ffffff` | 120 × 40 |
| Input | `#ffffff` | `#94a3b8`, 1px | "Type here...", 14px, `#64748b` | 200 × 40 |
| Label | none | none | "Label", 14px, `#1e293b` | 80 × 20 |
| Text (page editor) | none | none | "Text", 16px, `#1e293b` | 320 × 40, grows |
| Heading (page editor) | none | none | "Heading", 32px, `#0f172a` | 320 × 40, grows |
| Image (page editor) | none | none | - (alt text asked for) | 200 × 150, picture fitted inside |

- Shape colours: `DEFAULT_STYLE`.
- Widget colours, text and font size: `WIDGET_DEFAULTS`.
- Sizes when an element is placed with a click instead of a drag: `DEFAULT_SIZES`.

**Widget text** uses `system-ui, sans-serif`, 8px of padding and a 4px corner
on buttons. **Change together:** `FONT_FAMILY`, `TEXT_PADDING` and
`BUTTON_RADIUS` in `media/render.js`, and `FONT_FAMILY`, `INPUT_PADDING` and
`BUTTON_RADIUS` in `media/generators/html.js`. The first draws the canvas, the
second writes the HTML.

## The browser bar

The bar above every page (tabs on top, the address row under it) is the same in
both modes: drawing a new design, and editing a real page. Its look is all in
`media/chrome.css`: the bar's colour and text, the tabs (colour, rounded top
corners, maximum width), the active tab, and the address row.

**Its height: change together.** The bar is a 36px tab strip plus a 44px
address row, 80px in all, and page coordinates start below it. The two heights
are in `media/chrome.css`, in `CHROME` in `media/render.js`, and in `CHROME`
in `src/pageShell.ts`. If they disagree, what is drawn lands in a different
place from where the user clicked.

## Editing a real page

Everything drawn over an imported page lives in one block of CSS inside
`src/pageShell.ts`, so it cannot clash with the page's own styles:

- **Toolbar:** `.d2c-toolbar` and `.d2c-tool` (the tool buttons), `.d2c-tool.active`
  for the tool in use. Its height is `TOOLBAR_HEIGHT` near the top of the file;
  keep it one row of that height, because the page is pushed down by exactly
  that much and drawing positions are worked out from it.
- **Toolbar symbols:** `TOOL_ICONS` and `STYLE_ICONS`, 16x16 line drawings in
  the button's text colour, each `.d2c-glyph`. Each control's name and what it
  does are in its `title`, shown on hover. (`.d2c-icon` is taken: it is the
  browser bar's round buttons, in `media/chrome.css`.)
- **Hover outline:** `.hover`, a dashed blue line.
- **Selection:** `.sel` for the outline, `.tag` for the name tag above it, and
  `.h` for the 9px white resize handles.
- **Drawing a new element:** `.draft`, a dashed box with a light blue fill.

These use fixed colours, not the VS Code theme, so they stay visible on any
page.

The page itself is shown as it is. Moving an element nudges it (`position:
relative` with left and top), so the rest of the page does not reflow around
it.

## The phone view

What a page made in Draw2Code looks like on a phone, and in the editor's
phone view:

- **The phone's width and the breakpoint.** The phone view lays the page out
  390px wide; a page's phone layout applies in any window up to 767px wide.
  `PHONE_WIDTH` and `PHONE_BREAKPOINT` in `media/model.js`. **Change
  together:** `PHONE_BREAKPOINT` and `PHONE_LAYOUT_CLASS` are copied in
  `src/pageWidth.ts` (tests hold the copies to the model).
- **The phone block** makes the page as wide as the phone's window instead
  of the desktop column. **Change together:** the phone block at the end of
  `baseCss` in `media/generators/html.js`, and `PHONE_BASE` in
  `src/pageEdit.ts`, which writes the same rules with a page's phone layout
  (a test holds them together). The editor's own copy, without the `@media`
  query because the editor's window is a desktop one, is `phoneViewCss` in
  `src/pageEditor.ts`.
- **Hide on phone** shows the element at 30% opacity in the phone view, so
  it can be selected: `PHONE_HIDDEN_OPACITY` in `src/pageEditor.ts`.
- **The toolbar's phone buttons** (Phone, Hide on phone, Reset phone
  layout): the `phone`, `hide` and `reset` symbols in `STYLE_ICONS` in
  `src/pageShell.ts`.
- **The first draft's numbers** are at the top of `src/phoneDraft.ts`: how
  wide a band is (`BAND_SHARE`, 60% of the page), the phone's side margin
  (`MARGIN`, 16px) and the space between blocks (`GAP`, 12px), a band's
  room above and below (`PAD_MIN`, `PAD_MAX`), and how much of a font size
  is kept (`FONT_SCALE`, 0.65). The least font size is `PHONE_FONT_MIN`
  (14px) in `media/model.js`.

## Tabs and labels

- **A project's tab name:** a project opened from its `.draw2code/project.d2c` is
  named after its folder, not "project.d2c". That comes from
  `configurationDefaults` > `workbench.editor.customLabels.patterns` in the root
  `package.json`.
- **A new design** is `Untitled-1.d2c` (the next free number) until it is
  saved. Unsaved work shows VS Code's own dot on the tab.
- **Any other `.d2c`:** a plain message saying it is not a project Draw2Code can
  open, written in `notAProject` in the root `src/projectEditor.ts`.

## The generated page

`media/generators/html.js` writes only what was drawn, with no theme of its
own. That is deliberate (see "No built-in taste" in the main README), so it
is not a place to add styling.

- Elements are placed absolutely, 1:1 with the canvas. Shapes are inline SVG.
- The page body gets the page colour, with no margin or padding.
- Publish's clean copy (`-prod`) looks exactly like `-dev`: Draw2Code's markers
  and stylesheets are removed, but nothing moves.

## The icon

The extension has no icon yet. To add one, put a 128 × 128 PNG in the
repository and name it in the root `package.json` as `"icon"`.

---

*This document was drafted and written with help from AI (Claude, by Anthropic).*
