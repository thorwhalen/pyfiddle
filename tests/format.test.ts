import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cellConcepts, detectConcepts, pythonTokens } from '../src/page/concepts';
import { colabUrl, toIpynb } from '../src/page/ipynb';
import { fromPrimmLesson, type PrimmLesson } from '../src/page/primm';
import { lastStage, parsePage, stageTitle, type Concept } from '../src/page/schema';

const library: Concept[] = [
  { id: 'for', title: 'for loops', summary: 'Repeat for each item.' },
  { id: 'len', title: 'len()', summary: 'How many items.' },
  { id: 'modulo', title: 'the % operator', summary: 'The remainder.', match: ['%'] },
  { id: 'lower', title: '.lower()', summary: 'Small letters.', match: ['.lower'] },
  { id: 'fstring', title: 'f-strings', summary: 'Values in text.', match: ['f"'] },
];

describe('the page format', () => {
  it('accepts the minimal staged cell shape (kind, text, check, stage, concepts)', () => {
    const page = parsePage({
      id: 'demo', title: 'Demo',
      cells: [
        { kind: 'markdown', text: 'Read this first.', stage: 0, concepts: [] },
        { kind: 'code', text: 'n = 0', check: 'assert n == 3', stage: 1, concepts: ['len'] },
      ],
    });
    expect(page.cells.map((c) => [c.id, c.kind, c.stage])).toEqual([['cell-1', 'markdown', 0], ['cell-2', 'code', 1]]);
    expect(lastStage(page)).toBe(1);
  });

  it('fills defaults, and takes a single hint as the first of the hints', () => {
    const page = parsePage({ id: 'p', title: 'P', cells: [{ kind: 'code', id: 'a', text: 'x', hint: 'one', hints: ['two'] }] });
    const c = page.cells[0];
    expect(c.kind === 'code' && [c.hints, c.stage, c.concepts, c.readOnly]).toEqual([['one', 'two'], 0, [], false]);
    expect('hint' in c).toBe(false);
  });

  it('refuses duplicate cell ids, unknown kinds and an answer outside the choices', () => {
    expect(() => parsePage({ id: 'p', title: 'P', cells: [{ kind: 'markdown', id: 'a', text: '' }, { kind: 'markdown', id: 'a', text: '' }] })).toThrow(/two cells with the id "a"/);
    expect(() => parsePage({ id: 'p', title: 'P', cells: [{ kind: 'video', text: '' }] })).toThrow();
    expect(() => parsePage({ id: 'p', title: 'P', cells: [{ kind: 'choice', question: 'q', choices: ['a', 'b'], answer: 2 }] })).toThrow(/one of the choices/);
    expect(() => parsePage({ id: 'p', title: 'P', cells: [{ kind: 'markdown', text: 'x', check: 'assert 1' }] })).toThrow();
    expect(() => parsePage({ id: 'p', title: 'P', cells: [], colab: 'javascript:alert(1)' })).toThrow();
  });

  it('a page lists the names the host gives, and titles its stages', () => {
    const page = parsePage({ id: 'p', title: 'P', given: ['ciphertext'], stages: ['Moved, or changed?'], cells: [{ kind: 'markdown', id: 'a', text: 'x', stage: 1 }] });
    expect(page.given).toEqual(['ciphertext']);
    expect(stageTitle(page, 1)).toBe('Moved, or changed?');
    expect(stageTitle(page, 0)).toBeUndefined();
    expect(parsePage({ id: 'p', title: 'P', cells: [] }).given).toEqual([]);
    expect(() => parsePage({ id: 'p', title: 'P', stages: ['One'], cells: [{ kind: 'markdown', id: 'a', text: 'x', stage: 2 }] })).toThrow(/cell "a" is in stage 2, but `stages` names only 1/);
    expect(() => parsePage({ id: 'p', title: 'P', given: ['not a name'], cells: [] })).toThrow(/a Python name/);
  });

  it('the example pages are valid pages', () => {
    for (const name of ['first-steps', 'concept-for']) {
      expect(() => parsePage(JSON.parse(readFileSync(`example/pages/${name}.json`, 'utf8')))).not.toThrow();
    }
  });
});

describe('concepts', () => {
  it('tokenises Python, leaving strings and comments out', () => {
    expect(pythonTokens('for c in text.lower():  # len here is a comment\n    n = n % 26 // 2\nprint("for len", f"{n}")')).toEqual(
      ['for', 'c', 'in', 'text', '.lower', '(', ')', ':', 'n', '=', 'n', '%', '//', 'print', '(', ',', 'f"', ')'],
    );
  });

  it('finds the concepts a cell uses, in order of appearance, after the ones it lists', () => {
    expect(detectConcepts('total = len(s) % 26\nfor c in s: pass', library).map((c) => c.id)).toEqual(['len', 'modulo', 'for']);
    const cell = parsePage({ id: 'p', title: 'P', cells: [{ kind: 'code', text: 'for c in s.lower(): print(f"{c}")', concepts: ['len', 'nope'] }] }).cells[0];
    expect(cellConcepts(cell, library).map((c) => c.id)).toEqual(['len', 'for', 'lower', 'fstring']);
    expect(cellConcepts(cell, library, { detect: false }).map((c) => c.id)).toEqual(['len']);
  });
});

describe('PRIMM lessons', () => {
  const lesson: PrimmLesson = {
    id: 'shift', title: 'Shift a letter', intro: 'Letters are numbers in disguise.', learn: ['for', 'len'],
    predict: { question: 'What does this print?', code: 'print(len("ab"))', choices: ['1', '2'], answer: 1, explain: 'Two letters.' },
    run: { code: 'print(ord("A"))', note: 'Run it.' },
    investigate: { prompts: ['Try `ord("B")`.'] },
    modify: { task: 'Make `n` the code of B.', code: 'n = 0', check: 'assert n == 66', hint: 'ord("B")', solution: 'n = ord("B")' },
    make: { task: 'Make `m` the code of Z.', code: '', check: 'assert m == 90', solution: 'm = ord("Z")' },
    colab: 'https://colab.research.google.com/github/o/r/blob/main/n.ipynb',
  };

  it('become pages with the steps in order, checks hidden in code cells, and the learned concepts listed', () => {
    const page = parsePage(fromPrimmLesson(lesson));
    expect(page.cells.map((c) => `${c.kind}:${c.id}`)).toEqual([
      'markdown:intro', 'markdown:predict-heading', 'choice:predict', 'markdown:run-heading', 'code:run', 'markdown:investigate', 'code:modify', 'code:make',
    ]);
    const modify = page.cells.find((c) => c.id === 'modify');
    expect(modify?.kind === 'code' && [modify.check, modify.hints, modify.solution, modify.concepts]).toEqual(['assert n == 66', ['ord("B")'], 'n = ord("B")', ['for', 'len']]);
    expect(page.colab).toBe(lesson.colab);
    expect(lastStage(page)).toBe(0);
  });

  it('staged, open one PRIMM step at a time', () => {
    const page = parsePage(fromPrimmLesson(lesson, { staged: true }));
    expect(Object.fromEntries(page.cells.map((c) => [c.id, c.stage]))).toMatchObject({ predict: 0, run: 1, investigate: 2, modify: 3, make: 4 });
  });
});

describe('the notebook', () => {
  const page = parsePage({
    id: 'nb', title: 'Notebook',
    cells: [
      { kind: 'markdown', id: 'm', text: 'Hello\n\nWorld\n' },
      { kind: 'code', id: 'c:1', text: 'n = 0\n', task: 'Make n 3.', check: 'assert n == 3', hints: ['Three.'], solution: 'n = 3' },
      { kind: 'choice', id: 'q', question: 'Which?', choices: ['a', 'b'], answer: 0, stage: 2 },
    ],
  });

  it('is nbformat 4.5 with valid, unique cell ids and sources as lines', () => {
    const nb = toIpynb(page);
    expect([nb.nbformat, nb.nbformat_minor]).toEqual([4, 5]);
    const ids = nb.cells.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
    expect(nb.cells[1].source).toEqual(['Hello\n', '\n', 'World']);
  });

  it('keeps the check as a folded cell, hides the solution unless asked, and stops at a stage', () => {
    const nb = toIpynb(page, { stage: 1 });
    expect(nb.cells.map((c) => c.cell_type)).toEqual(['markdown', 'markdown', 'markdown', 'code', 'markdown', 'code']);
    const check = nb.cells[5];
    expect(check.metadata).toEqual({ cellView: 'form' });
    expect(check.source[0]).toMatch(/^#@title Check your answer/);
    expect(JSON.stringify(nb)).not.toContain('n = 3');
    expect(JSON.stringify(toIpynb(page, { solutions: true }))).toContain('n = 3');
    const given = toIpynb(page, { given: { ciphertext: 'KHOOR "Z"', keys: [1, null] } }).cells[1]!;
    expect(given.cell_type).toBe('code');
    expect(given.source.join('')).toBe('import json\nciphertext = "KHOOR \\"Z\\""\nkeys = json.loads("[1,null]")');
    expect(toIpynb(page).cells.some((c) => c.source.join('').includes('Which?'))).toBe(true);
  });

  it('builds a Colab address for a notebook on GitHub', () => {
    expect(colabUrl({ owner: 'o', repo: 'r', path: '/nb/x.ipynb' })).toBe('https://colab.research.google.com/github/o/r/blob/main/nb/x.ipynb');
  });
});

describe('the page model entry', () => {
  it('imports no DOM renderer, editor, markdown renderer or runtime (pyfiddle/page stays light)', async () => {
    const { readdirSync } = await import('node:fs');
    for (const f of readdirSync('src/page')) {
      const src = readFileSync(`src/page/${f}`, 'utf8');
      const imports = [...src.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
      expect(imports.filter((i) => !i.startsWith('./') && i !== 'zod'), f).toEqual([]);
    }
  });
});

describe('store keys', () => {
  it('round-trip, so a host store can map them onto its own shape', async () => {
    const { parseStoreKey, storeKeys } = await import('../src/page/store');
    expect(parseStoreKey(storeKeys.draft('lesson-1', 'make'))).toEqual({ page: 'lesson-1', cell: 'make', field: 'draft' });
    expect(parseStoreKey(storeKeys.released('lesson-1'))).toEqual({ page: 'lesson-1', field: 'released' });
    expect(parseStoreKey('something/else/entirely/x')).toBeUndefined();
  });
});
