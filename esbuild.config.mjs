import { build } from 'esbuild';

await build({
  entryPoints: ['src/run.ts'],
  bundle: true,
  minify: false,
  charset: 'utf8',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['jsdom'],
  outfile: 'dist/digest-bot.cjs',
  logLevel: 'info',
  banner: { js: '#!/usr/bin/env node' },
});
