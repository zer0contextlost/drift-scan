import path from 'path';
import { loadConfig } from '../src/config/loader';
import { crawlFiles } from '../src/crawler';
import { buildGraph } from '../src/graph/builder';
import { checkGraph } from '../src/graph/checker';
import { rankViolations } from '../src/rank';
import { filterBySeverity } from '../src/report/filters';
import { formatSarif } from '../src/report/sarif';
import { buildZoneGraph, formatMermaid, formatDot } from '../src/report/graph';
import { ScanResult, Violation, Severity } from '../src/types';

const dirtyFixture = path.resolve(__dirname, 'fixtures/dirty-arch');

async function buildResult(fixture: string): Promise<ScanResult> {
  const config = loadConfig(fixture);
  const files = await crawlFiles(fixture, config);
  const ctx = { projectRoot: fixture };
  const nodes = await buildGraph(files, fixture, config, ctx);
  const raw = checkGraph(nodes, config);
  const violations = rankViolations(raw, config);
  return { version: '1.5.0', scannedFiles: files.length, violations, durationMs: 42 };
}

describe('filterBySeverity', () => {
  const makeViolation = (severity: Severity): Violation => ({
    id: 'test', type: 'layer', severity, score: 0,
    fromFile: 'a', fromZone: 'a', toFile: 'b', toZone: 'b',
    importLine: 1, description: '', suggestedFix: '', fanout: 0,
  });

  it('returns all when min is low', () => {
    const vs = ['critical', 'high', 'medium', 'low'].map((s) => makeViolation(s as Severity));
    expect(filterBySeverity(vs, 'low')).toHaveLength(4);
  });

  it('filters below high', () => {
    const vs = ['critical', 'high', 'medium', 'low'].map((s) => makeViolation(s as Severity));
    const filtered = filterBySeverity(vs, 'high');
    expect(filtered.map((v) => v.severity)).toEqual(['critical', 'high']);
  });

  it('returns only critical when min is critical', () => {
    const vs = ['critical', 'high', 'medium', 'low'].map((s) => makeViolation(s as Severity));
    const filtered = filterBySeverity(vs, 'critical');
    expect(filtered.map((v) => v.severity)).toEqual(['critical']);
  });

  it('returns empty when no violations meet threshold', () => {
    const vs = ['low', 'medium'].map((s) => makeViolation(s as Severity));
    expect(filterBySeverity(vs, 'critical')).toHaveLength(0);
  });
});

describe('SARIF output', () => {
  let result: ScanResult;
  let sarif: Record<string, unknown>;

  beforeAll(async () => {
    result = await buildResult(dirtyFixture);
    sarif = JSON.parse(formatSarif(result));
  });

  it('has correct $schema and version', () => {
    expect(sarif['$schema']).toContain('sarif-schema-2.1.0');
    expect(sarif['version']).toBe('2.1.0');
  });

  it('has exactly one run', () => {
    expect(Array.isArray(sarif['runs'])).toBe(true);
    expect((sarif['runs'] as unknown[]).length).toBe(1);
  });

  it('tool driver has correct name', () => {
    const run = (sarif['runs'] as Record<string, unknown>[])[0];
    const tool = run['tool'] as Record<string, unknown>;
    const driver = tool['driver'] as Record<string, unknown>;
    expect(driver['name']).toBe('drift-scan');
    expect(driver['version']).toBe('1.5.0');
  });

  it('rules are deduplicated', () => {
    const run = (sarif['runs'] as Record<string, unknown>[])[0];
    const tool = run['tool'] as Record<string, unknown>;
    const driver = tool['driver'] as Record<string, unknown>;
    const rules = driver['rules'] as Record<string, unknown>[];
    const ids = rules.map((r) => r['id']);
    const unique = new Set(ids);
    expect(ids.length).toBe(unique.size);
  });

  it('each result has ruleId, level, message, locations', () => {
    const run = (sarif['runs'] as Record<string, unknown>[])[0];
    const results = run['results'] as Record<string, unknown>[];
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(typeof r['ruleId']).toBe('string');
      expect(['error', 'warning', 'note']).toContain(r['level']);
      expect(r['message']).toBeTruthy();
      expect(Array.isArray(r['locations'])).toBe(true);
      expect((r['locations'] as unknown[]).length).toBeGreaterThan(0);
    }
  });

  it('ruleId format is drift/<type>/<from>→<to>', () => {
    const run = (sarif['runs'] as Record<string, unknown>[])[0];
    const results = run['results'] as Record<string, unknown>[];
    for (const r of results) {
      expect(r['ruleId'] as string).toMatch(/^drift\/(layer|circular|undeclared)\/.+→.+$/);
    }
  });

  it('critical/high map to error level', () => {
    const criticals = result.violations.filter((v) => v.severity === 'critical' || v.severity === 'high');
    const run = (sarif['runs'] as Record<string, unknown>[])[0];
    const results = run['results'] as Record<string, unknown>[];
    if (criticals.length > 0) {
      const errorResults = results.filter((r) => r['level'] === 'error');
      expect(errorResults.length).toBeGreaterThan(0);
    }
  });

  it('run properties include scannedFiles', () => {
    const run = (sarif['runs'] as Record<string, unknown>[])[0];
    const props = run['properties'] as Record<string, unknown>;
    expect(typeof props['scannedFiles']).toBe('number');
  });
});

describe('graph output', () => {
  it('buildZoneGraph returns edges', async () => {
    const config = loadConfig(dirtyFixture);
    const files = await crawlFiles(dirtyFixture, config);
    const ctx = { projectRoot: dirtyFixture };
    const nodes = await buildGraph(files, dirtyFixture, config, ctx);
    const edges = buildZoneGraph(nodes, config);
    expect(Array.isArray(edges)).toBe(true);
    // dirty-arch has cross-zone imports → at least one edge
    expect(edges.length).toBeGreaterThan(0);
  });

  it('buildZoneGraph marks violation edges', async () => {
    const config = loadConfig(dirtyFixture);
    const files = await crawlFiles(dirtyFixture, config);
    const ctx = { projectRoot: dirtyFixture };
    const nodes = await buildGraph(files, dirtyFixture, config, ctx);
    const edges = buildZoneGraph(nodes, config);
    const hasViolation = edges.some((e) => e.hasViolation);
    expect(hasViolation).toBe(true);
  });

  it('formatMermaid starts with graph TD', async () => {
    const config = loadConfig(dirtyFixture);
    const files = await crawlFiles(dirtyFixture, config);
    const ctx = { projectRoot: dirtyFixture };
    const nodes = await buildGraph(files, dirtyFixture, config, ctx);
    const edges = buildZoneGraph(nodes, config);
    const mermaid = formatMermaid(edges, config);
    expect(mermaid).toMatch(/^graph TD/);
  });

  it('formatMermaid includes violation arrow for dirty-arch', async () => {
    const config = loadConfig(dirtyFixture);
    const files = await crawlFiles(dirtyFixture, config);
    const ctx = { projectRoot: dirtyFixture };
    const nodes = await buildGraph(files, dirtyFixture, config, ctx);
    const edges = buildZoneGraph(nodes, config);
    const mermaid = formatMermaid(edges, config);
    expect(mermaid).toContain('🔴');
  });

  it('formatDot starts with digraph drift', async () => {
    const config = loadConfig(dirtyFixture);
    const files = await crawlFiles(dirtyFixture, config);
    const ctx = { projectRoot: dirtyFixture };
    const nodes = await buildGraph(files, dirtyFixture, config, ctx);
    const edges = buildZoneGraph(nodes, config);
    const dot = formatDot(edges, config);
    expect(dot).toMatch(/^digraph drift \{/);
  });

  it('formatDot marks violation edges red dashed', async () => {
    const config = loadConfig(dirtyFixture);
    const files = await crawlFiles(dirtyFixture, config);
    const ctx = { projectRoot: dirtyFixture };
    const nodes = await buildGraph(files, dirtyFixture, config, ctx);
    const edges = buildZoneGraph(nodes, config);
    const dot = formatDot(edges, config);
    expect(dot).toContain('color=red');
    expect(dot).toContain('style=dashed');
  });
});
