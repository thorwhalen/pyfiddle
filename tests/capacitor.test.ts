import { describe, expect, it } from 'vitest';
import { downloadOnFirstUse, type DownloadFs } from '../src/capacitor';

const FILES = [{ name: 'a.mjs', bytes: 3 }, { name: 'b.wasm', bytes: 5 }];

/** A file system in memory; `serve` says what the server sends for each file name. */
function memoryFs(serve: Record<string, string>) {
  const files = new Map<string, string>();
  const downloads: string[] = [];
  const fs: DownloadFs = {
    size: async (p) => files.get(p)?.length,
    async download(url, path, onBytes) {
      downloads.push(url);
      const body = serve[url.split('/').pop()!];
      if (body === undefined) throw new Error('404');
      onBytes(body.length);
      files.set(path, body);
    },
    rename: async (from, to) => {
      files.set(to, files.get(from)!);
      files.delete(from);
    },
    remove: async (p) => {
      files.delete(p);
    },
    mkdir: async () => {},
    folderUrl: async (p) => `capacitor://localhost/_capacitor_file_/data/${p}`,
  };
  return { fs, files, downloads };
}

describe('the first-use download', () => {
  it('downloads every file once, with progress, then works offline', async () => {
    const m = memoryFs({ 'a.mjs': 'abc', 'b.wasm': '12345' });
    const source = downloadOnFirstUse({ source: 'https://example.org/py/', fs: m.fs, files: FILES, dir: 'py' });
    const seen: number[] = [];
    expect(await source((p) => seen.push(p.loaded))).toBe('capacitor://localhost/_capacitor_file_/data/py/');
    expect(seen.at(-1)).toBe(8);
    expect([...m.files.keys()].sort()).toEqual(['py/a.mjs', 'py/b.wasm']);
    await source(() => {});
    expect(m.downloads).toHaveLength(2);
  });

  it('refuses a file of the wrong size (a host answering with its own page), and tries again next time', async () => {
    const m = memoryFs({ 'a.mjs': 'abc', 'b.wasm': '<html>' });
    const source = downloadOnFirstUse({ source: 'https://example.org/py', fs: m.fs, files: FILES, dir: 'py' });
    await expect(source(() => {})).rejects.toThrow(/could not download b\.wasm \(the server sent something else\)/);
    expect(m.files.has('py/b.wasm')).toBe(false);
    expect(m.downloads[0]).toBe('https://example.org/py/a.mjs');
  });

  it('a second Run during the download joins it', async () => {
    const m = memoryFs({ 'a.mjs': 'abc', 'b.wasm': '12345' });
    const source = downloadOnFirstUse({ source: 'https://example.org/py/', fs: m.fs, files: FILES, dir: 'py' });
    const [a, b] = await Promise.all([source(() => {}), source(() => {})]);
    expect(a).toBe(b);
    expect(m.downloads).toHaveLength(2);
  });

  it('only from https (or a local test server)', () => {
    const { fs } = memoryFs({});
    expect(() => downloadOnFirstUse({ source: 'http://example.org/py/', fs })).toThrow(/https/);
    expect(() => downloadOnFirstUse({ source: 'http://10.0.2.2:5173/py/', fs })).not.toThrow();
  });
});
