import { DependencyNode, DriftConfig } from '../types';
import { resolveToFile } from '../util/resolve';

interface ZoneEdge {
  from: string;
  to: string;
  count: number;
  hasViolation: boolean;
}

export function buildZoneGraph(nodes: DependencyNode[], config: DriftConfig): ZoneEdge[] {
  const edgeMap = new Map<string, ZoneEdge>();

  const nodeByFile = new Map(nodes.map((n) => [n.file, n]));
  for (const node of nodes) {
    if (!node.zone) continue;
    for (const imp of node.imports) {
      const toFile = resolveToFile(imp.toPath, nodeByFile);
      const toNode = toFile ? nodeByFile.get(toFile) : undefined;
      if (!toNode?.zone || toNode.zone === node.zone) continue;

      const key = `${node.zone}→${toNode.zone}`;
      const existing = edgeMap.get(key);
      const isViolation = !config.zones[node.zone]?.canImport.includes(toNode.zone);

      if (existing) {
        existing.count++;
        if (isViolation) existing.hasViolation = true;
      } else {
        edgeMap.set(key, { from: node.zone, to: toNode.zone, count: 1, hasViolation: isViolation });
      }
    }
  }

  return Array.from(edgeMap.values()).sort((a, b) => b.count - a.count);
}

export function formatMermaid(edges: ZoneEdge[], config: DriftConfig): string {
  const lines: string[] = ['graph TD'];

  // Declare all zones as nodes with their layer index
  for (const [i, layer] of config.layers.entries()) {
    if (config.zones[layer]) {
      lines.push(`  ${layer}["${layer} (layer ${i + 1})"]`);
    }
  }
  lines.push('');

  // Draw edges — red for violations, green for permitted
  for (const edge of edges) {
    const arrow = edge.hasViolation ? `-->|🔴 ${edge.count}|` : `-->|✓ ${edge.count}|`;
    lines.push(`  ${edge.from} ${arrow} ${edge.to}`);
  }

  // Style violation edges red
  const violationEdges = edges.filter((e) => e.hasViolation);
  if (violationEdges.length > 0) {
    lines.push('');
    lines.push('  classDef violation fill:#fee2e2,stroke:#ef4444,color:#991b1b');
    for (const edge of violationEdges) {
      lines.push(`  class ${edge.from} violation`);
    }
  }

  return lines.join('\n');
}

export function formatDot(edges: ZoneEdge[], config: DriftConfig): string {
  const lines: string[] = [
    'digraph drift {',
    '  rankdir=TB;',
    '  node [shape=box, style=filled, fillcolor=lightblue];',
    '',
  ];

  for (const layer of config.layers) {
    if (config.zones[layer]) {
      lines.push(`  "${layer}";`);
    }
  }
  lines.push('');

  for (const edge of edges) {
    const color = edge.hasViolation ? 'red' : 'green';
    const style = edge.hasViolation ? 'dashed' : 'solid';
    lines.push(`  "${edge.from}" -> "${edge.to}" [label="${edge.count}", color=${color}, style=${style}];`);
  }

  lines.push('}');
  return lines.join('\n');
}
