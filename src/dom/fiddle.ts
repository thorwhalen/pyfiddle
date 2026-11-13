/**
 * A fiddle: a Python editor with Run, Stop and Reset, and what the program printed under it, as
 * plain DOM (no framework), so it works in any page and any host framework.
 *
 * Python loads on the first Run anywhere on the page (one shared runtime); a Run here stops
 * whatever another fiddle is running; destroying the fiddle stops its own program. Where the code
 * is kept is the store's (`store` + `storeKey`): Reset puts the original code back and offers Undo
 * until the next edit, and the code it replaced is kept in the store too, so a reload loses nothing.
 * With a `check`, the check runs after the code, in the same namespace, and its verdict shows
 * under the output.
 */
import { COULD_NOT_START, sharedRuntime, type PythonRuntime, type RunResult } from '../runtime/runtime';
import type { Given, Stream } from '../runtime/protocol';
import { whenRead, type FiddleStore } from '../page/store';
import { createEditor, type EditorHandle } from './editor';
import { attr, button, h } from './h';

/** Output beyond this is cut, so a runaway loop of prints cannot freeze the page. */
const MAX_OUTPUT_CHARS = 20_000;
/** A status line, and Stop, appear only once a wait passes this, so a quick run never flashes them. */
const SHOW_WAIT_MS = 400;

/** What a fiddle keeps between visits: the code, and the code a Reset replaced (until the next edit). */
export type FiddleDraft = { code?: string; undo?: string };

export type FiddleOptions = {
  /** Which fiddle this is: it owns its runs, and tests find it by it (`data-fiddle`). */
  id: string;
  /** The starting code. */
  code: string;
  /** The editor's accessible name. */
  label?: string;
  /** Hidden Python run after the code; see the page format. */
  check?: string;
  /** Names the program starts with, set by the host (a round's ciphertext, say). */
  given?: Given;
  readOnly?: boolean;
  runtime?: PythonRuntime;
  /** Where the student's code is kept; nothing is kept without one. */
  store?: FiddleStore;
  storeKey?: string;
  onResult?: (r: RunResult) => void;
};

export type FiddleHandle = { el: HTMLElement; getCode: () => string; run: () => Promise<RunResult | undefined>; destroy: () => void };

const mb = (bytes: number) => (bytes / 1e6).toFixed(1);
const coarse = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export function mountFiddle(parent: HTMLElement, opts: FiddleOptions): FiddleHandle {
  const { id, code: initial, label = 'Python code', check, given, readOnly = false, store, storeKey, onResult } = opts;
  const rt = opts.runtime ?? sharedRuntime();

  let code = initial;
  let undo: string | null = null;
  let touched = false;
  let quiet = false;
  let pending = false;
  let slow = false;
  let slowTimer: ReturnType<typeof setTimeout> | undefined;
  let result: RunResult | null = null;
  let size = 0;

  const editorHost = h('div', { class: 'pf-editor' });
  const runBtn = button('Run', () => void run(), { kind: 'primary' });
  const stopBtn = button('Stop', () => {
    rt.stop();
    runBtn.focus(); // Stop disappears; keep the keyboard where it was
  });
  const resetBtn = button('Reset', () => resetOrUndo());
  const status = h('div', { class: 'pf-status', role: 'status' });
  const output = h('pre', { class: 'pf-output', 'aria-label': 'Output', hidden: true });
  const verdict = h('div', { class: 'pf-verdict', role: 'status', 'aria-live': 'polite' });
  const el = h('div', { class: 'pf-fiddle', 'data-fiddle': id },
    editorHost,
    h('div', { class: 'pf-actions' }, runBtn, stopBtn, resetBtn),
    status, output, verdict);
  parent.append(el);

  const save = () => {
    if (!store || !storeKey) return;
    void store.set<FiddleDraft>(storeKey, code === initial && undo === null ? undefined : { code, ...(undo === null ? {} : { undo }) });
  };

  const editor: EditorHandle = createEditor(editorHost, {
    doc: code,
    label,
    readOnly,
    onChange: (next) => {
      if (quiet) return;
      touched = true;
      code = next;
      undo = null;
      save();
      render();
    },
  });
  const replace = (text: string) => {
    quiet = true;
    editor.set(text);
    quiet = false;
    code = text;
  };

  // A saved draft that arrives after the editor was made (an async store) still lands, unless the student has started typing.
  const applyDraft = (d: FiddleDraft | undefined) => {
    if (touched || !d) return;
    if (d.code !== undefined && d.code !== code) replace(d.code);
    if (d.undo !== undefined) undo = d.undo;
    render();
  };
  if (store && storeKey && !readOnly) whenRead(store.get<FiddleDraft>(storeKey), applyDraft);

  function mine() {
    const s = rt.getState();
    return { loading: s.owner === id && s.status === 'loading', running: s.owner === id && s.status === 'running', progress: s.progress };
  }

  function render() {
    const { loading, running, progress } = mine();
    const busy = pending || loading || running;
    if (busy && slowTimer === undefined && !slow) slowTimer = setTimeout(() => { slow = true; render(); }, SHOW_WAIT_MS);
    if (!busy) {
      clearTimeout(slowTimer);
      slowTimer = undefined;
      slow = false;
    }
    const failed = !!result?.error?.startsWith(COULD_NOT_START);
    runBtn.textContent = busy ? (loading ? 'Starting Python…' : 'Running…') : failed ? 'Try again' : 'Run';
    attr(runBtn, 'aria-busy', busy ? 'true' : undefined);
    attr(runBtn, 'data-pending', busy);
    stopBtn.hidden = !((loading || running) && slow);
    const changed = code !== initial || undo !== null;
    resetBtn.hidden = readOnly || !changed;
    resetBtn.textContent = undo !== null ? 'Undo reset' : 'Reset';
    attr(resetBtn, 'aria-disabled', busy ? 'true' : undefined);
    status.replaceChildren();
    if (loading && slow) {
      if (progress) status.append(`Downloading Python, once: ${mb(progress.loaded)} of ${mb(progress.total)} MB `, h('progress', { max: progress.total, value: progress.loaded }));
      else status.append('Starting Python. The first time takes longer, while it downloads (a few megabytes, once); after that it starts in a moment.');
    } else if (running && slow) status.append('Running… Stop ends a program that runs too long.');
  }
  const unsubscribe = rt.subscribe(render);

  const showResult = (r: RunResult, printed: boolean) => {
    output.hidden = false;
    output.removeAttribute('aria-busy');
    const failed = r.error?.startsWith(COULD_NOT_START);
    if (r.error) output.append(h('span', { class: 'pf-err' }, failed ? `${r.error} Check the connection, then press Try again.` : r.error));
    if (!printed && !r.error && !r.interrupted) output.append(h('span', { class: 'pf-quiet' }, '(Nothing was printed.)'));
    if (r.interrupted) output.append(h('span', { class: 'pf-quiet' }, `${printed ? '\n' : ''}Stopped.`));
    verdict.replaceChildren();
    if (r.check) {
      verdict.append(r.check.passed
        ? h('p', { class: 'pf-pass' }, '✓ Check passed.')
        : h('p', { class: 'pf-fail' }, `Not yet. ${r.check.message}`));
    }
  };

  async function run(): Promise<RunResult | undefined> {
    const { loading, running } = mine();
    if (pending || loading || running) return undefined; // a repeat press while this fiddle's run is under way does nothing
    pending = true;
    // The last output stays up, muted, until the new run prints or ends, so the page does not jump.
    attr(output, 'aria-busy', 'true');
    verdict.replaceChildren();
    render();
    if (coarse()) editor.view.contentDOM.blur(); // close the phone's keyboard so the output shows
    size = 0;
    let first = true;
    const clear = () => {
      if (!first) return;
      first = false;
      output.replaceChildren();
      output.hidden = false;
      output.removeAttribute('aria-busy');
    };
    const r = await rt.run(code, {
      owner: id,
      check,
      given,
      preempt: true,
      onOutput: (stream: Stream, text: string) => {
        clear();
        if (size >= MAX_OUTPUT_CHARS) return;
        const room = MAX_OUTPUT_CHARS - size;
        size += text.length;
        const shown = text.length > room ? `${text.slice(0, room)}\n… (the rest of the output was cut)\n` : text;
        output.append(stream === 'stderr' ? h('span', { class: 'pf-err' }, shown) : shown);
      },
    });
    const printed = !first;
    clear();
    pending = false;
    result = r;
    showResult(r, printed);
    render();
    onResult?.(r);
    if (coarse()) requestAnimationFrame(() => output.scrollIntoView({ block: 'nearest' }));
    return r;
  }

  function resetOrUndo() {
    const { loading, running } = mine();
    if (pending || loading || running) return;
    if (undo !== null) {
      replace(undo);
      undo = null;
    } else {
      undo = code;
      replace(initial);
    }
    save();
    render();
  }

  render();
  return {
    el,
    getCode: () => code,
    run,
    destroy() {
      unsubscribe();
      clearTimeout(slowTimer);
      const s = rt.getState();
      // Leaving the page stops this fiddle's program, so it never blocks the next one.
      if (s.owner === id && (s.status === 'running' || s.status === 'loading')) rt.stop();
      editor.destroy();
      el.remove();
    },
  };
}
