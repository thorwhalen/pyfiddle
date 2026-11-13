/**
 * The Python worker: Pyodide (CPython compiled to WebAssembly), loaded from `indexURL` on the first
 * run, then kept. It runs one program at a time in a fresh namespace, streams what it prints, and
 * reports a traceback cut down to the cell's own lines.
 *
 * The loader (`pyodide.mjs`) is imported from the same folder as the rest of Pyodide, never bundled,
 * so the loader and the interpreter always come from one version, wherever they were downloaded to.
 * This file is bundled into a string at build time (`scripts/build-worker.mjs`) and started from a
 * Blob, so a host needs no bundler configuration to use it.
 */
import { INSTALL_HARNESS } from './harness';
import type { FromWorker, RunMessage, Stream, ToWorker } from './protocol';

type Pyodide = {
  version: string;
  runPythonAsync: (code: string) => Promise<unknown>;
  setStdout: (o: { write: (b: Uint8Array) => number }) => void;
  setStderr: (o: { write: (b: Uint8Array) => number }) => void;
  setInterruptBuffer: (b: Int32Array) => void;
  pyimport: (name: string) => { run: RunFn };
};
type RunFn = (code: string, check: string, given: string) => { toJs: () => [string, string, string, boolean]; destroy: () => void };

const post = (m: FromWorker) => postMessage(m);

/** A raw stream writer: decodes UTF-8 across chunk boundaries and posts the text as it comes. */
const writer = (stream: Stream) => {
  const decoder = new TextDecoder();
  return (bytes: Uint8Array) => {
    const text = decoder.decode(bytes, { stream: true });
    if (text) post({ type: 'out', id: current, stream, text });
    return bytes.length;
  };
};

let harness: RunFn | null = null;
let booting: Promise<Pyodide> | null = null;
let current = 0;

async function boot(indexURL: string, interrupt?: SharedArrayBuffer): Promise<Pyodide> {
  const { loadPyodide } = (await import(/* @vite-ignore */ `${indexURL}pyodide.mjs`)) as { loadPyodide: (o: { indexURL: string }) => Promise<Pyodide> };
  const py = await loadPyodide({ indexURL });
  py.setStdout({ write: writer('stdout') });
  py.setStderr({ write: writer('stderr') });
  if (interrupt) py.setInterruptBuffer(new Int32Array(interrupt));
  await py.runPythonAsync(INSTALL_HARNESS);
  harness = py.pyimport('_pyfiddle').run;
  return py;
}

function run({ id, code, check, given }: RunMessage) {
  current = id;
  const result = harness!(code, check ?? '', given ?? '');
  const [error, status, message, interrupted] = result.toJs();
  result.destroy();
  post({
    type: 'done', id,
    error: error || undefined,
    interrupted: interrupted || undefined,
    check: status === 'passed' ? { passed: true } : status === 'failed' ? { passed: false, message } : undefined,
  });
}

onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === 'boot') {
    booting ??= boot(m.indexURL, m.interrupt);
    try {
      const py = await booting;
      post({ type: 'ready', version: py.version });
    } catch (err) {
      booting = null;
      post({ type: 'boot-error', message: err instanceof Error ? err.message : String(err) });
    }
  } else if (m.type === 'run') {
    try {
      run(m);
    } catch (err) {
      // The harness catches every Python error, so an error here means the interpreter itself
      // failed (a stack overflow from a huge recursion limit, out of memory). It cannot be used
      // again: say so, and the page starts a new one on the next Run.
      post({ type: 'fatal', id: m.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
};
