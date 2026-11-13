# pyfiddle — dev notes for agents

Seams (defaults): `indexURL` (selfHosted), `makeWorker` (Blob of the bundled worker), `store` (localStore), `conceptHref` (concept.href). Surfaces built: library, IIFE bundle, Vite plugin, CLI. Rationale and NOT-seams: `docs/adr/0001-shape.md`.

- The page format's source of truth is `src/page/schema.ts` (Zod); `dist/page.schema.json` is generated from it.
- The worker is bundled into `src/runtime/worker-source.generated.ts` by `npm run gen` (every build/test/typecheck runs it; the file is gitignored).
- The Python harness (`src/runtime/harness.ts`) is tested under real CPython in `tests/harness.test.ts`; change it only with a test there.
- Pyodide is pinned exactly; `PYODIDE_VERSION`/`PYODIDE_FILES` are baked at build time from it (`src/node.ts` `pyodideDefines`).
- Never put course or challenge texts in this public repo: examples are original, generic content.
- Release: a commit subject with `[publish]` on main publishes to npm via trusted publishing (`.github/workflows/ci.yml`); never an NPM_TOKEN.
