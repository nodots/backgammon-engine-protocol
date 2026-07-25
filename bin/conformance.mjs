#!/usr/bin/env node
/**
 * engine-conformance — does a running engine actually satisfy the contract?
 *
 * Run it against any engine, in the vendor's own CI:
 *   npx @nodots/backgammon-engine-protocol conformance http://localhost:8080
 *
 * ZERO DEPENDENCIES, and deliberately no move generator. Legality is the most
 * valuable check, but computing it would require an engine — so each golden
 * vector instead carries the COMPLETE precomputed set of legal plays, and this
 * tool only checks membership. That keeps the harness dependency-free and makes
 * our legality claims independently auditable: a vendor can inspect the vectors
 * rather than trust a black box.
 *
 * WHAT THIS DOES NOT DO: it never checks whether a move is GOOD. A weak but
 * legal engine passes, by design. This is a conformance suite, not a strength
 * benchmark — strength is measured by head-to-head, which is a different thing
 * entirely and cannot be self-reported.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const args = argv.filter((a) => !a.startsWith('--'));
const base = (args[0] ?? '').replace(/\/+$/, '');
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const has = (n) => argv.includes(`--${n}`);

if (!base) {
  console.error('usage: conformance <baseUrl> [--vectors <path>] [--timeout-ms 10000] [--verbose]');
  console.error('  e.g. conformance http://localhost:8080');
  process.exit(2);
}

const VECTORS = flag('vectors', join(HERE, '..', 'conformance', 'vectors.json'));
const TIMEOUT = Number(flag('timeout-ms', 10000));
const VERBOSE = has('verbose');

const results = [];
const record = (name, ok, detail = '', skipped = false) => {
  results.push({ name, ok, detail, skipped });
  if (VERBOSE || (!ok && !skipped)) {
    const tag = skipped ? 'SKIP' : ok ? 'ok  ' : 'FAIL';
    console.log(`${tag}  ${name}${detail ? ` — ${detail}` : ''}`);
  }
};

async function post(path, body) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
      signal: ctl.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* leave null; callers report the raw text */
    }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

async function get(path) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const res = await fetch(`${base}${path}`, { signal: ctl.signal });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* leave null */
    }
    return { status: res.status, json, text };
  } finally {
    clearTimeout(timer);
  }
}

/** Order-independent play key. Must match tools/genConformanceVectors.mjs. */
function playKey(moves) {
  if (!Array.isArray(moves)) return null;
  return moves
    .map((m) => `${m?.from}/${m?.to}`)
    .sort()
    .join(',');
}

/**
 * Cumulative distribution invariants (SPEC §6).
 *
 * These are the cheapest high-value check in the suite: they are pure
 * arithmetic, and an engine that gets them wrong emits silently corrupt
 * equities that no amount of head-to-head would attribute correctly.
 */
function evaluationProblems(e) {
  const p = [];
  const num = (k) => typeof e[k] === 'number' && Number.isFinite(e[k]);
  for (const k of ['win', 'winGammon', 'winBackgammon', 'loseGammon', 'loseBackgammon']) {
    if (!num(k)) return [`${k} missing or not a finite number`];
    if (e[k] < 0 || e[k] > 1) p.push(`${k}=${e[k]} outside [0,1]`);
  }
  const EPS = 1e-6;
  if (e.winGammon > e.win + EPS) p.push(`winGammon ${e.winGammon} > win ${e.win}`);
  if (e.winBackgammon > e.winGammon + EPS)
    p.push(`winBackgammon ${e.winBackgammon} > winGammon ${e.winGammon}`);
  const lose = 1 - e.win;
  if (e.loseGammon > lose + EPS) p.push(`loseGammon ${e.loseGammon} > 1-win ${lose.toFixed(6)}`);
  if (e.loseBackgammon > e.loseGammon + EPS)
    p.push(`loseBackgammon ${e.loseBackgammon} > loseGammon ${e.loseGammon}`);
  return p;
}

const isErrorBody = (j) =>
  j && typeof j === 'object' && j.error && typeof j.error.code === 'string' &&
  typeof j.error.message === 'string';

const ERROR_CODES = new Set([
  'invalid_position_id',
  'invalid_request',
  'unsupported',
  'timeout',
  'internal',
]);

/* ------------------------------------------------------------------ checks */

async function checkHealth() {
  let r;
  try {
    r = await get('/v1/health');
  } catch (e) {
    record('health reachable', false, e.name === 'AbortError' ? `no response in ${TIMEOUT}ms` : e.message);
    return false;
  }
  if (r.status !== 200 || !r.json) {
    record('health reachable', false, `HTTP ${r.status}: ${r.text.slice(0, 120)}`);
    return false;
  }
  record('health reachable', true);
  record(
    'health.protocolVersion === "1"',
    r.json.protocolVersion === '1',
    `got ${JSON.stringify(r.json.protocolVersion)}`,
  );
  record(
    'health identifies the engine',
    typeof r.json.engineName === 'string' && r.json.engineName.length > 0 &&
      typeof r.json.engineVersion === 'string',
    `engineName=${JSON.stringify(r.json.engineName)} engineVersion=${JSON.stringify(r.json.engineVersion)}`,
  );
  return true;
}

async function checkVectors(vectors) {
  let legalityChecked = 0;
  let evaluationsChecked = 0;
  for (const v of vectors) {
    let r;
    try {
      r = await post('/v1/move', v.request);
    } catch (e) {
      record(`${v.id} (${v.category}) responds`, false,
        e.name === 'AbortError' ? `no response in ${TIMEOUT}ms` : e.message);
      continue;
    }
    if (r.status !== 200 || !r.json) {
      record(`${v.id} (${v.category}) responds 200`, false, `HTTP ${r.status}: ${r.text.slice(0, 120)}`);
      continue;
    }
    const key = playKey(r.json.moves);
    if (key === null) {
      record(`${v.id} (${v.category}) returns a moves array`, false, `moves=${JSON.stringify(r.json.moves)}`);
      continue;
    }
    const legal = v.legalPlays.includes(key);
    legalityChecked++;
    record(
      `${v.id} (${v.category}) play is legal`,
      legal,
      legal ? '' : `returned "${key}" which is not among ${v.legalPlayCount} legal plays`,
    );

    // Optional per SPEC §5 — only checked when the engine chooses to disclose.
    if (r.json.equity !== undefined && typeof r.json.equity !== 'number') {
      record(`${v.id} equity is numeric when present`, false, `got ${typeof r.json.equity}`);
    }
    for (const [i, c] of (r.json.candidates ?? []).entries()) {
      if (c?.evaluation) {
        const problems = evaluationProblems(c.evaluation);
        evaluationsChecked++;
        record(
          `${v.id} candidate[${i}] evaluation invariants`,
          problems.length === 0,
          problems.join('; '),
        );
      }
      if (Array.isArray(c?.moves) && !v.legalPlays.includes(playKey(c.moves))) {
        record(`${v.id} candidate[${i}] is legal`, false, `"${playKey(c.moves)}" not legal`);
      }
    }
  }
  return { legalityChecked, evaluationsChecked };
}

async function checkErrors(sample) {
  const cases = [
    ['malformed positionId', { ...sample, positionId: '!!!not-a-position!!!' }, ['invalid_position_id', 'invalid_request']],
    ['missing positionId', { ...sample, positionId: undefined }, ['invalid_request']],
    ['die out of range', { ...sample, dice: [9, 0] }, ['invalid_request']],
  ];
  for (const [name, body, acceptable] of cases) {
    let r;
    try {
      r = await post('/v1/move', body);
    } catch (e) {
      record(`error: ${name}`, false,
        e.name === 'AbortError'
          ? `HUNG — no response in ${TIMEOUT}ms. A request the engine cannot answer must be an error, never a hang.`
          : e.message);
      continue;
    }
    if (r.status >= 200 && r.status < 300) {
      record(`error: ${name}`, false, `answered HTTP ${r.status} instead of rejecting`);
      continue;
    }
    if (!isErrorBody(r.json)) {
      record(`error: ${name}`, false,
        `non-2xx with no ErrorResponse body (SPEC §4): ${r.text.slice(0, 120)}`);
      continue;
    }
    if (!ERROR_CODES.has(r.json.error.code)) {
      record(`error: ${name}`, false, `unknown error.code "${r.json.error.code}"`);
      continue;
    }
    record(`error: ${name}`, acceptable.includes(r.json.error.code),
      acceptable.includes(r.json.error.code)
        ? `code=${r.json.error.code}`
        : `code=${r.json.error.code}, expected one of ${acceptable.join('|')}`);
  }

  // Unparseable JSON must not crash or hang the engine either.
  try {
    const r = await post('/v1/move', '{not json');
    record('error: unparseable JSON body', r.status >= 400 && r.status < 500,
      `HTTP ${r.status}`);
  } catch (e) {
    record('error: unparseable JSON body', false,
      e.name === 'AbortError' ? `HUNG — no response in ${TIMEOUT}ms` : e.message);
  }
}

async function checkCube(sample) {
  const { dice: _drop, ...noDice } = sample;
  const enums = {
    '/v1/double': ['double', 'no-double', 'too-good', 'beaver', 'redouble'],
    '/v1/take': ['take', 'drop', 'beaver'],
    '/v1/resign': ['none', 'single', 'gammon', 'backgammon'],
  };
  for (const [path, allowed] of Object.entries(enums)) {
    let r;
    try {
      r = await post(path, noDice);
    } catch (e) {
      record(`${path} responds`, false, e.name === 'AbortError' ? `no response in ${TIMEOUT}ms` : e.message);
      continue;
    }
    // An engine may legitimately decline cube decisions entirely.
    if (r.status === 501 && isErrorBody(r.json) && r.json.error.code === 'unsupported') {
      record(`${path} action in enum`, true, 'declared unsupported — allowed', true);
      continue;
    }
    if (r.status !== 200 || !r.json) {
      record(`${path} responds 200`, false, `HTTP ${r.status}: ${r.text.slice(0, 120)}`);
      continue;
    }
    record(`${path} action in enum`, allowed.includes(r.json.action),
      `got ${JSON.stringify(r.json.action)}`);
  }
}

/* -------------------------------------------------------------------- main */

const payload = JSON.parse(readFileSync(VECTORS, 'utf8'));
const vectors = payload.vectors ?? [];
console.log(`engine-conformance -> ${base}`);
console.log(`  ${vectors.length} vectors from ${VECTORS} (schema ${payload._meta?.schemaVersion})\n`);

const reachable = await checkHealth();
if (!reachable) {
  console.error('\nengine is not reachable; aborting.');
  process.exit(1);
}
const { legalityChecked, evaluationsChecked } = await checkVectors(vectors);
await checkErrors(vectors[0]?.request ?? {});
await checkCube(vectors[0]?.request ?? {});

const failed = results.filter((r) => !r.ok && !r.skipped);
const skipped = results.filter((r) => r.skipped);
console.log(
  `\n${results.length - skipped.length} checks, ${failed.length} failed, ${skipped.length} skipped` +
    ` (${legalityChecked} legality, ${evaluationsChecked} evaluation invariants)`,
);
if (failed.length) {
  console.log('\nfailures:');
  for (const f of failed) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
  process.exit(1);
}
console.log('PASS — engine conforms to protocol version 1.');
