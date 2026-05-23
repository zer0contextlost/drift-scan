export type ViolationType = 'layer' | 'circular' | 'undeclared';
export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface Zone {
  paths: string[];
  canImport: string[];
}

export interface ConfigException {
  from: string;    // glob pattern matched against fromFile (relative to project root)
  to?: string;     // glob pattern matched against toFile (optional — any target if omitted)
  reason?: string; // human note, not used at runtime
}

export interface DriftConfig {
  layers: string[];
  zones: Record<string, Zone>;
  ignore: string[];
  exceptions?: ConfigException[];
}

export interface ImportStatement {
  fromFile: string;
  toPath: string;
  line: number;
  typeOnly?: boolean;   // true for TypeScript `import type` statements
  suppress?: boolean;   // true when a drift-ignore comment is present on or above the import line
}

export interface DependencyNode {
  file: string;
  zone: string | null;
  imports: ImportStatement[];
}

export interface Violation {
  id: string;
  type: ViolationType;
  severity: Severity;
  score: number;
  fromFile: string;
  fromZone: string;
  toFile: string;
  toZone: string;
  importLine: number;
  description: string;
  suggestedFix: string;
  fanout: number;       // number of same-zone files that import fromFile (transitive exposure)
  typeOnly?: boolean;   // true if the violating import is type-only (import type)
  cycleChain?: string[];
}

export interface ScanResult {
  version: string;
  scannedFiles: number;
  violations: Violation[];
  durationMs: number;
  excepted?: number;          // violations suppressed by config exceptions
  baselineSuppressed?: number; // violations suppressed by --from-baseline
}
