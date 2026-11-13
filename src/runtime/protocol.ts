/**
 * The messages between the page and the Python worker. One run at a time: the page sends `run`, the
 * worker streams `out` while it runs and ends with `done`. Kept free of DOM and worker globals so
 * both sides (and the tests) import it.
 */

/** Where the Python files come from, and the shared interrupt flag when the page is cross-origin isolated. */
export type BootMessage = { type: 'boot'; indexURL: string; interrupt?: SharedArrayBuffer };

/**
 * Run `code` in a fresh namespace. When `check` is given, it runs afterwards in the same namespace,
 * so it can look at the variables and functions the code made (and at `_printed`, everything the
 * code printed); its first failed `assert` is the hint. `given` is JSON text of an object whose
 * entries the namespace starts with (see `Given`).
 */
export type RunMessage = { type: 'run'; id: number; code: string; check?: string; given?: string };

/**
 * Names a program starts with, set by the host rather than written in a cell (a round's ciphertext,
 * say). Values cross to Python as JSON: strings, numbers, booleans, null, lists and dicts.
 */
export type Given = Record<string, unknown>;

export type ToWorker = BootMessage | RunMessage;

export type Stream = 'stdout' | 'stderr';
export type CheckResult = { passed: true } | { passed: false; message: string };

export type FromWorker =
  | { type: 'ready'; version: string }
  | { type: 'boot-error'; message: string }
  | { type: 'out'; id: number; stream: Stream; text: string }
  /** `error` is the traceback (the cell's own lines only) when the code raised; `check` is set when a check ran. */
  | { type: 'done'; id: number; error?: string; check?: CheckResult; interrupted?: boolean }
  /** The interpreter itself failed during a run and cannot be used again. */
  | { type: 'fatal'; id: number; message: string };
