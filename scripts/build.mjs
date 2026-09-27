import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

const watch = process.argv.includes('--watch');
const common = { bundle: true, sourcemap: true, logLevel: 'info' };

mkdirSync('dist/renderer', { recursive: true });
copyFileSync('src/index.html', 'dist/renderer/index.html');

const builds = [
  {
    ...common,
    entryPoints: ['electron/main.ts', 'electron/preload.ts'],
    outdir: 'dist/electron',
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron', '@lydell/node-pty'],
  },
  {
    ...common,
    entryPoints: ['src/main.ts'],
    outdir: 'dist/renderer',
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
  },
];

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}
