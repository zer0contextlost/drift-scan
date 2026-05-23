import fs from 'fs';
import path from 'path';
import { Violation } from '../types';

interface BaselineFile {
  createdAt: string;
  version: string;
  totalViolations: number;
  fingerprints: string[];
}

function toFwdSlash(p: string): string {
  return p.split('\\').join('/');
}

function relPath(absPath: string, rootDir: string): string {
  return toFwdSlash(path.relative(rootDir, absPath));
}

// Stable fingerprint that survives re-runs as long as the import line doesn't move.
export function fingerprint(v: Violation, rootDir: string): string {
  if (v.type === 'circular' && v.cycleChain) {
    const chain = [...v.cycleChain].map((f) => relPath(f, rootDir)).sort().join('|');
    return `circular:${chain}`;
  }
  return `${v.type}:${relPath(v.fromFile, rootDir)}:${relPath(v.toFile, rootDir)}:${v.importLine}`;
}

export function saveBaseline(violations: Violation[], rootDir: string, outPath: string, version: string): void {
  const data: BaselineFile = {
    createdAt: new Date().toISOString(),
    version,
    totalViolations: violations.length,
    fingerprints: violations.map((v) => fingerprint(v, rootDir)),
  };
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2) + '\n');
}

export function loadBaseline(filePath: string): Set<string> {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as BaselineFile;
    return new Set(raw.fingerprints ?? []);
  } catch (e) {
    throw new Error(`Could not read baseline file "${filePath}": ${(e as Error).message}`);
  }
}

export function filterByBaseline(
  violations: Violation[],
  baseline: Set<string>,
  rootDir: string,
): { kept: Violation[]; suppressed: number } {
  const kept: Violation[] = [];
  let suppressed = 0;
  for (const v of violations) {
    if (baseline.has(fingerprint(v, rootDir))) {
      suppressed++;
    } else {
      kept.push(v);
    }
  }
  return { kept, suppressed };
}
