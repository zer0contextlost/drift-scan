import path from 'path';
import { loadConfig } from '../src/config/loader';
import { crawlFiles } from '../src/crawler';
import { buildGraph } from '../src/graph/builder';
import { checkGraph } from '../src/graph/checker';
import { rankViolations } from '../src/rank';
import { formatJson } from '../src/report/json';
import { ScanResult } from '../src/types';

const dirtyFixture = path.resolve(__dirname, 'fixtures/dirty-arch');

describe('JSON output shape', () => {
  let result: ScanResult;
  let parsed: unknown;

  beforeAll(async () => {
    const config = loadConfig(dirtyFixture);
    const files = await crawlFiles(dirtyFixture, config);
    const ctx = { projectRoot: dirtyFixture };
    const nodes = await buildGraph(files, dirtyFixture, config, ctx);
    const raw = checkGraph(nodes, config);
    const violations = rankViolations(raw, config);
    result = { version: '1.0.0', scannedFiles: files.length, violations, durationMs: 42 };
    parsed = JSON.parse(formatJson(result));
  });

  it('is valid JSON', () => {
    expect(() => JSON.parse(formatJson(result))).not.toThrow();
  });

  it('has required top-level fields', () => {
    const obj = parsed as Record<string, unknown>;
    expect(typeof obj['version']).toBe('string');
    expect(typeof obj['scannedFiles']).toBe('number');
    expect(Array.isArray(obj['violations'])).toBe(true);
    expect(typeof obj['durationMs']).toBe('number');
  });

  it('each violation has required spec fields', () => {
    const obj = parsed as Record<string, unknown>;
    const violations = obj['violations'] as Record<string, unknown>[];
    expect(violations.length).toBeGreaterThan(0);
    for (const v of violations) {
      expect(typeof v['id']).toBe('string');
      expect(['layer', 'circular', 'undeclared']).toContain(v['type']);
      expect(['critical', 'high', 'medium', 'low']).toContain(v['severity']);
      expect(typeof v['score']).toBe('number');
      expect(typeof v['fromFile']).toBe('string');
      expect(typeof v['fromZone']).toBe('string');
      expect(typeof v['toFile']).toBe('string');
      expect(typeof v['toZone']).toBe('string');
      expect(typeof v['description']).toBe('string');
      expect(typeof v['suggestedFix']).toBe('string');
    }
  });

  it('violations are sorted by score descending', () => {
    const obj = parsed as Record<string, unknown>;
    const violations = obj['violations'] as Record<string, unknown>[];
    const scores = violations.map((v) => v['score'] as number);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it('id format matches spec: drift-<type>-<file>:<line>-<n>', () => {
    const obj = parsed as Record<string, unknown>;
    const violations = obj['violations'] as Record<string, unknown>[];
    for (const v of violations) {
      expect((v['id'] as string)).toMatch(/^drift-(layer|circular|undeclared)-.+:\d+-\d+$/);
    }
  });
});
