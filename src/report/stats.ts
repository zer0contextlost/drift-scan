import path from 'path';
import { DependencyNode, DriftConfig, Violation } from '../types';

interface ZoneStat {
  name: string;
  files: number;
  crossZoneImports: number;
  violations: number;
}

function toFwdSlash(p: string): string {
  return p.split('\\').join('/');
}

function relPath(absPath: string, rootDir: string): string {
  return toFwdSlash(path.relative(rootDir, absPath));
}

export async function printStats(
  nodes: DependencyNode[],
  violations: Violation[],
  config: DriftConfig,
  rootDir: string,
): Promise<void> {
  const { default: chalk } = await import('chalk');

  // Build per-zone stats
  const zoneFiles = new Map<string, number>();
  const zoneCrossImports = new Map<string, number>();

  for (const node of nodes) {
    if (!node.zone) continue;
    zoneFiles.set(node.zone, (zoneFiles.get(node.zone) ?? 0) + 1);

    for (const imp of node.imports) {
      const toNode = nodes.find((n) => {
        const nf = toFwdSlash(n.file);
        const tf = toFwdSlash(imp.toPath);
        return nf === tf || nf === tf + '.ts' || nf === tf + '.py' || nf === tf + '.go' ||
          nf === tf + '/index.ts' || nf === tf + '/__init__.py' ||
          (nf.startsWith(tf + '/') && nf.endsWith('.go'));
      });
      if (toNode?.zone && toNode.zone !== node.zone) {
        zoneCrossImports.set(node.zone, (zoneCrossImports.get(node.zone) ?? 0) + 1);
      }
    }
  }

  // Violation counts per zone
  const zoneViolations = new Map<string, number>();
  for (const v of violations) {
    zoneViolations.set(v.fromZone, (zoneViolations.get(v.fromZone) ?? 0) + 1);
  }

  const stats: ZoneStat[] = config.layers
    .filter((l) => config.zones[l])
    .map((name) => ({
      name,
      files: zoneFiles.get(name) ?? 0,
      crossZoneImports: zoneCrossImports.get(name) ?? 0,
      violations: zoneViolations.get(name) ?? 0,
    }));

  // Health score: of all cross-zone imports between defined zones, what fraction are clean?
  // Undeclared violations are excluded — they come from files outside any zone, which
  // aren't represented in the cross-zone import denominator.
  const totalCross = stats.reduce((s, z) => s + z.crossZoneImports, 0);
  const structuralViols = violations.filter((v) => v.type === 'layer' || v.type === 'circular').length;
  const totalViols = violations.length;
  const health = totalCross === 0
    ? (structuralViols === 0 ? 100 : 0)
    : Math.round(Math.max(0, (1 - structuralViols / totalCross) * 100));

  const totalFiles = nodes.length;
  const unzoned = nodes.filter((n) => !n.zone).length;

  // Column widths
  const nameW = Math.max(4, ...stats.map((s) => s.name.length));
  const pad = (s: string | number, w: number, right = false) =>
    right ? String(s).padStart(w) : String(s).padEnd(w);

  console.log('');
  console.log(chalk.bold('  Architecture stats'));
  console.log('');
  console.log(
    `  ${pad('Zone', nameW)}  ${pad('Files', 5, true)}  ${pad('Cross-imports', 13, true)}  ${pad('Violations', 10, true)}`
  );
  console.log(`  ${'─'.repeat(nameW + 34)}`);

  for (const z of stats) {
    const violStr = z.violations > 0
      ? chalk.red(pad(z.violations, 10, true))
      : chalk.green(pad(z.violations, 10, true));
    console.log(
      `  ${pad(z.name, nameW)}  ${pad(z.files, 5, true)}  ${pad(z.crossZoneImports, 13, true)}  ${violStr}`
    );
  }

  if (unzoned > 0) {
    console.log(`  ${pad('(unzoned)', nameW)}  ${pad(unzoned, 5, true)}`);
  }

  console.log('');

  const healthColor = health >= 90 ? chalk.green : health >= 70 ? chalk.yellow : chalk.red;
  const violSummary = structuralViols !== totalViols
    ? `${structuralViols} structural · ${totalViols - structuralViols} undeclared`
    : `${totalViols} violations`;
  console.log(`  Health score: ${healthColor.bold(health + '%')}  (${violSummary} · ${totalFiles} files)`);

  // Top hotspots by fanout
  const byFanout = [...violations]
    .sort((a, b) => b.fanout - a.fanout || b.score - a.score)
    .slice(0, 5);

  if (byFanout.length > 0) {
    console.log('');
    console.log('  Hotspots (highest fanout):');
    for (const v of byFanout) {
      const icon = v.severity === 'critical' ? '●' : v.severity === 'high' ? '◐' : v.severity === 'medium' ? '◌' : '○';
      const col = v.severity === 'critical' || v.severity === 'high' ? chalk.red : chalk.yellow;
      console.log(
        `    ${col(icon)} ${relPath(v.fromFile, rootDir)}  ${chalk.gray('→')}  ${v.toZone}` +
        (v.fanout > 0 ? chalk.gray(`  (fanout ${v.fanout})`) : '')
      );
    }
  }

  // Violation breakdown by type
  const byType = { layer: 0, circular: 0, undeclared: 0 };
  for (const v of violations) byType[v.type]++;
  if (totalViols > 0) {
    const parts = [];
    if (byType.layer)      parts.push(`${byType.layer} layer`);
    if (byType.circular)   parts.push(`${byType.circular} circular`);
    if (byType.undeclared) parts.push(`${byType.undeclared} undeclared`);
    console.log('');
    console.log(`  Violation types: ${parts.join(' · ')}`);
  }

  console.log('');
}
