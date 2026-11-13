/**
 * `pyfiddle/vite`: self-hosted Python for a Vite app. The dev server serves Pyodide's core files
 * from the installed package, and the build copies them (with their licence notice) to
 * `pyodide/v<version>/` in the output, which is where the runtime's default `selfHosted()` looks.
 * The files never go in git. It also writes the app's base into the page
 * (`<meta name="pyfiddle-base">`), so `selfHosted()` finds the files from any route.
 *
 *   // vite.config.ts
 *   import pyfiddle from 'pyfiddle/vite';
 *   export default { plugins: [pyfiddle()] };
 *
 * `copy: false` leaves them out of a build that downloads them on first use instead (a native app,
 * `pyfiddle/capacitor`). `crossOriginIsolation: true` sends COOP/COEP headers from the dev and
 * preview servers, so Stop can interrupt Python instead of restarting it (the production host must
 * send the same headers). They are set by a middleware that runs before Vite's static server, so
 * a 304 revalidation carries them too (WebKit refuses a worker otherwise).
 */
import { createReadStream, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { licenceNotice, NOTICE_NAME, pyodideDir, pyodideMeta } from './node';

type Next = (err?: unknown) => void;
type Req = { url?: string };
type Res = NodeJS.WritableStream & { setHeader(name: string, value: string): void; end(body?: string): void };
type Middlewares = { use(fn: (req: Req, res: Res, next: Next) => void): void };
type Server = { middlewares: Middlewares };
type EmitFile = (o: { type: 'asset'; fileName: string; source: Uint8Array | string }) => string;

const TYPES: Record<string, string> = { '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.zip': 'application/zip', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8' };

export type PyfiddlePluginOptions = { copy?: boolean; crossOriginIsolation?: boolean };

export default function pyfiddle({ copy = true, crossOriginIsolation = false }: PyfiddlePluginOptions = {}) {
  const meta = pyodideMeta();
  const dir = pyodideDir(meta.version);
  const names = new Set(meta.files.map((f) => f.name));
  let base = '/';

  const isolate = (server: Server) => {
    if (!crossOriginIsolation) return;
    server.middlewares.use((_req, res, next) => {
      res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
      res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
      next();
    });
  };

  return {
    name: 'pyfiddle',
    configResolved(config: { base: string }) {
      base = config.base.endsWith('/') ? config.base : `${config.base}/`;
    },
    /** Tells `selfHosted()` where the site's root is, so pages on any route find the files. */
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { name: 'pyfiddle-base', content: base }, injectTo: 'head' as const }];
    },
    configureServer(server: Server) {
      isolate(server);
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        const prefix = `${base}${dir}`;
        const name = path.startsWith(prefix) ? path.slice(prefix.length) : '';
        if (name === NOTICE_NAME) {
          res.setHeader('Content-Type', TYPES['.txt']);
          res.end(licenceNotice(meta));
          return;
        }
        if (!names.has(name)) return next();
        res.setHeader('Content-Type', TYPES[name.slice(name.lastIndexOf('.'))] ?? 'application/octet-stream');
        createReadStream(join(meta.dir, name)).pipe(res);
      });
    },
    configurePreviewServer(server: Server) {
      isolate(server);
    },
    generateBundle(this: { emitFile: EmitFile }) {
      if (!copy) return;
      for (const f of meta.files) this.emitFile({ type: 'asset', fileName: `${dir}${f.name}`, source: readFileSync(join(meta.dir, f.name)) });
      this.emitFile({ type: 'asset', fileName: `${dir}${NOTICE_NAME}`, source: licenceNotice(meta) });
    },
  };
}
