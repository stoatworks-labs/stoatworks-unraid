// Locate an app repo's checkout on this machine.
//
// The repo tree was reorganised on 2026-08-17 from one flat ~/projects into
// three, each subdivided by discipline:
//
//   ~/projects/<category>/<repo>            software
//   ~/hardware/<category>/<repo>            hardware
//   ~/reverse-engineering/<category>/<repo> protocol work
//
// Both generators resolved `join($HOME/Projects, repo)` and therefore found
// NOTHING after the move. That failure is quiet in the worst way: gen-docker
// prints "Wrote 0 files" and lists every repo under "Notes", which reads like
// "nothing needed doing" rather than "I could not find any of your code".
//
// Kept deliberately simple — a two-level scan of three known roots, not a
// recursive search — so it cannot wander into node_modules or a build tree and
// return a directory that merely shares a name.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const HOME = process.env.HOME;

/** The roots, in priority order. */
export const ROOTS = [
  join(HOME, 'projects'),
  join(HOME, 'hardware'),
  join(HOME, 'reverse-engineering'),
];

/**
 * Resolve a repo directory name to an absolute path, or null.
 *
 * `override` is the old --projects / PROJECTS_DIR flat directory. When given it
 * wins outright, so the pre-move behaviour is still reachable for a checkout
 * laid out some other way (CI, a worktree, a colleague's machine).
 */
export function resolveRepo(name, override = null) {
  if (override) {
    const flat = join(override, name);
    return existsSync(flat) ? flat : null;
  }

  for (const root of ROOTS) {
    if (!existsSync(root)) continue;

    // A repo sitting directly in a root (pre-move leftovers, and the roots
    // themselves are not category-only by guarantee).
    const direct = join(root, name);
    if (existsSync(direct)) return direct;

    for (const category of readdirSync(root)) {
      if (category.startsWith('.')) continue;
      const catDir = join(root, category);
      try {
        if (!statSync(catDir).isDirectory()) continue;
      } catch {
        continue;
      }
      const candidate = join(catDir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}
