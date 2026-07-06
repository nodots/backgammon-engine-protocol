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

### `POST /v1/resign`

Request: `HintRequest` **without `dice`**.
Response: `ResignResponse`.

```jsonc
{
  "action": "none",          // 'none' | 'single' | 'gammon' | 'backgammon'
  "equity": -1.0             // OPTIONAL
}
```

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
