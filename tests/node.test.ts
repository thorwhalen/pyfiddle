import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { copyPyodide, licenceNotice, pyodideMeta, pyodidePython } from '../src/node';
import { PYODIDE_DIR, PYODIDE_FILES, PYODIDE_VERSION } from '../src/runtime/assets';

describe('self-hosting Pyodide', () => {
  it('the browser code and the copy step agree on the version, the files and their sizes', () => {
    const meta = pyodideMeta();
    expect(PYODIDE_VERSION).toBe(meta.version);
    expect(PYODIDE_FILES).toEqual(meta.files);
    expect(PYODIDE_DIR).toBe(`pyodide/v${meta.version}/`);
  });

  it('copies the core files and the licence notice to <site>/pyodide/v<version>/', () => {
    const site = mkdtempSync(join(tmpdir(), 'pyfiddle-'));
    const out = copyPyodide(site);
    expect(out).toBe(join(site, PYODIDE_DIR));
    for (const f of PYODIDE_FILES) expect(statSync(join(out, f.name)).size, f.name).toBe(f.bytes);
    const notice = readFileSync(join(out, 'LICENSES.txt'), 'utf8');
    expect(notice).toBe(licenceNotice());
  });

  it('the notice names this version and carries the three licences', () => {
    const notice = licenceNotice();
    expect(notice).toContain(`Pyodide ${PYODIDE_VERSION}`);
    expect(notice).toContain(`https://github.com/pyodide/pyodide/tree/${PYODIDE_VERSION}`);
    for (const l of ['Mozilla Public License Version 2.0', 'PYTHON SOFTWARE FOUNDATION LICENSE VERSION 2', 'MIT License', 'Licenses and Acknowledgements for Incorporated Software']) expect(notice).toContain(l);
    expect(notice).toContain(`CPython ${pyodidePython()}`);
    expect(notice).not.toMatch(/\{version\}/);
  });
});
