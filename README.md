# pyfiddle

Python fiddle web pages: text and runnable Python cells, like notebook cells but as an ordinary web page, running real CPython ([Pyodide](https://pyodide.org)) in a Web Worker. Made for lessons: a teacher releases a page part by part, cells carry hidden checks and step-by-step hints, every cell explains the keywords and operators it uses, and the page exports to a Jupyter notebook for Google Colab.

```bash
npm install pyfiddle
```

```ts
import { mountPage } from 'pyfiddle';
import 'pyfiddle/styles.css';

mountPage(document.getElementById('lesson')!, {
  id: 'counting',
  title: 'Counting letters',
  cells: [
    { kind: 'markdown', text: 'Python can count the characters of a sentence.' },
    { kind: 'code', text: 'print(len("hello"))' },
    { kind: 'code', stage: 1, task: 'Make `n` the number of l’s in `"hello"`.', text: 'n = 0',
      check: 'assert n == 2, "Count the l\'s with .count()"', hint: '`"hello".count("l")`' },
  ],
});
```

Python loads on the first Run (never on page load) from the site's own `pyodide/v<version>/` folder. Put it there with the Vite plugin, or with one command for any other site:

```ts
// vite.config.ts
import pyfiddle from 'pyfiddle/vite';
export default { plugins: [pyfiddle()] };
```

```bash
npx pyfiddle pyodide public/   # copies Pyodide's core files (about 13 MB) and their licence notice
```

## What a page can do

- **Cells**: `markdown`, `code` (a fiddle with Run, Stop, Reset and Undo) and `choice` ("what will this print?"). One Python serves the whole page; each run gets a fresh namespace, and a traceback shows only the cell's own lines.
- **Hidden checks**: a code cell's `check` is Python run after the student's code in the same namespace (with `_printed` holding what it printed). Its first failed `assert` message is what the student reads. The check is never shown.
- **Deferred disclosure**: `hints` open one at a time, then the `solution`; the page remembers how far a student went.
- **Staged release**: every cell has a `stage` (0, the default, is visible from the start). With `teacher: true` the page shows every cell and a "Release next part" button; students see a stage once it is released. When the store is shared (below), the release reaches every student's open page.
- **Concept explainers**: a page or a host defines `concepts` (id, title, a short markdown summary, a link to the concept's own page, which is just another page with its own fiddles). Each cell lists the concepts its code uses, in a collapsed block: those it names in `concepts`, plus those found in its code (`for`, `len`, `%`, `.lower`, `f"`).
- **Notebook export**: "Download notebook" writes the page (up to the released stage) as an `.ipynb`; each check becomes a folded "Check your answer" cell that prints the same verdict. A page with a `colab` URL also gets "Open in Colab". `npx pyfiddle notebook page.json out.ipynb` does the same from the command line.
- **Stop always works**: on a cross-origin isolated page (COOP/COEP headers) it raises `KeyboardInterrupt` and keeps the interpreter; otherwise it ends the worker and the next Run starts a new one from cached files.
- **Theming**: everything is drawn with `--pf-*` CSS variables that default to the host's shadcn-style tokens (`--card`, `--foreground`, `--muted`, `--primary`, `--ring`, `--destructive`, `--font-mono`, `--radius`), then to system colours, so pages follow the host's light and dark themes with no configuration.

## The page format

A page is `{ id, title, cells, concepts?, colab? }`. The Zod schema in `src/page/schema.ts` is the source of truth; the same format as JSON Schema ships as `pyfiddle/page.schema.json`, for pages written as JSON, YAML or TOML.

| Cell | Fields (all cells also take `id`, `stage`, `concepts`) |
|---|---|
| `markdown` | `text` |
| `code` | `text` (the starting code), `task`, `label`, `check`, `hints` (or a single `hint`), `solution`, `readOnly` |
| `choice` | `question`, `code`, `choices`, `answer` (index), `explain` |

Lessons written in the PRIMM shape (Predict, Run, Investigate, Modify, Make; one object with a field per step) become pages with `fromPrimmLesson(lesson, { staged })`, so existing lesson files need no rewrite.

Markdown is rendered with `marked`, HTML included: page content is treated as the author's. For pages written by people you do not trust, pass a sanitising `renderMarkdown` (below).

## Seams: what a host replaces

| Seam | Default | Replace it with |
|---|---|---|
| `createPythonRuntime({ indexURL })` | `selfHosted()`: the page's own `pyodide/v<version>/` | `downloadOnFirstUse(...)` from `pyfiddle/capacitor` for a native app |
| `createPythonRuntime({ makeWorker })` | the bundled worker, started from a Blob (no bundler setup) | a URL worker, for a page whose CSP refuses `blob:` workers |
| `mountPage(el, page, { store })` | `localStore()`: localStorage, in memory when storage is blocked | any `{ get, set, subscribe? }` over the host's own state: a zustand slice, a small adapter over a zodal `DataProvider`, a server, a class-wide document. Keys come from `storeKeys`; `parseStoreKey` maps one back to its page, cell and field |
| `mountPage(el, page, { renderMarkdown })` | `marked`, HTML passed through | a sanitising renderer, for pages written by people the host does not trust |
| `mountPage(el, page, { conceptHref })` | the concept's `href` | the host router's link for a concept id |

A host passes its runtime to every page with `mountPage(el, page, { runtime })`; without one, all pages share `sharedRuntime()`.

### A native app (Capacitor)

The app package leaves Pyodide out and downloads it on the first Run, natively, with progress, from your own server; every later Run is offline. Each file is checked against its exact size, so a host answering an unknown path with the app's own page is caught.

```ts
import { createPythonRuntime } from 'pyfiddle';
import { capacitorFs, downloadOnFirstUse } from 'pyfiddle/capacitor';
import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { FileTransfer } from '@capacitor/file-transfer';

const runtime = createPythonRuntime({
  indexURL: downloadOnFirstUse({
    source: 'https://example.org/app/pyodide/v314.0.7/',   // the web build's folder, on your server
    fs: capacitorFs({ Capacitor, Directory, Filesystem, FileTransfer }),
  }),
});
```

Build the native bundle with `pyfiddle({ copy: false })` so the files stay out of it.

### React

```tsx
import { FiddlePage, usePythonState } from 'pyfiddle/react';

<FiddlePage page={page} options={{ runtime, store, conceptHref: (c) => `#/concepts/${c.id}` }} />
```

`FiddlePage` and `Fiddle` mount the same DOM renderer the plain pages use; `usePythonState()` gives the runtime's state (loading with progress, running, ready) for a host's own indicators.

### Headless

`pyfiddle/page` is the page model alone (schema, concepts, PRIMM adapter, notebook export, store keys), with no DOM, editor or worker, for build scripts and servers. `pyfiddle/runtime` is the runtime alone: `run(code, { owner, check, onOutput, preempt })` resolves to `{ error?, check?, interrupted? }`; `stop()`, `warm()`, `subscribe()`, `getState()`.

## Example

`example/` is a page with no build step (the one-file bundle `pyfiddle.iife.js` as `window.pyfiddle`), with a staged lesson, a concept page and the teacher view:

```bash
npm run example        # builds, copies Pyodide, serves http://localhost:4173
```

## Licences

pyfiddle is MIT. The Python it serves is Pyodide (MPL-2.0) with CPython (PSF License and the licences of the software CPython incorporates); the copy step (`pyfiddle/vite`, `npx pyfiddle pyodide`) always writes their notices as `LICENSES.txt` next to the files. A site or a native app's download source serving the files must serve that notice too, and should link to it. The one-file bundle `pyfiddle.iife.js` includes CodeMirror, Lezer, marked and zod (all MIT); their notices are in `pyfiddle.iife.js.LICENSE.txt`, next to it.

## Development

```bash
npm install
npm test             # unit tests, including the harness under real CPython (Pyodide in Node)
npm run typecheck
npm run e2e          # the example page in Chromium: desktop, and a phone with cross-origin isolation
```

The name was checked free on npm, PyPI and GitHub on 2026-11-13.
