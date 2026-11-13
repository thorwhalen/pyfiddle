/**
 * One Python for the whole page: a Web Worker running Pyodide, started on the first Run and kept for
 * every cell after it. Only one program runs at a time.
 *
 * A Run from another cell takes over (`preempt`): the running program is stopped first, so leaving
 * a page mid-run, or forgetting a loop, never blocks the next cell.
 *
 * Stop always works. When the page is cross-origin isolated, it raises KeyboardInterrupt through
 * Pyodide's interrupt buffer and the interpreter is kept; otherwise (and if the interrupt is ignored)
 * it ends the worker, and the next Run starts a new one from the cached files.
 *
 * Seams: `indexURL` says where Pyodide's files are (the page's own folder by default; a native app
 * passes one that downloads them first, with progress: `pyfiddle/capacitor`), and `makeWorker`
 * builds the worker (tests pass a fake; a page whose CSP refuses `blob:` workers passes a URL one).
 */
import { selfHosted, type IndexSource, type Progress } from './assets';
import type { CheckResult, FromWorker, Given, Stream, ToWorker } from './protocol';
import { WORKER_SOURCE } from './worker-source.generated';

export type RuntimeState = {
  status: 'idle' | 'loading' | 'ready' | 'running' | 'failed';
  /** The cell whose program is running (or whose Run started the loading). */
  owner?: string;
  /** Bytes downloaded so far, while a first download runs (a native app). */
  progress?: Progress;
  /** Why the last start failed. */
  error?: string;
};

export type RunResult = { error?: string; check?: CheckResult; interrupted?: boolean };
export type RunOptions = {
  owner: string;
  check?: string;
  /** Names the program starts with (a round's ciphertext, say); JSON values. */
  given?: Given;
  onOutput: (stream: Stream, text: string) => void;
  /** Stop whatever is running or loading for another cell, and run this instead. */
  preempt?: boolean;
};

/** What a run reports when the interpreter itself failed (a huge recursion, out of memory). */
export const CRASHED = 'Python stopped working: the program probably went too deep or used too much memory. It starts again on the next Run.';
export const BUSY = 'Another program is still running.';
export const COULD_NOT_START = 'Python could not start';

export type WorkerLike = Pick<Worker, 'postMessage' | 'terminate'> & {
  onmessage: ((e: MessageEvent<FromWorker>) => void) | null;
  onerror: ((e: ErrorEvent) => void) | null;
};

/** The default worker: the bundled worker source, started from a Blob (no bundler configuration needed). */
export const blobWorker = (): WorkerLike => {
  const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
  const w = new Worker(url, { type: 'module', name: 'pyfiddle' }) as WorkerLike;
  // The worker has read its script once it answers; revoking right away is safe in every engine
  // that has started fetching it, and the next worker gets a fresh URL.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return w;
};

const SIGINT = 2;

export type RuntimeOptions = {
  /** Where Pyodide's files are. Default: the page's own `pyodide/v<version>/` folder. */
  indexURL?: IndexSource;
  /** Builds the worker. Default: the bundled worker, from a Blob. */
  makeWorker?: () => WorkerLike;
  /** How long Stop waits for KeyboardInterrupt before ending the worker (cross-origin isolated pages only). */
  interruptGraceMs?: number;
};

export function createPythonRuntime({ indexURL = selfHosted(), makeWorker = blobWorker, interruptGraceMs = 1500 }: RuntimeOptions = {}) {
  let state: RuntimeState = { status: 'idle' };
  const listeners = new Set<() => void>();
  const set = (next: RuntimeState) => {
    state = next;
    listeners.forEach((l) => l());
  };

  let worker: WorkerLike | null = null;
  let ready: Promise<WorkerLike> | null = null;
  let interrupt: Int32Array | null = null;
  let nextId = 1;
  /** Bumped whenever the worker is ended, so a load that was stopped half-way never comes back to life. */
  let generation = 0;
  class Stopped extends Error {}
  let running: { id: number; onOutput: RunOptions['onOutput']; resolve: (r: RunResult) => void; done: Promise<RunResult> } | null = null;
  /** The newest Run asked for: an older one still waiting for Python to load gives way to it. */
  let latestRequest = 0;
  /** Rejects the load in progress, if any (Stop while loading). */
  let abortBoot: (() => void) | null = null;

  const end = () => {
    generation++;
    abortBoot?.();
    abortBoot = null;
    worker?.terminate();
    worker = null;
    ready = null;
    interrupt = null;
  };

  /** The worker died under a running program (out of memory, say): report it, and start afresh next time. */
  const crashed = (message: string) => {
    const r = running;
    running = null;
    end();
    set({ status: 'idle' });
    r?.resolve({ error: message });
  };

  /** Start the worker and load Python, once; later calls get the same promise. */
  const start = (owner: string) => {
    if (ready) return ready;
    set({ status: 'loading', owner });
    const gen = generation;
    const current = (async () => {
      // Stop gives up waiting at once; the download itself may go on, and the next Run picks it up.
      const url = await new Promise<string>((resolve, reject) => {
        abortBoot = () => reject(new Stopped());
        indexURL((progress) => gen === generation && set({ ...state, progress })).then(resolve, reject);
      });
      if (gen !== generation) throw new Stopped();
      const w = makeWorker();
      worker = w;
      const shared = typeof SharedArrayBuffer !== 'undefined' && globalThis.crossOriginIsolated ? new SharedArrayBuffer(4) : undefined;
      interrupt = shared ? new Int32Array(shared) : null;
      await new Promise<void>((resolve, reject) => {
        let booted = false;
        abortBoot = () => reject(new Stopped());
        w.onmessage = (e) => {
          const m = e.data;
          if (m.type === 'ready') {
            booted = true;
            abortBoot = null;
            resolve();
          } else if (m.type === 'boot-error') reject(new Error(m.message));
          else if (m.type === 'out' && running?.id === m.id) running.onOutput(m.stream, m.text);
          else if (m.type === 'done' && running?.id === m.id) {
            const r = running;
            running = null;
            set({ status: 'ready' });
            r.resolve({ error: m.error, check: m.check, interrupted: m.interrupted });
          } else if (m.type === 'fatal' && running?.id === m.id) crashed(CRASHED);
        };
        w.onerror = (e) => {
          const message = e.message || 'The Python worker stopped unexpectedly.';
          if (booted) crashed(message);
          else reject(new Error(message));
        };
        w.postMessage({ type: 'boot', indexURL: url, interrupt: shared } satisfies ToWorker);
      });
      set({ status: 'ready' });
      return w;
    })();
    ready = current;
    current.catch((err: unknown) => {
      if (err instanceof Stopped || gen !== generation) return;
      end();
      set({ status: 'failed', owner, error: err instanceof Error ? err.message : String(err) });
    });
    return current;
  };

  const api = {
    getState: () => state,
    subscribe: (fn: () => void) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    /** Load Python now (say, when a page with cells is opened and the network is idle), without running anything. */
    warm: (owner = 'warm') => start(owner).then(() => undefined, () => undefined),
    /** Run a program; resolves when it ends, is stopped or overtaken, or Python fails to start. */
    async run(code: string, { owner, check, given, onOutput, preempt = false }: RunOptions): Promise<RunResult> {
      const givenJson = given && Object.keys(given).length ? JSON.stringify(given) : undefined;
      const busy = running !== null || state.status === 'loading';
      if (busy && !preempt) return { error: BUSY };
      const ticket = ++latestRequest;
      if (running) {
        const r = running;
        api.stop();
        await r.done;
      }
      if (state.status === 'loading') set({ ...state, owner }); // the load now serves this cell
      let w: WorkerLike;
      try {
        w = await start(owner);
      } catch (err) {
        if (err instanceof Stopped) return { interrupted: true };
        return { error: `${COULD_NOT_START}: ${err instanceof Error ? err.message : String(err)}` };
      }
      if (ticket !== latestRequest || running) return { interrupted: true }; // a later Run took over
      if (interrupt) Atomics.store(interrupt, 0, 0);
      const id = nextId++;
      set({ status: 'running', owner });
      let resolve!: (r: RunResult) => void;
      const done = new Promise<RunResult>((r) => {
        resolve = r;
      });
      running = { id, onOutput, resolve, done };
      w.postMessage({ type: 'run', id, code, check, given: givenJson } satisfies ToWorker);
      return done;
    },
    /** Stop the running program, or a first load that is taking too long. */
    stop() {
      if (state.status === 'loading') {
        end();
        set({ status: 'idle' });
        return;
      }
      const r = running;
      if (!r) return;
      const kill = () => {
        if (running !== r) return;
        running = null;
        end();
        set({ status: 'idle' });
        r.resolve({ interrupted: true });
      };
      if (interrupt) {
        Atomics.store(interrupt, 0, SIGINT);
        setTimeout(kill, interruptGraceMs);
      } else kill();
    },
  };
  return api;
}

export type PythonRuntime = ReturnType<typeof createPythonRuntime>;

let shared: PythonRuntime | null = null;

/**
 * The page's one Python, created on first use with the default options (nothing loads until a Run).
 * A host that needs other options (a native download, a custom worker) creates its own runtime
 * with `createPythonRuntime` and passes it to `mountPage` / `mountFiddle`.
 */
export const sharedRuntime = (): PythonRuntime => (shared ??= createPythonRuntime());
