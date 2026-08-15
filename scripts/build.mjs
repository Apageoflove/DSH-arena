/** Zero-dependency TypeScript-strip build for the distributable DSH Arena package. */

import { promises as fs } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripTypeScriptTypes } from 'node:module';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceCore = join(projectRoot, 'src', 'core');
const outputCore = join(projectRoot, 'lib', 'core');

/** Strips erasable TypeScript and rewrites explicit source extensions for Node ESM. */
async function transpile(sourcePath, outputPath, relocatePlugin = false) {
  const source = await fs.readFile(sourcePath, 'utf8');
  let output = stripTypeScriptTypes(source, { mode: 'strip', sourceUrl: sourcePath }).replaceAll('.ts\'', '.js\'').replaceAll('.ts"', '.js"');
  if (relocatePlugin) output = output.replaceAll("'../core/", "'./core/").replaceAll('"../core/', '"./core/');
  await fs.mkdir(dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, output, 'utf8');
}

/** Builds every core module plus the DSH host and browser entrypoints. */
async function build() {
  const coreFiles = (await fs.readdir(sourceCore)).filter((file) => file.endsWith('.ts')).sort();
  for (const file of coreFiles) await transpile(join(sourceCore, file), join(outputCore, file.replace(/\.ts$/, '.js')));
  await transpile(join(projectRoot, 'src', 'dsh', 'plugin.ts'), join(projectRoot, 'lib', 'index.js'), true);
  await fs.mkdir(join(projectRoot, 'lib'), { recursive: true });
  await fs.copyFile(join(projectRoot, 'src', 'dsh', 'client.mjs'), join(projectRoot, 'lib', 'client.js'));
}

await build();
