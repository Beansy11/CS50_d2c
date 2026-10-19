# Website editor

Import a website's files and see the site as it really looks. In the editor you
can move, edit and remove what is on its pages, and the site's own HTML and CSS
change to match. A new design can also be drawn on a blank canvas and saved as
a website project.

| Path | What it is |
|---|---|
| `src/` | The VS Code side: the editor panel, opening and editing a site's pages, saving a design as a project and publishing it (`siteProject.ts`) |
| `media/` | The editor page: canvas, drawing, properties, browser bar, and `generators/html.js` (a design -> HTML/CSS) |
| `test/` | Tests (`npm test` runs them) |
| `docs/` | [RECIPES.md](docs/RECIPES.md) - how to extend it; [SITE-TEMPLATE.md](docs/SITE-TEMPLATE.md) - what counts as a site, and the folders a project uses; [LOOK.md](docs/LOOK.md) - where the editor's look lives and how to change it |

---

*This document was drafted and written with help from AI (Claude, by Anthropic).*
