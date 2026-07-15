import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(serverRoot, 'dist', 'cloudbase');
const sourcePackage = JSON.parse(await fs.readFile(path.join(serverRoot, 'package.json'), 'utf8'));

delete sourcePackage.type;
delete sourcePackage.devDependencies;
sourcePackage.main = 'index.js';
sourcePackage.engines = { node: '>=18.15' };

await fs.rm(outputDir, { recursive: true, force: true });
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, 'package.json'), `${JSON.stringify(sourcePackage, null, 2)}\n`);
