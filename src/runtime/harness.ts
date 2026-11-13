/**
 * The Python side of a run, as source text: installed once per interpreter as a private module
 * (`_pyfiddle`), so a cell's program cannot reach it by accident.
 *
 * `run(code, check)` runs the code in a fresh namespace under the file name "cell", so a traceback
 * names the cell's lines and nothing of ours; then the check, in the same namespace, with
 * `_printed` holding everything the code printed. Every run starts from the same builtins and
 * recursion limit, so one cell's experiment (`len = ...`, `builtins.len = ...`) never leaks into
 * the next, and the modules a cell imported are imported afresh by the next one. Returns (traceback or "", check status, check message, interrupted).
 *
 * It is plain Python, so the tests run it under real CPython (Pyodide in Node) as well.
 */
export const HARNESS = `
import builtins, io, linecache, sys, traceback

def _no_input(prompt=""):
    raise RuntimeError("input() does not work here: put the text in a variable instead.")

builtins.input = _no_input
_BUILTINS = dict(builtins.__dict__)
_LIMIT = sys.getrecursionlimit()

class _Tee:
    """Passes writes through to the real stream and keeps a copy for the check."""
    def __init__(self, stream):
        self._stream = stream
        self.copy = io.StringIO()
    def write(self, s):
        self.copy.write(s)
        return self._stream.write(s)
    def flush(self):
        self._stream.flush()
    def __getattr__(self, name):
        return getattr(self._stream, name)

def _source(name, code):
    # So a traceback can quote the cell's line.
    linecache.cache[name] = (len(code), None, code.splitlines(True), name)

def _tb(e):
    tb = e.__traceback__
    while tb is not None and tb.tb_frame.f_code.co_filename != "cell":
        tb = tb.tb_next
    return "".join(traceback.format_exception(type(e), e, tb)) if tb is not None else "".join(traceback.format_exception_only(type(e), e))

def _core(code, check, tee):
    ns = {"__name__": "__main__"}
    _source("cell", code)
    try:
        exec(compile(code, "cell", "exec"), ns)
    except KeyboardInterrupt:
        return ("", "", "", True)
    except SystemExit:
        pass
    except SyntaxError as e:
        return ("".join(traceback.format_exception_only(type(e), e)), "", "", False)
    except BaseException as e:
        return (_tb(e), "", "", False)
    if not check:
        return ("", "", "", False)
    sys.stdout.flush()
    ns["_printed"] = tee.copy.getvalue()
    try:
        exec(compile(check, "check", "exec"), ns)
    except KeyboardInterrupt:
        return ("", "", "", True)
    except AssertionError as e:
        return ("", "failed", str(e) or "Not yet: the check did not pass.", False)
    except NameError as e:
        name = getattr(e, "name", None)
        return ("", "failed", f"The check looks for \`{name}\`, and your code has not made it yet." if name else str(e), False)
    except BaseException as e:
        return ("", "failed", f"{type(e).__name__}: {e}", False)
    return ("", "passed", "", False)

def run(code, check):
    modules = set(sys.modules)
    real = sys.stdout
    tee = _Tee(real)
    sys.stdout = tee
    try:
        return _core(code, check, tee)
    finally:
        sys.stdout = real
        sys.stdout.flush()
        sys.stderr.flush()
        builtins.__dict__.clear()
        builtins.__dict__.update(_BUILTINS)
        sys.setrecursionlimit(_LIMIT)
        # Modules a cell imported (or made up) are forgotten, so the next cell imports them afresh.
        for name in set(sys.modules) - modules:
            del sys.modules[name]
`;

/** The Python that installs the harness as the private module `_pyfiddle`. */
export const INSTALL_HARNESS = `import sys, types\n_m = types.ModuleType("_pyfiddle")\nexec(${JSON.stringify(HARNESS)}, _m.__dict__)\nsys.modules["_pyfiddle"] = _m\ndel _m, types`;
