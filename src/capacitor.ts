/**
 * `pyfiddle/capacitor`: Python for a native app (Capacitor on Android or iOS) that leaves Pyodide out
 * of its package (about 13 MB): the first Run downloads it, natively and with progress, into the
 * app's own storage, and every later Run uses that copy, offline.
 *
 * Pass the result as the runtime's `indexURL`:
 *
 *   import { Capacitor } from '@capacitor/core';
 *   import { Directory, Filesystem } from '@capacitor/filesystem';
 *   import { FileTransfer } from '@capacitor/file-transfer';
 *   const runtime = createPythonRuntime({ indexURL: downloadOnFirstUse({
 *     source: 'https://example.org/app/pyodide/v<version>/',   // your own server: the web build's folder
 *     fs: capacitorFs({ Capacitor, Directory, Filesystem, FileTransfer }),
 *   }) });
 *
 * The plugins are passed in, so this package depends on none of them. A file counts only when its
 * size is exactly the one this Pyodide's file has: a static host that answers an unknown path with
 * the app's own page, or a download cut off half-way, is caught, and the next Run tries again.
 */
import { PYODIDE_BYTES, PYODIDE_DIR, PYODIDE_FILES, type IndexSource, type Progress } from './runtime/assets';

// extraction candidate: "download a pinned set of files once, size-checked, with progress" is not
// Python-specific (an offline media pack is the second consumer to look for, i2mint/zodal#115); only
// the defaults below are Pyodide's.

/** The few file operations the download needs: a seam, so tests and other native shells can provide them. */
export type DownloadFs = {
  /** The file's size in bytes, or undefined when it is not there. */
  size(path: string): Promise<number | undefined>;
  /** Download `url` to `path`, reporting bytes received so far. */
  download(url: string, path: string, onBytes: (n: number) => void): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  /** The folder as a URL the web view can load (ending in `/`). */
  folderUrl(path: string): Promise<string>;
};

export type DownloadOptions = {
  /** The folder to download from (ending in `/`): your own server's `pyodide/v<version>/`. No default: a children's app must never fall back to a third-party host. */
  source: string;
  fs: DownloadFs;
  /** The local folder. Default: `pyodide/v<version>` (a new version downloads afresh). */
  dir?: string;
  files?: readonly { name: string; bytes: number }[];
};

/**
 * An `indexURL` that downloads Pyodide once (with progress), then returns its local folder. A Run
 * while the download is under way (after a Stop, say) joins it instead of starting a second one.
 */
export function downloadOnFirstUse({ source, fs, dir = PYODIDE_DIR.replace(/\/$/, ''), files = PYODIDE_FILES }: DownloadOptions): IndexSource {
  if (!/^https:\/\//.test(source) && !/^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2)[:/]/.test(source)) {
    throw new Error(`pyfiddle: the Pyodide source must be an https URL (got "${source}")`);
  }
  const base = source.endsWith('/') ? source : `${source}/`;
  const total = files.reduce((n, f) => n + f.bytes, 0) || PYODIDE_BYTES;
  const listeners = new Set<(p: Progress) => void>();
  let inflight: Promise<string> | null = null;

  async function downloadOne({ name, bytes }: { name: string; bytes: number }, onBytes: (n: number) => void) {
    // Written under a temporary name and renamed once whole, so a half-written file never has the final name.
    const part = `${dir}/${name}.part`;
    let problem: string;
    try {
      await fs.download(`${base}${name}`, part, onBytes);
      if ((await fs.size(part)) === bytes) {
        await fs.remove(`${dir}/${name}`).catch(() => undefined); // a stale or broken copy
        await fs.rename(part, `${dir}/${name}`);
        return;
      }
      problem = 'the server sent something else';
    } catch (err) {
      problem = err instanceof Error ? err.message : String(err);
    }
    throw new Error(`could not download ${name} (${problem}). Check the connection and press Run again.`);
  }

  async function download(onProgress: (p: Progress) => void): Promise<string> {
    const have = await Promise.all(files.map(async (f) => (await fs.size(`${dir}/${f.name}`)) === f.bytes));
    if (have.includes(false)) {
      await fs.mkdir(dir).catch(() => undefined);
      let done = files.reduce((n, f, i) => n + (have[i] ? f.bytes : 0), 0);
      onProgress({ loaded: done, total });
      for (const [i, f] of files.entries()) {
        if (have[i]) continue;
        await downloadOne(f, (got) => onProgress({ loaded: done + Math.min(got, f.bytes), total }));
        done += f.bytes;
        onProgress({ loaded: done, total });
      }
    }
    const url = await fs.folderUrl(dir);
    return url.endsWith('/') ? url : `${url}/`;
  }

  return (onProgress) => {
    listeners.add(onProgress);
    inflight ??= download((p) => listeners.forEach((l) => l(p))).finally(() => {
      inflight = null;
      listeners.clear();
    });
    return inflight;
  };
}

/** The Capacitor plugins `capacitorFs` needs, typed loosely so this package does not depend on them. */
export type CapacitorPlugins = {
  Capacitor: { convertFileSrc: (uri: string) => string };
  Directory: { Data: unknown };
  Filesystem: {
    stat(o: { path: string; directory: unknown }): Promise<{ size: number }>;
    getUri(o: { path: string; directory: unknown }): Promise<{ uri: string }>;
    rename(o: { from: string; to: string; directory: unknown }): Promise<void>;
    deleteFile(o: { path: string; directory: unknown }): Promise<void>;
    mkdir(o: { path: string; directory: unknown; recursive: boolean }): Promise<void>;
  };
  FileTransfer: {
    downloadFile(o: { url: string; path: string; progress: boolean }): Promise<unknown>;
    addListener(event: 'progress', fn: (p: { type: string; url: string; bytes: number }) => void): Promise<{ remove: () => Promise<void> }>;
  };
};

/** `DownloadFs` over Capacitor's Filesystem and FileTransfer plugins, in the app's data directory. */
export function capacitorFs({ Capacitor, Directory, Filesystem, FileTransfer }: CapacitorPlugins): DownloadFs {
  const directory = Directory.Data;
  return {
    size: (path) => Filesystem.stat({ path, directory }).then((s) => s.size, () => undefined),
    async download(url, path, onBytes) {
      const { uri } = await Filesystem.getUri({ path, directory });
      const listener = await FileTransfer.addListener('progress', (p) => {
        if (p.type === 'download' && p.url === url) onBytes(p.bytes);
      });
      try {
        await FileTransfer.downloadFile({ url, path: uri, progress: true });
      } finally {
        await listener.remove();
      }
    },
    rename: (from, to) => Filesystem.rename({ from, to, directory }),
    remove: (path) => Filesystem.deleteFile({ path, directory }),
    mkdir: (path) => Filesystem.mkdir({ path, directory, recursive: true }),
    folderUrl: async (path) => `${Capacitor.convertFileSrc((await Filesystem.getUri({ path, directory })).uri)}/`,
  };
}
