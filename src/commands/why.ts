import path from 'path';
import { DependencyNode, DriftConfig, Violation } from '../types';
import { resolveToFile } from '../util/resolve';

const SEV_ICON: Record<string, string> = { critical: '●', high: '◐', medium: '◌', low: '○' };

function rel(rootDir: string, f: string): string {
  return path.relative(rootDir, f).split('\\').join('/');
}

export async function printWhy(
  targetFile: string,
  nodes: DependencyNode[],
  violations: Violation[],
  config: DriftConfig,
  rootDir: string,
): Promise<void> {
  const { default: chalk } = await import('chalk');

  const node = nodes.find(n => n.file === targetFile);
  const nodeByFile = new Map(nodes.map(n => [n.file, n]));

  const zoneIdx = node?.zone ? config.layers.indexOf(node.zone) : -1;
  const zoneConfig = node?.zone ? config.zones[node.zone] : undefined;

  console.log('');
  console.log(`  ${chalk.bold.white(rel(rootDir, targetFile))}`);
  console.log(`  zone   ${node?.zone ? chalk.cyan(node.zone) : chalk.gray('(unzoned)')}`);
  if (zoneConfig && zoneIdx >= 0) {
    const layerStr = `layer ${zoneIdx + 1} of ${config.layers.length}`;
    const canStr = zoneConfig.canImport.length > 0
      ? zoneConfig.canImport.map(z => chalk.cyan(z)).join(', ')
      : chalk.gray('none');
    console.log(`  layer  ${layerStr}`);
    console.log(`  can import  ${canStr}`);
  }

  // ── Imports ────────────────────────────────────────────────────────────────
  const importsByZone = new Map<string, Array<{ toFile: string; line: number; typeOnly?: boolean }>>();
  const unresolved: Array<{ toPath: string; line: number }> = [];

  for (const imp of node?.imports ?? []) {
    const toFile = resolveToFile(imp.toPath, nodeByFile);
    if (!toFile) {
      // Skip obvious external packages (no path separator in them)
      if (!imp.toPath.includes('/') && !imp.toPath.startsWith('.')) continue;
      unresolved.push({ toPath: imp.toPath, line: imp.line });
      continue;
    }
    const toZone = nodeByFile.get(toFile)?.zone ?? '(unzoned)';
    if (!importsByZone.has(toZone)) importsByZone.set(toZone, []);
    importsByZone.get(toZone)!.push({ toFile, line: imp.line, typeOnly: imp.typeOnly });
  }

  console.log('');
  if (importsByZone.size === 0 && unresolved.length === 0) {
    console.log(`  ${chalk.gray('no internal imports')}`);
  } else {
    const totalImports = [...importsByZone.values()].reduce((s, a) => s + a.length, 0);
    console.log(`  ${chalk.bold('imports')}  (${totalImports} cross-zone)`);
    for (const [zone, imps] of [...importsByZone.entries()].sort()) {
      if (zone === node?.zone) continue; // skip same-zone
      const allowed = zoneConfig?.canImport.includes(zone);
      const marker = allowed === false ? chalk.red('✗') : chalk.green('✓');
      console.log(`    ${marker} ${chalk.cyan(zone)}  (${imps.length})`);
      for (const { toFile, line, typeOnly } of imps.slice(0, 4)) {
        const tag = typeOnly ? chalk.gray(' [type]') : '';
        console.log(`        ${chalk.gray('L' + line)}  ${rel(rootDir, toFile)}${tag}`);
      }
      if (imps.length > 4) console.log(`        ${chalk.gray(`… ${imps.length - 4} more`)}`);
    }
  }

  // ── Dependents ─────────────────────────────────────────────────────────────
  const dependentsByZone = new Map<string, Array<{ fromFile: string; line: number }>>();
  for (const n of nodes) {
    if (n.file === targetFile) continue;
    for (const imp of n.imports) {
      const resolved = resolveToFile(imp.toPath, nodeByFile);
      if (resolved !== targetFile) continue;
      const zone = n.zone ?? '(unzoned)';
      if (!dependentsByZone.has(zone)) dependentsByZone.set(zone, []);
      dependentsByZone.get(zone)!.push({ fromFile: n.file, line: imp.line });
    }
  }

  console.log('');
  if (dependentsByZone.size === 0) {
    console.log(`  ${chalk.gray('nothing imports this file')}`);
  } else {
    const totalDeps = [...dependentsByZone.values()].reduce((s, a) => s + a.length, 0);
    console.log(`  ${chalk.bold('imported by')}  (${totalDeps} files)`);
    for (const [zone, deps] of [...dependentsByZone.entries()].sort()) {
      console.log(`    ${chalk.cyan(zone)}  (${deps.length})`);
      for (const { fromFile, line } of deps.slice(0, 4)) {
        console.log(`        ${chalk.gray('L' + line)}  ${rel(rootDir, fromFile)}`);
      }
      if (deps.length > 4) console.log(`        ${chalk.gray(`… ${deps.length - 4} more`)}`);
    }
  }

  // ── Violations ─────────────────────────────────────────────────────────────
  const fileViols = violations.filter(v => v.fromFile === targetFile || v.toFile === targetFile);
  console.log('');
  if (fileViols.length === 0) {
    console.log(`  ${chalk.green('✓')} no violations`);
  } else {
    console.log(`  ${chalk.bold('violations')}  (${fileViols.length})`);
    for (const v of fileViols) {
      const icon = SEV_ICON[v.severity] ?? '○';
      const sev = chalk[v.severity === 'critical' ? 'red' : v.severity === 'high' ? 'yellow' : 'white'](v.severity.toUpperCase());
      console.log(`    ${icon} ${sev}  ${v.description}`);
    }
  }

  console.log('');
}
