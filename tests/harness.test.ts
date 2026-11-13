/**
 * The harness under real CPython: Pyodide, loaded in Node from the pinned package, running the very
 * Python the worker installs. What a student sees (tracebacks, check messages) is decided here.
 */
import { loadPyodide, type PyodideInterface } from 'pyodide';
import { beforeAll, describe, expect, it } from 'vitest';
import { INSTALL_HARNESS } from '../src/runtime/harness';
import { checkCell } from '../src/page/ipynb';
import { pyodideMeta } from '../src/node';

let py: PyodideInterface;
let out = '';
type Run = (code: string, check: string) => { toJs: () => [string, string, string, boolean]; destroy: () => void };
let harness: Run;

const run = (code: string, check = '') => {
  out = '';
  const r = harness(code, check);
  const [error, status, message, interrupted] = r.toJs();
  r.destroy();
  return { error, status, message, interrupted, out };
};

beforeAll(async () => {
  py = await loadPyodide({ indexURL: `${pyodideMeta().dir}/` });
  py.setStdout({ batched: (s: string) => { out += `${s}\n`; } });
  await py.runPythonAsync(INSTALL_HARNESS);
  harness = py.pyimport('_pyfiddle').run as unknown as Run;
}, 120_000);

describe('the harness, under CPython', () => {
  it('runs the code and lets its output through', () => {
    expect(run('print(2 + 3)')).toMatchObject({ error: '', status: '', out: '5\n' });
  });

  it('gives every run a fresh namespace', () => {
    run('x = 1');
    expect(run('print(x)').error).toMatch(/NameError: name 'x' is not defined/);
  });

  it('cuts the traceback to the cell’s own lines, and quotes them', () => {
    const { error } = run('def f():\n    return 1 / 0\nf()');
    expect(error).toMatch(/File "cell", line 3/);
    expect(error).toMatch(/return 1 \/ 0/);
    expect(error).toMatch(/ZeroDivisionError/);
    expect(error).not.toMatch(/_pyfiddle|_core|exec/);
  });

  it('reports a syntax error without a traceback', () => {
    expect(run('print("a"').error).toMatch(/SyntaxError/);
  });

  it('runs the check in the code’s namespace; its first failed assert is the message', () => {
    expect(run('n = 4', 'assert n == 4').status).toBe('passed');
    expect(run('n = 3', 'assert n == 4, "n should be 4"')).toMatchObject({ status: 'failed', message: 'n should be 4' });
  });

  it('says plainly when the check looks for a name the code has not made', () => {
    expect(run('m = 1', 'assert n == 4').message).toBe('The check looks for `n`, and your code has not made it yet.');
  });

  it('lets the check read what the code printed (`_printed`)', () => {
    expect(run('print("HELLO")', 'assert "HELLO" in _printed').status).toBe('passed');
    expect(run('print("hi")', 'assert "HELLO" in _printed, "print HELLO"').message).toBe('print HELLO');
  });

  it('puts the builtins and the recursion limit back after every run', () => {
    run('import builtins, sys\nbuiltins.len = None\nsys.setrecursionlimit(50)');
    expect(run('print(len("abc"))').out).toBe('3\n');
    expect(run('import sys\nprint(sys.getrecursionlimit() > 50)').out).toBe('True\n');
  });

  it('forgets the modules a cell imported, so a changed module does not leak into the next cell', () => {
    run('import fractions\nfractions.Fraction = None');
    expect(run('import fractions\nprint(fractions.Fraction(1, 2))').out).toBe('1/2\n');
  });

  it('explains that input() does not work in a page', () => {
    expect(run('input("name? ")').error).toMatch(/input\(\) does not work here/);
  });

  it('treats exit() as the end of the program, not an error', () => {
    expect(run('print(1)\nraise SystemExit').error).toBe('');
  });

  it('the notebook’s check cell prints the same verdicts', async () => {
    const verdict = async (code: string, check: string) => {
      out = '';
      await py.runPythonAsync(`${code}\n${checkCell(check).replace(/^#@title.*\n/, '')}`, { globals: py.toPy({}) });
      return out.trim();
    };
    expect(await verdict('n = 4', 'assert n == 4')).toBe('✓ Check passed.');
    expect(await verdict('n = 3', 'assert n == 4, "n should be 4"')).toBe('Not yet. n should be 4');
    expect(await verdict('m = 1', 'assert zz == 4')).toMatch(/^Not yet\. The check looks for 'zz'/);
    // A check on what was printed re-runs the cell above (IPython's In) with its output captured.
    const printed = async (code: string) => {
      out = '';
      const g = py.toPy({ In: ['', code, 'check'] });
      await py.runPythonAsync(code, { globals: g });
      out = '';
      await py.runPythonAsync(checkCell('assert "HELLO" in _printed, "print HELLO"').replace(/^#@title.*\n/, ''), { globals: g });
      return out.trim();
    };
    expect(await printed('print("HELLO")')).toBe('✓ Check passed.');
    expect(await printed('print("hi")')).toBe('Not yet. print HELLO');
  });
});
