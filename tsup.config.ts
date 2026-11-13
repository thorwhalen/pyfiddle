import { defineConfig } from 'tsup';
import { pyodideDefines } from './src/node';

const define = pyodideDefines();

export default defineConfig([
  {
    entry: { index: 'src/index.ts', runtime: 'src/runtime/index.ts', page: 'src/page/index.ts', react: 'src/react.tsx', capacitor: 'src/capacitor.ts' },
    format: ['esm'],
    dts: true,
    sourcemap: true,
    target: 'es2022',
    define,
    external: ['react'],
  },
  {
    entry: { vite: 'src/vite.ts', node: 'src/node.ts', cli: 'src/cli.ts' },
    format: ['esm'],
    dts: { entry: { vite: 'src/vite.ts', node: 'src/node.ts' } },
    platform: 'node',
    target: 'node20',
    banner: { js: '#!/usr/bin/env node' },
  },
  {
    entry: { 'pyfiddle.iife': 'src/iife.ts' },
    format: ['iife'],
    globalName: 'pyfiddle',
    minify: true,
    banner: { js: '/*! pyfiddle (MIT). Bundles CodeMirror, Lezer, marked, zod and their dependencies: see pyfiddle.iife.js.LICENSE.txt */' },
    target: 'es2022',
    define,
    outExtension: () => ({ js: '.js' }),
  },
]);
