# `.claude/` — cell scope enforcement

A single PreToolUse hook (`hooks/enforce-scope.js`) enforces the auto-shop
**cell** model without the auto-shop daemon: when a `SCOPE.json` is present, any
`Edit`/`Write` to a file outside `allowedPaths` (or matching `forbiddenPaths`)
is **blocked**, so a worker agent physically cannot leave its lane.

## How a worker uses it
1. Check out the cell's feature branch.
2. Drop the cell's `SCOPE.json` (copied from the GitHub issue body) at either:
   - `.auto-shop/cells/<branch>/SCOPE.json` (branch-scoped, preferred), or
   - repo-root `SCOPE.json`.
3. Work normally. Edits outside `allowedPaths` are rejected with a scope
   violation; the correct response is to **stop and write `BLOCKER.md`**, not to
   widen the lane.

## Notes
- **No SCOPE.json present ⇒ no restriction.** `main`/`development` and ad-hoc
  work are unaffected; enforcement only applies while a cell is active.
- `SCOPE.json` / `HANDOFF.md` / `BLOCKER.md` are always writable (coordination).
- Self-contained: zero npm dependencies (Node builtins only).
- Adapted from `nodots/auto-shop` `scripts/hooks/enforce-scope-pretooluse.js`.
