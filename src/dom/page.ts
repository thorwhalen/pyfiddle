/**
 * A fiddle page, as plain DOM: its cells in order (text, runnable code, "what will this print?"
 * questions), each with its concept explainers folded under it; the stages a teacher has not
 * released yet held back; hints and solutions revealed only on request; and the page as a
 * notebook to download or open in Colab.
 *
 * What the student did (edits, hints shown, answers, checks passed) and the released stage live in
 * the `store` seam (`localStore()` by default). A teacher view (`teacher: true`) shows every cell,
 * marks the held-back ones, and releases or takes back a stage; when the store is shared with the
 * students (a host's server), the release reaches them through the store's `subscribe`.
 */
import { marked } from 'marked';
import { cellConcepts, mergeConcepts } from '../page/concepts';
import { ipynbText } from '../page/ipynb';
import { lastStage, parsePage, stageTitle, type Cell, type ChoiceCell, type CodeCell, type Concept, type PageInput, type ResolvedPage } from '../page/schema';
import { localStore, storeKeys, whenRead, type FiddleStore } from '../page/store';
import { sharedRuntime, type PythonRuntime, type RunResult } from '../runtime/runtime';
import type { Given } from '../runtime/protocol';
import { createEditor, type EditorHandle } from './editor';
import { mountFiddle, type FiddleHandle } from './fiddle';
import { attr, button, h } from './h';

export type PageOptions = {
  runtime?: PythonRuntime;
  /** Where the student's work and the released stage are kept. Default: `localStore()`. */
  store?: FiddleStore;
  /** Concept explainers available to every page (the page's own `concepts` override them by id). */
  concepts?: readonly Concept[];
  /** A concept's link, or none. Default: its `href`. A host router maps ids to its own routes here. */
  conceptHref?: (concept: Concept) => string | undefined;
  /** Find a cell's concepts in its code too, not only those it lists. Default true. */
  detectConcepts?: boolean;
  /**
   * Values for the names the page's `given` lists (and any others every fiddle should start with).
   * A page that lists a name not supplied here is refused with an error naming it.
   */
  given?: Given;
  /** The teacher's view: every stage visible, with release controls. Default false. */
  teacher?: boolean;
  /** Offer the page as a notebook (download, and Open in Colab when the page names one). Default true. */
  notebook?: boolean;
  /**
   * Markdown to HTML. Default: `marked`, which passes HTML through. A host showing pages written by
   * people it does not trust passes a sanitising renderer (e.g. `(md) => DOMPurify.sanitize(marked.parse(md))`).
   */
  renderMarkdown?: (markdown: string) => string;
  /**
   * Hands the notebook to the person. Default: a download link. A native app shell (Capacitor),
   * where a download link does nothing, passes its own (the Share or Filesystem plugin).
   */
  saveFile?: (name: string, file: Blob) => void;
  /** Called when a cell's check passes or fails, and when a choice is answered. */
  onResult?: (cell: Cell & { id: string }, result: { passed: boolean; run?: RunResult }) => void;
};

export type PageHandle = {
  el: HTMLElement;
  page: ResolvedPage;
  /** The stage released so far. */
  released: () => number;
  /** Release up to `stage` (teachers' controls call this). */
  release: (stage: number) => Promise<void>;
  destroy: () => void;
};

/** Markdown as plain text, for an accessible name: no emphasis marks, backticks, heading marks or link targets. */
const plainText = (md: string) => md.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/^#+\s*/gm, '').replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();

/** Only web and relative links: a page's `colab` or a concept's link never runs script (`javascript:`). */
const safeHref = (url: string | undefined) => {
  if (!url) return undefined;
  try {
    const { protocol } = new URL(url, 'https://relative.invalid/');
    return protocol === 'https:' || protocol === 'http:' ? url : undefined;
  } catch {
    return undefined;
  }
};

/** The default way to hand over a file: a download link. */
const downloadFile = (name: string, file: Blob) => {
  const a = h('a', { href: URL.createObjectURL(file), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
};

/** The default markdown renderer: `marked`, HTML passed through (authors' content is trusted; see `renderMarkdown`). */
export const markedRenderer = (md: string): string => marked.parse(md, { async: false });

const MORE = 'More of this page opens when your teacher releases it.';

export function mountPage(parent: HTMLElement, input: PageInput | ResolvedPage, opts: PageOptions = {}): PageHandle {
  const page = parsePage(input);
  const {
    runtime = sharedRuntime(),
    store = localStore(),
    conceptHref = (c: Concept) => c.href,
    detectConcepts = true,
    teacher = false,
    notebook = true,
    renderMarkdown = markedRenderer,
    saveFile = downloadFile,
    onResult,
    given,
  } = opts;
  const missing = page.given.filter((name) => !given || !Object.hasOwn(given, name));
  if (missing.length) throw new Error(`pyfiddle: page "${page.id}" needs the host to give ${missing.map((n) => `\`${n}\``).join(', ')} (mountPage's \`given\` option)`);
  const partName = (stage: number) => {
    const title = stageTitle(page, stage);
    return title ? `Part ${stage + 1}: ${title}` : `Part ${stage + 1}`;
  };
  /** Set by destroy(): a store answer arriving later must not build anything into the detached page. */
  let destroyed = false;
  /** Hints shown per cell, so a student's notebook carries only those. */
  const hintsShown: Record<string, number> = {};
  const markdown = (text: string) => {
    const div = h('div', { class: 'pf-md' });
    div.innerHTML = renderMarkdown(text);
    return div;
  };
  const library = mergeConcepts(opts.concepts, page.concepts);
  const last = lastStage(page);
  let released = 0;
  const cleanups: (() => void)[] = [];

  const el = h('article', { class: 'pf-page', 'data-page': page.id });
  parent.append(el);

  // ---- toolbar: the notebook, and the teacher's release controls
  const toolbar = h('div', { class: 'pf-toolbar' });
  if (notebook) {
    toolbar.append(button('Download notebook', () => {
      const text = teacher
        ? ipynbText(page, { solutions: true, given })
        : ipynbText(page, { stage: released, hints: (id) => hintsShown[id] ?? 0, given });
      saveFile(`${page.id}.ipynb`, new Blob([text], { type: 'application/x-ipynb+json' }));
    }, { kind: 'quiet' }));
    const colab = safeHref(page.colab);
    if (colab) toolbar.append(h('a', { class: 'pf-btn pf-btn-quiet', href: colab, target: '_blank', rel: 'noopener' }, 'Open in Colab'));
  }
  const stageLabel = h('span', { class: 'pf-stage-label', role: 'status' });
  const releaseBtn = button('Release next part', () => void release(released + 1), { kind: 'primary' });
  const takeBackBtn = button('Take back', () => void release(released - 1));
  if (teacher && last > 0) toolbar.append(h('span', { class: 'pf-teacher' }, stageLabel, releaseBtn, takeBackBtn));
  if (toolbar.childElementCount) el.append(toolbar);

  // ---- cells
  type Slot = { cell: Cell & { id: string }; el: HTMLElement; mounted: boolean };
  const slots: Slot[] = page.cells.map((cell) => {
    const section = h('section', { class: `pf-cell pf-cell-${cell.kind}`, 'data-cell': cell.id, 'data-stage': cell.stage, hidden: true });
    el.append(section);
    return { cell, el: section, mounted: false };
  });
  const more = h('p', { class: 'pf-more', hidden: true }, MORE);
  el.append(more);

  const conceptsBlock = (cell: Cell) => {
    const found = cellConcepts(cell, library, { detect: detectConcepts });
    if (!found.length) return null;
    const list = h('dl', { class: 'pf-concept-list' });
    for (const c of found) {
      const href = safeHref(conceptHref(c));
      list.append(h('dt', {}, c.title), h('dd', {}, markdown(c.summary), href ? h('a', { class: 'pf-concept-link', href }, `More on ${c.title} →`) : null));
    }
    return h('details', { class: 'pf-concepts' }, h('summary', {}, `In this cell: ${found.map((c) => c.title).join(', ')}`), list);
  };

  const mountCode = (slot: Slot, cell: CodeCell & { id: string }) => {
    if (cell.task) slot.el.append(markdown(cell.task));
    const solvedBadge = h('span', { class: 'pf-solved', hidden: true }, '✓ Done');
    if (cell.check) slot.el.append(solvedBadge);
    whenRead(store.get<boolean>(storeKeys.solved(page.id, cell.id)), (s) => { if (!destroyed) solvedBadge.hidden = !s; });
    const fiddle: FiddleHandle = mountFiddle(slot.el, {
      id: `${page.id}/${cell.id}`,
      code: cell.text.replace(/\n+$/, ''),
      label: plainText(cell.label ?? cell.task?.split('\n').find((l) => l.trim() && !/^#/.test(l)) ?? cell.task ?? 'Python code'),
      check: cell.check,
      given,
      readOnly: cell.readOnly,
      runtime,
      store,
      storeKey: storeKeys.draft(page.id, cell.id),
      onResult: (r) => {
        if (!r.check) return;
        if (r.check.passed) {
          solvedBadge.hidden = false;
          void store.set(storeKeys.solved(page.id, cell.id), true);
        }
        onResult?.(cell, { passed: r.check.passed, run: r });
      },
    });
    cleanups.push(() => fiddle.destroy());

    // Hints one at a time, then the solution: deferred disclosure, remembered across visits.
    const steps = cell.hints.length + (cell.solution ? 1 : 0);
    if (!steps) return;
    const help = h('div', { class: 'pf-help' });
    const helpBtn = button('', () => void reveal(shown + 1), { kind: 'quiet' });
    slot.el.append(help, helpBtn);
    let shown = 0;
    const solutionEditors: EditorHandle[] = [];
    const reveal = async (n: number, persist = true) => {
      if (destroyed) return;
      shown = Math.min(n, steps);
      hintsShown[cell.id] = Math.min(shown, cell.hints.length);
      help.replaceChildren();
      cell.hints.slice(0, shown).forEach((hint, i) => help.append(h('div', { class: 'pf-hint' }, h('strong', {}, cell.hints.length > 1 ? `Hint ${i + 1}: ` : 'Hint: '), markdown(hint))));
      solutionEditors.splice(0).forEach((e) => e.destroy());
      if (cell.solution && shown > cell.hints.length) {
        const box = h('div', { class: 'pf-solution' }, h('strong', {}, 'One way to do it'));
        help.append(box);
        solutionEditors.push(createEditor(box, { doc: cell.solution.replace(/\n+$/, ''), label: 'One way to do it', readOnly: true }));
      }
      helpBtn.hidden = shown >= steps;
      helpBtn.textContent = shown < cell.hints.length ? (shown === 0 ? 'Show a hint' : 'Another hint') : 'Show one way to do it';
      if (persist) await store.set(storeKeys.hints(page.id, cell.id), shown);
    };
    cleanups.push(() => solutionEditors.forEach((e) => e.destroy()));
    helpBtn.textContent = cell.hints.length ? 'Show a hint' : 'Show one way to do it';
    whenRead(store.get<number>(storeKeys.hints(page.id, cell.id)), (n) => { if (typeof n === 'number' && n > 0) void reveal(n, false); });
  };

  const mountChoice = (slot: Slot, cell: ChoiceCell & { id: string }) => {
    slot.el.append(markdown(cell.question));
    if (cell.code) {
      const box = h('div', { class: 'pf-editor' });
      slot.el.append(box);
      const ed = createEditor(box, { doc: cell.code.replace(/\n+$/, ''), label: 'The code the question is about', readOnly: true });
      cleanups.push(() => ed.destroy());
    }
    const feedback = h('div', { class: 'pf-verdict', role: 'status', 'aria-live': 'polite' });
    // Native radios: one tab stop for the group, arrow keys move between choices, and the group is named by its question.
    const name = `pf-${page.id}-${cell.id}`;
    const radios = cell.choices.map((_, i) => h('input', { type: 'radio', name, value: i, class: 'pf-sr-only' }));
    const labels = cell.choices.map((choice, i) => h('label', { class: 'pf-btn pf-choice' }, radios[i], choice));
    radios.forEach((r, i) => r.addEventListener('change', () => void pick(i, true)));
    slot.el.append(h('fieldset', { class: 'pf-choices' }, h('legend', { class: 'pf-sr-only' }, plainText(cell.question)), ...labels), feedback);
    const pick = async (i: number, fresh: boolean) => {
      if (destroyed) return;
      radios[i].checked = true;
      labels.forEach((l, j) => {
        attr(l, 'data-right', j === cell.answer && i === j);
        attr(l, 'data-wrong', j !== cell.answer && i === j);
      });
      const right = i === cell.answer;
      feedback.replaceChildren(h('p', { class: right ? 'pf-pass' : 'pf-fail' }, right ? 'Right.' : `Not quite: the answer is “${cell.choices[cell.answer]}”.`));
      if (cell.explain) feedback.append(markdown(cell.explain));
      if (fresh) {
        await store.set(storeKeys.answer(page.id, cell.id), i);
        onResult?.(cell, { passed: right });
      }
    };
    whenRead(store.get<number>(storeKeys.answer(page.id, cell.id)), (i) => { if (typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < cell.choices.length) void pick(i, false); });
  };

  const mount = (slot: Slot) => {
    if (slot.mounted) return;
    slot.mounted = true;
    const { cell } = slot;
    if (teacher && cell.stage > 0) slot.el.append(h('p', { class: 'pf-stage-tag' }, partName(cell.stage)));
    if (cell.kind === 'markdown') slot.el.append(markdown(cell.text));
    else if (cell.kind === 'code') mountCode(slot, cell);
    else mountChoice(slot, cell);
    const concepts = conceptsBlock(cell);
    if (concepts) slot.el.append(concepts);
  };

  const show = () => {
    for (const slot of slots) {
      const open = slot.cell.stage <= released;
      const visible = open || teacher;
      // Mount before un-hiding, so the editor measures itself in a visible box on the next frame.
      if (visible) mount(slot);
      slot.el.hidden = !visible;
      attr(slot.el, 'data-held', teacher && !open);
    }
    more.hidden = teacher || released >= last;
    const next = stageTitle(page, released + 1);
    more.textContent = next ? `Next, “${next}”, opens when your teacher releases it.` : MORE;
    releaseBtn.textContent = next ? `Release: ${next}` : 'Release next part';
    stageLabel.textContent = released >= last ? `All ${last + 1} parts released` : `Part ${released + 1} of ${last + 1} released`;
    attr(releaseBtn, 'aria-disabled', released >= last ? 'true' : undefined);
    releaseBtn.hidden = released >= last;
    takeBackBtn.hidden = released <= 0;
  };

  const setReleased = (value: unknown) => {
    if (destroyed) return;
    released = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(Math.floor(value), last)) : 0;
    show();
  };

  async function release(stage: number) {
    setReleased(stage);
    await store.set(storeKeys.released(page.id), released);
  }

  show();
  whenRead(store.get<number>(storeKeys.released(page.id)), (v) => { if (v !== undefined) setReleased(v); });
  const off = store.subscribe?.(storeKeys.released(page.id), setReleased);
  if (off) cleanups.push(off);

  return {
    el,
    page,
    released: () => released,
    release,
    destroy() {
      destroyed = true;
      cleanups.splice(0).forEach((c) => c());
      el.remove();
    },
  };
}
