import path from 'path';
import { Violation, DriftConfig } from '../types';
import { matchGlob } from '../util/glob';

function toFwdSlash(p: string): string {
  return p.split('\\').join('/');
}

function relPath(absPath: string, rootDir: string): string {
  return toFwdSlash(path.relative(rootDir, absPath));
}

export function applyExceptions(
  violations: Violation[],
  rootDir: string,
  config: DriftConfig,
): { kept: Violation[]; excepted: number } {
  if (!config.exceptions?.length) return { kept: violations, excepted: 0 };

  const kept: Violation[] = [];
  let excepted = 0;

  for (const v of violations) {
    const relFrom = relPath(v.fromFile, rootDir);
    const relTo   = relPath(v.toFile, rootDir);

    const matched = (config.exceptions ?? []).some((ex) => {
      if (!matchGlob(ex.from, relFrom)) return false;
      if (ex.to && !matchGlob(ex.to, relTo)) return false;
      return true;
    });

    if (matched) {
      excepted++;
    } else {
      kept.push(v);
    }
  }

  return { kept, excepted };
}
