# Nodots Backgammon Engine Protocol

**Protocol version:** `1`

The frozen, language-neutral wire contract that every Nodots backgammon analysis
engine implements. It is published as the Apache-2.0 package
`@nodots/backgammon-engine-protocol`. Vendors depend **only** on this package and
may implement their engine in any language behind the HTTP boundary — no GPL code
crosses the wire.

The canonical TypeScript type definitions live in [`src/index.ts`](./src/index.ts)
and are re-exported from the package root. This document is the normative
description of the same contract; where prose and types disagree, the types win.

Related issue: [nodots/backgammon#360](https://github.com/nodots/backgammon/issues/360).

---

## 1. Transports

The contract is used in two forms:

1. **In-process** — the `AnalysisProvider` interface, implemented by the
   in-process GNU wrapper and used directly by the core engine.
2. **HTTP** — the vendor surface below, for black-box engines that run out of
   process (or in another language). The HTTP responses relax the in-process
   contract so a vendor may keep scoring detail private (see §4).

Both forms exchange the same request shape (`HintRequest`) and the same
`MoveStep` coordinate convention.

## 2. Coordinate and container convention

A `MoveStep` describes one checker step.

- `from = 0` means the checker leaves the **bar**; `fromContainer = 'bar'`.
- `to = 0` means the checker bears **off**; `toContainer = 'off'`.
- Any other value is a board point in the range `1..24`, from the active
  player's own directional perspective; the corresponding container is `'point'`.
- `moveKind` is `'reenter'` when `from = 0`, `'bear-off'` when `to = 0`, and
  `'point-to-point'` otherwise.
- `isHit` is `true` when the step lands on and sends an opponent blot to the bar.
- `player` is the color of the checker being moved.

## 3. Request: `HintRequest`

Every decision method receives a position plus match/cube context:

| field                   | type                  | notes                                   |
| ----------------------- | --------------------- | --------------------------------------- |
| `positionId`            | `string`              | GNU position ID (canonical encoding).   |
| `positionIdConvention`  | `'on-roll-first' \| 'opponent-first'` | OPTIONAL. How to read `positionId`. Defaults to `'opponent-first'`. **Send it explicitly** — see below. |
| `dice`                  | `[number, number]`    | The roll. Omitted for cube/take/resign. |
| `activePlayerColor`     | `'white' \| 'black'`  | Player on roll / on decision.           |
| `activePlayerDirection` | `'clockwise' \| 'counterclockwise'` | Direction of travel.      |
| `cubeValue`             | `number`              | Current doubling-cube value (1, 2, 4…). |
| `cubeOwner`             | `'white' \| 'black' \| null` | `null` when the cube is centered. |
| `matchScore`            | `[number, number]`    | `[white, black]` points scored.         |
| `matchLength`           | `number`              | Match target; `0`/`1` for money play by convention. |
| `crawford`              | `boolean`             | Whether this is the Crawford game.      |
| `jacoby`                | `boolean`             | Jacoby rule in effect (money play).     |
| `beavers`               | `boolean`             | Beavers allowed (money play).           |

`dice` is present for move requests and **omitted** for `double`, `take`, and
`resign` requests, where no roll applies.

### Position ID convention — read this

Two orderings of a GNU position ID exist in the wild, and they decode the **same
id to different boards**:

- `'on-roll-first'` — GNU Backgammon's own ordering. Use for ids emitted by gnubg
  or tools that copy it.
- `'opponent-first'` — the ordering used by Nodots CORE and wildBG.

An engine that assumes the wrong one does not fail loudly. It decodes a *valid but
different* position and returns a move that is **illegal for the position the
caller meant**, with no error. This was observed against the reference
implementation itself: feeding it gnubg-emitted ids while it assumed
opponent-first produced illegal moves on 5 of 36 conformance vectors.

`positionIdConvention` is OPTIONAL and defaults to `'opponent-first'`, purely so
callers written before it existed keep working. **New integrations should always
send it.** Engines SHOULD honour it; an engine that supports only one ordering
MUST return `unsupported` for the other rather than silently misreading.

Conformance vectors record which convention they were generated under, and the
suite ships a set for each.

## 4. HTTP surface (protocol version `1`)

All paths are prefixed with `/v1`. Requests are `application/json` bodies
carrying a `HintRequest` (minus `dice` where noted). Responses are
`application/json`.

### `POST /v1/move`

Request: `HintRequest` (with `dice`).
Response: `MoveResponse`.

```jsonc
{
  "moves": [ /* MoveStep[] — the recommended play */ ],
  "equity": 0.123,          // OPTIONAL: vendor may omit
  "candidates": [ /* MoveHint[] — OPTIONAL ranked alternatives */ ]
}
```

### `POST /v1/double`

Request: `HintRequest` **without `dice`**.
Response: `DoubleResponse`.

```jsonc
{
  "action": "double",        // 'double' | 'no-double' | 'too-good' | 'beaver' | 'redouble'
  "takePoint": 0.72,         // OPTIONAL
  "dropPoint": 0.78,         // OPTIONAL
  "equity": 0.18,            // OPTIONAL (cubeful)
  "candidates": [ /* DoubleHint[] — OPTIONAL */ ]
}
```

### `POST /v1/take`

Request: `HintRequest` **without `dice`**.
Response: `TakeResponse`.

```jsonc
{
  "action": "take",          // 'take' | 'drop' | 'beaver'
  "takeEquity": -0.4,        // OPTIONAL
  "dropEquity": -1.0,        // OPTIONAL
  "candidates": [ /* TakeHint[] — OPTIONAL */ ]
}
```

**Perspective (important).** A GNU position ID encodes the board from the
**on-roll player's** point of view; `activePlayerColor` only *names* that player
and does not reorient anything. On a take request the player on decision is the
**taker**, so `positionId` MUST be encoded from the taker's side. Sending the
doubler's view returns a confidently inverted answer with no error — this is the
one place in the protocol where a caller mistake is silent rather than an
`invalid_request`.

### `POST /v1/resign`

Request: `HintRequest` **without `dice`**.
Response: `ResignResponse`.

```jsonc
{
  "action": "none",          // 'none' | 'single' | 'gammon' | 'backgammon'
  "equity": -1.0             // OPTIONAL
}
```

An engine that does not model resignation SHOULD return `"none"` unconditionally
rather than `unsupported`: `none` is a valid, playable answer meaning "do not
volunteer a resignation", so a caller needs no special case. Reserve
`unsupported` for requests an engine cannot answer at all.

Returning `"none"` unconditionally is therefore conformant, and carries **no
claim** that the engine evaluated the position for resignation. Consumers must
not infer resignation strength from this endpoint. The reference implementation
does exactly this.

### `GET /v1/health`

Response: `HealthResponse` (= `HealthStatus`).

```jsonc
{
  "status": "ok",
  "engineName": "example-engine",
  "engineVersion": "1.4.2",
  "protocolVersion": "1"
}
```

### Errors (all endpoints)

Every endpoint returns either its documented success body or an `ErrorResponse`.
A conforming engine MUST NOT return a bare non-2xx with an unstructured body, and
MUST NOT hang: a request it cannot answer is an error, not a timeout.

```jsonc
{
  "error": {
    "code": "invalid_position_id",
    "message": "positionId is not a decodable GNU position ID",
    "field": "positionId"        // optional pointer to the offending field
  }
}
```

`code` is one of:

| code | meaning | suggested status |
| --- | --- | --- |
| `invalid_position_id` | `positionId` is not a decodable GNU position ID | 400 |
| `invalid_request` | a required field is missing, malformed, or out of range (including dice outside 1..6) | 400 |
| `unsupported` | well-formed, but this engine does not answer it — e.g. it declines match play, or does not implement resignation | 501 |
| `timeout` | the engine could not answer within its own budget | 504 |
| `internal` | an unexpected fault on the engine side | 500 |

Clients MUST branch on `error.code`, never on the HTTP status: proxies rewrite
statuses, and the status column above is a suggestion, not part of the contract.

`unsupported` is deliberately distinct from `internal`. It is a permanent,
expected refusal, so a conformance run reports it as a declared capability gap
rather than failing the engine. An engine that only plays money games answers
`unsupported` to a match-play request and remains conformant.

## 5. Optionality rule

The in-process `AnalysisProvider` always returns full `Evaluation` and hint
detail. The **HTTP responses** make `equity` and `candidates` (and the
double/take point/equity fields) **OPTIONAL**: a vendor MAY omit them to keep
its scoring private while still returning a playable `moves`/`action`. Consumers
MUST treat those fields as possibly absent.

## 6. Evaluation semantics

`Evaluation` carries a cumulative outcome distribution:

- `P(lose) = 1 - win` (derived, not transmitted).
- `win >= winGammon >= winBackgammon`.
- `(1 - win) >= loseGammon >= loseBackgammon`.
- `equity` is cubeless money equity; `cubefulEquity` is optional.

Equity is a derived quantity, not a raw neural-net output.

## 7. Versioning

`protocolVersion` is the string `"1"` and is exported as `PROTOCOL_VERSION`.
This document describes version `1`. Any incompatible change to the request
shape, the coordinate convention, or the required response fields is a new
protocol version.

### Protocol version vs package version

These are **independent**, and vendors should pin to the first, not the second.

`PROTOCOL_VERSION` describes the wire. It is frozen at `"1"` and moves only for
an incompatible wire change, at which point both versions coexist under distinct
paths (`/v1`, `/v2`) — the protocol is never silently redefined underneath a
running engine.

The npm package version is ordinary semver over the *published artifact*:

- **patch** — documentation, JSDoc, build output; no type or wire change.
- **minor** — additive types (new optional field, new exported interface, a new
  member of a union that consumers already handle via a default branch). An
  integration built against an earlier minor keeps compiling and keeps passing
  conformance.
- **major** — a breaking change to the *TypeScript* surface: a removed or
  narrowed type, a renamed export, a field becoming required. This can happen
  **without** a protocol bump, because a type can tighten while the wire stays
  identical.

The reverse also holds: a new protocol version forces a major package bump.

Reaching package `1.0.0` asserts that the TypeScript surface is stable enough
to promise the above, and nothing about engine strength or feature completeness.
While the package is `0.x`, minor bumps may break types.

