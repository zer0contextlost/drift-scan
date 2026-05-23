import path from 'path';
import { ScanResult, Severity, Violation } from '../types';

const VERSION = '2.0.0';
const TOOL_URI = 'https://github.com/zer0contextlost/drift-scan';

function severityToLevel(severity: Severity): string {
  switch (severity) {
    case 'critical': return 'error';
    case 'high':     return 'error';
    case 'medium':   return 'warning';
    case 'low':      return 'note';
  }
}

function ruleId(v: Violation): string {
  return `drift/${v.type}/${v.fromZone}→${v.toZone}`;
}

function ruleDescription(v: Violation): string {
  switch (v.type) {
    case 'layer':      return `Layer boundary violation: ${v.fromZone} must not import ${v.toZone}`;
    case 'circular':   return `Circular dependency across zone boundary`;
    case 'undeclared': return `Unzoned file imports from declared zone`;
  }
}

function toRelUri(filePath: string): string {
  const rel = path.relative(process.cwd(), filePath).split('\\').join('/');
  return rel.startsWith('.') ? rel : `./${rel}`;
}

export function formatSarif(result: ScanResult): string {
  // Deduplicate rules by ruleId
  const rulesMap = new Map<string, object>();
  for (const v of result.violations) {
    const id = ruleId(v);
    if (!rulesMap.has(id)) {
      rulesMap.set(id, {
        id,
        name: `Drift${v.type.charAt(0).toUpperCase() + v.type.slice(1)}`,
        shortDescription: { text: ruleDescription(v) },
        helpUri: TOOL_URI,
        properties: { tags: ['architecture', 'maintainability'] },
      });
    }
  }

  const results = result.violations.map((v) => ({
    ruleId: ruleId(v),
    level: severityToLevel(v.severity),
    message: {
      text: `${v.description}. Fix: ${v.suggestedFix}`,
    },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: toRelUri(v.fromFile), uriBaseId: '%SRCROOT%' },
          region: v.importLine > 0 ? { startLine: v.importLine } : undefined,
        },
      },
    ],
    properties: {
      score: v.score,
      fanout: v.fanout,
      fromZone: v.fromZone,
      toZone: v.toZone,
      ...(v.typeOnly ? { typeOnly: true } : {}),
      ...(v.cycleChain ? { cycleChain: v.cycleChain.map(toRelUri) } : {}),
    },
  }));

  const sarif = {
    $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'drift-scan',
            version: VERSION,
            informationUri: TOOL_URI,
            rules: Array.from(rulesMap.values()),
          },
        },
        results,
        properties: {
          scannedFiles: result.scannedFiles,
          durationMs: result.durationMs,
        },
      },
    ],
  };

  return JSON.stringify(sarif, null, 2);
}
