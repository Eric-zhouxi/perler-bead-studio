import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await build({
  entryPoints: [path.join(serverDir, 'index.js')],
  outfile: path.join(serverDir, 'dist', 'cloudbase', 'index.js'),
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  packages: 'external',
});

