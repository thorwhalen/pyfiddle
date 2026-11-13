/**
 * `pyfiddle/node`: build-time helpers. Which Pyodide this pyfiddle runs (its pinned dependency), and
 * copying its core files, with their licence notice, next to a site so the page serves Python
 * itself (`selfHosted()`, the runtime's default). The Vite plugin and the CLI use these.
 */
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The core files a run needs (no packages beyond the standard library). */
export const PYODIDE_FILE_NAMES = ['pyodide.mjs', 'pyodide.asm.mjs', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json'] as const;
export const NOTICE_NAME = 'LICENSES.txt';

export type PyodideMeta = { dir: string; version: string; files: { name: string; bytes: number }[] };

/** The installed (pinned) Pyodide: its folder, version and core files with sizes. */
export function pyodideMeta(): PyodideMeta {
  const dir = dirname(createRequire(import.meta.url).resolve('pyodide/package.json'));
  const { version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { version: string };
  return { dir, version, files: PYODIDE_FILE_NAMES.map((name) => ({ name, bytes: statSync(join(dir, name)).size })) };
}

/** The folder, relative to a site's root, that the files go in (what `selfHosted()` loads). */
export const pyodideDir = (version = pyodideMeta().version) => `pyodide/v${version}/`;

/** The CPython version inside the pinned Pyodide (from its lock file). */
export const pyodidePython = (meta = pyodideMeta()): string =>
  (JSON.parse(readFileSync(join(meta.dir, 'pyodide-lock.json'), 'utf8')) as { info: { python: string } }).info.python;

const notice = (name: string) => readFileSync(fileURLToPath(new URL(`../notices/${name}`, import.meta.url)), 'utf8');
const rule = (title: string) => `${'='.repeat(80)}\n${title}\n${'='.repeat(80)}\n\n`;

/**
 * The licence notice for Pyodide, CPython (with the software it incorporates) and CodeMirror, for
 * this version. The CPython texts are vendored per Python version (`notices/cpython-<python>-*`), so
 * upgrading Pyodide to another Python fails here until they are added.
 */
export function licenceNotice(meta = pyodideMeta()): string {
  const python = pyodidePython(meta);
  return [
    notice('python-licenses.txt').replaceAll('{version}', meta.version).replaceAll('{python}', python),
    notice('mpl-2.0.txt'),
    rule(`CPython ${python}: LICENSE`) + notice(`cpython-${python}-LICENSE.txt`),
    rule(`CPython ${python}: licenses and acknowledgements for incorporated software (Doc/license.rst)`) + notice(`cpython-${python}-incorporated.rst`),
    notice('codemirror-lezer-mit.txt'),
  ].join('\n\n');
}

/**
 * Copy the core files and the licence notice (`LICENSES.txt`) to `<siteDir>/pyodide/v<version>/`;
 * returns that folder. The notice always goes with the files: a site (or a native app's download
 * source) serving them must serve it too.
 */
export function copyPyodide(siteDir: string): string {
  const meta = pyodideMeta();
  const out = join(siteDir, pyodideDir(meta.version));
  mkdirSync(out, { recursive: true });
  for (const f of meta.files) copyFileSync(join(meta.dir, f.name), join(out, f.name));
  writeFileSync(join(out, NOTICE_NAME), licenceNotice(meta));
  return out;
}

/** The build-time constants the browser code reads (`__PYODIDE_VERSION__`, `__PYODIDE_FILES__`). */
export const pyodideDefines = () => {
  const { version, files } = pyodideMeta();
  return { __PYODIDE_VERSION__: JSON.stringify(version), __PYODIDE_FILES__: JSON.stringify(files) };
};
