/**
 * Compile-time test.
 *
 * This file is never executed. It is type-checked by `npm run lint`
 * (test/tsconfig.json). It proves a sample AnalysisProvider implementation
 * satisfies the exported contract and that every wire type is constructible
 * from the public surface only.
 */
import type {
  AnalysisProvider,
  DoubleHint,
  DoubleResponse,
  ErrorCode,
  ErrorResponse,
  Evaluation,
  Explanation,
  HealthStatus,
  HintRequest,
  MoveHint,
  MoveResponse,
  ResignDecision,
  ResignResponse,
  TakeHint,
  TakeResponse,
} from '../src/index.js';
import { PROTOCOL_VERSION } from '../src/index.js';

const sampleEvaluation: Evaluation = {
  win: 0.55,
  winGammon: 0.15,
  winBackgammon: 0.01,
  loseGammon: 0.1,
  loseBackgammon: 0.005,
  equity: 0.12,
  cubefulEquity: 0.18,
};

// A minimal in-process engine that satisfies the full contract.
class SampleEngine implements AnalysisProvider {
  async evaluate(_req: HintRequest): Promise<Evaluation> {
    return sampleEvaluation;
  }

  async getMoveHints(_req: HintRequest, _maxHints?: number): Promise<MoveHint[]> {
    const hint: MoveHint = {
      moves: [
        {
          from: 24,
          to: 18,
          moveKind: 'point-to-point',
          isHit: false,
          player: 'white',
          fromContainer: 'point',
          toContainer: 'point',
        },
        {
          from: 0,
          to: 3,
          moveKind: 'reenter',
          isHit: true,
          player: 'white',
          fromContainer: 'bar',
          toContainer: 'point',
        },
      ],
      evaluation: sampleEvaluation,
      equity: 0.12,
      rank: 0,
      difference: 0,
    };
    return [hint];
  }

  async getDoubleHint(_req: HintRequest): Promise<DoubleHint> {
    return {
      action: 'no-double',
      takePoint: 0.72,
      dropPoint: 0.78,
      evaluation: sampleEvaluation,
      cubefulEquity: 0.18,
    };
  }

  async getTakeHint(_req: HintRequest): Promise<TakeHint> {
    return {
      action: 'take',
      evaluation: sampleEvaluation,
      takeEquity: -0.4,
      dropEquity: -1,
    };
  }

  async getResignDecision(_req: HintRequest): Promise<ResignDecision> {
    return { action: 'none' };
  }

  async explain(_req: HintRequest): Promise<Explanation> {
    return {
      summary: 'Escapes the back checker and hits on the three point.',
      features: { pipCount: 148, shots: 11, primeLength: 3 },
      conceptDeltas: [{ concept: 'pipCount', before: 154, after: 148 }],
    };
  }

  async health(): Promise<HealthStatus> {
    return {
      status: 'ok',
      engineName: 'sample',
      engineVersion: '0.0.0',
      protocolVersion: PROTOCOL_VERSION,
    };
  }
}

// A bear-off step exercises to=0 / off convention.
const bearOff: MoveHint['moves'][number] = {
  from: 3,
  to: 0,
  moveKind: 'bear-off',
  isHit: false,
  player: 'black',
  fromContainer: 'point',
  toContainer: 'off',
};

// HTTP responses may omit equity/candidates.
const moveResponse: MoveResponse = { moves: [bearOff] };
const doubleResponse: DoubleResponse = { action: 'double' };
const takeResponse: TakeResponse = { action: 'drop' };
const resignResponse: ResignResponse = { action: 'single', equity: -1 };

// Error bodies: minimal, and with the optional field pointer.
const minimalError: ErrorResponse = {
  error: { code: 'invalid_position_id', message: 'not a decodable GNU position ID' },
};
const fieldError: ErrorResponse = {
  error: { code: 'invalid_request', message: 'die out of range', field: 'dice[1]' },
};

// Pin the code union exhaustively. If a member is added or removed, this stops
// compiling -- which is the point: ErrorCode is the one part of the surface a
// conformance harness branches on, so it must not drift silently.
const allCodes: ErrorCode[] = [
  'invalid_position_id',
  'invalid_request',
  'unsupported',
  'timeout',
  'internal',
];
function assertExhaustive(code: ErrorCode): string {
  switch (code) {
    case 'invalid_position_id':
    case 'invalid_request':
      return '400';
    case 'unsupported':
      return '501';
    case 'timeout':
      return '504';
    case 'internal':
      return '500';
    default: {
      const never: never = code;
      return never;
    }
  }
}

// Reference the values so the compiler treats them as used at type level.
export const _sample: AnalysisProvider = new SampleEngine();
export const _responses = { moveResponse, doubleResponse, takeResponse, resignResponse };
export const _errors = { minimalError, fieldError, allCodes, assertExhaustive };
