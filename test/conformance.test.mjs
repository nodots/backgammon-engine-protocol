/**
 * Tests the CONFORMANCE HARNESS, not an engine.
 *
 * A suite that has never been observed to fail proves nothing. So each break
 * mode targets exactly one check, and the assertion is that the harness rejects
 * it — if a break mode ever starts passing, that check has silently rotted.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MOCK = join(HERE, 'mock-engine.mjs');
const HARNESS = join(HERE, '..', 'bin', 'conformance.mjs');

/** Start a mock, resolve once it reports its port. */
function startMock(breakMode) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [MOCK, '--break', breakMode], { stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => reject(new Error('mock did not start')), 15000);
    child.stdout.on('data', (d) => {
      const m = /listening (\d+)/.exec(String(d));
      if (m) {
        clearTimeout(timer);
        resolve({ child, port: Number(m[1]) });
      }
    });
    child.on('error', reject);
  });
}

/** Run the harness against a port; resolve its exit code. */
function runHarness(port, extraArgs = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [HARNESS, `http://127.0.0.1:${port}`, ...extraArgs], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolve({ code, out }));
  });
}

async function withMock(breakMode, fn) {
  const { child, port } = await startMock(breakMode);
  try {
    return await fn(port);
  } finally {
    child.kill();
  }
}

test('a conformant engine passes', async () => {
  await withMock('none', async (port) => {
    const { code, out } = await runHarness(port);
    assert.equal(code, 0, `expected PASS, got exit ${code}:\n${out}`);
    assert.match(out, /PASS/);
  });
});

test('an engine that reads only one id ordering negotiates and passes', async () => {
  await withMock('on-roll-only', async (port) => {
    const { code, out } = await runHarness(port);
    assert.equal(code, 0, `expected PASS after encoding negotiation, got exit ${code}:\n${out}`);
    assert.match(out, /using 'on-roll-first' vectors/);
  });
});

// Each of these must FAIL. If one starts passing, that check has rotted.
const BREAKS = [
  ['illegal-move', /not among .* legal results/],
  ['bad-evaluation', /winBackgammon .* > winGammon/],
  ['no-error-shape', /no ErrorResponse body/],
  ['accepts-garbage', /answered HTTP 200 instead of rejecting/],
  ['bad-version', /protocolVersion/],
  ['no-convention', /refused both/],
];

for (const [mode, pattern] of BREAKS) {
  test(`the harness rejects a "${mode}" engine`, async () => {
    await withMock(mode, async (port) => {
      const { code, out } = await runHarness(port);
      assert.notEqual(code, 0, `expected FAIL for ${mode}, but the harness passed:\n${out}`);
      assert.match(out, pattern, `expected a diagnostic matching ${pattern} for ${mode}:\n${out}`);
    });
  });
}

test('the harness reports a hang rather than waiting forever', async () => {
  await withMock('hang', async (port) => {
    const { code, out } = await runHarness(port, ['--timeout-ms', '1500']);
    assert.notEqual(code, 0);
    assert.match(out, /no response in 1500ms|not reachable/);
  });
});
