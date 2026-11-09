// production build. plain node instead of rm/mkdir/cp so it also works on windows
import { build } from 'esbuild';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// build from the repo root no matter where it's run from
process.chdir(fileURLToPath(new URL('..', import.meta.url)));

const outdir = 'dist';
rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir);
copyFileSync(
  'framework/mock-server/mockServiceWorker.js',
  `${outdir}/mockServiceWorker.js`,
);

const shared = { bundle: true, minify: true, logLevel: 'info' };

await Promise.all([
  build({
    ...shared,
    entryPoints: ['framework/server/index.ts'],
    outfile: `${outdir}/server.js`,
    platform: 'node',
    target: 'node22',
    // readable stack traces (npm run serve uses --enable-source-maps)
    sourcemap: true,
  }),
  build({
    ...shared,
    entryPoints: ['framework/client/index.tsx'],
    outfile: `${outdir}/client.js`,
    platform: 'browser',
    target: 'es2020',
    // so the browser gets react's production build
    define: { 'process.env.NODE_ENV': '"production"' },
  }),
]);
