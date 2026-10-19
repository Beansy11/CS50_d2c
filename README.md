# Draw2Code Web Editor
#### Video Demo:  <URL HERE>
#### Description:

Draw2Code Web Editor is a Visual Studio Code extension that lets you draw a web page
on a canvas and get real HTML and CSS out of it, or point it at a website you
already have and edit the real page in place. It is a website builder that gives
you the code back.

**Why I built it.** Years ago in high school I built websites for my parents'
businesses using Hostinger's website builder. The building part was fine. The
problem was everything after: I only ever used those programs to design, not to
host, so when I wanted the actual code files to put on my own server I had a
hard time getting them out in a usable state. And the moment I edited the code
by hand, the builder usually stopped doing what I wanted it to do. I still got
there in the end, but after hours of work and starting over several times. After
I turned in my CS50 Week 8 assignment I started building the thing I wished I
had back then, and I used my Week 8 files as the first site I tested it against.

**Who it is for.** People who build websites regularly but find it annoying to
type several lines of code and still see nothing change in the browser without
constantly saving and refreshing. Business owners who want to understand how
their own website actually works instead of being locked out of it. And people
learning to code, who can open a real site in the editor and see how the pieces
are wired together.

**The two copies.** This is the design decision that shapes the whole project.
A site you edit in Draw2Code always has two copies. For a new design saved as
`MyProject`, they are `MyProject-dev` and `MyProject-prod`. You edit `-dev`
freely, with no worry about breaking something, while a server can be serving
`-prod` the whole time. When you are happy, you press Publish and `-prod` is
rebuilt from `-dev` as clean code: no Draw2Code markers, no Draw2Code stylesheets,
and the rules Draw2Code wrote for each page moved into the site's own
`css/style.css`. The only sign that Draw2Code was involved is a
`.draw2code/project.d2c` file, which is how the extension recognises a folder as
one of its projects. An imported site works the same way, except your own folder
plays the part of `-prod`: Draw2Code copies it to `<site>-dev`, you edit the copy,
and Publish is the only thing that ever writes back into your folder, after
listing every file it is about to change and asking you to confirm. This split
also fixed a real bug: while testing on my own I kept re-importing the same
folders and my own code kept duplicating projects, and I filled up my storage
without noticing. So the rules are strict: picking a `-dev` folder means the
site it belongs to, so a copy never gets a copy of its own (`homepage-dev-dev`).

**Why the webview holds the source of truth.** In most VS Code extensions the
model lives in the extension and the webview is a dumb screen. Here it is the
other way round, on purpose. The canvas is a live editor: you drag things,
retype a button's text, add elements, basically everything you would otherwise
do in code. For that to work the webview has to be the thing that is
manipulated, kept in sync with `-dev`. If it worked like other programs you
might as well serve `-dev` to a browser and type the code by hand anyway. For
the same reason, undo history is kept per site and shared by every panel
editing it, rather than per window. And Save and Publish mean different things:
Save writes your edits into `-dev`, and Publish is the only thing that writes
the final copy.

**The hardest part.** Showing a real page inside the editor, live and editable.
I first tried to translate the HTML and CSS by hand into something the viewer
could draw, and spent about half a day reinventing the wheel before I realised
that browsers already solve exactly this problem. So I researched how a browser
actually does it (parsing HTML into the DOM, parsing CSS into the CSSOM,
combining them into a render tree so only what needs to be shown is laid out)
and copied that approach instead of inventing one: the real page is shown by the
webview's own browser engine, and Draw2Code only adds an editing layer on top.
That worked immediately. Changing the page's files uses `parse5`, an HTML
parser, which is the project's only runtime dependency. It lets an edit change
just the element it is about and leave the rest of your file exactly as you
wrote it.

**No built-in taste.** While making sample sites with AI chats I noticed
something: different agents, asked for different things, kept producing sites
that looked the same. Even when I specified the look, the style and feel came
out the same, across different tools, not just one with a house style. So
Draw2Code's generator outputs only what was drawn, and nothing else. If the
program added its own taste, the user would stop feeling that what they built
is theirs, and would start feeling they need to learn to code to make it look
the way they pictured it, which is exactly how I felt as a kid making my
parents' site in somebody else's builder.

**Why a VS Code extension.** Writing a standalone app would have meant writing
my own IDE, which is an enormous amount of work for almost no benefit when VS
Code already gives me the file picker, tabs and the editor itself. I did write
my own undo stack first, before I knew I could hand that job to VS Code. Once I
learned how, `.d2c` became a proper custom editor, so VS Code's own undo, hot
exit and "Save changes?" prompt work on a Draw2Code project like on any other
file.

#### How to run it

Run `npm install`, open the folder in VS Code and press **F5**. A second VS Code
window opens with the extension loaded. In it, run **Draw2Code Web Editor: New
Design** from the Command Palette (`Ctrl+Shift+P`), or open a folder that holds
a website and answer **Redraw** when Draw2Code offers to draw it. `npm test` runs
the tests.

#### Files

- **`package.json`**: the extension's manifest: its commands, the `.d2c` custom
  editor, and the test script.
- **`src/extension.ts`**: the entry point. Registers every command and the `.d2c`
  custom editor, and starts the watcher that notices a website in the open folder.
- **`src/projectEditor.ts`**: the `.d2c` custom editor. Opens a project or a new
  untitled design, and connects it to VS Code's undo, hot exit and Save.
- **`src/projectFormat.ts`**: the project label, `.draw2code/project.d2c`: reading
  and writing it, which project names are allowed, and copying folders.
- **`src/publish.ts`**: Publish for a saved project: deletes `-prod` and builds
  it again from `-dev`.
- **`website-editor/src/designerPanel.ts`**: the editor tab, the biggest file.
  Owns the webview, the messages between it and the extension, and the watcher
  that shows hand edits made in `-dev` in the editor.
- **`website-editor/src/design.ts`**: the design as the extension sees it, a
  plain-data copy sent by the webview, plus the loaders for the model and the
  generator.
- **`website-editor/src/pageShell.ts`**: wraps a real page so it can be shown
  and edited inside the webview: rewrites its links to files, and adds the
  browser bar and the editing layer.
- **`website-editor/src/pageEdit.ts`**, **`pageEditor.ts`**: editing a real
  page without rewriting it: new text, moves and sizes (written to a stylesheet
  per page, `draw2code/<page>.css`), and new elements.
- **`website-editor/src/copyPaste.ts`**: copy, paste and duplicate: which
  rules go with a copied element, its new ids, and where the copies land.
- **`website-editor/src/align.ts`**: left, centre and right: what each
  alignment button writes for each kind of text box, and which one an element
  shows now.
- **`website-editor/src/colours.ts`**: the hex field beside each colour box and
  the colours used last, one click away, since the browser's own picker opens
  in RGB.
- **`website-editor/src/fieldKeys.ts`**: the keys a toolbar field, the address
  bar or text being retyped keeps to itself, so Ctrl+Z or Ctrl+A acts on the
  field instead of being passed on to VS Code.
- **`website-editor/src/csp.ts`**: the Content-Security-Policy of a page shown
  in the editor or the preview: what it may load, as a browser would load it
  from the site.
- **`website-editor/src/images.ts`**, **`videos.ts`**: pictures and videos:
  which files count as one, where a picked file is copied in the development
  copy, which links to YouTube or Vimeo can be embedded, and checking an
  address before it goes into a page.
- **`website-editor/src/pageWidth.ts`**: the page width of a project: checking
  a width typed, and writing it into the stylesheet every page shares.
- **`website-editor/src/phoneDraft.ts`**: a page's phone layout's first draft,
  made from its desktop layout: wide shapes become bands as wide as the phone,
  what is on them is stacked in reading order, decoration is hidden, and text
  is never under 14px. The phone layout itself is a second set of rules per
  page, kept beside the desktop ones in `pageEditor.ts`.
- **`website-editor/src/placement.ts`**, **`room.ts`**, **`edgeScroll.ts`**,
  **`redraw.ts`**, **`arrival.ts`**: the page editor's X, Y, Width and Height
  fields, resizing and snapping guides, keeping elements in the page's
  column, the room below the page, scrolling
  while a drag is held at the edge, drawing a resized shape again at its new
  size, and a page drawn again after an edit shown where it was at once.
- **`website-editor/src/links.ts`**, **`underline.ts`**: what Link offers
  (pages, sections of pages, web addresses) and how a link keeps the look of
  what it was made from, and the underline toggle.
- **`website-editor/src/heldFiles.ts`**: edits held in memory, with a ● on the
  tab, until you save.
- **`website-editor/src/history.ts`**: undo and redo, one history per site,
  100 steps deep.
- **`website-editor/src/site.ts`**, **`siteFiles.ts`**: which folder is the site
  (decided the way a web server decides its document root), its `-dev` copy, and
  the Open, Publish and Reset flows.
- **`website-editor/src/siteProject.ts`**: saving a new design as a project, and
  building Publish's clean copy.
- **`website-editor/src/importWatcher.ts`**, **`previewPanel.ts`**,
  **`sitePreviewPanel.ts`**: noticing new sites, and the previews.
- **`website-editor/media/`**: everything that runs inside the webview, as plain
  JavaScript: `main.js` (the canvas), `model.js` (the data model), `render.js`,
  `props.js` (the properties popup), `textEditor.js`, `chrome.js` (the browser
  bar), `main.css` (the canvas and its popups) and `chrome.css` (the browser
  bar), and `generators/html.js` (a design into HTML and CSS). The
  generator and the model have no VS Code import in them at all, so the same
  file runs in the tests and in the extension, and could move into a standalone
  app later without being rewritten.
- **`website-editor/media/site/video-player.js`**, **`video-player.css`**: the
  video player Draw2Code copies into a site that has a video file, so the
  controls look and work the same in every browser; without the script, the
  video falls back to the browser's own controls.
- **`website-editor/test/`**: 704 tests in 24 files, run with Node's own test
  runner. They test the model, the generator, page editing, saving and
  publishing, and undo directly, with no VS Code needed.
- **`website-editor/docs/`**: my notes on extending it (`RECIPES.md`) and on
  what counts as a site and the folders a project uses (`SITE-TEMPLATE.md`),
  and where the editor's look lives and how to change it (`LOOK.md`).
- **`ROADMAP.md`**: what I plan next and how: pages for phones (built), and
  other kinds of site with a profile per stack.
- **`video/`**: the cover of the demo video, as a picture and its HTML source.
- **`LICENSE`**: the MIT licence.

#### What works, and what does not yet

`ROADMAP.md` lists everything that is not finished: known bugs, what is not
built yet, and what has not been tested.

Creating a design, drawing shapes and widgets, adding pages, saving it as a
project, importing an existing site and editing its pages in place (retyping
text, moving, resizing, drawing new elements), following links between pages,
undo and redo, and publishing all work.

After the first Save, the page editor also has:

- **Resizing** with the eight handles around the selected element: the edge
  or corner you drag moves and the one across from it stays where it is, so
  the left handle dragged left makes the element wider to the left, as in a
  drawing program. A drawn shape (rectangle, ellipse, line, pen stroke) is
  drawn again at each size, so its border and corner rounding keep their px
  instead of being stretched.
- **Delete** (or Backspace) removes the selected element.
- **Link** makes the selected button or text a link to a page of the site, a
  section of a page, or a web address (only `https://`, `http://` and
  `mailto:`), and can change or remove it later. **A section of this page**
  lists its headings, its parts and everything placed on it; one without a
  name (an id) is given one from its words, which you can change, so the
  link is `#our-prices`. **A section of another page** lists that page's
  named elements (`about.html#team`). A second click on a selected link
  follows it, scrolling to the section; a page made in Draw2Code scrolls
  there smoothly.
- **U** underlines the selected text, or takes the underline away: a link's
  too.
- **Text** and **Heading** add text that wraps inside its box; Shift+Enter
  starts a new line while retyping.
- **Input** adds a text box; double-click it to change the words it shows
  while empty (its placeholder). Enter keeps them, Esc puts back the old
  ones.
- **Image** adds a picture: you pick the file (PNG, JPEG, GIF, WebP or SVG),
  it is copied into the site's `assets/` folder, and you describe it for its
  `alt` text.
- **Video** adds a video. The small arrow beside it picks the kind, **Your
  own video** or **Hosted video**, and a click on Video adds the kind picked
  last. Your own video is an `.mp4` and/or a `.webm`, picked together in one
  Open dialog (or one after the other, when the dialog takes only one file),
  copied into `assets/` and played in the site's own player (its
  two files go in `css/` and `js/`), with a picture to show before it plays
  if you pick one. Give both, the same video: the page lists the `.webm`
  first, so browsers that play it (Fedora's too) use it, and the editor (VS
  Code cannot play `.webm`), Safari and other systems that play H.264 use the
  `.mp4`. With only one file, the editor says where it will not play. A
  hosted video is a YouTube or Vimeo link, played in their player.
- **B** and **left, centre and right** make text bold and align it.
- **Corner rounding** (in px) rounds the corners of the selected rectangle,
  button, picture or text box; 0 is square.
- **Hex codes and recent colours**: the small arrow beside each colour box
  (fill, border, text) opens a field to type a hex code in (`#0b1020` or
  `0b1020`; Enter uses it, Esc puts the colour back) and the last ten colours
  used, one click each. They are kept for the next time VS Code opens.
- **Page width**: every page of a project made in Draw2Code is a column
  1440px wide, centred in the window, so a wider window shows the page's
  background either side and a narrower one scrolls sideways. Elements are
  placed from the column's top-left. **Draw2Code: Page Width...** (or the
  last toolbar button) changes it for every page at once, from 320 to
  3840px; it first explains what changes and only applies when you confirm.
  Elements keep their x, y and size, so with a narrower page anything past
  its right edge is cut off. It is kept in `.draw2code/project.d2c`. On a
  phone, a page is shrunk to fit the screen, with pinch-zoom: each page asks
  for a viewport as wide as the column, and Publish writes the width the
  project has now into every page it publishes, until the page has a phone
  layout of its own (below).
- **Phone view** (the phone button, on a page made in Draw2Code) shows the
  page as a phone does: a column 390px wide. The first time, it asks, then
  gives the page a layout of its own for phones (any window up to 767px
  wide), started from a first draft of its desktop layout: a shape or
  picture at least 60% of the page wide is a band, made as wide as the
  phone, with what is on it stacked top to bottom; elements side by side
  stay in reading order, in as many lines as the phone needs, centred where
  they were centred; steps or columns laid out as a grid are read one
  column at a time; a smaller shape holding others, such as a mock-up of a
  screen, is scaled down whole; a drawing that only decorates (a circle
  behind the words, holding nothing) is hidden on phones. Text is never
  under 14px; Text and Heading keep a least height, as their Height field
  does, measured for their words at the phone's width, and a label or
  button too long for the phone has its words on more lines.
  **Reset phone layout** (beside Hide on phone) makes the draft again from
  the desktop layout, after asking. In the phone view, a
  move, a resize, X, Y, Width, Height, a font size and an alignment change
  the page on phones only; colours, words, bold, underline, links, corner
  rounding and Full width change it everywhere. **Hide on phone** (beside
  it) leaves the selected element out on phones; the phone view still shows
  it faintly, so it can be selected and shown again. The column, snapping
  and the fields work at the phone's width; a drawing is stretched to its
  phone box rather than drawn again. Ctrl+Z shows each step in the view it
  was made in. Click the button again for the desktop view, which never
  shows the phone layout, however narrow the panel. Revert page takes the
  phone layout away; Publish writes it into the shared stylesheet (with
  the phone block a project made before phones has no copy of). Imported
  sites have no phone view: a site's own `@media` rules would need a window
  as narrow as a phone, which the editor's page is not.
- **Full width** stretches the selected element across the whole window,
  keeping its place from the top and its height: for a section's background.
  The rest of the page stays in its column, and the page never scrolls
  sideways because of it. A second click puts it back where it was. Only for
  elements placed freely on a page made in Draw2Code.
- **The page's column**: on a page made in Draw2Code the editor shows where
  the column is: a thin dashed line along each side, the whole height of the
  view. They are drawn over the page, so they show over a full-width section
  too, and nothing else is drawn: beside the column the page looks exactly as
  it will in a browser. The lines are not part of the page, and clicks go
  through them. Every
  element but a full-width one is kept inside the column: a drawing, a move
  or a resize stops at its sides (snapping and scrolling at the edge still
  work, and Ctrl only turns snapping off), an X or Width typed past a side
  stops there, and a paste, a duplicate or a widget clicked near a side is
  moved in, several together. An element wider than the column (the page
  made narrower since) is made as wide as it once it is moved, resized or
  pasted.
- **X, Y, Width and Height** (the four fields after the tools) show the
  selected element's place and size in px, from the top-left of the page (of
  its centred column, on a page made in Draw2Code), and follow it while it is
  moved or resized. Type a number and press Enter, or click elsewhere, to
  place or size it exactly: one undo step; Esc puts it back. A drawn shape is
  drawn again at its new size. For Text and Heading, Height is the least
  height: the box still grows with its words, and the field shows how tall it
  really is. A full-width element's X and Width are the window's, so those
  two are off.
- **Snapping guides**: while moving, resizing or drawing, the box's edges and
  centre snap onto those of the elements beside it and of the page's column
  when they come within 6px, and a thin pink line shows each one it lines up
  with. A resize snaps only the edges being dragged, and the line is where
  that edge is; a drawing snaps only the corner the pointer has, the corner
  pressed staying where it was pressed; a freehand stroke does not snap.
  Snapping never undoes what is drawn: a move never changes a size, a box
  under 12px along a side does not snap along it (dots, thin bars and grid
  lines stay as drawn), a snap changes a size by a quarter of it at most,
  and a gap left between an element and the one beside it stays, however
  small. Nothing dragged out is made 0px wide or tall (a straight line
  excepted). Hold Ctrl (Cmd on a Mac) while dragging to drag freely: pressed
  or let go mid-drag, it takes effect at once.
- **Selecting several**: Shift+click adds an element to the selection, or
  takes a selected one out of it; each is outlined. Delete removes them all,
  dragging any of them moves them all, and Revert element reverts them all,
  each as one undo step. The style, text and box controls, Link and Full
  width change one element, so with several selected they are off.
- **Copy, paste and duplicate**: Ctrl+C copies the selected elements, and
  Ctrl+V pastes them onto the page shown, also another page of the site
  (the copy is kept by the extension, so switching pages keeps it). Ctrl+D
  duplicates them in place, 16px down and right. The copies are placed
  freely, keep their look (their rules are copied under new ids, rect-7 and
  so on, numbered per page), their links and their pictures and videos (the
  same files), and their places to each other, and are selected afterwards.
  A paste lands where they were copied from, 16px further for each paste of
  the same copy onto that page; on the page they came from, the first paste
  is already 16px off. A full-width background pasted onto a page not made
  in Draw2Code is no longer full width: it is as wide as the window it was
  copied in, and as far left. One undo step each. Not while typing in a
  field or retyping text. These three keys are the editor tab's only: in
  the Site Preview, Ctrl+C copies text as in a browser.
- **Room below the page**: the page scrolls about two screens past its lowest
  element, so the next section can be drawn below what is already there. Only
  the editor adds it; the published page ends where its content does. A page
  that fits the panel shows no scrollbar for it, so it keeps its full width as
  in a browser; scroll into the room with the mouse wheel. A page made in
  Draw2Code is measured by how far its elements reach, so one that goes even
  a little past the bottom of the panel keeps its scrollbar, as a browser
  shows one.
- **Scrolling at the edges**: while drawing, moving or resizing, hold the
  pointer near the top of the page (just under the bar, or over it) or near
  the bottom of the panel and the page scrolls, faster the nearer the edge,
  with the drag going on as it scrolls. A box taller than the panel, such as
  a full-height section's background, is drawn in one drag.
- **The view stays where it was**: adding, deleting or reverting an element,
  making a link, Ctrl+Z and Ctrl+Y draw the page again, and it is shown at once
  where it was, as far down and as far across (a page made in Draw2Code
  scrolls sideways in a panel narrower than its column), never slid back to
  it, so a double-click on what was just drawn retypes it straight away. A
  page switched to, with a tab, a link or Back, starts at its top, or at the
  section a link goes to, as a page newly opened in a browser does. The Site
  Preview does the same.
- A **warning** when a page is removed while other pages still link to it.

The page editor's toolbar shows each tool and control as a small symbol;
hover over one to see its name and what it does. It is one row, about 1,500px
wide, and in a narrower panel the mouse wheel scrolls it sideways.

Known problems:

- None of these tools exist on the canvas (New Design). They appear once the
  design has been saved and is open in the page editor.
- Saving a new design under a name without `.d2c` saves the project
  correctly but leaves the tab showing an error.
- Publishing an imported site keeps Draw2Code's `data-d2c` markers and
  `draw2code/` stylesheets in your folder, where a new project's `-prod` is
  clean.

#### Use of AI

I wrote the website editor myself. I used AI (Claude, by Anthropic) for eleven
things. First, to take out a separate desktop-app builder I had
started in the same repository, which is not part of this project; each file it
removed code from says so in a comment. Second, to test the extension by
running it in VS Code and clicking through it like a user, which is how the
known problems above were found; those test scripts are not part of this
repository. Third, to help draft and write the documentation: this README, from my
answers to its questions about the project, the other Markdown files
(`ROADMAP.md`, `website-editor/README.md` and the three files in
`website-editor/docs/`), each of which says so at the end, and the cover in
`video/`, which its README says Claude designed. Fourth, to choose the project's name and
apply it: the project was called HardHat Designer while I built it. Claude
helped me pick Draw2Code Web Editor by checking which names were already
taken, then renamed it everywhere at my direction, from the names users see to
the project's folder (`.draw2code/`), its file type (`.d2c`) and its markers
(`data-d2c`); each code file it renamed says so in a comment. Fifth, to fix one bug,
because I was in a hurry: an imported page that sets no background of its own
showed black text on VS Code's dark background, where a browser shows white.
Claude wrote the fix at my direction (the page's backdrop, in
`website-editor/src/pageShell.ts`), and that file says so in a comment. Sixth,
to make the page editor's toolbar fit a narrow panel: its word labels made it
about 1,200px wide. Claude suggested several fixes; I chose symbols with a
description on hover, to keep it minimal, and required that the editor still
show the page exactly as a browser does. Claude wrote it to that requirement,
keeping the toolbar one row of the same height, and `pageShell.ts` says so in a
comment. Seventh, to fix a small bug quickly while I prepared to record my
video: after using a colour box, the border width, the font size or the
address bar, Delete did nothing until you clicked somewhere else on the page.
Claude wrote the fix at my direction, and `pageShell.ts` says so in a comment.
Eighth, to fix two bugs Claude found in a dry run, where it built a small
website with the editor: a picture on a page made with "+" did not show in the
editor though it showed in a browser, and a space could not be typed in a
Button. Claude wrote both fixes at my direction, and `pageShell.ts` says so in
a comment. Ninth, to add corner rounding to the page editor, so the website in
my demo video can look like a professional product page; Claude wrote it at my
direction, and `pageShell.ts` says so in a comment.
Tenth, while I built the video tool. Claude first told me that VS Code's
editor cannot play an H.264 `.mp4` but can play a `.webm`. That was wrong.
When I had an agent test my custom `.mp4` player, my own laptop kept showing
"media is corrupted", because it cannot play H.264. Testing then showed that
VS Code 1.142 plays an H.264 `.mp4` but not a `.webm`. That is why a video in
Draw2Code takes both files: the `.webm` for browsers, and the `.mp4` for the
editor, Safari and other systems that play H.264. The agent only tested the
video tool; I wrote it.
Eleventh, the unit tests: I did not write them. To save time, I had an AI
coding agent read my code and write tests for it, and it put the 24 files in
`website-editor/test/` (704 tests, run with `npm test`). The code they test
is mine; the tests are the agent's. Each test file says so in a comment at
the top.
