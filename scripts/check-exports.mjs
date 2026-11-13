/** Fails the build when a path package.json promises (exports, types, bin) is missing from dist. */
import { existsSync, readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const targets = new Set([pkg.main, pkg.types, ...Object.values(pkg.bin ?? {})]);
const walk = (v) => (typeof v === 'string' ? targets.add(v) : Object.values(v).forEach(walk));
walk(pkg.exports);
const missing = [...targets].filter((t) => !existsSync(t));
if (missing.length) {
  console.error(`missing from the build: ${missing.join(', ')}`);
  process.exit(1);
}
console.log(`all ${targets.size} package.json targets exist`);
