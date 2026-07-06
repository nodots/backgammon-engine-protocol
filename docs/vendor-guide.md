# Vendor Onboarding Guide

How to ship a sealed, closed-source backgammon engine to the Nodots platform.

This guide is for **third-party engine vendors**. It explains the integration
model, the wire contract you implement, operational expectations, the licensing
boundary that keeps your source private, and a minimal working example.

The normative contract is [`SPEC.md`](../SPEC.md) and the TypeScript types in
[`src/index.ts`](../src/index.ts). Where this guide and the types disagree, the
types win.

- [The integration model](#1-the-integration-model)
- [What you depend on](#2-what-you-depend-on)
- [The HTTP surface](#3-the-http-surface)
- [Request/response reference](#4-requestresponse-reference)
- [Coordinate convention](#5-coordinate-convention)
- [Operational expectations](#6-operational-expectations)
- [Security: HMAC request signing](#7-security-hmac-request-signing)
- [Licensing](#8-licensing)
- [Hello-world skeleton](#9-hello-world-skeleton)
- [Onboarding checklist](#10-onboarding-checklist)

---

## 1. The integration model

You host an HTTPS endpoint. Nodots calls it once per decision.

```
                         per decision (move / double / take / resign)
 Nodots platform  ───────────────  HTTPS POST /v1/...  ──────────────▶  Your engine
 (caller)         ◀───────────────  JSON response       ──────────────  (your server)
```

- **You run the server.** Nodots never receives your binary, your weights, or
  your source. It only ever sees the JSON you return.
- **Nodots is the client.** For each in-game decision it sends a `HintRequest`
  describing the position and match context, and expects a decision back.
- **Stateless per call.** Every request carries the full position
  (`positionId`) and match/cube context. You do not need to track game state
  between calls; you may, but the platform does not rely on it.
- **One engine, many decision types.** The same endpoint base serves move, cube
  (double), take, resign, and health decisions on distinct paths.

Because the only thing that crosses the boundary is JSON over HTTPS, your engine
can be written in **any language** — C, C++, Rust, Python, Go, Node — and run on
**any host** you control. The platform neither knows nor cares.

## 2. What you depend on

Your **only** required dependency is the Apache-2.0 package
[`@nodots/backgammon-engine-protocol`](../README.md):

```bash
npm install @nodots/backgammon-engine-protocol
```

It ships **types and a spec only** — zero runtime dependencies, no GPL code. It
gives you:

- The TypeScript request/response types (`HintRequest`, `MoveResponse`,
  `DoubleResponse`, `TakeResponse`, `ResignResponse`, `HealthResponse`,
  `MoveStep`, and the supporting shapes).
- The `AnalysisProvider` interface, if you implement in TypeScript in-process.
- `PROTOCOL_VERSION` (currently `"1"`).

If you implement your engine in another language, you do not install anything —
you treat the JSON shapes in [`SPEC.md`](../SPEC.md) as your interface definition.
The TypeScript package is the machine-readable copy of that same contract for
those who want it.

You do **not** need — and must not take a dependency on — GNU Backgammon, the
Nodots core engine, or any other Nodots package. The protocol package is the
whole surface.

## 3. The HTTP surface

All paths are prefixed with `/v1`. Request bodies are `application/json`
`HintRequest` objects; responses are `application/json`.

| Method + path      | Request                       | Response          |
| ------------------ | ----------------------------- | ----------------- |
| `POST /v1/move`    | `HintRequest` (with `dice`)   | `MoveResponse`    |
| `POST /v1/double`  | `HintRequest` (no `dice`)     | `DoubleResponse`  |
| `POST /v1/take`    | `HintRequest` (no `dice`)     | `TakeResponse`    |
| `POST /v1/resign`  | `HintRequest` (no `dice`)     | `ResignResponse`  |
| `GET  /v1/health`  | —                             | `HealthResponse`  |

`dice` is present only on `POST /v1/move`. For `double`, `take`, and `resign`
no roll applies and the field is omitted.

The `/v1` prefix is the protocol version. If Nodots ever ships an incompatible
change to the request shape, the coordinate convention, or the required response
fields, it becomes `/v2`, and your `/v1` endpoint keeps working under the old
contract. See [versioning](#versioning).

## 4. Request/response reference

Summarized from [`SPEC.md`](../SPEC.md); the types in
[`src/index.ts`](../src/index.ts) are authoritative.

### `HintRequest` (every decision)

| field                   | type                                | notes                                             |
| ----------------------- | ----------------------------------- | ------------------------------------------------- |
| `positionId`            | `string`                            | GNU position ID (canonical encoding of the board).|
| `dice`                  | `[number, number]`                  | The roll. Present on `move`; omitted otherwise.   |
| `activePlayerColor`     | `'white' \| 'black'`                | Player on roll / on decision.                     |
| `activePlayerDirection` | `'clockwise' \| 'counterclockwise'` | Direction of travel for the active player.        |
| `cubeValue`             | `number`                            | Current doubling-cube value (1, 2, 4, …).         |
| `cubeOwner`             | `'white' \| 'black' \| null`        | `null` when the cube is centered.                 |
| `matchScore`            | `[number, number]`                  | `[white, black]` points scored.                   |
| `matchLength`           | `number`                            | Match target; `0`/`1` = money play by convention. |
| `crawford`              | `boolean`                           | Whether this is the Crawford game.                |
| `jacoby`                | `boolean`                           | Jacoby rule in effect (money play).               |
| `beavers`               | `boolean`                           | Beavers allowed (money play).                      |

The `positionId` fully describes the board. Decode it against the coordinate
convention below; every point index it yields is in the active player's own
directional perspective.

### `MoveResponse` (from `POST /v1/move`)

```jsonc
{
  "moves": [ /* MoveStep[] — the recommended play, in order */ ],
  "equity": 0.123,          // OPTIONAL
  "candidates": [ /* MoveHint[] — OPTIONAL ranked alternatives */ ]
}
```

- `moves` is **required**: the checker steps of the play you recommend.
- `equity` and `candidates` are **OPTIONAL**. See [the optionality rule](#the-optionality-rule).

### `DoubleResponse` (from `POST /v1/double`)

```jsonc
{
  "action": "double",   // 'double' | 'no-double' | 'too-good' | 'beaver' | 'redouble'
  "takePoint": 0.72,    // OPTIONAL
  "dropPoint": 0.78,    // OPTIONAL
  "equity": 0.18,       // OPTIONAL (cubeful)
  "candidates": [ /* DoubleHint[] — OPTIONAL */ ]
}
```

### `TakeResponse` (from `POST /v1/take`)

```jsonc
{
  "action": "take",     // 'take' | 'drop' | 'beaver'
  "takeEquity": -0.4,   // OPTIONAL
  "dropEquity": -1.0,   // OPTIONAL
  "candidates": [ /* TakeHint[] — OPTIONAL */ ]
}
```

### `ResignResponse` (from `POST /v1/resign`)

```jsonc
{
  "action": "none",     // 'none' | 'single' | 'gammon' | 'backgammon'
  "equity": -1.0        // OPTIONAL
}
```

### `HealthResponse` (from `GET /v1/health`)

```jsonc
{
  "status": "ok",
  "engineName": "example-engine",
  "engineVersion": "1.4.2",
  "protocolVersion": "1"
}
```

### The optionality rule

Only the decision field is required in each response — `moves` for a move, and
`action` for double / take / resign. Everything numeric — `equity`,
`candidates`, `takePoint`, `dropPoint`, `takeEquity`, `dropEquity` — is
**OPTIONAL**.

You may **omit all scoring detail** to keep your evaluation private, and still
return a fully playable decision. This is deliberate: the platform never forces
you to reveal how strong a move is.

**Trade-off:** if you omit `equity`/`candidates`, the platform cannot compute a
Performance Rating (PR) or place your engine on the skill leaderboard for those
games — PR is derived from the equity difference between the best and chosen
plays. If you want your engine ranked, return `equity` and a ranked
`candidates` list. If you would rather stay a black box, omit them. Both are
valid; it is your call per response.

## 5. Coordinate convention

A `MoveStep` describes one checker step:

| field           | meaning                                                                  |
| --------------- | ------------------------------------------------------------------------ |
| `from`          | Origin point `1..24`, or `0` for the **bar**.                            |
| `to`            | Destination point `1..24`, or `0` for **off** (bear-off).                |
| `fromContainer` | `'bar'` when `from = 0`, else `'point'`.                                 |
| `toContainer`   | `'off'` when `to = 0`, else `'point'`.                                   |
| `moveKind`      | `'reenter'` if `from = 0`; `'bear-off'` if `to = 0`; else `'point-to-point'`. |
| `isHit`         | `true` when the step lands on and sends an opponent blot to the bar.     |
| `player`        | The color of the checker being moved.                                    |

Points are numbered `1..24` from the **active player's own directional
perspective** (the `activePlayerDirection` in the request). A play (e.g. a
doubles roll) is an ordered array of `MoveStep`s.

Worked examples:

- `24/18`: `{ from: 24, to: 18, moveKind: 'point-to-point', ... }`.
- Enter from the bar to the 20-point: `{ from: 0, to: 20, moveKind: 'reenter', fromContainer: 'bar', ... }`.
- Bear a checker off the 3-point: `{ from: 3, to: 0, moveKind: 'bear-off', toContainer: 'off', ... }`.

## 6. Operational expectations

### Latency budget

- **Target: 2 seconds** per decision. Aim to answer within this on typical
  positions.
- **Hard timeout: 10 seconds.** If Nodots does not receive a complete response
  within 10s, it abandons the call and treats it as a failure. Size your search
  so worst-case positions still return well inside 10s.

### Availability and health

- Serve `GET /v1/health` returning a `HealthResponse` with `status: "ok"` and
  your `engineName` / `engineVersion` / `protocolVersion`. Nodots polls this to
  confirm your endpoint is live and to record which engine build served a game.
- Return quickly from health; it is a liveness probe, not an evaluation.

### Transport

- **HTTPS only.** Serve a valid TLS certificate. Plain HTTP is rejected.
- Respond `application/json`. Return non-2xx for malformed requests so failures
  are visible rather than silent.

### Versioning

- Report `protocolVersion: "1"` in every `HealthResponse` and serve the `/v1`
  paths. This is the string exported as `PROTOCOL_VERSION`.
- Version `1` is frozen. An incompatible change to the request shape, the
  coordinate convention, or the required response fields would be a new protocol
  version (`/v2`), announced before it is required. Keep serving `/v1` until you
  have migrated.

## 7. Security: HMAC request signing

So you can verify that a call really came from Nodots (and not an impostor
replaying requests to your endpoint), Nodots signs every request with a shared
secret using HMAC.

At onboarding you and Nodots exchange a **shared signing secret**. On each
request Nodots sends:

- `X-Nodots-Timestamp`: the Unix epoch milliseconds when the request was signed.
- `X-Nodots-Signature`: `HMAC-SHA256(secret, timestamp + "." + rawBody)`, hex
  encoded.

To verify a request, recompute the HMAC over `timestamp + "." + rawBody` with
your copy of the secret and compare in constant time. Reject the request if:

- the signature does not match, or
- the timestamp is outside an acceptable skew window (e.g. more than a few
  minutes old) — this bounds replay.

Verifying is optional but **strongly recommended**: it is the only way to be
sure an inbound decision request is genuinely from Nodots. Keep the secret out
of source control and rotate it if it is ever exposed. A verification snippet is
in the [hello-world skeleton](#9-hello-world-skeleton).

## 8. Licensing

This is the platform's core promise, and the reason the boundary is drawn where
it is:

- The protocol package `@nodots/backgammon-engine-protocol` is **Apache-2.0** —
  a permissive license. It contains **types and a spec only**, and no GPL code.
- Depending on it puts **no copyleft obligation** on your engine. Apache-2.0
  does not require you to publish, disclose, or relicense anything you build
  against it.
- You **do not link any GPL code**. GNU Backgammon (GPL) lives entirely on the
  Nodots side of the HTTP boundary; it never crosses the wire and you never
  depend on it. All that reaches you is JSON.
- Therefore **your engine source stays private.** You ship a sealed,
  closed-source binary behind your HTTPS endpoint, keep your weights and search
  code secret, and remain fully compliant.

In short: permissive-licensed types + a network boundary = your intellectual
property stays yours. Nothing in this integration obliges you to open your
source.

> This section describes the licensing intent of the integration and is not
> legal advice. If you have obligations from other dependencies inside your own
> engine, review them with your own counsel.

## 9. Hello-world skeleton

A minimal vendor server that answers every decision path with a legal-looking
response. It is deliberately trivial — swap the stub logic for your engine. Any
language works; this is a tiny Node/Express example.

```js
// server.js — minimal Nodots engine vendor skeleton (Node + Express)
import express from 'express';
import crypto from 'node:crypto';

const PORT = process.env.PORT ?? 8443;
const SIGNING_SECRET = process.env.NODOTS_SIGNING_SECRET ?? '';

const app = express();

// Capture the raw body so the HMAC is computed over exactly what was sent.
app.use(express.json({
  verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); },
}));

// Verify the Nodots HMAC signature (see §7). Recommended in production.
function verifyNodots(req, res, next) {
  if (!SIGNING_SECRET) return next(); // dev only; require it in production
  const ts = req.get('X-Nodots-Timestamp') ?? '';
  const sig = req.get('X-Nodots-Signature') ?? '';
  const expected = crypto
    .createHmac('sha256', SIGNING_SECRET)
    .update(`${ts}.${req.rawBody ?? ''}`)
    .digest('hex');
  const ok =
    sig.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  const fresh = Math.abs(Date.now() - Number(ts)) < 5 * 60 * 1000; // 5 min skew
  if (!ok || !fresh) return res.status(401).json({ error: 'bad signature' });
  next();
}

// POST /v1/move — return a legal-looking play. Omitting equity/candidates
// keeps scoring private (no PR/leaderboard; see §4 optionality rule).
app.post('/v1/move', verifyNodots, (req, res) => {
  const { activePlayerColor, dice } = req.body; // HintRequest
  const [d1] = dice ?? [1, 1];
  // Stub: pretend to move one checker 24 -> (24 - d1). Replace with your engine.
  res.json({
    moves: [{
      from: 24,
      to: 24 - d1,
      moveKind: 'point-to-point',
      isHit: false,
      player: activePlayerColor,
      fromContainer: 'point',
      toContainer: 'point',
    }],
    // equity, candidates omitted → engine stays a black box.
  });
});

// POST /v1/double — cube decision. 'no-double' is always safe.
app.post('/v1/double', verifyNodots, (_req, res) => {
  res.json({ action: 'no-double' });
});

// POST /v1/take — facing a double. 'take' is a valid stub.
app.post('/v1/take', verifyNodots, (_req, res) => {
  res.json({ action: 'take' });
});

// POST /v1/resign — never volunteer a resignation.
app.post('/v1/resign', verifyNodots, (_req, res) => {
  res.json({ action: 'none' });
});

// GET /v1/health — liveness + identity.
app.get('/v1/health', (_req, res) => {
  res.json({
    status: 'ok',
    engineName: 'hello-world-engine',
    engineVersion: '0.0.1',
    protocolVersion: '1',
  });
});

app.listen(PORT, () => console.log(`vendor engine listening on :${PORT}`));
```

Notes:

- This returns **structurally valid but not legal** moves. Before going live,
  your engine must return plays that are legal for the given `positionId` and
  `dice`. Nodots validates and will reject an illegal play.
- The example omits `equity`/`candidates` to show the black-box path. Add them
  if you want a PR and leaderboard placement.
- Serve this behind TLS (a reverse proxy terminating HTTPS is fine); Nodots
  requires HTTPS.

## 10. Onboarding checklist

- [ ] Implement `POST /v1/move`, `/v1/double`, `/v1/take`, `/v1/resign` and
      `GET /v1/health`.
- [ ] Return legal plays for the given `positionId` + `dice` (not just the
      structural stub).
- [ ] Decide per response whether to include `equity`/`candidates` (ranked, for
      PR/leaderboard) or omit them (stay a black box).
- [ ] Serve over HTTPS with a valid certificate.
- [ ] Answer within the 2s target and always inside the 10s hard timeout.
- [ ] Verify the Nodots HMAC signature; exchange and safely store the shared
      secret.
- [ ] Report `protocolVersion: "1"` from `/v1/health`.
- [ ] Confirm your only Nodots dependency is
      `@nodots/backgammon-engine-protocol` (Apache-2.0) — no GPL linkage.

---

See also: [`README.md`](../README.md) · [`SPEC.md`](../SPEC.md) ·
[`src/index.ts`](../src/index.ts) · design issue
[nodots/backgammon#360](https://github.com/nodots/backgammon/issues/360).
