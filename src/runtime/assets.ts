/**
 * Which Pyodide this package runs, and where its files are. The version and the file list (with
 * sizes) are the pinned `pyodide` dependency's, baked in at build time, so the runtime, the copy
 * step (`pyfiddle/vite`, `npx pyfiddle pyodide <dir>`) and the first-use download
 * (`pyfiddle/capacitor`) all agree on one version.
 */
declare const __PYODIDE_VERSION__: string;
declare const __PYODIDE_FILES__: { name: string; bytes: number }[];

export const PYODIDE_VERSION: string = __PYODIDE_VERSION__;

/** The core files a run needs, with their sizes in bytes (for a download's progress and its check). */
export const PYODIDE_FILES: readonly { name: string; bytes: number }[] = __PYODIDE_FILES__;

export const PYODIDE_BYTES = PYODIDE_FILES.reduce((n, f) => n + f.bytes, 0);

/** The folder, relative to the page's base, that the copy step writes. */
export const PYODIDE_DIR = `pyodide/v${PYODIDE_VERSION}/`;

/** Where the Python files come from: resolves to a folder URL (ending in `/`), reporting download progress if it downloads. */
export type Progress = { loaded: number; total: number };
export type IndexSource = (onProgress: (p: Progress) => void) => Promise<string>;

/**
 * The site folder the copy step wrote into: `base` when given; else the app's base, which the Vite
 * plugin writes into the page as `<meta name="pyfiddle-base">` (so a page on a deep, history-routed
 * path such as `/lessons/3` still finds `/pyodide/...`); else the page's own base.
 */
const siteBase = (base?: string) => {
  const b = base ?? document.querySelector<HTMLMetaElement>('meta[name="pyfiddle-base"]')?.content ?? '';
  return b && !b.endsWith('/') ? `${b}/` : b;
};

/**
 * The default source: the site's own `pyodide/v<version>/` folder (the copy step puts it there), as
 * an absolute URL, since the worker resolves imports against its own address, not the page's.
 */
export const selfHosted = ({ base }: { base?: string } = {}): IndexSource => async () =>
  new URL(`${siteBase(base)}${PYODIDE_DIR}`, document.baseURI).href;
