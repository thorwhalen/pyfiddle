# ADR 0001: the shape of pyfiddle v1

Date: 2026-11-13. Status: accepted.

## Context

A learning app built in-browser Python fiddles (Pyodide in a Web Worker, lazy boot, Stop by interrupt buffer or by replacing the worker, CodeMirror 6, a native first-use download) and filed the component need as i2mint/zodal#125, with that implementation as the starter. A search of the fleet's package registries found no in-browser Python component; Papyros and PyScript were evaluated there and not adopted. The owner wants it as an independent public package, not inside zodal. Its first consumer needs text+fiddle pages, staged release by a teacher, concept explainers linking to concept pages, hidden checks, a store seam for student edits, self-hosted Pyodide, a native download seam, theming through host CSS tokens, and `.ipynb` export.

Lessons are often written in the PRIMM shape (one object with `predict`, `run`, `investigate`, `modify`, `make`), and staged pages need little more than `{ kind: 'markdown' | 'code', text, check?, stage, concepts[] }`. The page format takes that minimal shape natively and adds an adapter for PRIMM lessons, so moving an existing course onto it is a swap.

## Decision

Three layers, one implementation each:

1. **Runtime** (`pyfiddle/runtime`): headless, framework-free. The worker is bundled to a string at build time and started from a Blob, so no host bundler configuration is needed.
2. **Page model**: a Zod schema (the single source of truth; JSON Schema emitted from it), concept detection by tokenising the code, the PRIMM adapter, notebook export, and the store seam.
3. **Renderer**: plain DOM, so it works in a page with no framework and in every framework. React (`pyfiddle/react`) only mounts it.

Build-time helpers (`pyfiddle/vite`, `pyfiddle/node`, the `pyfiddle` CLI) copy the pinned Pyodide next to a site with its licence notice.

### Seams

| # | Seam | v1 default (no new dependency) | Replacement we can point at |
|---|---|---|---|
| 1 | `indexURL` (where Pyodide's files are) | `selfHosted()`: the site's own folder | `downloadOnFirstUse` + `capacitorFs` (a native app host) |
| 2 | `makeWorker` | the bundled worker from a Blob | the tests' fake worker; a URL worker for strict-CSP hosts |
| 3 | `store` (student work, released stage) | `localStore()` with a memory fallback | a host's own progress store; a shared class store for releases |
| 4 | `conceptHref` | the concept's `href` | a host router |
| 5 | `renderMarkdown` | `marked`, HTML passed through | a sanitising renderer, for pages from authors the host does not trust (a shared class store brings those) |

The runtime instance itself is injected (`runtime` option), which is how seam 1 reaches the pages.

**NOT seams**, written directly on purpose: the UI wording (English; seam candidate: a `messages` option, once a host in another language exists, which the PRIMM adapter's `headings` already anticipates), the output cap and the 400 ms status delay, the editor's extensions, the check-cell wording in notebooks. Each is a candidate if a second host needs it changed.

### Surfaces

Built: the library (ESM + types), the one-file browser bundle, the Vite plugin, the CLI (`pyodide`, `notebook`, `version`). MCP and HTTP: not applicable to a browser component; the CLI's `notebook` command is the agent-reachable piece.

## Consequences

- One Pyodide version per pyfiddle release (pinned dependency); the runtime, the copy step and the native download agree on it by construction, and a test holds them equal.
- Untrusted page content needs a sanitising `renderMarkdown` from the host; the default passes HTML through.
- `pyfiddle/page` imports nothing from the DOM renderer, the editor, `marked` or the runtime (a test holds this), so build scripts and servers use the page model alone.
- Next changes already known, each an add at an existing seam: sha256 verification of native downloads (a field on the file list), `input()` support (a worker capability), more cell kinds (a schema union member plus a renderer branch).
