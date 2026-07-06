/**
 * @nodots/backgammon-engine-protocol
 *
 * Language-neutral wire contract for Nodots backgammon engine plugins.
 * Apache-2.0. Zero runtime dependencies. Vendors depend ONLY on this package
 * and may implement their engine in any language behind the HTTP boundary.
 *
 * These are re-authored data-shape definitions. They intentionally do not
 * derive from any GPL source.
 */

/** Checker color. */
export type Color = 'white' | 'black';

/** Direction of travel around the board for a player. */
export type Direction = 'clockwise' | 'counterclockwise';

/** Kind of checker container a step touches. */
export type Container = 'bar' | 'point' | 'off';

/**
 * Evaluation outcome distribution.
 *
 * P(lose) is derived = 1 - win. Equity is derived, not a neural-net output.
 * Probabilities are cumulative in the usual backgammon sense:
 * win >= winGammon >= winBackgammon and (1 - win) >= loseGammon >= loseBackgammon.
 */
export interface Evaluation {
  win: number;
  winGammon: number;
  winBackgammon: number;
  loseGammon: number;
  loseBackgammon: number;
  /** Cubeless money equity. */
  equity: number;
  cubefulEquity?: number;
}

/**
 * One checker step.
 *
 * Convention: from=0 => bar (fromContainer='bar'); to=0 => off
 * (toContainer='off'); otherwise a 1..24 point.
 */
export interface MoveStep {
  from: number;
  to: number;
  moveKind: 'point-to-point' | 'reenter' | 'bear-off';
  isHit: boolean;
  player: Color;
  fromContainer: Container;
  toContainer: Container;
}

/** A ranked candidate play made up of one or more checker steps. */
export interface MoveHint {
  moves: MoveStep[];
  evaluation: Evaluation;
  equity: number;
  rank: number;
  /** difference = equity - bestEquity (<= 0). */
  difference: number;
}

/** Cube-action recommendation for the player on roll. */
export interface DoubleHint {
  action: 'double' | 'no-double' | 'too-good' | 'beaver' | 'redouble';
  takePoint: number;
  dropPoint: number;
  evaluation: Evaluation;
  cubefulEquity: number;
}

/** Take/drop recommendation for the player facing a double. */
export interface TakeHint {
  action: 'take' | 'drop' | 'beaver';
  evaluation: Evaluation;
  takeEquity: number;
  dropEquity: number;
}

/** Resignation recommendation. */
export interface ResignDecision {
  action: 'none' | 'single' | 'gammon' | 'backgammon';
  evaluation?: Evaluation;
}

/** Liveness/identity report for an engine. */
export interface HealthStatus {
  status: 'ok';
  engineName: string;
  engineVersion: string;
  protocolVersion: '1';
}

/** A computed positional fact used to ground explanations. */
export interface ConceptDelta {
  concept: string;
  before: number;
  after: number;
}

/** Human-facing narration plus deterministic computed facts. */
export interface Explanation {
  /** Human-readable narration (optional to populate). */
  summary: string;
  /** Deterministic computed facts (pip count, shots, prime length...). */
  features?: Record<string, number | string | boolean>;
  /** Before/after deltas for the chosen move. */
  conceptDeltas?: ConceptDelta[];
}

/**
 * The request every decision method takes: a position plus match/cube context.
 *
 * For double/take/resign decisions `dice` is not meaningful; the HTTP surface
 * omits it (see SPEC.md).
 */
export interface HintRequest {
  /** GNU position ID (canonical). */
  positionId: string;
  dice: [number, number];
  activePlayerColor: Color;
  activePlayerDirection: Direction;
  cubeValue: number;
  cubeOwner: Color | null;
  matchScore: [number, number];
  matchLength: number;
  crawford: boolean;
  jacoby: boolean;
  beavers: boolean;
}

/**
 * The contract BOTH the in-process GNU wrapper and any (black-box) engine
 * implement.
 */
export interface AnalysisProvider {
  evaluate(req: HintRequest): Promise<Evaluation>;
  getMoveHints(req: HintRequest, maxHints?: number): Promise<MoveHint[]>;
  getDoubleHint(req: HintRequest): Promise<DoubleHint>;
  getTakeHint(req: HintRequest): Promise<TakeHint>;
  getResignDecision(req: HintRequest): Promise<ResignDecision>;
  explain(req: HintRequest): Promise<Explanation>;
  health(): Promise<HealthStatus>;
}

/**
 * HTTP response surface.
 *
 * On the wire a vendor MAY omit equity/hints to keep their scoring private.
 * These response types make those fields optional, unlike the internal
 * AnalysisProvider contract which always returns them.
 */

/** Response to POST /v1/move. */
export interface MoveResponse {
  moves: MoveStep[];
  equity?: number;
  candidates?: MoveHint[];
}

/** Response to POST /v1/double. */
export interface DoubleResponse {
  action: DoubleHint['action'];
  takePoint?: number;
  dropPoint?: number;
  equity?: number;
  candidates?: DoubleHint[];
}

/** Response to POST /v1/take. */
export interface TakeResponse {
  action: TakeHint['action'];
  takeEquity?: number;
  dropEquity?: number;
  candidates?: TakeHint[];
}

/** Response to POST /v1/resign. */
export interface ResignResponse {
  action: ResignDecision['action'];
  equity?: number;
}

/** Response to GET /v1/health. */
export type HealthResponse = HealthStatus;

/** Frozen protocol version. */
export const PROTOCOL_VERSION = '1' as const;
