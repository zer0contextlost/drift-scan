import path from 'path';
import fs from 'fs';
import { DriftConfig, DependencyNode } from '../types';
import { crawlFiles } from '../crawler';
import { buildGraph } from '../graph/builder';
import { readGoModuleName } from '../parsers/go';
import { readTsPathConfig } from '../config/tsconfig';
import { resolveToFile } from '../util/resolve';

export interface InitResult {
  config: DriftConfig;
  warnings: string[];
  cycleWarnings: string[];
  zoneFileCounts: Record<string, number>;
}

function norm(p: string) { return p.split('\\').join('/'); }

const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', '__pycache__', 'vendor',
  '.git', 'public', '.venv', 'venv', 'env', 'coverage', '.cache',
  'storybook-static', '.next', '.nuxt', 'target', 'bin', 'obj',
]);

export function detectSourceRoot(dir: string): string {
  for (const candidate of ['src', 'lib', 'app', 'pkg']) {
    const p = path.join(dir, candidate);
    if (!fs.existsSync(p) || !fs.statSync(p).isDirectory()) continue;
    // If there's exactly one sub-package and IT has sub-directories, drill into it.
    // Common for Python src-layout: src/mypackage/{subpkg1,subpkg2,...}
    const subs = getSubdirs(p);
    if (subs.length === 1) {
      const inner = path.join(p, subs[0]);
      if (getSubdirs(inner).length > 0) return inner;
    }
    return p;
  }
  // No src/ etc — check if the dir itself has a single package directory
  const subs = getSubdirs(dir);
  if (subs.length === 1) {
    const inner = path.join(dir, subs[0]);
    if (getSubdirs(inner).length > 0) return inner;
  }
  return dir;
}

function getSubdirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.') && !SKIP_DIRS.has(d.name))
      .map(d => d.name)
      .sort();
  } catch { return []; }
}

interface TopoResult { sorted: string[]; cycles: Array<[string, string]> }

function topologicalSort(zones: string[], edges: Map<string, Set<string>>): TopoResult {
  // edges: fromZone → Set<toZone>  (fromZone imports toZone)
  // Goal: toZone appears before fromZone in output (lower-level first).
  // inDegree[z] = number of distinct zones that z imports from (i.e. its dependencies).
  // Zones with inDegree=0 have no dependencies → they go first (bottom of the stack).
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, Set<string>>(); // toZone → zones that import it

  for (const z of zones) { inDegree.set(z, 0); dependents.set(z, new Set()); }

  for (const [from, tos] of edges) {
    if (!zones.includes(from)) continue;
    const uniqueTos = new Set([...tos].filter(t => zones.includes(t) && t !== from));
    inDegree.set(from, uniqueTos.size);
    for (const to of uniqueTos) dependents.get(to)!.add(from);
  }

  const queue: string[] = zones.filter(z => inDegree.get(z) === 0).sort();
  const sorted: string[] = [];
  const visited = new Set<string>();

  while (queue.length > 0) {
    queue.sort();
    const z = queue.shift()!;
    if (visited.has(z)) continue;
    visited.add(z);
    sorted.push(z);
    for (const dep of (dependents.get(z) ?? [])) {
      const d = (inDegree.get(dep) ?? 1) - 1;
      inDegree.set(dep, d);
      if (d === 0) queue.push(dep);
    }
  }

  const inCycle = zones.filter(z => !visited.has(z)).sort();
  sorted.push(...inCycle);

  const cycles: Array<[string, string]> = [];
  for (const z of inCycle) {
    for (const other of (edges.get(z) ?? [])) {
      if (inCycle.includes(other) && edges.get(other)?.has(z)) {
        if (!cycles.some(([a, b]) => a === other && b === z)) cycles.push([z, other]);
      }
    }
  }

  return { sorted, cycles };
}

export async function inferConfig(dir: string): Promise<InitResult> {
  const warnings: string[] = [];
  const sourceRoot = detectSourceRoot(dir);
  const subdirs = getSubdirs(sourceRoot);

  const relSrcPrefix = sourceRoot !== dir
    ? norm(path.relative(dir, sourceRoot)) + '/'
    : '';

  if (subdirs.length === 0) {
    warnings.push('No subdirectories found — all files will be in one zone. Add zones manually.');
    return {
      config: { layers: [], zones: {}, ignore: defaultIgnore() },
      warnings,
      cycleWarnings: [],
      zoneFileCounts: {},
    };
  }

  // Detect root-level source files in the sourceRoot (not in any subdir)
  const ROOT_ZONE = path.basename(sourceRoot); // e.g. "flask" for src/flask/
  const hasRootFiles = fs.readdirSync(sourceRoot, { withFileTypes: true })
    .some(f => f.isFile() && /\.(ts|tsx|js|jsx|py|go)$/.test(f.name)
      && !f.name.startsWith('__') && f.name !== '__init__.py');
  // Only add root zone if the name doesn't clash with a subdir
  const useRootZone = hasRootFiles && !subdirs.includes(ROOT_ZONE);

  // Synthetic config: one zone per subdir, no rules yet
  const syntheticZones: DriftConfig['zones'] = {};
  for (const sub of subdirs) {
    syntheticZones[sub] = { paths: [`${relSrcPrefix}${sub}/**`], canImport: [] };
  }
  if (useRootZone) {
    // Root-level files: match *.ext directly in sourceRoot, not in subdirs
    const rootPatterns = ['ts', 'tsx', 'js', 'jsx', 'py', 'go']
      .map(ext => `${relSrcPrefix}*.${ext}`);
    syntheticZones[ROOT_ZONE] = { paths: rootPatterns, canImport: [] };
  }

  const allZoneNames = useRootZone ? [...subdirs, ROOT_ZONE] : subdirs;
  const syntheticConfig: DriftConfig = {
    layers: allZoneNames,
    zones: syntheticZones,
    ignore: defaultIgnore(),
  };

  const goModuleName = await readGoModuleName(dir) ?? undefined;
  const tsPathConfig = readTsPathConfig(dir) ?? undefined;
  const ctx = { projectRoot: dir, goModuleName, tsPathConfig };

  let nodes: DependencyNode[] = [];
  try {
    const files = await crawlFiles(dir, syntheticConfig);
    nodes = await buildGraph(files, dir, syntheticConfig, ctx);
  } catch (e) {
    warnings.push(`Import analysis failed: ${(e as Error).message}. Zones inferred from directory structure only.`);
  }

  // File counts per zone
  const zoneFileCounts: Record<string, number> = {};
  for (const z of allZoneNames) zoneFileCounts[z] = 0;
  for (const n of nodes) {
    if (n.zone) zoneFileCounts[n.zone] = (zoneFileCounts[n.zone] ?? 0) + 1;
  }

  // Zone → zone import edges (runtime only, no typeOnly)
  const edges = new Map<string, Set<string>>();
  const nodeByFile = new Map(nodes.map(n => [n.file, n]));

  for (const node of nodes) {
    if (!node.zone) continue;
    for (const imp of node.imports) {
      if (imp.typeOnly || imp.suppress) continue;
      const toFile = resolveToFile(imp.toPath, nodeByFile);
      if (!toFile) continue;
      const toZone = nodeByFile.get(toFile)?.zone;
      if (!toZone || toZone === node.zone) continue;
      if (!edges.has(node.zone)) edges.set(node.zone, new Set());
      edges.get(node.zone)!.add(toZone);
    }
  }

  // Only keep zones with actual files
  const activeZones = allZoneNames.filter(z => (zoneFileCounts[z] ?? 0) > 0);
  if (activeZones.length < allZoneNames.length) {
    const empty = allZoneNames.filter(z => !activeZones.includes(z));
    warnings.push(`Empty zones omitted: ${empty.join(', ')}`);
  }

  const { sorted: layers, cycles } = topologicalSort(activeZones, edges);

  // Build canImport + correct paths per zone
  const zones: DriftConfig['zones'] = {};
  for (let i = 0; i < layers.length; i++) {
    const z = layers[i];
    const direct = [...(edges.get(z) ?? [])];
    const canImport = direct.filter(dep => layers.indexOf(dep) < i);
    // Root zone gets multi-extension root patterns; subdirs get recursive glob
    const paths = (z === ROOT_ZONE && useRootZone)
      ? ['ts', 'tsx', 'js', 'jsx', 'py', 'go'].map(ext => `${relSrcPrefix}*.${ext}`)
      : [`${relSrcPrefix}${z}/**`];
    zones[z] = { paths, canImport };
  }

  const cycleWarnings = cycles.map(([a, b]) =>
    `"${a}" ↔ "${b}" have a circular dependency — review their canImport entries`
  );

  return {
    config: { layers, zones, ignore: defaultIgnore() },
    warnings,
    cycleWarnings,
    zoneFileCounts,
  };
}

function defaultIgnore(): string[] {
  return [
    '**/*.test.ts', '**/*.spec.ts', '**/*.test.js', '**/*.spec.js',
    '**/*_test.go', '**/test_*.py', '**/*_test.py', '**/conftest.py',
    '**/tests/**', '**/test/**', '**/__pycache__/**', '**/*.d.ts',
  ];
}
