/**
 * A static server for the example and the e2e tests: `node scripts/serve.mjs <dir> [port] [--isolated]`.
 * `--isolated` sends COOP/COEP, so Stop interrupts Python instead of restarting the worker.
 */
import { createReadStream, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';

const args = process.argv.slice(2);
const isolated = args.includes('--isolated');
const [root = 'example', port = '4173'] = args.filter((a) => !a.startsWith('--'));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.wasm': 'application/wasm', '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8' };

createServer((req, res) => {
  const path = normalize(decodeURIComponent((req.url ?? '/').split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  let file = join(root, path);
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    statSync(file);
  } catch {
    res.writeHead(404).end('not found');
    return;
  }
  const headers = { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' };
  if (isolated) Object.assign(headers, { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' });
  res.writeHead(200, headers);
  createReadStream(file).pipe(res);
}).listen(Number(port), () => console.log(`serving ${root} on http://localhost:${port}${isolated ? ' (cross-origin isolated)' : ''}`));
