/** Writes the page format as JSON Schema (dist/page.schema.json), from the Zod schema, and copies the stylesheet. */
import { copyFileSync, writeFileSync } from 'node:fs';
import { z } from 'zod';
import { PageSchema } from '../dist/index.js';

const schema = z.toJSONSchema(PageSchema, { io: 'input', unrepresentable: 'any' });
writeFileSync('dist/page.schema.json', `${JSON.stringify({ title: 'pyfiddle page', ...schema }, null, 2)}\n`);
copyFileSync('src/styles.css', 'dist/styles.css');
