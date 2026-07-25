#!/usr/bin/env node
/**
 * A minimal conformant engine, plus deliberately broken variants.
 *
 * The protocol repo cannot run the real engine (private, and heavy), but it can
 * and must test the CONFORMANCE HARNESS itself. A suite that has never been seen
 * to fail is not evidence of anything — so this ships a mock that passes and a
 * set that provably do not, and CI asserts both directions.
 *
 * It answers /v1/move by reading the golden vectors and returning a legal play.
 * That is legitimate for a mock: the point is to exercise the harness, not to
 * play backgammon.
 *
 *   node test/mock-engine.mjs [--port 0] [--break <mode>]
 *
 * Break modes, each targeting one check:
 *   illegal-move     returns a play that is not in the vector's legal set
 *   bad-evaluation   returns winBackgammon > winGammon (violates SPEC §6)
 *   no-error-shape   rejects bad input with a bare 400 and no ErrorResponse body
 *   accepts-garbage  answers 200 to a malformed positionId instead of rejecting
 *   hang             never responds (tests the timeout path)
 *   bad-version      reports protocolVersion "2"
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const BREAK = flag('break', 'none');
const PORT = Number(flag('port', 0));

const payload = JSON.parse(readFileSync(join(HERE, '..', 'conformance', 'vectors.json'), 'utf8'));
const byId = new Map(payload.vectors.map((v) => [v.request.positionId + '|' + v.request.dice.join(','), v]));

/** Parse a play key like "8/5,6/5" back into MoveStep-ish objects. */
function keyToMoves(key) {
  if (!key) return [];
  return key.split(',').map((s) => {
    const [from, to] = s.split('/').map(Number);
    return {
      from,
      to,
      moveKind: from === 0 ? 'reenter' : to === 0 ? 'bear-off' : 'point-to-point',
      isHit: false,
      player: 'white',
      fromContainer: from === 0 ? 'bar' : 'point',
      toContainer: to === 0 ? 'off' : 'point',
    };
  });
}

const okEvaluation = {
  win: 0.55,
  winGammon: 0.15,
  winBackgammon: 0.01,
  loseGammon: 0.1,
  loseBackgammon: 0.005,
  equity: 0.2,
};
const badEvaluation = { ...okEvaluation, winBackgammon: 0.4 }; // > winGammon

const err = (res, status, code, message, field) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: { code, message, ...(field ? { field } : {}) } }));
};

const server = createServer((req, res) => {
  if (BREAK === 'hang') return; // deliberately never respond

  if (req.method === 'GET' && req.url === '/v1/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'ok',
        engineName: 'mock-engine',
        engineVersion: '1.0.0',
        protocolVersion: BREAK === 'bad-version' ? '2' : '1',
      }),
    );
    return;
  }

  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      if (BREAK === 'no-error-shape') {
        res.writeHead(400);
        res.end('bad json');
        return;
      }
      return err(res, 400, 'invalid_request', 'body is not valid JSON');
    }

    // Dice are required for /v1/move and OMITTED for cube/resign requests
    // (SPEC §3), so validating them unconditionally would reject conformant
    // traffic -- which is exactly what this mock did on its first run.
    const needsDice = (req.url ?? '') === '/v1/move';
    const diceOk = needsDice
      ? Array.isArray(parsed?.dice) &&
        parsed.dice.length === 2 &&
        parsed.dice.every((d) => Number.isInteger(d) && d >= 1 && d <= 6)
      : parsed?.dice === undefined ||
        (Array.isArray(parsed.dice) &&
          parsed.dice.every((d) => Number.isInteger(d) && d >= 1 && d <= 6));
    const valid =
      parsed &&
      typeof parsed.positionId === 'string' &&
      /^[A-Za-z0-9+/]+$/.test(parsed.positionId) &&
      diceOk;

    if (!valid && BREAK !== 'accepts-garbage') {
      if (BREAK === 'no-error-shape') {
        res.writeHead(400);
        res.end('nope');
        return;
      }
      const badId = typeof parsed?.positionId !== 'string' || !/^[A-Za-z0-9+/]+$/.test(parsed?.positionId ?? '');
      return badId && typeof parsed?.positionId === 'string'
        ? err(res, 400, 'invalid_position_id', 'undecodable position id', 'positionId')
        : err(res, 400, 'invalid_request', 'malformed request', 'positionId');
    }

    const url = req.url ?? '';
    if (url === '/v1/move') {
      const v = byId.get(parsed.positionId + '|' + (parsed.dice ?? []).join(','));
      const legal = v ? v.legalPlays[0] : '';
      const key = BREAK === 'illegal-move' ? '24/1,24/1' : legal;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          moves: keyToMoves(key),
          equity: 0.1,
          candidates: [
            {
              moves: keyToMoves(key),
              evaluation: BREAK === 'bad-evaluation' ? badEvaluation : okEvaluation,
              equity: 0.1,
              rank: 1,
              difference: 0,
            },
          ],
        }),
      );
      return;
    }
    const enums = {
      '/v1/double': { action: 'no-double', takePoint: 0.72, dropPoint: 0.78 },
      '/v1/take': { action: 'take', takeEquity: -0.4, dropEquity: -1 },
      '/v1/resign': { action: 'none', equity: -0.1 },
    };
    if (enums[url]) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(enums[url]));
      return;
    }
    err(res, 404, 'invalid_request', 'unknown endpoint');
  });
});

server.listen(PORT, () => {
  const { port } = server.address();
  // The runner reads this line to learn the port.
  console.log(`mock-engine listening ${port} break=${BREAK}`);
});
