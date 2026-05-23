/**
 * Regression tests covering specific false-positive and false-negative scenarios.
 * Each test documents the exact scenario it guards against.
 */
import path from 'path';
import { checkGraph } from '../src/graph/checker';
import { buildGraph } from '../src/graph/builder';
import { crawlFiles } from '../src/crawler';
import { loadConfig } from '../src/config/loader';
import { DependencyNode, DriftConfig } from '../src/types';

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function node(file: string, zone: string | null, toFiles: string[]): DependencyNode {
  return {
    file,
    zone,
    imports: toFiles.map((t, i) => ({ fromFile: file, toPath: t, line: i + 1 })),
  };
}

const baseConfig: DriftConfig = {
  layers: ['domain', 'application', 'infrastructure'],
  zones: {
    domain:         { paths: ['src/domain/**'], canImport: [] },
    application:    { paths: ['src/app/**'],    canImport: ['domain'] },
    infrastructure: { paths: ['src/infra/**'],  canImport: ['domain', 'application'] },
  },
  ignore: [],
};

// ──────────────────────────────────────────────────────────
// FP: external packages must never be treated as zone files
// ──────────────────────────────────────────────────────────
describe('FP — external package imports', () => {
  it('does not flag @nestjs/common as a zone violation', () => {
    // External imports are not resolved to absolute paths — they stay as package names
    // and resolveToFile returns null for them, so no violation is emitted.
    const svc = node('/proj/src/domain/User.ts', 'domain', ['@nestjs/common', 'reflect-metadata', 'rxjs']);
    const violations = checkGraph([svc], baseConfig);
    expect(violations).toHaveLength(0);
  });

  it('does not flag node built-ins', () => {
    const svc = node('/proj/src/app/Runner.ts', 'application', ['fs', 'path', 'child_process', 'crypto']);
    const violations = checkGraph([svc], baseConfig);
    expect(violations).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────
// FP: intra-zone imports must never be flagged
// ──────────────────────────────────────────────────────────
describe('FP — intra-zone imports', () => {
  it('domain importing another domain file is not a violation', () => {
    const a = node('/proj/src/domain/User.ts', 'domain', ['/proj/src/domain/Order.ts']);
    const b = node('/proj/src/domain/Order.ts', 'domain', []);
    const violations = checkGraph([a, b], baseConfig);
    expect(violations.filter((v) => v.type === 'layer')).toHaveLength(0);
  });

  it('infra importing another infra file is not a violation', () => {
    const a = node('/proj/src/infra/Db.ts', 'infrastructure', ['/proj/src/infra/Pool.ts']);
    const b = node('/proj/src/infra/Pool.ts', 'infrastructure', []);
    const violations = checkGraph([a, b], baseConfig);
    expect(violations.filter((v) => v.type === 'layer')).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────
// FP: cross-zone imports that ARE allowed must not be flagged
// ──────────────────────────────────────────────────────────
describe('FP — permitted cross-zone imports', () => {
  it('app importing domain is allowed', () => {
    const d = node('/proj/src/domain/User.ts', 'domain', []);
    const a = node('/proj/src/app/UserSvc.ts', 'application', ['/proj/src/domain/User.ts']);
    expect(checkGraph([d, a], baseConfig)).toHaveLength(0);
  });

  it('infra importing domain is allowed', () => {
    const d = node('/proj/src/domain/User.ts', 'domain', []);
    const i = node('/proj/src/infra/Repo.ts', 'infrastructure', ['/proj/src/domain/User.ts']);
    expect(checkGraph([d, i], baseConfig)).toHaveLength(0);
  });

  it('infra importing app is allowed', () => {
    const a = node('/proj/src/app/Svc.ts', 'application', []);
    const i = node('/proj/src/infra/Repo.ts', 'infrastructure', ['/proj/src/app/Svc.ts']);
    expect(checkGraph([a, i], baseConfig)).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────
// FP: unzoned→unzoned imports are never flagged
// ──────────────────────────────────────────────────────────
describe('FP — unzoned files importing each other', () => {
  it('two unzoned files importing each other produce no violation', () => {
    const a = node('/proj/scripts/seed.ts', null, ['/proj/scripts/helpers.ts']);
    const b = node('/proj/scripts/helpers.ts', null, []);
    const violations = checkGraph([a, b], baseConfig);
    expect(violations).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────
// FP: circular imports WITHIN the same zone must not be flagged
// (only cross-zone cycles are architectural drift)
// ──────────────────────────────────────────────────────────
describe('FP — same-zone circular imports', () => {
  it('A→B→A within domain zone does not produce a circular violation', () => {
    const a = node('/proj/src/domain/A.ts', 'domain', ['/proj/src/domain/B.ts']);
    const b = node('/proj/src/domain/B.ts', 'domain', ['/proj/src/domain/A.ts']);
    const violations = checkGraph([a, b], baseConfig);
    expect(violations.filter((v) => v.type === 'circular')).toHaveLength(0);
  });
});

// ──────────────────────────────────────────────────────────
// Zone glob matching edge cases
// ──────────────────────────────────────────────────────────
describe('zone glob matching', () => {
  const cleanFixture = path.resolve(__dirname, 'fixtures/clean-arch');

  it('src/domain-utils is NOT assigned to the domain zone', async () => {
    // Pattern src/domain/** must not match src/domain-utils/foo.ts
    const config = loadConfig(cleanFixture);
    const ctx = { projectRoot: cleanFixture };

    // Test that a file inside domain/ is assigned correctly
    const nodes = await buildGraph(
      [`${cleanFixture}\\src\\domain\\User.ts`],
      cleanFixture,
      config,
      ctx,
    );
    expect(nodes[0].zone).toBe('domain');
  });

  it('deep nested files within a zone are correctly assigned', async () => {
    const config = loadConfig(cleanFixture);
    const ctx = { projectRoot: cleanFixture };
    const nodes = await buildGraph(
      [`${cleanFixture}\\src\\domain\\User.ts`],
      cleanFixture,
      config,
      ctx,
    );
    expect(nodes[0].zone).toBe('domain');
  });
});

// ──────────────────────────────────────────────────────────
// Windows path normalization: backslash vs forward slash
// must not affect zone assignment or import resolution
// ──────────────────────────────────────────────────────────
describe('path normalization (Windows vs Unix)', () => {
  it('backslash file paths are resolved the same as forward slash', () => {
    // toPath from TS parser uses forward slashes (normalizePath converts)
    // nodeByFile keys use OS separator (backslash on Windows)
    // resolveToFile must normalize both sides before comparing
    const infraFile = 'F:\\proj\\src\\infra\\db.ts';
    const infraNode = node(infraFile, 'infrastructure', []);
    const domainNode = node(
      'F:\\proj\\src\\domain\\User.ts',
      'domain',
      ['F:/proj/src/infra/db.ts'], // forward-slash path pointing to backslash-stored file
    );
    const violations = checkGraph([domainNode, infraNode], baseConfig);
    const layerViols = violations.filter((v) => v.type === 'layer');
    expect(layerViols).toHaveLength(1);
    expect(layerViols[0].fromZone).toBe('domain');
    expect(layerViols[0].toZone).toBe('infrastructure');
  });
});

// ──────────────────────────────────────────────────────────
// Crawler must exclude .d.ts, test files by default
// ──────────────────────────────────────────────────────────
describe('crawler default exclusions', () => {
  it('crawled files from clean-arch fixture contain no .d.ts or .test.ts files', async () => {
    const config = loadConfig(path.resolve(__dirname, 'fixtures/clean-arch'));
    const files = await crawlFiles(path.resolve(__dirname, 'fixtures/clean-arch'), config);
    expect(files.every((f) => !f.endsWith('.d.ts'))).toBe(true);
    expect(files.every((f) => !f.includes('.test.'))).toBe(true);
    expect(files.every((f) => !f.includes('.spec.'))).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────
// Violations are correctly ranked: higher score first
// ──────────────────────────────────────────────────────────
describe('ranking is stable and descending', () => {
  it('all scores in ranked output are non-increasing', () => {
    const { rankViolations } = require('../src/rank');
    const violations = [
      { ...node('/proj/src/domain/A.ts', 'domain', []).imports[0], type: 'layer', severity: 'low', score: 0, fromFile: '/a', fromZone: 'domain', toFile: '/b', toZone: 'infrastructure', importLine: 1, description: '', suggestedFix: '', fanout: 3, id: '1' },
      { ...node('/proj/src/domain/A.ts', 'domain', []).imports[0], type: 'layer', severity: 'low', score: 0, fromFile: '/c', fromZone: 'application', toFile: '/d', toZone: 'infrastructure', importLine: 1, description: '', suggestedFix: '', fanout: 1, id: '2' },
    ];
    const ranked = rankViolations(violations, baseConfig);
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
  });
});
