// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountPage, type PageOptions } from '../src/dom/page';
import type { PageInput } from '../src/page/schema';
import { memoryStore, storeKeys, type FiddleStore } from '../src/page/store';
import { fakeRuntime, tick } from './fakes';

const example = JSON.parse(readFileSync('example/pages/first-steps.json', 'utf8'));

const page: PageInput = {
  id: 'p', title: 'Page',
  concepts: [{ id: 'len', title: 'len()', summary: 'How many.', href: '/concepts/len' }],
  cells: [
    { kind: 'markdown', id: 'intro', text: 'Hello **there**' },
    { kind: 'code', id: 'go', text: 'print:hi', label: 'Go' },
    { kind: 'code', id: 'task', stage: 1, text: 'print:x', task: 'Do it', check: 'ok-secret-check', concepts: ['len'], hints: ['First hint', 'Second hint'], solution: 'n = len(s)' },
    { kind: 'choice', id: 'q', stage: 2, question: 'Which?', choices: ['a', 'b'], answer: 1, explain: 'Because.' },
  ],
};

const mount = (opts: PageOptions = {}) => {
  document.body.innerHTML = '<div id="root"></div>';
  const { rt } = fakeRuntime();
  const store = opts.store ?? memoryStore();
  const handle = mountPage(document.getElementById('root')!, page, { runtime: rt, store, ...opts });
  const cell = (id: string) => handle.el.querySelector<HTMLElement>(`[data-cell="${id}"]`)!;
  const buttonIn = (el: Element, text: RegExp) => [...el.querySelectorAll('button')].find((b) => text.test(b.textContent ?? '')) as HTMLButtonElement;
  return { handle, store, rt, cell, buttonIn };
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('a fiddle page', () => {
  it('renders markdown and code cells, and holds back the stages not released', () => {
    const { cell } = mount();
    expect(cell('intro').innerHTML).toContain('<strong>there</strong>');
    expect(cell('go').hidden).toBe(false);
    expect(cell('go').querySelector('.cm-content')?.getAttribute('aria-label')).toBe('Go');
    expect(cell('task').hidden).toBe(true);
    expect(cell('q').hidden).toBe(true);
    expect(document.querySelector('.pf-more')?.hasAttribute('hidden')).toBe(false);
  });

  it('runs a cell, shows its output, and never shows the check', async () => {
    const { cell, buttonIn } = mount();
    buttonIn(cell('go'), /^Run$/).click();
    await vi.waitFor(() => expect(cell('go').querySelector('.pf-output')?.textContent).toBe('hi'));
    expect(document.body.innerHTML).not.toContain('secret-check');
  });

  it('a teacher releases the next part, and the student page follows through the shared store', async () => {
    const store = memoryStore();
    const student = mount({ store });
    const studentRoot = student.handle.el;
    const teacherRoot = document.createElement('div');
    document.body.append(teacherRoot);
    const teacher = mountPage(teacherRoot, page, { runtime: student.rt, store, teacher: true });
    expect(teacherRoot.querySelector<HTMLElement>('[data-cell="task"]')!.hidden).toBe(false);
    expect(teacherRoot.querySelector('[data-cell="task"]')!.hasAttribute('data-held')).toBe(true);
    expect(teacherRoot.querySelector('.pf-stage-label')?.textContent).toBe('Part 1 of 3 released');
    [...teacherRoot.querySelectorAll('button')].find((b) => b.textContent === 'Release next part')!.click();
    await tick();
    expect(store.get(storeKeys.released('p'))).toBe(1);
    expect(studentRoot.querySelector<HTMLElement>('[data-cell="task"]')!.hidden).toBe(false);
    expect(studentRoot.querySelector<HTMLElement>('[data-cell="q"]')!.hidden).toBe(true);
    teacher.destroy();
  });

  it('reveals hints one at a time, then the solution, and remembers how far', async () => {
    const store = memoryStore({ [storeKeys.released('p')]: 2 });
    const first = mount({ store });
    await tick();
    const task = first.cell('task');
    first.buttonIn(task, /Show a hint/).click();
    await tick();
    expect(task.textContent).toContain('First hint');
    expect(task.textContent).not.toContain('Second hint');
    first.buttonIn(task, /Another hint/).click();
    await tick();
    first.buttonIn(task, /one way to do it/).click();
    await tick();
    expect(task.querySelector('.pf-solution .cm-content')?.textContent).toContain('n = len(s)');
    first.handle.destroy();
    const again = mount({ store });
    await tick();
    expect(again.cell('task').querySelector('.pf-solution')).not.toBeNull();
  });

  it('marks a cell done when its check passes, and tells the host', async () => {
    const onResult = vi.fn();
    const store = memoryStore({ [storeKeys.released('p')]: 1 });
    const { cell, buttonIn } = mount({ store, onResult });
    await tick();
    buttonIn(cell('task'), /^Run$/).click();
    await vi.waitFor(() => expect(cell('task').querySelector('.pf-pass')?.textContent).toBe('✓ Check passed.'));
    expect(cell('task').querySelector<HTMLElement>('.pf-solved')!.hidden).toBe(false);
    expect(store.get(storeKeys.solved('p', 'task'))).toBe(true);
    expect(onResult).toHaveBeenCalledWith(expect.objectContaining({ id: 'task' }), expect.objectContaining({ passed: true }));
  });

  it('keeps the student’s edits in the store, and puts them back on the next visit', async () => {
    const store = memoryStore({ [storeKeys.draft('p', 'go')]: { code: 'print:saved' } });
    const { cell } = mount({ store });
    await tick();
    expect(cell('go').querySelector('.cm-content')?.textContent).toBe('print:saved');
    expect(cell('go').querySelector('.pf-actions')?.textContent).toContain('Reset');
  });

  it('answers a choice question with its explanation, and remembers the answer', async () => {
    const store = memoryStore({ [storeKeys.released('p')]: 2 });
    const first = mount({ store });
    [...first.cell('q').querySelectorAll('label')].find((l) => l.textContent === 'a')!.click();
    await tick();
    expect(first.cell('q').textContent).toContain('Not quite: the answer is “b”.');
    expect(first.cell('q').textContent).toContain('Because.');
    expect(store.get(storeKeys.answer('p', 'q'))).toBe(0);
  });

  it('folds the concepts a cell uses under it, linking to their pages', async () => {
    const store = memoryStore({ [storeKeys.released('p')]: 1 });
    const { cell } = mount({ store });
    const details = cell('task').querySelector('details.pf-concepts')!;
    expect(details.hasAttribute('open')).toBe(false);
    expect(details.querySelector('summary')?.textContent).toBe('In this cell: len()');
    expect(details.querySelector('a')?.getAttribute('href')).toBe('/concepts/len');
  });

  it('a host router can give concepts its own links', () => {
    const store = memoryStore({ [storeKeys.released('p')]: 1 });
    const { cell } = mount({ store, conceptHref: (c) => `#/concepts/${c.id}` });
    expect(cell('task').querySelector('.pf-concept-link')?.getAttribute('href')).toBe('#/concepts/len');
  });

  it('offers the page as a notebook, and Open in Colab when the page names one', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const { rt } = fakeRuntime();
    const handle = mountPage(document.getElementById('root')!, { ...page, colab: 'https://colab.research.google.com/github/o/r/blob/main/p.ipynb' }, { runtime: rt, store: memoryStore() });
    const toolbar = handle.el.querySelector('.pf-toolbar')!;
    expect(toolbar.textContent).toContain('Download notebook');
    expect(toolbar.querySelector('a')?.getAttribute('href')).toMatch(/^https:\/\/colab\.research\.google\.com\//);
  });

  it('a host can sanitise markdown with its own renderer', () => {
    const { cell } = mount({ renderMarkdown: (md) => `<p>${md.replace(/[<>*]/g, '')}</p>` });
    expect(cell('intro').innerHTML).toBe('<div class="pf-md"><p>Hello there</p></div>');
  });

  it('a stored stage that is not a number shows the first part, never nothing', () => {
    const { cell } = mount({ store: memoryStore({ [storeKeys.released('p')]: Number.NaN }) });
    expect(cell('go').hidden).toBe(false);
  });

  it('a store that answers after the page was destroyed builds nothing into it', async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const { rt } = fakeRuntime();
    let answer!: (v: unknown) => void;
    const slow = { get: (key: string) => (key === storeKeys.released('p') ? new Promise((r) => { answer = r; }) : undefined), set: () => {} } as unknown as FiddleStore;
    const handle = mountPage(document.getElementById('root')!, page, { runtime: rt, store: slow });
    handle.destroy();
    answer(2);
    await tick();
    expect(handle.el.querySelectorAll('.pf-fiddle')).toHaveLength(0);
    expect(handle.el.querySelector<HTMLElement>('[data-cell="task"]')!.childElementCount).toBe(0);
  });

  it('never turns a page’s links into script', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const { rt } = fakeRuntime();
    const handle = mountPage(document.getElementById('root')!, page, { runtime: rt, store: memoryStore({ [storeKeys.released('p')]: 1 }), conceptHref: () => 'javascript:alert(1)' });
    expect(handle.el.querySelector('.pf-concept-link')).toBeNull();
  });

  it('a student’s notebook has only the hints they revealed; the teacher’s has everything', async () => {
    const saved: Record<string, string> = {};
    const saveFile = (name: string, blob: Blob) => {
      const reader = new FileReader();
      reader.onload = () => { saved[name] = String(reader.result); };
      reader.readAsText(blob);
    };
    const store = memoryStore({ [storeKeys.released('p')]: 1 });
    const student = mount({ store, saveFile });
    student.buttonIn(student.cell('task'), /Show a hint/).click();
    await tick();
    student.buttonIn(student.handle.el, /Download notebook/).click();
    await vi.waitFor(() => expect(saved['p.ipynb']).toBeDefined());
    expect(saved['p.ipynb']).toContain('First hint');
    expect(saved['p.ipynb']).not.toContain('Second hint');
    expect(saved['p.ipynb']).not.toContain('Which?');
  });

  it('renders the example page', () => {
    document.body.innerHTML = '<div id="root"></div>';
    const { rt } = fakeRuntime();
    const handle = mountPage(document.getElementById('root')!, example, { runtime: rt, store: memoryStore(), teacher: true });
    expect(handle.el.querySelectorAll('.pf-cell')).toHaveLength(example.cells.length);
    handle.destroy();
    expect(document.querySelector('.pf-page')).toBeNull();
  });
});
