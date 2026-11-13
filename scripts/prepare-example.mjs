/** Puts the built bundle, the stylesheet and Pyodide next to the example page (none of them go in git). */
import { copyFileSync } from 'node:fs';
import { copyPyodide } from '../dist/node.js';

copyFileSync('dist/pyfiddle.iife.js', 'example/pyfiddle.iife.js');
copyFileSync('dist/styles.css', 'example/styles.css');
console.log(`example ready: ${copyPyodide('example')}`);
