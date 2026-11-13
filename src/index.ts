/**
 * pyfiddle: Python fiddle web pages. Text and runnable Python cells, running real CPython (Pyodide)
 * in a Web Worker, with staged disclosure, hidden checks, concept explainers and notebook export.
 *
 * - `mountPage(el, page, options)`: render a page (plain DOM; `pyfiddle/react` wraps it).
 * - `mountFiddle(el, options)`: one fiddle on its own.
 * - The page model (also `pyfiddle/page`, with no DOM): `parsePage`, `PageSchema`, `fromPrimmLesson`,
 *   `toIpynb`, `colabUrl`, the store seam.
 * - The runtime (also `pyfiddle/runtime`): `createPythonRuntime`, `sharedRuntime`.
 */
export { mountPage } from './dom/page';
export type { PageHandle, PageOptions } from './dom/page';
export { mountFiddle } from './dom/fiddle';
export type { FiddleDraft, FiddleHandle, FiddleOptions } from './dom/fiddle';
export { createEditor } from './dom/editor';
export type { EditorHandle } from './dom/editor';
export * from './page/index';
export * from './runtime/index';
