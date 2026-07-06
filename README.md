# @nodots/backgammon-engine-protocol

The frozen, language-neutral **wire contract** for Nodots backgammon engine
plugins. It defines the request/response data shapes and the `AnalysisProvider`
interface that every analysis engine — the in-process GNU wrapper or any
black-box vendor engine behind an HTTP boundary — implements.

This package ships **types and a spec only**: zero runtime dependencies, no GPL
code. Vendors depend on this Apache-2.0 package and may implement their engine in
any language.

- Full protocol spec: [`SPEC.md`](./SPEC.md)
- Design issue: [nodots/backgammon#360](https://github.com/nodots/backgammon/issues/360)

## Install

```bash
npm install @nodots/backgammon-engine-protocol
```

## Usage

Implement `AnalysisProvider` to expose an engine to the Nodots core:

```ts
import type {
  AnalysisProvider,
  Evaluation,
  HealthStatus,
  HintRequest,
  MoveHint,
} from '@nodots/backgammon-engine-protocol';
import { PROTOCOL_VERSION } from '@nodots/backgammon-engine-protocol';

export class MyEngine implements AnalysisProvider {
  async evaluate(req: HintRequest): Promise<Evaluation> {
    // ...run your engine on req.positionId...
    return {
      win: 0.55,
      winGammon: 0.15,
      winBackgammon: 0.01,
      loseGammon: 0.1,
      loseBackgammon: 0.005,
      equity: 0.12,
    };
  }

  async getMoveHints(req: HintRequest, maxHints = 10): Promise<MoveHint[]> {
    // from=0 => bar, to=0 => off, otherwise a 1..24 point.
    return [];
  }

  // getDoubleHint, getTakeHint, getResignDecision, explain omitted for brevity.

  async health(): Promise<HealthStatus> {
    return {
      status: 'ok',
      engineName: 'my-engine',
      engineVersion: '1.0.0',
      protocolVersion: PROTOCOL_VERSION,
    };
  }
}
```

For out-of-process engines, serve the HTTP surface (`POST /v1/move`,
`POST /v1/double`, `POST /v1/take`, `POST /v1/resign`, `GET /v1/health`) using
the response types (`MoveResponse`, `DoubleResponse`, …) where `equity` and
`candidates` are optional. See [`SPEC.md`](./SPEC.md).

## Coordinate convention

A `MoveStep` uses `from = 0` for the bar and `to = 0` for bearing off; any other
value is a `1..24` point from the active player's own directional perspective.

## License

[Apache-2.0](./LICENSE).
