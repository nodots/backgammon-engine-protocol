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

## [Unreleased]

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
- CI (build, lint, test on Node 20).

### Notes

- The package remains **types-only at runtime**: `PROTOCOL_VERSION` is still the
  sole runtime export, asserted by `test/runtime.test.js`.
- No wire-visible change. `PROTOCOL_VERSION` stays `"1"`.

## [0.1.0] — 2026-07-06

Initial frozen wire contract (tag `contract-v1-frozen`) plus the vendor
onboarding guide. Never published to npm; consumed as a git dependency.
