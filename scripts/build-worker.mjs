import { build } from 'esbuild';

await build({
  entryPoints: {
    worker: 'src/worker.ts',
    migrate: 'src/migrate.ts',
    seed: 'scripts/seed.ts'
  },
  outdir: 'build-worker',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node24',
  packages: 'external',
  sourcemap: true
});
