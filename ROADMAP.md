# Roadmap

What is not finished in Draw2Code Web Editor, and what comes next. The README
says what works; this file is the other half.

## Known bugs

- **Saving a new design under a name without `.d2c`** saves the project
  correctly, but the tab then shows "The file is not displayed in the text
  editor because it is a directory." Seen with VS Code's simple save dialog,
  which does not add the extension; check whether the normal save dialog on
  Linux adds it.
- **Publishing an imported site keeps Draw2Code in your folder:** the
  `data-d2c` markers, the `data-d2c-was` and `data-d2c-looks` attributes on
  links, the `data-d2c-drawn` attribute on resized shapes and the
  `draw2code/` stylesheets are copied as they are.
  A new project's `-prod` is already clean; an import's final copy should be
  too.
- **An empty stylesheet is left behind.** When a page's last Draw2Code edit is
  undone, `draw2code/<page>.css` stays with only its header comment, and
  Publish copies it into your folder. Links reach it too: two links made on
  a page and removed first-made first leave the stylesheet linked and empty,
  and on a site with no project a link made and removed leaves an empty
  `.draw2code/overrides.json` and an empty `draw2code/` folder.
- **Deleting next to an element a page script added or moved can delete its
  neighbour.** An element without an id is found by its position, and the
  page shown and the file then count differently: on a page whose script
  adds a `<nav>` to the top of `<body>`, deleting one `<div>` deletes the one
  after it in the file. Ctrl+Z brings it back.
- **Deleting an element left unclosed at the end of the file** (a last `<p>`
  with no `</p>`) also deletes `</body>`, `</html>` and whatever follows
  them, such as a closing comment.
- **A page with no `<head>` but a `<header>`:** the editor's
  Content-Security-Policy is put inside the header, where the browser
  ignores it, so the page's own scripts are not held back while editing.
- **Deleting a form with a control named `remove`** saves the change, but
  the editor's script stops on it (`form.remove` is that control), so in the
  Site Preview the form stays on screen until the page is drawn again.
- **A page `<select>` takes the first Delete.** Clicking one while editing
  selects it and also opens its list, and the open list takes every key:
  Delete does nothing until Esc closes the list.
- **Esc does not stop a link being followed.** A second click on a selected
  link follows it after a short pause; Esc in that pause clears the
  selection, but the page is still followed. Delete stops it.
- **Ctrl+Z and Ctrl+Y do nothing in the Site Preview.** Its overlay sends
  them, but `sitePreviewPanel.ts` does not take them. An element deleted
  there has to be brought back from the editor tab; Revert page puts back
  only rules, not markup.
- **On an imported page, the editor can hide a scrollbar a browser shows.**
  Such a page may be as tall as the window in ways the editor does not
  measure (`min-height: 100vh` on its own `<body>`), so a page that scrolls
  by less than the bar's height (about 112px) is taken as one that does
  not, and its centred or full-width parts sit a scrollbar's width wider
  than in a browser. A page made in Draw2Code is measured by its elements
  and is right.
- **Redo of a Delete can leave a link to a stylesheet that is gone.** When
  the deleted element took the page's last rule and the stylesheet was never
  saved, redo removes `draw2code/<page>.css` but the page keeps its `<link>`
  to it, so Save and Publish write a page that asks for a missing file
  (nothing on screen, a 404 in the browser). Reverting the only rule did
  this already.
- **Text either side of a deleted element is joined as written:** a stray
  `<` or half an entity (`&am`) just before it can join what follows into a
  tag or another character.
- **Publish takes the indentation of an indented `</head>` with the
  stylesheet link,** so a page's `-prod` copy differs from the source by
  those spaces.
- **A page added with + shows a copied link without its look.** The new page
  copies the nav or header as it is, a link made from a button included, but
  not that link's rules from Draw2Code's stylesheet: it keeps its href and
  shows as a plain underlined link. Carrying the copied elements' rules into
  the new page would keep it.
- **Link takes the selected element out of the page for a moment** to measure
  how it would look as a link, so a running animation or a video inside it
  starts again and a page script watching the page sees two changes.
- **Text made a link keeps its margins and widths in px** for the width the
  editor had then: `margin: 10px auto` and `width: 50%` become fixed, so a
  centred paragraph or heading is off centre at any other window width.
- **Making an element a link changes the one after it.** The page's sibling
  rules (`h1 + p`, `li + li`, `h2 ~ p`) stop matching once the tag is `a`,
  so the next element can lose its colour, margin or border. Only the
  linked element's own look is measured.
- **A page file with a quote in its name breaks the link drawn to it.** Link
  can write an href to such a page and the file is right, but the editor
  draws the decoded name into the page unescaped (`rewriteUrls` in
  `siteFiles.ts`), so the quote ends the attribute. It gives a page nothing
  its own scripts could not do already.
- **A change can lose to the page's own style.** Fill, Border, Text, px, B
  and alignment write a rule in `draw2code/<page>.css`; a `style` attribute
  on the element, a page rule more specific than that rule, or an
  `!important` utility (Bootstrap's `.fs-3` or `.text-center`) wins. The
  change shows at once and is an undo step, but after the next redraw, on
  reopening and in `-prod` the old look is back, with no message.
  `style="text-align: center"` on a heading is a common case.
- **On a right-to-left page, alignment reads `start` as left.** A paragraph
  in `<html dir="rtl">` sits on the right but shows Align left as on, and
  Align left then does nothing, because the editor takes the text as already
  on the left (`alignOf` in `align.ts`). A flex label does the same. On a
  grid box alignment writes only `text-align`, so items the grid places
  (`place-items: center`) do not move.
- **A picture from an imported site's own folder is copied again.** Only
  files inside the development copy are used where they are, so picking
  `site/img/cat.png` writes a new `assets/cat.png` (or `assets/logo-2.png`
  when the name is taken) although `site-dev/img/cat.png` is already there,
  and Publish adds the duplicate to your folder. The Open dialog usually
  starts in the original, so this is the common way to pick.
- **Pictures on a Flask site do not show in the running app.** They are
  copied to `assets/` and written as `../assets/x.png` from `templates/`;
  the editor shows them and Publish copies them, but Flask serves only
  `static/`. Draw2Code's own stylesheets for templates have the same limit.
- **A copied picture follows the unsaved page, not the saved one.** It is
  deleted as soon as no open page uses it, even when the saved page still
  does: delete an image, then quit with hot exit or crash, and the saved
  page points at a picture that is gone. The other way round, pictures
  copied for images never saved stay in `-dev` when VS Code closes with
  Don't Save without asking the extension (a soft revert), when VS Code
  crashes, or when a hot-exit backup is reverted in a later session.
- **A video with only one file does not play everywhere.** VS Code's own
  browser ships a media library that reads `.mp4` only (checked in VS Code
  1.142: H.264, VP9 and AV1 in an `.mp4` play; VP8 and VP9 in a `.webm` do
  not), and an H.264 `.mp4` does not play on some systems, such as a default
  Fedora. Solved for a video given both: the page lists its `.webm` first and
  its `.mp4` second, so each goes on to the one it plays. Given only a
  `.webm`, the editor still shows its poster (or black) and "This browser
  cannot play this video", and so does such a system given only an H.264
  `.mp4`; the Video tool says so after adding it. Going on to the `.mp4` was
  checked in Chromium with a `.webm` it could not play, not yet by hand in
  VS Code.
- **YouTube and Vimeo may refuse to play inside the editor,** which has no
  web address to show them. The box is drawn at its exact size and place
  either way. Not yet checked by hand in VS Code.
- **A full-width drawing stretches its rounded corners** with it: its
  picture is stretched to the window's width, so a rectangle's corner
  rounding becomes an oval curve. Its border keeps its width.
- **A full-width element reaches half a scrollbar past each side** of a page
  that has a vertical scrollbar: it is the window's width (`100vw`), which
  counts the scrollbar. What is past the sides is cut off, so it looks
  right, but its selection outline in the editor goes past the edges by
  that much (5px in VS Code).
- **Revert element and Revert page leave Full width on.** It is a class on
  the element in the page, not one of Draw2Code's rules; click Full width
  again, or Ctrl+Z.
- **Some ways a page goes give no link warning:** Revert File or Don't Save
  dropping a page that was added and never saved, and a page deleted on disk
  whose unsaved edits were kept with Keep mine, which goes on revert. Other
  pages may still link to it.

## Not built yet

- **Corner rounding is only in the page editor,** not on the canvas, and with
  nothing selected it is off rather than set for the next shape. A drawn
  rectangle's rounding is the CSS `rx`/`ry`, checked in Chromium only.
- **A rounded picture rounds its box,** not the picture: a wide picture in a
  square box is letterboxed, so its corners are cut on a slant.
- **Pages for phones.** Every page is one fixed width (1440px unless changed);
  a window narrower than that scrolls sideways instead of fitting the page
  to it. That comes next: see "Pages for phones: the plan" below.
- **Snapping on the canvas, and to other parts of an imported page.** The
  page editor's guides line a box up with the elements beside it (on an
  imported page, those in the same parent) and the page's column, not with
  elements further away, a grid or equal gaps. How near is 6px of the page
  however far VS Code is zoomed.
- **Copying more of an element's look.** A copy takes the rules written for
  its id and Draw2Code's own, not the rules of its classes (the same site's
  other pages usually share them), rules inside `@media`, or a rule that
  finds it through where it is ("header h1"). The canvas has no Shift+click,
  copy or paste of its own yet, and the page editor's style controls change
  one element at a time.
- **Page width and Full width on the canvas.** The canvas draws from its
  left edge, shows neither, and Generate HTML makes its pages 1440px wide.
- **Page width and Full width in a project saved before them.** Its shared
  stylesheet has no rules for them: changing the page width gives its pages
  that width, but Full width does nothing there. A new project has both.
- **Smooth scrolling in a project saved before it.** A link to a section
  scrolls there at once on such a page, in the editor and published; a new
  project's shared stylesheet asks for smooth scrolling.
- **Back and Forward to where you were on a page.** VS Code keeps one
  scroll for the whole panel, so a page switched to, Back and Forward too,
  starts at its top (or at the section a link goes to), not where it was
  left. Keeping each page's own scroll would bring it back.
- **Naming a section of another page from the Link list.** A section of
  another page lists only that page's elements that have a name (an id)
  already; one without is named by linking to it from its own page first.
  A name, once given, is changed by hand.
- **A warning for a link to a section that is gone.** Deleting the element a
  `#name` link goes to leaves a link that goes nowhere, with no
  warning, as a page removed gives.
- **Undoing a page width change.** It is a setting of the project, written
  at once, so Ctrl+Z does not take it back; it is changed back the same way.
- **Generate HTML into an imported site writes only `index.html`.** Saving a
  new design as a project writes every page, but Generate on an existing site
  replaces `index.html` alone.
- **Text, links and images on the canvas.** The page editor has Text,
  Heading, Image, Link, B and alignment; the canvas, a sketch saved before
  building, has none of them.
- **Images inside links, and sections as links.** Link in the page editor
  makes a button, a label, text, a heading or a list item a link; a picture
  cannot go inside one, and a drawing or a section cannot be one yet.
- **Changing a picture.** Image adds a new one; replacing the file or the
  alt text of an image already on the page needs editing the page by hand.
- **Changing a video.** Video adds a new one; its files (an `.mp4` added
  beside a `.webm`, say), poster, link or name can only be changed by hand.
  A very large video is copied without a warning, and copying it, Publish
  and the list of changed files are slow.
- **A newer video player for a site that has an older one.** A site that
  already holds a different `js/video-player.js` gets `video-player-2.js`
  beside it for a page's first video after an update; pages that link the
  old one keep it.
- **The page editor's toolbar in the Site Preview.** The preview selects
  (Shift+click for several), moves, resizes, retypes and deletes, but Link,
  the colours, px, B, U, alignment, X/Y/Width/Height, Full width, the
  drawing tools, copy, paste and duplicate, and the column's dashed sides
  are only in the editor tab.
- **px, B and alignment for the next element drawn,** as the colours do with
  nothing selected. They are off then, and off for a drawing too.
- **A button made a link loses its hover look and its responsive sizes.**
  Its look is copied as it is at that moment, so `button:hover` or a media
  query on `h1` no longer applies, a `5vw` font is frozen in px, and the
  copied colours beat a `.btn:hover` rule. Copying the page's matching tag
  rules to the link's selector would keep them.
- **Links between the pages of a Flask app.** Link writes a page of the site
  as a file path (`about.html`), which works in the editor; a running Flask
  app serves its routes (`/about`) instead, so such a link needs
  `{{ url_for(...) }}` or the route, read from `app.py`.
- **Some links to a removed page are not counted.** The warning that a
  removed page is still linked to reads each link from the linking page's
  folder, so a link from the site root (`/about.html`), a link to a folder
  (`blog/` for `blog/index.html`) and a Flask route (`/about`) are missed,
  and so are `<area>`, `<form action>` and `onclick="location.href=..."`.
  Deleting a whole folder of pages on disk gives no warning either: VS Code
  reports the folder, not each page in it. Several pages deleted at once
  give one warning each.
- **File names in other notifications are shown as they are.** The removed
  page warning shows `[a](command:x).html` as text, but the picture and
  "changed on disk" messages do not yet, so a picked picture or a page with
  such a name would show as a link.
- **Importing an existing page onto the canvas,** so a page can be redrawn
  instead of only edited in place.
- **Scripts that build URLs at runtime.** Only the HTML's own links are
  rewritten for the editor, so a script that makes a link to an image or page
  while it runs will not find it.
- **A per-file diff view before Publish,** instead of only the list of added
  and changed files.
- **Settings:** a place to choose where new elements go by default, the snap
  grid, default colours, what the browser bar shows, and where Generate writes.

## Other kinds of site: one editor, a profile per stack

Draw2Code makes static sites, and it already opens an app-shaped project
(Flask or Django with `app.py` and `templates/`, Express with `views/`) and
edits its templates. The plan is to let a project be one of these stacks:

- **Static**: what Draw2Code makes now.
- **JAMstack**: a static site plus forms and data from outside services,
  hosted on a CDN (GitHub Pages, Netlify, Cloudflare Pages).
- **Monolithic**: one server renders the pages (Flask, Django, Express).
- **Serverless**: a static site plus functions (`functions/` or `api/`).
- **Decoupled / SPA**: a React or Vue front end that talks to an API. This
  is the furthest away: its pages are components, not HTML.

**Don't split the code per stack.** Almost all of it works on HTML, and HTML
is the same in every stack: drawing, selection, snapping, copy and paste,
styles, undo, the page shell and the page editing in `pageEdit.ts`. Four
copies of that would mean four copies of every fix. Mobile layout belongs
in this shared core too, so every stack gets it once.

**Split out only what differs**, a short list of questions each stack
answers its own way:

| Question | Static / JAMstack | Monolith (Flask) | Serverless |
|---|---|---|---|
| Where do pages live? | root, `pages/` | `templates/` | root or `public/` |
| What is a page? | an `.html` file, whole | an `.html` (or `.jinja`, `.ejs`, ...) that may hold template tags, and often only a block of `base.html` | an `.html` file, whole |
| Which page opens first? | the index file list (`index.html`, `index.htm`, ...) | the `/` route | the index file list |
| How is a link to a page written? | `about.html` | `/about` (a route) | `about.html` |
| Where do pictures and videos go? | `assets/` | `static/` | `assets/` |
| Where do the shared stylesheet, scripts and Draw2Code's own per-page stylesheets go, and how are they linked? | `css/`, `js/`, `draw2code/`, by relative path | `static/`, as `/static/...` | `css/`, `js/`, `draw2code/` |
| What does `/x` (a root-absolute address) mean? | the site root | the app's static route | the site root |
| How is the stack recognised on import? | pages in the folder | `app.py` or `manage.py` with `templates/`; `package.json` with `views/` | `functions/` or `api/` beside the pages |
| What does a new project contain? | pages | `app.py`, `templates/`, `static/` | pages and `functions/` |
| What does Publish produce? | the `-prod` folder | the app folder | `-prod`, the functions and the host's settings |
| How is it previewed, and what does the editor show? | open the HTML; the file itself | run the app; the page the app renders, not the template file | open the HTML, with the functions run locally |

Today those answers are fixed and scattered (checked against the code):
- `PAGE_DIRS` (`templates`, `views`, `pages`, `public`, `www`),
  `INDEX_FILES`, `isPage` (`.html` and `.htm` only), `DEV_SUFFIX` (`-dev`)
  and `IGNORED_DIRS` (already Python-aware: `__pycache__`, `venv`,
  `.venv`) are in `siteFiles.ts`. So is the one place that thinks like a
  server: `rewriteUrls` resolves `/static/x.css` against the site root.
- **Nothing detects a stack.** A folder is a site when `.html` files are
  directly in it or in one of the `PAGE_DIRS`; `app.py` is named only in
  comments. A Flask project is opened because `templates/` is a pages
  folder, not because it is Flask.
- `TEMPLATE` in `siteFiles.ts` holds `entry` (`index.html`), `assetsDir`
  (`assets`), `stylesDir` (`css`) and `scriptsDir` (`js`). `assetsDir` is
  used for pictures and videos (`images.ts`, `designerPanel.ts`);
  `stylesDir` and `scriptsDir` place the video player's two files
  (`videos.ts`). `pagesDir` and `folders` are defined and never used: the
  canvas names pages `page2.html` at the root, so the `pages/` folder in
  `docs/SITE-TEMPLATE.md` is only a suggestion.
- `index.html` is also written as a literal: `confirmReplacingPage` and
  `saveHtml` in `designerPanel.ts`, and `ENTRY_PAGE` in the canvas's
  `model.js`. The `.html` test is repeated in `links.ts` (twice),
  `siteFiles.ts`, `siteProject.ts` and `html.js` (`pageScope`, which the two
  files duplicate on purpose).
- The shared stylesheet's path is in the project label (`stylesheet`,
  `css/style.css`, `projectFormat.ts`) and the generator (`html.js`,
  `cssPath`); Draw2Code's per-page overrides go to `draw2code/<page>.css`
  (`pageEditor.ts`).
- The Flask `templates/` case for a new page is in `designerPanel.ts`
  (`addPage`). The new page copies the current page's `<head>` and banner
  (`newPageFrom`), which a child template that `{% extends %}` a base does
  not have.
- Every link is written as a file path (`pageHref`), and `checkHref` in
  `links.ts` refuses anything that starts with `/` or does not end in
  `.html`: a route like `/about` cannot even be typed.
- Publish is two different things: a made project gets `-prod`, built clean
  by `buildSiteProd` (`siteProject.ts`, through `src/publish.ts`); an import
  gets `applyCopy` (`siteFiles.ts`), which copies changed files back into the
  original as they are. "The app folder" in the table is the second one, so a
  monolith inherits the known bug above: `data-d2c` markers and `draw2code/`
  stylesheets published into your folder.
- The editor shows the file as written. Template tags are not understood:
  `{{ url_for('static', filename='x.css') }}` is rewritten as if it were a
  relative path and loads nothing, and a child template shows without its
  base. The page shell only knows that Jinja's `{%` can turn up as an
  attribute name.

That is where the Flask bugs above come from: pictures not in `static/`,
links that are not routes, and the same limit for Draw2Code's own
stylesheets.

**The shape:**
- A `stacks/` folder with one small module per stack. Each answers the
  questions above: `pageDirs`, `isPage(file)`, `entry` and the index list,
  `linkTo(page)`, `assetsDir`, `stylesDir`, `scriptsDir`, `overridesDir`,
  `resolveRoot(url)`, `detect(root)`, `scaffold()`, `publish()` and
  `preview()`.
- `static` is the default, and it returns exactly what the code does
  today.
- `.draw2code/project.d2c` records a project's stack, read with `static` as
  the default so every label written so far still opens. An import's label
  (`<site>-dev/.draw2code/project.d2c`, `ImportLabel`) records it too, since
  a monolith is nearly always an import. Detection is new work: today
  nothing reads `app.py`; the `monolith` profile's `detect` would look for
  `app.py` or `manage.py` beside `templates/`, or a `package.json` beside
  `views/`.
- The rest of the editor asks the project's profile (`profile.linkTo(...)`)
  instead of deciding for itself. The canvas is a consumer too: its
  `ENTRY_PAGE` and the generator's `cssPath` come from the same profile.
- Only one site is open in the Designer at a time, so the profile is one
  object per open project, not a global.

**The one question the table cannot answer by itself:** a monolith's page
is often not a whole document. The editor shows the page exactly as a
browser does, and a child template, or a page with `{{ }}` in it, has no
browser look until the app renders it. The `monolith` profile therefore
needs a source of rendered pages: run the app and fetch `/about` for the
editor, map what is edited back onto the template file, and run nothing
on Publish. That would be the first time Draw2Code starts a process, and
it is the part of this plan that is not yet designed.

**The order:**
1. Move today's answers into the `static` profile, with nothing else
   changed. All the tests passing is the proof that nothing did; a new test
   holds the `static` profile to today's constants. This step is bigger
   than moving `TEMPLATE`: the literals listed above (`index.html`, the
   `.html` test, `-dev`, the stylesheet path) go through the profile too,
   and `pagesDir` and `folders` are either used or dropped. The tests that
   pin the layout today are `project`, `site`, `images` and `links`
   (about 180 cases between them).
2. Add `jamstack`. It is nearly the same as static, which tests that the
   seams are in the right places. It adds a form that posts to a service
   (Formspree, Netlify Forms) and the host's settings (`netlify.toml`,
   `_redirects`). A form needs a Form tool first: the editor has Input and
   Button, but nothing that groups them and says where they post.
3. Add `monolith`, which fixes the Flask items above for real: detection,
   `static/` for pictures, videos, the player and the overrides, routes in
   Link (so `checkHref` accepts `/about`), a Publish that strips the markers
   the way `-prod` does, and the rendered-page source described above.
   Django (`manage.py`) and Express (`views/`, EJS) are the same profile
   with their own detection and template syntax.
4. Add `serverless`: JAMstack plus a `functions/` folder, and a form or
   button wired to one of them. "Functions run locally" means starting the
   host's development server (`netlify dev` and the like) from the editor,
   the same process question as the monolith's preview.
5. SPA last, if at all: exporting a design as components, or being the
   static shell an SPA starts in. It has no column in the table because
   none of the questions apply to it as asked.

**What users would see:** a New Project picker that shows each stack as a
small diagram (browser and CDN, browser and server, browser and functions,
SPA and API), marks the part Draw2Code makes, then sets up that stack's
folders and opens the canvas on the right one.

## Pages for phones: the plan

Decided before the work starts, so it stays at about three days. Each
decision names the cheapest shape that keeps the editor showing what a
browser shows; the cut list at the end says what goes first if it runs
over.

### Decisions

1. **Two widths, not many.** Desktop is the page width (1440px unless
   changed). Phone is one breakpoint: `@media (max-width: 767px)`, laid out
   for 390px. A tablet width is not in this round.
2. **A second layout, not a scaled one.** A scaled column makes 14px text
   4px tall. The phone layout is a second box per element.
3. **Stored as one more overrides map per page.** `overrides.json` already
   holds one `Overrides` map per page (`store[page]`); the phone layout is a
   second map under `store[page + "@phone"]`. `draw2code/<page>.css` gets the
   desktop rules as now, then the phone map inside one `@media` block.
   `buildSiteProd` merges both into the shared stylesheet the same way.
   Every function that walks a map today (`dropRulesFor`, `renameRules`,
   `renderOverrides`, `mergeOverride`, the held unsaved rules, remove,
   copy and paste) stays flat and is called once per map: no new data
   shape, no media key inside a map.
4. **What is per width and what is shared.** If it moves or sizes, it is
   per width: `left`, `top`, `width`, `height`/`min-height`, `font-size`,
   `text-align`, and hidden (`display: none`). Everything else is shared
   and written to the desktop map whichever view is showing: colours,
   border, corner rounding, bold, underline, links, the words, and Full
   width. The shell's one `style` op gains a `media` field; one table in the
   extension routes each property. Undo needs nothing new: a
   `PageSnapshot` already holds every map; the editor also puts back which
   view was showing.
5. **The canvas stays single-layout.** Phone layouts exist only in the page
   editor, after the first Save. `model.js` keeps one box per element and
   gains only the shared constants (`PHONE_WIDTH`, the breakpoint), which
   the extension imports from there, as it does `pageWidthOf`. The generator
   changes in two places only: the viewport meta (below) and a phone block
   in `baseCss` that undoes `body { min-width: max-content }` and makes
   `.page` 100% wide under the breakpoint. Desktop CSS is untouched, so the
   tests that pin it keep passing.
6. **The phone view in the editor** is a Desktop / Phone toggle on the
   toolbar. Phone gives `<html>` a width of 390px (the page is the webview
   document, so there is no frame); the overlay, the column's sides,
   snapping, confinement and the X/Y/Width/Height fields read the `.page`
   box as they do now, so they follow. Under the phone view the editor adds
   `.page > .full-width { left: 0; width: 100% }`, which is what a phone
   shows (there the column is the window) while `100vw` in the webview
   would still be the panel. One more thing the narrowing does not do: the
   webview is a desktop window as wide as the panel, so
   `@media (max-width: 767px)` never matches in it, whatever width `<html>`
   is given. While the phone view is on, the editor applies the phone rules
   itself: the phone map's rules and the generator's phone block, written
   into the page without their media query (the published site keeps the
   media query, so a browser applies them on its own). An imported site
   gets the narrowed `<html>` and nothing else: its own CSS does the rest.
7. **A first draft, inferred from geometry, so a phone layout is not 181
   elements placed by hand.** There are no sections: a band is a rectangle
   beside its texts, not their parent. When a page's phone view is first
   opened, the editor makes the phone map like this: a rectangle, ellipse
   or picture at least 60% of the page width is a band; an element whose
   box is at least 90% inside a band belongs to it; bands are stacked in
   order of their top, made full width and given the height their contents
   need; inside a band, elements are placed top-to-bottom, then
   left-to-right, scaled by 390 over the page width, with a 14px floor on
   font size; elements in no band are scaled the same way in place. Nothing
   inferred is stored: the result is only rules, edited from there like any
   other. "Reset phone layout" makes the draft again.
8. **Navigation, this round:** a "Hide on phone" toggle (per-width
   `display: none`), so a desktop nav row can be hidden or restacked. A menu
   button needs a script, as the video player does; that is the next round.
9. **A one-line fallback ships first.** A page with no phone map gets
   `<meta name="viewport" content="width=<page width>">`: phone browsers
   shrink the whole page to fit, with pinch-zoom, and desktop browsers
   ignore it. A page with a phone map gets `width=device-width,
   initial-scale=1`. Written where the meta is written now.
10. **Checked on an emulated phone, not a narrow window.** Desktop Chromium
    ignores the viewport meta, so the browser side of the comparison uses
    Playwright's iPhone emulation (390×844, device scale factor 3,
    `isMobile`), measured with the same script as the desktop check.

### Steps, in order, with a budget

0. **The fallback and the constants** (1–2 hours): the viewport meta, the
   phone block in `baseCss`, `PHONE_WIDTH` and the breakpoint in `model.js`,
   tests for each. Shippable on its own.
1. **The second map** (half a day): read, write and clear it
   (`readOverrides`, `writeCss`, `writeStore`, `clearOverrides`), merge it
   in `buildSiteProd`, carry it in the held unsaved rules, and call the flat
   functions on both maps where an element is removed, renamed, copied or
   pasted. A test per function with a phone map present.
2. **The phone view and routing** (one day): the toggle, the `<html>`
   width, the full-width rule under it, the `media` field on the `style` op
   and the property table, "Hide on phone", the view restored by undo, and
   the column confinement at 390px.
3. **The first draft** (half a day): the geometry rules above, "Reset phone
   layout", and a test on a page shaped like Pulsewise's hero.
4. **The check and the docs** (half a day): the iPhone emulation in the
   comparison, Pulsewise and the Draw2Code site run through it, README,
   this file and `LOOK.md`.

### Step 0, as built

- `model.js` has `PHONE_WIDTH` (390), `PHONE_BREAKPOINT` (767) and
  `PHONE_LAYOUT_CLASS` (`has-phone-layout`).
- **The phone block is gated by that class on `<html>`.** Unconditional, it
  would also apply in a desktop window narrower than 767px (a desktop
  browser ignores the viewport meta) and clip every page that has no phone
  layout, where today that window scrolls sideways. So the block is
  `html.has-phone-layout body` / `html.has-phone-layout .page`, and step 1
  adds the class when it writes a page's first phone rule (and switches the
  meta to `width=device-width, initial-scale=1`). It also keeps a VS Code
  panel narrower than 767px from turning the editor's own page into a phone,
  but only for a page with no phone layout (see step 1 below).
- **Publish writes the meta, not only the generator.** The meta holds the
  page width, which Page Width can change after the pages are made. Rewriting
  every page there would fight held unsaved pages and undo snapshots, so
  `buildSiteProd` sets it from the label's width on every page without the
  class (`setViewportWidth` in `pageWidth.ts`). That also brings older
  projects' `device-width` metas round on their next Publish. `-dev` keeps
  the meta it was made with, which only a phone reads.
- `pageWidthOf` is not imported by the extension: `pageWidth.ts` keeps its
  own copy and a test holds the two together, as `FULL_WIDTH_CLASS` does.
  `PHONE_LAYOUT_CLASS` follows the same pattern for now.
- For step 2: in the editor, the webview is a desktop window as wide as the
  panel, so `@media (max-width: 767px)` will not match when the phone view
  narrows `<html>` to 390px. The editor has to show the phone map's rules
  itself (outside the media block) while the phone view is on.

### Step 1, as built

- **The map:** `store[page + "@phone"]` (`phoneKey` in `pageEditor.ts`; the
  suffix is `PHONE_MAP_SUFFIX`, beside `TEMPLATE` in `siteFiles.ts`). A page
  has a phone layout while that entry exists, even empty, so removing the
  last element with phone rules does not quietly end it.
- **Written once:** `renderOverrides(desktop, phone)` puts the phone rules in
  one `@media (max-width: 767px)` block after the page's own rules;
  `buildSiteProd` does the same in the shared stylesheet, each rule scoped
  to its page and marker selectors pointed at the ids Publish gives.
  `PHONE_BREAKPOINT` is copied into `pageWidth.ts`, with a test.
- **A new edit, `phoneLayout`,** gives a page its phone map (`phone: {...}`)
  or takes it away (`phone: null`), with the class and the viewport, as one
  undo step. Nothing in the editor sends it yet: step 2's toggle and step 3's
  first draft will. Revert page takes the phone layout away too.
- **Flat functions, called once per map:** remove (`dropRulesFor`), revert
  element, naming a section (`renameRules`), taking a link away (the
  stylesheet stays while phone rules remain), undo snapshots, held edits
  (`pageIsHeld`, `dropHeldPage`), copy (`copiedRules` on the phone map) and
  paste (`EditOp.phoneRules`). A link's looks stay desktop-only: they are
  shared properties.
- **Paste:** the copy's phone rule moves by the same offset as on the page.
  On a page with no phone layout the phone rules are dropped: one element
  with phone rules must not switch a page into a phone layout nobody made.
- **For step 2:** a page WITH a phone layout shows it in any window up to
  767px, and the editor's webview is one. A VS Code panel that narrow
  shows the phone layout even in the desktop view, so the editor has to
  take the media block out of play both ways: apply the phone rules itself
  in the phone view, and keep them off in the desktop view.

### Step 2, as built

- **The toggle** (phone button, then Hide on phone beside it in the phone
  view) is on pages made in Draw2Code only. The first Phone on a page with
  no phone layout asks, then sends `phoneLayout` with a first draft from the
  boxes the overlay measured (`phoneDraft.ts`): for now the cut list's
  scaled copy, with a 14px floor (`PHONE_FONT_MIN` in `model.js`). Step 3
  replaces what `phoneDraft` does, not where it is called.
- **Routing is in the extension:** the overlay sends the same edits in both
  views; `DesignerPanel.onEdit` marks style and add edits made in the phone
  view (`inPhoneView`, `media: 'phone'`), and `applyEdit` splits them with
  one table, `PER_WIDTH` in `pageEditor.ts`: `left`, `top`, `width`,
  `height`, `min-height`, `font-size`, `text-align`, `justify-content`,
  `display`. An element added in the phone view gets its place in both maps.
- **How the editor shows each view** (`viewStylesheet`, `phoneViewCss`): on
  a page with a phone layout the page's `<link>` to its Draw2Code
  stylesheet is replaced by the rules the view needs, built from the store:
  desktop, its own rules only, and `<html>` without the class; phone, its
  own rules then the phone map's, outside any `@media`, plus `<html>` 390px
  wide and the phone block's rules. So neither view depends on the panel's
  width. A page with no phone layout is drawn exactly as before.
- **Drawings:** one svg, two boxes. On a page with a phone layout every
  drawing has `preserveAspectRatio="none"` (`stretchDrawings`, with the
  class), it is drawn again only for a desktop resize, and the phone block
  keeps its stroke width (`vector-effect`). Rounded corners stretch at phone
  size, as on a full-width drawing.
- **Hide on phone** is `display: none` in the phone map; the phone view
  shows such an element at opacity 0.3 instead, so it can be selected.
- **Undo** puts back the view each step was made in (`PageSnapshot.view`).
- **Imported sites have no phone view.** Narrowing `<html>` does not make a
  site's own `@media (max-width: ...)` rules apply: they read the window,
  and the webview is as wide as the panel. Showing them would take a
  narrow frame or rewriting the site's CSS; not this round.
- **Checked in the real editor** (VS Code 1.142 on Xvfb, xdotool input):
  phone view at 390px, column lines at 0 and 390; a move and a font size
  went to the phone map only, bold to the desktop map; Hide on phone wrote
  `display: none` and showed the element faintly; the desktop view kept
  every desktop box; Ctrl+Z went back to the phone view; a 642px panel in
  the desktop view still showed the desktop layout; a drag and a typed X
  past the right side stopped at 390; and after Publish the editor's phone
  boxes and an emulated iPhone 13's were the same for every element.
- Not changed: the Site Preview is a browser's view, so a preview narrower
  than 767px shows the phone layout, and an edit made there with editing on
  goes to the desktop rules.

### Step 3, as built

- **The first draft** (`phoneDraft.ts`), from the boxes the overlay measures
  at desktop width (`desktopElements`; in the phone view, with the desktop
  rules put in for one synchronous measure, the live inline styles of
  phone-view drags set aside):
  - A shape, picture or video at least 60% of the page wide is a band. An
    element is in the smallest shape whose box holds at least 90% of its
    own.
  - A band is as wide as the phone (one inside another, as wide as its
    column), what is in it stacked top to bottom with 16px margins and 12px
    between; elements whose heights overlapped at desktop width stay side
    by side while they fit; each is centred when it was centred in what
    holds it; the band is as tall as what is in it, with half its desktop
    room above and below (16 to 48px). Bands that touched still touch.
  - **Different from the plan:** a smaller shape that holds others (a
    dashboard mock, a card) is scaled down whole, what is in it with it;
    restacking its parts would take the picture apart.
  - **Different from the plan:** a font size is multiplied by 0.65, not by
    390/1440, never under 14px and never up. 390/1440 makes every heading
    14px; 0.65 makes a 56px heading 36px and a 32px one 21px.
  - Text and Heading get `min-height`, never `height` (your finding), with
    the lines their words take at the new width and size estimated from
    their desktop lines. Buttons, labels and inputs keep a height; a shape
    keeps its proportions.
  - Elements in no band are blocks of their own in the page's order.
- **Reset phone layout** (phone view) asks, then sends `phoneLayout` with a
  new draft: one undo step, Hide on phone included.
- **Paste and Duplicate in the phone view** (your finding): the copy's
  desktop rule is the original's own desktop place and size moved by the
  offset (`Pasted.desktop`, `EditOp.desktopDeclarations`), and a clip copied
  in the phone view and pasted at desktop width is placed the same way
  (`Clip.view`).
- Checked in the real editor: on a full-width band with a heading and two
  buttons, and a box below it, the draft was band 0,0,390 wide; heading
  21px with min-height; both buttons on one centred row; the box below as
  its own block. Ctrl+D in the phone view put the copy 16px off the
  original in both layouts. Reset after a move gave the first draft back
  exactly, and Ctrl+Z the move, in the phone view.

### Step 4, as built

- **The check** (decision 10): the published page on Playwright's iPhone 13
  (390×844, scale 3, mobile), measured as the desktop check measures, beside
  the editor's phone view and a desktop browser as wide as the editor's
  panel. It checks: the viewport is the phone's, nothing scrolls sideways
  and nothing is past either side; no words under 14px; no words cut off
  (wider or taller than their box) or on top of other words; every rule of
  the phone layout computed as written; the editor's box and the phone's
  the same for every element; every desktop box unchanged.
- **The Draw2Code site** (the showcase, a project made before step 0): its
  first draft, saved and published, not touched by hand. Home page: 59
  elements, 59 rules, the draft in under a second; page2: 5. Every check
  passes on both, and the Text and Heading boxes are exactly as tall as
  their words on the phone.
- **Pulsewise** (your run on step 3): every check passed; the hero showed
  three things, fixed here.
- **What the runs changed:**
  - **A project made before phones** has a stylesheet with no phone block,
    so `body { min-width: max-content }` kept the iPhone's page 1440 wide.
    A page's Draw2Code stylesheet now starts its `@media` block with the
    phone block's own rules (`PHONE_BASE` in `pageEdit.ts`, the
    generator's, held together by a test), and Publish writes them once
    into a shared stylesheet that has none.
  - **Decoration** (Pulsewise's hero circles): a drawing with no words,
    smaller than a band, in a band or in nothing, is hidden on phones and
    holds nothing in the draft when
    - it holds nothing and lies more than half over other elements (what
      holds it not counted);
    - it holds nothing and, in a band, is wider and taller than the tallest
      element with words in the band (Pulsewise's 240px circle: the
      headline is 150px tall; by area the headline is the bigger, so
      "bigger than every widget" would not have caught it); or
    - it is behind: everything it holds is also held by a shape it crosses
      that holds more (holding the same, the bigger one is behind). That
      shape is the content.
    What a shape holds is counted without drawings that hold nothing or
    are behind, and decoration holds nothing, all looked for again until
    nothing changes. So the 420px circle, behind the mock but inside the
    600px one, no longer makes the 600px one content, and both go (your
    third run: each kept the other). Pulsewise's hero, from its own boxes:
    the three circles hidden, the mock whole, 954px tall instead of 1,576.
    A drawing behind something in a card or a mock-up is part of its
    picture and stays; a picture or a video is never decoration. (The first
    cut of this rule, in e8d7014, hid Pulsewise's mock; 27c5c19 kept the
    two big circles.) Hidden, it is placed near where it would be, so the
    phone view's faint copy is there and Hide on phone turned off shows it
    within the phone.
  - **A picture scaled down whole** is measured by the box round it and
    everything in it: a card that started 36px left of its mock-up no
    longer lands past the column's left side.
  - **Heights measured, not estimated** (Pulsewise's headline over its
    paragraph): the draft is made, the extension asks the overlay
    (`measureWords`) how tall each Text and Heading's words are at the
    width and size the draft gave them, on a hidden copy, and makes the
    draft again with those heights (`wordsToMeasure`, `phoneDraft`'s
    `heights`). No width depends on a height, so nothing else moves. With
    no answer in 3 seconds the estimate stands.
  - **Reading order** (Pulsewise's nav and logos strip): a row is sorted by
    x and wrapped into lines, each line centred when the row was, and each
    element centred on its line when the row's were. Elements in no band
    are stacked together between bands, so their rows stay rows. A row
    whose elements are also above one another is columns, each stacked.
  - **Grids** (the site's How it works): rows of as many elements, each
    above the matching one of the next, are read one column at a time when
    a row does not fit on a line (steps: number, title, text), and stay
    rows when every row fits (a grid of logos).
  - **Long labels and buttons** (the site's footer credit was cut at
    358px): one too long for the phone at its new size gets
    `white-space: normal`, `height: auto` and a measured least height.
- A box's edges are rounded, not its size, so nothing ends a pixel past
  what holds it.
- Still as before: inside a picture scaled down whole (a mock), words keep
  14px and may be cut; a small empty drawing alone in blank space is a
  block.

### Done means

- Pulsewise's `-prod` on the emulated iPhone: no sideways scroll, no text
  under 14px, every element placed or hidden. **Met** in your step 3 run;
  the Draw2Code site meets it too (step 4).
- The editor's phone view and the emulated phone agree on every element's
  box, as the desktop check does today. **Met** on both sites.
- All existing tests pass unchanged; the new ones cover steps 0 to 3.
  **Met**: the tests from before the plan pass unchanged. Step 4 changed
  four of the phone tests where it changed on purpose what they pinned:
  three of step 1's (the phone block's own rules now come first in the
  `@media` block) and step 3's elements in no band (now a row, in lines).

### Cut list, if it runs over

1. Step 3, the first draft: the phone map starts as a scaled copy of the
   desktop boxes and is finished by hand with the fields.
2. "Hide on phone": restack instead.
3. The emulated-phone check stays; nothing else is cut before it.

### Known limits of this round

- Labels keep `white-space: nowrap`, except where the first draft gave
  one too long for the phone more lines: a label made longer later is
  clipped until it is widened. Text and Heading wrap.
- The first draft is a draft: it reads boxes, not meaning. Decoration is
  found only where it lies over other elements; a grid only where its rows
  line up.
- A full-width drawing's rounded corners stretch at phone width, as they do
  at desktop (see Known bugs).
- One breakpoint; no tablet layout; no menu button.

## Polish before a public release

- Run an app-shaped project (Flask) so the preview shows real data.
- Generate a separate `.html` and `.css`, not one self-contained file.
- The toolbar in a panel narrower than about 1,500px: it scrolls sideways
  (by wheel too), so the last controls are reachable but out of sight.
- An icon (see `website-editor/docs/LOOK.md`), README screenshots, and a
  packaged `.vsix`.
- Move `@types/parse5` from `dependencies` to `devDependencies`: it is only
  type information.
- Rename the GitHub repository to the project's name.

## Not tested yet

These work in the code but have not been checked by running the extension:

- the Preview and Site Preview panels
- Revert element and Revert page
- Reset Working Copy
- reopening a saved project from `.draw2code/project.d2c`
- "Keep mine / Load from disk" when a page changes on disk with unsaved edits
- a Flask-style site (`app.py` + `templates/` + `static/`)
- renaming and closing pages
- the colour and border controls on a real page
- the page editor's Delete, Link, Text and Heading with their line breaks
  and px, Image, B and alignment, and the warning that a removed page is
  still linked to. They were checked in Chromium, the overlay on its own and
  the panels with a stand-in for VS Code, not in VS Code itself. Nothing in
  `npm test` drives `pageShell.ts`, so the overlay's keys, retyping,
  Shift+Enter and the px box were checked by hand.

---

*This document was drafted and written with help from AI (Claude, by Anthropic).*
