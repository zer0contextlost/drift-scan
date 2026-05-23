import { DriftConfig, Severity, Violation } from '../types';

function zoneSeverity(zone: string, config: DriftConfig): number {
  const idx = config.layers.indexOf(zone);
  if (idx === -1) return 1;
  // Earlier layers are more critical (domain = index 0 = highest severity)
  return Math.max(1, config.layers.length - idx);
}

function scoreViolation(v: Violation, config: DriftConfig): number {
  const base = v.type === 'circular'
    ? (v.cycleChain?.length ?? 2)
    : v.fanout * 2;

  const zs = zoneSeverity(v.fromZone, config);
  return base + zs;
}

function toSeverity(score: number): Severity {
  if (score >= 12) return 'critical';
  if (score >= 8) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

export function rankViolations(violations: Violation[], config: DriftConfig): Violation[] {
  return violations
    .map((v) => {
      const score = scoreViolation(v, config);
      return { ...v, score, severity: toSeverity(score) };
    })
    .sort((a, b) => b.score - a.score);
}
