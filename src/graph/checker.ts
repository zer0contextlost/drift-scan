import { DependencyNode, DriftConfig, Violation, ViolationType } from '../types';

let violationCounter = 0;

function makeId(type: ViolationType, fromFile: string, line: number): string {
  return `drift-${type}-${fromFile}:${line}-${violationCounter++}`;
}

function norm(p: string): string {
  return p.split('\\').join('/');
}

function resolveToFile(toPath: string, _fromFile: string, nodeByFile: Map<string, DependencyNode>): string | null {
  // Strip .js/.jsx extension — TS projects often import with .js for ESM compatibility
  const stripped = toPath.replace(/\.(js|jsx)$/, '');
  const toNorm = norm(toPath);
  const strippedNorm = norm(stripped);

  for (const file of nodeByFile.keys()) {
    const fileNorm = norm(file);
    // Try both the original path and the stripped version (for .js → .ts resolution)
    for (const base of toNorm === strippedNorm ? [toNorm] : [toNorm, strippedNorm]) {
      if (
        fileNorm === base ||
        fileNorm === base + '.ts' ||
        fileNorm === base + '.tsx' ||
        fileNorm === base + '.js' ||
        fileNorm === base + '.jsx' ||
        fileNorm === base + '.py' ||
        fileNorm === base + '.go' ||
        fileNorm === base + '/index.ts' ||
        fileNorm === base + '/index.js' ||
        fileNorm === base + '/__init__.py' ||
        // Go package imports resolve to a directory — match any .go file inside it
        (fileNorm.startsWith(base + '/') && fileNorm.endsWith('.go'))
      ) {
        return file;
      }
    }
  }
  return null;
}

// Count how many files in the same zone import a given file
function buildInboundCounts(nodes: DependencyNode[], nodeByFile: Map<string, DependencyNode>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    for (const imp of node.imports) {
      const toFile = resolveToFile(imp.toPath, node.file, nodeByFile);
      if (!toFile) continue;
      const toNode = nodeByFile.get(toFile);
      if (!toNode) continue;
      // Only count inbound from the same zone (transitive same-zone exposure)
      if (toNode.zone && node.zone === toNode.zone) {
        counts.set(toFile, (counts.get(toFile) ?? 0) + 1);
      }
    }
  }
  return counts;
}

export function checkGraph(nodes: DependencyNode[], config: DriftConfig): Violation[] {
  violationCounter = 0;
  const violations: Violation[] = [];
  const nodeByFile = new Map(nodes.map((n) => [n.file, n]));
  const inboundCounts = buildInboundCounts(nodes, nodeByFile);

  for (const node of nodes) {
    for (const imp of node.imports) {
      if (imp.suppress || imp.typeOnly) continue;
      const toFile = resolveToFile(imp.toPath, node.file, nodeByFile);
      if (!toFile) continue;

      const toNode = nodeByFile.get(toFile);
      if (!toNode) continue;

      const fromZone = node.zone;
      const toZone = toNode.zone;

      if (!toZone) continue;

      if (!fromZone) {
        violations.push({
          id: makeId('undeclared', node.file, imp.line),
          type: 'undeclared',
          severity: 'low',
          score: 1,
          fromFile: node.file,
          fromZone: '(unzoned)',
          toFile,
          toZone,
          importLine: imp.line,
          description: `file outside any declared zone imports from zone "${toZone}"`,
          suggestedFix: `assign this file to a zone in .driftrc.json or add it to the ignore list`,
          fanout: 0,
          typeOnly: imp.typeOnly,
        });
        continue;
      }

      const zoneConfig = config.zones[fromZone];
      if (!zoneConfig) continue;

      if (toZone !== fromZone && !zoneConfig.canImport.includes(toZone)) {
        violations.push({
          id: makeId('layer', node.file, imp.line),
          type: 'layer',
          severity: 'low',
          score: 0,
          fromFile: node.file,
          fromZone,
          toFile,
          toZone,
          importLine: imp.line,
          description: `${fromZone} imports ${toZone} — "${fromZone}" is not permitted to depend on "${toZone}"`,
          suggestedFix: suggestLayerFix(fromZone, toZone),
          fanout: inboundCounts.get(node.file) ?? 0,
          typeOnly: imp.typeOnly,
        });
      }
    }
  }

  // Circular dependency detection
  const cycles = detectCycles(nodes, nodeByFile);
  for (const cycle of cycles) {
    const fromFile = cycle[0];
    const toFile = cycle[cycle.length - 1];
    const fromNode = nodeByFile.get(fromFile);
    const toNode = nodeByFile.get(toFile);
    violations.push({
      id: makeId('circular', fromFile, 0),
      type: 'circular',
      severity: 'low',
      score: 0,
      fromFile,
      fromZone: fromNode?.zone ?? '(unzoned)',
      toFile,
      toZone: toNode?.zone ?? '(unzoned)',
      importLine: 0,
      description: `circular dependency — ${cycle.length}-file cycle`,
      suggestedFix: `extract shared types to a lower layer to break the cycle`,
      fanout: cycle.length,
      cycleChain: cycle,
    });
  }

  return violations;
}

function suggestLayerFix(fromZone: string, toZone: string): string {
  if (fromZone === 'domain' && toZone === 'infrastructure') {
    return `inject a repository interface; implement it in infrastructure`;
  }
  if (fromZone === 'domain') {
    return `move shared abstractions to domain or introduce an interface`;
  }
  return `introduce an interface in a shared lower layer to decouple the dependency`;
}

function detectCycles(nodes: DependencyNode[], nodeByFile: Map<string, DependencyNode>): string[][] {
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(file: string, stack: string[]): void {
    if (inStack.has(file)) {
      const cycleStart = stack.indexOf(file);
      cycles.push([...stack.slice(cycleStart), file]);
      return;
    }
    if (visited.has(file)) return;

    visited.add(file);
    inStack.add(file);
    stack.push(file);

    const node = nodeByFile.get(file);
    if (node) {
      // Deduplicate cross-zone targets to avoid reporting the same cycle once per import statement
      const seen = new Set<string>();
      for (const imp of node.imports) {
        if (imp.typeOnly || imp.suppress) continue;
        const toFile = resolveToFile(imp.toPath, file, nodeByFile);
        if (!toFile || seen.has(toFile)) continue;
        seen.add(toFile);
        const toNode = nodeByFile.get(toFile);
        if (toNode && toNode.zone !== node.zone) {
          dfs(toFile, stack);
        }
      }
    }

    stack.pop();
    inStack.delete(file);
  }

  for (const node of nodes) {
    if (!visited.has(node.file)) {
      dfs(node.file, []);
    }
  }

  return deduplicateCycles(cycles);
}

function deduplicateCycles(cycles: string[][]): string[][] {
  const seen = new Set<string>();
  return cycles.filter((cycle) => {
    // Normalize: find the smallest file in the cycle and rotate to start there
    const nodes = cycle.slice(0, -1); // drop the repeated last node
    const minIdx = nodes.indexOf(nodes.reduce((a, b) => (a < b ? a : b)));
    const rotated = [...nodes.slice(minIdx), ...nodes.slice(0, minIdx)];
    const key = rotated.join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
