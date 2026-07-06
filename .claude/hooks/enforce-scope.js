#!/usr/bin/env node
'use strict';

/*
 * PreToolUse scope-enforcement hook (self-contained; no npm deps).
 * Adapted from nodots/auto-shop scripts/hooks/enforce-scope-pretooluse.js.
 *
 * Blocks Edit/Write to files outside the active cell's SCOPE.json allowedPaths
 * (or matching forbiddenPaths). No SCOPE.json present => no restriction, so
 * main/development and ad-hoc work are unaffected.
 *
 * SCOPE.json is resolved from, in order:
 *   1. .auto-shop/cells/<branch>/SCOPE.json   (branch-scoped)
 *   2. <repoRoot>/SCOPE.json                  (root fallback)
 * Coordination files (SCOPE.json/HANDOFF.md/BLOCKER.md) are always writable.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ARTIFACTS = { scope: 'SCOPE.json', handoff: 'HANDOFF.md', blocker: 'BLOCKER.md' };

function currentBranch(root) {
  try {
    return execSync(`git -C "${root}" rev-parse --abbrev-ref HEAD`, {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch { return null; }
}

function branchDir(root, branch) {
  if (!branch || branch === 'HEAD') return null;
  return path.join(root, '.auto-shop', 'cells', ...branch.split('/').filter(Boolean));
}

function artifactPath(root, kind, branch) {
  const name = ARTIFACTS[kind];
  const bdir = branchDir(root, branch);
  const branchScoped = bdir ? path.join(bdir, name) : null;
  const rootPath = path.join(root, name);
  if (branchScoped && fs.existsSync(branchScoped)) return branchScoped;
  if (fs.existsSync(rootPath)) return rootPath;
  return branchScoped || rootPath;
}

function coordinationPaths(root, branch) {
  const allowed = new Set();
  for (const kind of Object.keys(ARTIFACTS)) {
    allowed.add(ARTIFACTS[kind]);
    allowed.add(path.relative(root, artifactPath(root, kind, branch)).split(path.sep).join('/'));
  }
  return allowed;
}

// Minimal glob -> RegExp: supports **, **/ (zero-or-more dirs), *, ?, literals.
function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') { re += '(?:.*/)?'; i += 2; }
        else { re += '.*'; i += 1; }
      } else { re += '[^/]*'; }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      re += '\\' + c;
    } else { re += c; }
  }
  return new RegExp('^' + re + '$');
}

function matchesAny(patterns, rel) {
  return patterns.some(p => globToRegExp(p).test(rel));
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => { input += c; });
process.stdin.on('end', () => {
  try {
    const event = JSON.parse(input);
    const filePath = event.tool_input && event.tool_input.file_path;
    if (!filePath) process.exit(0);

    const root = path.resolve(__dirname, '..', '..'); // .claude/hooks/ -> repo root
    const branch = currentBranch(root);
    const scopePath = artifactPath(root, 'scope', branch);
    if (!fs.existsSync(scopePath)) process.exit(0); // no cell scope => unrestricted

    const scope = JSON.parse(fs.readFileSync(scopePath, 'utf8'));
    const rel = path.relative(root, path.resolve(filePath)).split(path.sep).join('/');
    if (rel.startsWith('..')) process.exit(0); // outside repo

    if (coordinationPaths(root, branch).has(rel)) process.exit(0);

    const allowed = Array.isArray(scope.allowedPaths) && scope.allowedPaths.length > 0 &&
      matchesAny(scope.allowedPaths, rel);
    const forbidden = Array.isArray(scope.forbiddenPaths) && matchesAny(scope.forbiddenPaths, rel);

    if (!allowed || forbidden) {
      process.stderr.write(
        `Scope violation: ${rel} is outside this cell's SCOPE.json allowedPaths ` +
        `(or matches forbiddenPaths). If you genuinely need this file, stop and write BLOCKER.md ` +
        `explaining why, rather than editing outside your lane.`
      );
      process.exit(2); // non-zero blocks the tool call
    }
    process.exit(0);
  } catch {
    process.exit(0); // fail open: never block on hook error
  }
});
