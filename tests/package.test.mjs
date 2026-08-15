/** Verifies DSH package metadata and dependency-free client build output. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('package declares distributable DSH host, client, and bundle patch entries', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.private, true);
  assert.equal(pkg.main, './lib/index.js');
  assert.equal(pkg.exports['./client'], './lib/client.js');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.deepEqual(pkg.dsh.client, { platform: 'web', inject: [], immediately: true });
  const patch = await readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  assert.match(patch, /name: dsh-arena/);
  assert.doesNotMatch(patch, /E:\/agent/);
});

test('built browser entry registers through the host module loader without DSH runtime dependencies', async () => {
  // The browser half is a lazy-CJS bundle: it registers with the
  // host-provided window.__ModuleLoader__ and the factory returns the plugin
  // exports. Importing it in Node must not require any DSH runtime package.
  let registered;
  globalThis.window = { __ModuleLoader__: { load: (spec) => { registered = spec; } } };
  try {
    await import('../lib/client.js');
    assert.ok(registered, 'client should register with the host loader');
    const exportsObj = registered.factory();
    assert.equal(typeof exportsObj.apply, 'function');
    assert.equal(typeof exportsObj.parseArenaReport, 'function');
  } finally {
    delete globalThis.window;
  }
});

test('built host entry retains declared peer imports for DSH to provide', async () => {
  const host = await readFile(new URL('../lib/index.js', import.meta.url), 'utf8');
  assert.match(host, /@deepseek-ai\/schemastery/);
  assert.match(host, /\.\/core\/arena\.js/);
});
