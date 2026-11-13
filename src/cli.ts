/**
 * The `pyfiddle` command.
 *
 *   pyfiddle pyodide <siteDir>                 copy Pyodide's core files (and notice) to <siteDir>/pyodide/v<version>/
 *   pyfiddle notebook <page.json> [out.ipynb]  write a page as a notebook (checks included; --solutions adds them)
 *   pyfiddle version                           the Pyodide version this pyfiddle runs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { copyPyodide, pyodideMeta } from './node';
import { ipynbText, parsePage } from './page/index';

const USAGE = `usage:
  pyfiddle pyodide <siteDir>                 copy Pyodide's files to <siteDir>/pyodide/v<version>/
  pyfiddle notebook <page.json> [out.ipynb]  write a page as a notebook (--solutions to include them)
  pyfiddle version                           the Pyodide version this pyfiddle runs`;

function main(argv: string[]): number {
  const flags = new Set(argv.filter((a) => a.startsWith('--')));
  const [command, ...args] = argv.filter((a) => !a.startsWith('--'));
  if (command === 'pyodide' && args[0]) {
    console.log(`copied Pyodide ${pyodideMeta().version} to ${copyPyodide(args[0])}`);
    return 0;
  }
  if (command === 'notebook' && args[0]) {
    const page = parsePage(JSON.parse(readFileSync(args[0], 'utf8')));
    const text = ipynbText(page, { solutions: flags.has('--solutions') });
    if (args[1]) writeFileSync(args[1], text);
    else process.stdout.write(text);
    return 0;
  }
  if (command === 'version') {
    console.log(pyodideMeta().version);
    return 0;
  }
  console.error(USAGE);
  return command === undefined || command === 'help' || flags.has('--help') ? 0 : 2;
}

process.exitCode = main(process.argv.slice(2));
