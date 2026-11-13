/**
 * A page as a Jupyter notebook (nbformat 4.5), to download or to publish on GitHub and open in
 * Google Colab. Markdown cells stay markdown; a code cell becomes its task (markdown), its code, and
 * its check as a separate cell titled "Check your answer" (folded away in Colab with `cellView:
 * form`) that prints the verdict the page would show. Hints and, on request, solutions go in folded
 * `<details>` blocks; a choice cell becomes its question, its code and its choices, with the answer
 * folded.
 */
import type { ResolvedPage } from './schema';

type NbCell =
  | { cell_type: 'markdown'; id: string; metadata: Record<string, unknown>; source: string[] }
  | { cell_type: 'code'; id: string; metadata: Record<string, unknown>; source: string[]; execution_count: null; outputs: [] };

export type Notebook = {
  nbformat: 4;
  nbformat_minor: 5;
  metadata: Record<string, unknown>;
  cells: NbCell[];
};

export type IpynbOptions = {
  /** Include cells up to this release stage. Default: all of them. */
  stage?: number;
  /** Include each code cell's solution, folded. Default false. */
  solutions?: boolean;
  /** Include the hidden checks as runnable cells. Default true. */
  checks?: boolean;
  /** How many of a cell's hints to include. Default: all (a student's own download passes the ones they revealed). */
  hints?: (cellId: string) => number;
};

/** Jupyter keeps a cell's source as a list of lines, each but the last ending with its newline. */
const lines = (s: string) => {
  const parts = s.replace(/\n+$/, '').split('\n');
  return parts.map((l, i) => (i < parts.length - 1 ? `${l}\n` : l));
};
const fence = (code: string) => `\`\`\`python\n${code.replace(/\n+$/, '')}\n\`\`\``;
const details = (summary: string, body: string) => `<details><summary>${summary}</summary>\n\n${body}\n\n</details>`;
const indent = (code: string) => code.replace(/\n+$/, '').split('\n').map((l) => `    ${l}`).join('\n');

/**
 * The check as a cell a student runs right after their code: prints the verdict instead of a
 * traceback. A check that reads `_printed` gets it by running the cell above again with its output
 * captured (IPython's `In`; empty outside IPython).
 */
export const checkCell = (check: string) => `#@title Check your answer (run me right after the cell above)
${/\b_printed\b/.test(check) ? `import contextlib as _cl, io as _io
_buf = _io.StringIO()
try:
    with _cl.redirect_stdout(_buf):
        exec(In[-2])
except NameError:
    pass
_printed = _buf.getvalue()
` : ''}try:
${indent(check)}
    _ok = True
except AssertionError as _e:
    _ok = False
    print("Not yet.", _e if str(_e) else "The check did not pass.")
except NameError as _e:
    _ok = False
    print("Not yet. The check looks for", repr(getattr(_e, "name", None) or _e), "and your code has not made it yet.")
if _ok:
    print("\\u2713 Check passed.")`;

export function toIpynb(page: ResolvedPage, { stage = Infinity, solutions = false, checks = true, hints }: IpynbOptions = {}): Notebook {
  const cells: NbCell[] = [];
  // nbformat 4.5 cell ids: 1-64 characters of [A-Za-z0-9-_], unique in the notebook.
  const used = new Set<string>();
  const nbId = (raw: string) => {
    const base = raw.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 56) || 'cell';
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return id;
  };
  const md = (id: string, text: string) => cells.push({ cell_type: 'markdown', id: nbId(id), metadata: {}, source: lines(text) });
  const code = (id: string, text: string, metadata: Record<string, unknown> = {}) =>
    cells.push({ cell_type: 'code', id: nbId(id), metadata, source: lines(text), execution_count: null, outputs: [] });

  md('title', `# ${page.title}`);
  for (const c of page.cells) {
    if (c.stage > stage) continue;
    if (c.kind === 'markdown') md(c.id, c.text);
    else if (c.kind === 'choice') {
      const body = [c.question, ...(c.code ? [fence(c.code)] : []), c.choices.map((x, i) => `${i + 1}. ${x}`).join('\n'),
        details('Answer', `${c.answer + 1}. ${c.choices[c.answer]}${c.explain ? `\n\n${c.explain}` : ''}`)];
      md(c.id, body.join('\n\n'));
    } else {
      if (c.task) md(`${c.id}-task`, c.task);
      code(c.id, c.text);
      const extra = [
        ...c.hints.slice(0, hints ? hints(c.id) : c.hints.length).map((h, i) => details(c.hints.length > 1 ? `Hint ${i + 1}` : 'Hint', h)),
        ...(solutions && c.solution ? [details('One way to do it', fence(c.solution))] : []),
      ];
      if (extra.length) md(`${c.id}-help`, extra.join('\n\n'));
      if (checks && c.check) code(`${c.id}-check`, checkCell(c.check), { cellView: 'form' });
    }
  }
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: { name: 'python3', display_name: 'Python 3', language: 'python' },
      language_info: { name: 'python' },
      colab: { provenance: [] },
    },
    cells,
  };
}

/** The notebook as the text of an `.ipynb` file. */
export const ipynbText = (page: ResolvedPage, options?: IpynbOptions) => `${JSON.stringify(toIpynb(page, options), null, 1)}\n`;

/** The Colab address of a notebook published on GitHub. */
export const colabUrl = ({ owner, repo, path, branch = 'main' }: { owner: string; repo: string; path: string; branch?: string }) =>
  `https://colab.research.google.com/github/${owner}/${repo}/blob/${branch}/${path.replace(/^\//, '')}`;
