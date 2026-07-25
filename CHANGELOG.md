# Changelog

All notable changes to `@nodots/backgammon-engine-protocol`.

This package has two independent version numbers, and conflating them is the
easiest mistake to make when reading this file:

- **`PROTOCOL_VERSION`** — the wire contract, currently `"1"` and **frozen**. It
  changes only when the request shape, the coordinate convention, or the required
  response fields change incompatibly. A vendor's integration is pinned to this.
- **package semver** — this file. It moves whenever the published artifact moves,
  including for additive types and documentation that leave the wire unchanged.

See SPEC.md §7 for the full policy.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] — 2026-07-25

First published release. `PROTOCOL_VERSION` remains `"1"` — the wire is
unchanged; this is a minor bump because the TypeScript surface gained types,
per the policy in SPEC §7.

### Added

- `ErrorResponse` and `ErrorCode` — the failure shape for every non-2xx response
  on the `/v1` surface. Previously the contract said only "return non-2xx", which
  a vendor could not conform to and a conformance harness could not check: the
  failure path was the one part of the wire surface with no agreed shape.
  `ErrorCode` distinguishes `unsupported` (a permanent, expected refusal — an
  engine that declines match play) from `internal` (a fault), so a conformance run
  can report the former instead of failing it.
- `engines: { node: ">=18" }`.
- `publishConfig: { access: "public" }` — required for a scoped package;
  without it `npm publish` fails with 402 regardless of account plan.
- `CHANGELOG.md` and `docs/vendor-guide.md` added to the published `files`. The
  vendor guide was linked from the README but excluded from the tarball, so every
  npm consumer got a dead link.
- `PositionIdConvention` and an optional `positionIdConvention` field on
  `HintRequest`. Two orderings of a GNU position id exist in the wild and decode
  the SAME id to DIFFERENT boards, so an engine assuming the wrong one returns a
  move that is illegal for the position the caller meant — silently, with no
  error. Found against our own reference implementation, which produced illegal
  moves on 5 of 36 conformance vectors when fed gnubg-emitted ids. Optional and
  defaulting to `'opponent-first'`, so callers written before it keep working.
- **`engine-conformance` CLI** (`bin/conformance.mjs`) plus 36 legality-pinning
  golden vectors in two convention-specific sets. Dependency-free and with no
  move generator: legality is precomputed into the vectors, so the harness only
  checks membership and a vendor can audit our legality claims rather than trust
  them. It pins legality, never strength — a conforming weak engine passes.
- SPEC §4: the take-request perspective rule (the one place a caller mistake is
  silent rather than an `invalid_request`), and the resignation scope statement
  (returning `none` unconditionally is conformant and carries no strength claim).
- CI (build, lint, test on Node 20), including a step that verifies the published
  tarball contents and a suite that proves the conformance harness FAILS against
  five deliberately broken engines and a hang. A harness never observed to fail
  is not evidence.

### Notes

- The package remains **types-only at runtime**: `PROTOCOL_VERSION` is still the
  sole runtime export, asserted by `test/runtime.test.js`.
- No wire-visible change. `PROTOCOL_VERSION` stays `"1"`.

## [0.1.0] — 2026-07-06

Initial frozen wire contract (tag `contract-v1-frozen`) plus the vendor
onboarding guide. Never published to npm; consumed as a git dependency.
