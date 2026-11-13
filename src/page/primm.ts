/**
 * Lessons in the PRIMM shape (Predict, Run, Investigate, Modify, Make) as pages. A lesson written
 * as one object with a field per step becomes an ordered list of cells, so a host moving onto
 * pyfiddle keeps its lesson files as they are.
 *
 * With `staged: true` each PRIMM step is its own release stage (Predict 0, Run 1, Investigate 2,
 * Modify 3, Make 4), so a teacher can open a lesson one step at a time and a student predicts before
 * running.
 */
import type { PageInput } from './schema';

/** A task with a starter, a hidden check and one way to do it. */
export type PrimmTask = { task: string; code: string; check?: string; hint?: string; hints?: string[]; solution?: string };

export type PrimmLesson = {
  id: string;
  title: string;
  /** Markdown, before the steps. */
  intro?: string;
  /** Free-text concept ids; the ones the concept library defines become each cell's explicit concepts. */
  learn?: string[];
  predict?: { question: string; code: string; choices: string[]; answer: number; explain?: string };
  run?: { code: string; note?: string };
  investigate?: { prompts: string[] };
  modify?: PrimmTask;
  make?: PrimmTask;
  colab?: string;
};

export type PrimmOptions = {
  /** One release stage per PRIMM step. Default false (everything visible). */
  staged?: boolean;
  /** Headings for the steps, in the page's language. */
  headings?: Partial<Record<'predict' | 'run' | 'investigate' | 'modify' | 'make', string>>;
};

const HEADINGS = { predict: 'Predict', run: 'Run', investigate: 'Investigate', modify: 'Modify', make: 'Make' };

export function fromPrimmLesson(lesson: PrimmLesson, { staged = false, headings = {} }: PrimmOptions = {}): PageInput {
  const h = { ...HEADINGS, ...headings };
  const stage = (n: number) => (staged ? n : 0);
  const cells: PageInput['cells'] = [];
  if (lesson.intro) cells.push({ kind: 'markdown', id: 'intro', text: lesson.intro });
  if (lesson.predict) {
    const p = lesson.predict;
    cells.push({ kind: 'markdown', id: 'predict-heading', text: `### ${h.predict}` });
    cells.push({ kind: 'choice', id: 'predict', question: p.question, code: p.code, choices: p.choices, answer: p.answer, explain: p.explain });
  }
  if (lesson.run) {
    cells.push({ kind: 'markdown', id: 'run-heading', stage: stage(1), text: `### ${h.run}${lesson.run.note ? `\n\n${lesson.run.note}` : ''}` });
    cells.push({ kind: 'code', id: 'run', stage: stage(1), text: lesson.run.code, label: `${h.run}: ${lesson.title}` });
  }
  if (lesson.investigate) {
    cells.push({ kind: 'markdown', id: 'investigate', stage: stage(2), text: `### ${h.investigate}\n\n${lesson.investigate.prompts.map((p) => `- ${p}`).join('\n')}` });
  }
  ([['modify', 3], ['make', 4]] as const).forEach(([step, n]) => {
    const t = lesson[step];
    if (!t) return;
    cells.push({
      kind: 'code', id: step, stage: stage(n), text: t.code, task: `### ${h[step]}\n\n${t.task}`, label: `${h[step]}: ${t.task.split('\n')[0]}`,
      check: t.check, hints: [...(t.hint ? [t.hint] : []), ...(t.hints ?? [])], solution: t.solution,
    });
  });
  if (lesson.learn?.length) for (const c of cells) if (c.kind !== 'markdown') c.concepts = [...lesson.learn];
  return { id: lesson.id, title: lesson.title, cells, ...(lesson.colab ? { colab: lesson.colab } : {}) };
}
