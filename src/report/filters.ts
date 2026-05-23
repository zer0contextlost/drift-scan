import { Violation, Severity } from '../types';

export function filterBySeverity(violations: Violation[], min: Severity): Violation[] {
  const order: Severity[] = ['low', 'medium', 'high', 'critical'];
  const idx = order.indexOf(min);
  if (idx === -1) return violations;
  return violations.filter((v) => order.indexOf(v.severity) >= idx);
}
