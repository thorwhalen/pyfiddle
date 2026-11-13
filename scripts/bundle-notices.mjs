/**
 * Writes dist/pyfiddle.iife.js.LICENSE.txt: the licence of every package bundled into the one-file
 * browser bundle (pyfiddle's runtime dependencies and theirs, Pyodide excepted: it is loaded at run
 * time from its own folder, with its own notice), each from the package's own LICENSE file.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Node's lookup, by hand (some packages do not export their package.json): the nearest node_modules/<name> up from `from`. */
const packageDir = (name, from) => {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
    if (dirname(dir) === dir) throw new Error(`cannot find ${name} from ${from}`);
  }
};
const root = JSON.parse(readFileSync('package.json', 'utf8'));
const seen = new Map();
const queue = Object.keys(root.dependencies).filter((d) => d !== 'pyodide').map((name) => [name, process.cwd()]);
while (queue.length) {
  const [name, from] = queue.shift();
  if (seen.has(name)) continue;
  const dir = packageDir(name, from);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
  if (!file) throw new Error(`${name}: no LICENSE file to reproduce`);
  seen.set(name, { version: pkg.version, license: pkg.license, text: readFileSync(join(dir, file), 'utf8').trim() });
  for (const dep of Object.keys(pkg.dependencies ?? {})) queue.push([dep, dir]);
}
const body = [...seen.entries()].sort(([a], [b]) => a.localeCompare(b))
  .map(([name, p]) => `${'='.repeat(80)}\n${name} ${p.version} (${p.license})\n${'='.repeat(80)}\n\n${p.text}\n`).join('\n');
const out = 'dist/pyfiddle.iife.js.LICENSE.txt';
if (!existsSync('dist')) throw new Error('build first');
writeFileSync(out, `pyfiddle.iife.js bundles pyfiddle (MIT, Copyright (c) 2026 Thor Whalen) and these packages:\n\n${body}`);
console.log(`${out}: ${[...seen.keys()].join(', ')}`);
