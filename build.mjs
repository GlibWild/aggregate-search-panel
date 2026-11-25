import * as esbuild from 'esbuild';
import { cp, mkdir, rm, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = resolve(root, 'dist');
const watch = process.argv.includes('--watch');

const shared = {
  bundle: true,
  platform: 'browser',
  target: ['chrome116'],
  logLevel: 'info',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
};

async function copyStatic() {
  await mkdir(dist, { recursive: true });
  await cp(resolve(root, 'public'), dist, { recursive: true });
}

async function buildEntrypoints() {
  await esbuild.build({
    ...shared,
    entryPoints: [resolve(root, 'src/background/index.ts')],
    outfile: resolve(dist, 'background.js'),
    format: 'iife',
  });

  await esbuild.build({
    ...shared,
    entryPoints: [resolve(root, 'src/offscreen/offscreen.ts')],
    outfile: resolve(dist, 'offscreen.js'),
    format: 'iife',
  });

  await esbuild.build({
    ...shared,
    entryPoints: [resolve(root, 'src/sidepanel/main.tsx')],
    outdir: resolve(dist, 'sidepanel'),
    entryNames: 'main',
    assetNames: '[name]',
    format: 'iife',
    jsx: 'automatic',
    loader: { '.css': 'css' },
  });
}

async function run() {
  await rm(dist, { recursive: true, force: true });
  await copyStatic();
  await buildEntrypoints();
  const manifest = await stat(resolve(dist, 'manifest.json'));
  console.log(`构建完成：${dist}（manifest ${manifest.size} bytes）`);
}

if (watch) {
  await copyStatic();
  const contexts = await Promise.all([
    esbuild.context({
      ...shared,
      entryPoints: [resolve(root, 'src/background/index.ts')],
      outfile: resolve(dist, 'background.js'),
      format: 'iife',
    }),
    esbuild.context({
      ...shared,
      entryPoints: [resolve(root, 'src/offscreen/offscreen.ts')],
      outfile: resolve(dist, 'offscreen.js'),
      format: 'iife',
    }),
    esbuild.context({
      ...shared,
      entryPoints: [resolve(root, 'src/sidepanel/main.tsx')],
      outdir: resolve(dist, 'sidepanel'),
      entryNames: 'main',
      assetNames: '[name]',
      format: 'iife',
      jsx: 'automatic',
      loader: { '.css': 'css' },
    }),
  ]);
  await Promise.all(contexts.map((context) => context.watch()));
  console.log('监听模式已启动，修改 public/ 下的静态文件需要重新运行构建。');
} else {
  await run();
}
