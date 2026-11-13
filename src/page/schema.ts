/**
 * The page format: the single source of truth for what a fiddle page is. Types, validation and the
 * published JSON Schema (`pyfiddle/page.schema.json`, for authors writing JSON, YAML or TOML) are
 * all derived from these Zod schemas.
 *
 * A page is an ordered list of cells. Every cell may carry:
 * - `stage`: the release step it belongs to (0, the default, is shown from the start; a teacher
 *   releases 1, 2, ... in order);
 * - `concepts`: ids of concept explainers (keywords, operators, functions) it uses, shown collapsed
 *   under the cell and linking to each concept's own page.
 *
 * The cell kinds: `markdown` (text), `code` (a runnable fiddle, with an optional hidden check,
 * hints revealed one at a time and a solution), and `choice` (a "what will this print?" question).
 */
import { z } from 'zod';

const id = z.string().regex(/^[A-Za-z0-9_.:-]+$/, 'letters, digits and _ . : - only');

const common = {
  /** Stable within the page: where a student's edits are kept. Default: the cell's position (`cell-3`). */
  id: id.optional(),
  /** The release step: 0 (default) is visible from the start. */
  stage: z.number().int().nonnegative().default(0),
  /** Concept ids this cell uses, listed under it. Concepts named in the code are found on their own too. */
  concepts: z.array(z.string()).default([]),
};

export const MarkdownCellSchema = z.object({
  kind: z.literal('markdown'),
  /** Markdown, rendered as given (authors' content is trusted; see the README on untrusted pages). */
  text: z.string(),
  ...common,
}).strict(); // a markdown cell has nothing to run: a `check` on one is an author's mistake, not something to drop silently

export const CodeCellSchema = z.object({
    kind: z.literal('code'),
    /** The starting code. */
    text: z.string(),
    /** What to do, in markdown, shown above the editor. */
    task: z.string().optional(),
    /** The editor's accessible name. Default: the task's first line, or "Python code". */
    label: z.string().optional(),
    /** Hidden Python run after the code in the same namespace (`_printed` holds what it printed); its first failed assert is the message. */
    check: z.string().optional(),
    /** Hints, revealed one at a time. */
    hints: z.array(z.string().min(1)).default([]),
    /** One hint (the same as `hints: [hint]`; merged into `hints` by `parsePage`). */
    hint: z.string().min(1).optional(),
    /** One way to do it, revealed on request (after the hints). */
    solution: z.string().optional(),
    /** Show the code only (a worked example that can still be run). */
    readOnly: z.boolean().default(false),
    ...common,
  });

export const ChoiceCellSchema = z
  .object({
    kind: z.literal('choice'),
    question: z.string().min(1),
    /** The code the question is about, shown read-only. */
    code: z.string().optional(),
    choices: z.array(z.string()).min(2),
    /** The index of the right choice. */
    answer: z.number().int().nonnegative(),
    /** Shown once an answer is picked. */
    explain: z.string().optional(),
    ...common,
  })
  .refine((c) => c.answer < c.choices.length, 'the answer must be one of the choices');

export const CellSchema = z.discriminatedUnion('kind', [MarkdownCellSchema, CodeCellSchema, ChoiceCellSchema]);

/**
 * A concept explainer: a keyword, operator, function or idea, with a short summary shown collapsed
 * under each cell that uses it, and a link to its own page (which has its own fiddles).
 */
export const ConceptSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  /** Markdown, a few lines. */
  summary: z.string().min(1),
  /** The concept's own page: a URL, or whatever the host's `conceptHref` turns into one. */
  href: z.string().optional(),
  /**
   * The tokens in a cell's code that mean this concept is used: keywords and names (`for`, `len`),
   * operators (`%`, `//`), methods (`.lower`). Default: the id itself. Empty: never detected, only listed.
   */
  match: z.array(z.string()).optional(),
});

export const PageSchema = z.object({
  id,
  title: z.string().min(1),
  cells: z.array(CellSchema),
  /** Concept explainers this page defines (merged over any library the host passes). */
  concepts: z.array(ConceptSchema).default([]),
  /**
   * Names every fiddle starts with, whose values the host supplies (`mountPage`'s `given`), never the
   * page: a round's ciphertext, say, so no page file holds it. Listing them here lets a page say
   * what it needs, and the renderer refuse to show it without them.
   */
  given: z.array(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'a Python name')).default([]),
  /**
   * A title per release stage: `stages[0]` names stage 1, and so on (stage 0, shown from the start,
   * has none). When given, every staged cell's stage must have a title.
   */
  stages: z.array(z.string().min(1)).optional(),
  /** The page as a notebook already published on GitHub, opened in Colab (`colabUrl` builds it). */
  colab: z.url({ protocol: /^https?$/ }).optional(),
});

export type MarkdownCell = z.infer<typeof MarkdownCellSchema>;
export type CodeCell = z.infer<typeof CodeCellSchema>;
export type ChoiceCell = z.infer<typeof ChoiceCellSchema>;
export type Cell = z.infer<typeof CellSchema>;
export type Concept = z.infer<typeof ConceptSchema>;
export type Page = z.infer<typeof PageSchema>;
/** What an author writes: defaults may be left out, and a single `hint` may stand for `hints`. */
export type PageInput = z.input<typeof PageSchema>;

/** A page with every cell given its id (`cell-<n>` by position unless the author named it). */
export type ResolvedCell = Cell & { id: string };
export type ResolvedPage = Omit<Page, 'cells'> & { cells: ResolvedCell[] };

/**
 * Validate and normalise a page (from JSON, YAML, TOML or code). Throws a ZodError naming the
 * offending path; cell ids must be unique.
 */
export function parsePage(input: unknown): ResolvedPage {
  const page = PageSchema.parse(input);
  const cells: ResolvedPage['cells'] = page.cells.map((c, i) => {
    const named = { ...c, id: c.id ?? `cell-${i + 1}` };
    if (named.kind !== 'code' || named.hint === undefined) return named;
    const { hint, ...rest } = named;
    return { ...rest, hints: [hint, ...rest.hints] };
  });
  const seen = new Set<string>();
  for (const c of cells) {
    if (seen.has(c.id)) throw new Error(`pyfiddle: page "${page.id}" has two cells with the id "${c.id}"`);
    seen.add(c.id);
    if (page.stages && c.stage > page.stages.length) {
      throw new Error(`pyfiddle: page "${page.id}" cell "${c.id}" is in stage ${c.stage}, but \`stages\` names only ${page.stages.length}`);
    }
  }
  return { ...page, cells };
}

/** A stage's title, when the page names its stages (stage 0 has none). */
export const stageTitle = (page: Pick<Page, 'stages'>, stage: number): string | undefined => (stage > 0 ? page.stages?.[stage - 1] : undefined);

/** The highest stage any cell is in (0 when the page is not staged). */
export const lastStage = (page: Pick<Page, 'cells'>) => page.cells.reduce((n, c) => Math.max(n, c.stage), 0);
