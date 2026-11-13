/**
 * Concept explainers: which keywords, operators and functions a cell uses. A cell lists its
 * concepts explicitly (`concepts: [...]`), and the ones its code names are found on their own:
 * the code is tokenised (strings and comments left out), and each concept's `match` tokens are
 * looked for. Detection only ever finds concepts the library defines, so a page shows explainers
 * for what its author wrote up and nothing else.
 */
import type { Cell, Concept } from './schema';

/** Longest first, so `//` is one token rather than two `/`. */
const OPERATORS = ['**=', '//=', '>>=', '<<=', '->', ':=', '**', '//', '==', '!=', '<=', '>=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<', '>>',
  '+', '-', '*', '/', '%', '@', '<', '>', '=', '&', '|', '^', '~', '[', ']', '(', ')', '{', '}', ':', ',', '.'];

/**
 * The tokens of some Python code: names and keywords (`for`, `len`), attribute names prefixed with
 * a dot (`.lower`), and operators. String literals and comments are dropped, except that an
 * f-string yields the token `f"`; numbers are dropped.
 */
export function pythonTokens(code: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  let afterDot = false;
  while (i < code.length) {
    const ch = code[i];
    if (ch === '#') {
      while (i < code.length && code[i] !== '\n') i++;
      continue;
    }
    const str = /^([rRbBuUfF]{0,2})('''|"""|'|")/.exec(code.slice(i, i + 5));
    if (str && (str[1] === '' || /[A-Za-z_0-9]/.test(code[i - 1] ?? '') === false)) {
      const [whole, prefix, quote] = str;
      if (/f/i.test(prefix)) tokens.push('f"');
      i += whole.length;
      while (i < code.length && !code.startsWith(quote, i)) i += code[i] === '\\' ? 2 : 1;
      i += quote.length;
      afterDot = false;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z_0-9]*/.exec(code.slice(i));
    if (name) {
      tokens.push(afterDot ? `.${name[0]}` : name[0]);
      i += name[0].length;
      afterDot = false;
      continue;
    }
    const num = /^\d[\d_]*(\.\d*)?([eE][+-]?\d+)?j?/.exec(code.slice(i));
    if (num) {
      i += num[0].length;
      afterDot = false;
      continue;
    }
    const op = OPERATORS.find((o) => code.startsWith(o, i));
    if (op) {
      if (op === '.') afterDot = true;
      else {
        tokens.push(op);
        afterDot = false;
      }
      i += op.length;
      continue;
    }
    i++;
  }
  return tokens;
}

/** The concepts a piece of code uses, in the order they first appear. */
export function detectConcepts(code: string, library: readonly Concept[]): Concept[] {
  const tokens = pythonTokens(code);
  const first = new Map<Concept, number>();
  for (const c of library) {
    const match = c.match ?? [c.id];
    const at = tokens.findIndex((t) => match.includes(t));
    if (at >= 0) first.set(c, at);
  }
  return [...first.entries()].sort((a, b) => a[1] - b[1]).map(([c]) => c);
}

/** A cell's concepts: the ones it lists (in its order), then the ones its code uses. Unknown ids are skipped. */
export function cellConcepts(cell: Cell, library: readonly Concept[], { detect = true }: { detect?: boolean } = {}): Concept[] {
  const byId = new Map(library.map((c) => [c.id, c]));
  const listed = cell.concepts.map((id) => byId.get(id)).filter((c): c is Concept => !!c);
  const code = cell.kind === 'code' ? cell.text : cell.kind === 'choice' ? (cell.code ?? '') : '';
  const found = detect && code ? detectConcepts(code, library) : [];
  return [...new Set([...listed, ...found])];
}

/** Merge concept libraries: later ones override earlier ones by id. */
export const mergeConcepts = (...libraries: (readonly Concept[] | undefined)[]): Concept[] => [
  ...new Map(libraries.flatMap((l) => l ?? []).map((c) => [c.id, c])).values(),
];
