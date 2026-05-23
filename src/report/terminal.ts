import path from 'path';
import { ScanResult, Severity } from '../types';

const VERSION = '1.0.0';

const SEVERITY_ICONS: Record<Severity, string> = {
  critical: '●',
  high: '◐',
  medium: '◌',
  low: '○',
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function rel(file: string): string {
  return path.relative(process.cwd(), file);
}

export async function printReport(result: ScanResult, targetDir: string): Promise<void> {
  const { default: chalk } = await import('chalk');

  const { violations, scannedFiles, durationMs } = result;

  console.log('');
  console.log(`  ${chalk.bold(`DRIFT v${VERSION}`)}  —  architectural drift analysis`);
  console.log(`  target: ${targetDir}`);
  console.log('');

  if (violations.length === 0) {
    console.log(`  ${chalk.green('✓')} no violations found`);
    console.log('');
    console.log(`  scanned ${scannedFiles} files in ${formatDuration(durationMs)}`);
    console.log('');
    return;
  }

  const byType = {
    layer: violations.filter((v) => v.type === 'layer').length,
    circular: violations.filter((v) => v.type === 'circular').length,
    undeclared: violations.filter((v) => v.type === 'undeclared').length,
  };

  console.log(`  violations found: ${chalk.bold(String(violations.length))}`);
  if (byType.layer > 0)      console.log(`    layer       ${byType.layer}`);
  if (byType.circular > 0)   console.log(`    circular    ${byType.circular}`);
  if (byType.undeclared > 0) console.log(`    undeclared  ${byType.undeclared}`);
  console.log('');
  console.log(`  ━━━ VIOLATIONS  (ranked by blast radius)  ━━━`);
  console.log('');

  const colorMap: Record<Severity, (t: string) => string> = {
    critical: chalk.red,
    high: chalk.yellow,
    medium: chalk.cyan,
    low: chalk.gray,
  };

  for (const v of violations) {
    const icon = SEVERITY_ICONS[v.severity];
    const color = colorMap[v.severity];

    if (v.type === 'layer') {
      const typeTag = v.typeOnly ? chalk.gray(' [type-only]') : '';
      const title = `${icon} ${v.severity.toUpperCase()}  ${rel(v.fromFile)} → ${rel(v.toFile)}`;
      console.log(`  ${color(title)}${typeTag}`);
      console.log(`    ${v.description}`);
      if (v.fanout > 0) {
        console.log(`    ├─ ${v.fanout} same-zone file${v.fanout !== 1 ? 's' : ''} import this file (transitive exposure)`);
      }
      console.log(`    └─ ${chalk.green('fix →')} ${v.suggestedFix}`);
    } else if (v.type === 'circular') {
      const chain = v.cycleChain?.map(rel).join(' → ') ?? `${rel(v.fromFile)} → ${rel(v.toFile)}`;
      const title = `${icon} ${v.severity.toUpperCase()}  ${rel(v.fromFile)} ⟲ ${rel(v.toFile)}`;
      console.log(`  ${color(title)}`);
      console.log(`    ${v.description}`);
      console.log(`    ├─ ${chain}`);
      console.log(`    └─ ${chalk.green('fix →')} ${v.suggestedFix}`);
    } else {
      const title = `${icon} ${v.severity.toUpperCase()}  ${rel(v.fromFile)} (unzoned → ${v.toZone})`;
      console.log(`  ${color(title)}`);
      console.log(`    ${v.description}`);
      console.log(`    └─ ${chalk.green('fix →')} ${v.suggestedFix}`);
    }
    console.log('');
  }

  console.log(`  ─────────────────────────────────────────────────────`);
  console.log(`  ${violations.length} violation${violations.length !== 1 ? 's' : ''}  ·  scanned ${scannedFiles} files in ${formatDuration(durationMs)}`);
  console.log('');
}
