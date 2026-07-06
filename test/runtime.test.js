/**
 * Runtime test. Runs against the built ESM output in dist/ via `node --test`.
 * Zero dependencies: uses the built-in node:test and node:assert modules.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PROTOCOL_VERSION } from '../dist/index.js';

test('PROTOCOL_VERSION is the frozen string "1"', () => {
  assert.equal(PROTOCOL_VERSION, '1');
  assert.equal(typeof PROTOCOL_VERSION, 'string');
});

test('package exposes only the version constant at runtime (types are erased)', async () => {
  const mod = await import('../dist/index.js');
  // Interfaces/types produce no runtime binding; the only runtime export is the constant.
  assert.deepEqual(Object.keys(mod).sort(), ['PROTOCOL_VERSION']);
});
