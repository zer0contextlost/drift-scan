import path from 'path';
import fs from 'fs';
import os from 'os';
import { loadConfig } from '../src/config/loader';
import { crawlFiles } from '../src/crawler';
import { buildGraph } from '../src/graph/builder';
import { checkGraph } from '../src/graph/checker';
import { rankViolations } from '../src/rank';
import { applyExceptions } from '../src/report/exceptions';
import { saveBaseline, loadBaseline, filterByBaseline, fingerprint } from '../src/report/baseline';
import { Violation } from '../src/types';

const dirtyFixture = path.resolve(__dirname, 'fixtures/dirty-arch');

// ── helpers ──────────────────────────────────────────────────────────────────

function makeViolation(overrides: Partial<Violation> = {}): Violation {
  return {
    id: 'test-1',
    type: 'layer',
    severity: 'high',
    score: 8,
    fromFile: '/proj/src/domain/Order.ts',
    fromZone: 'domain',
    toFile: '/proj/src/infra/Database.ts',
    toZone: 'infra',
    importLine: 5,
    description: 'domain imports infra',
    suggestedFix: 'introduce interface',
    fanout: 2,
    ...overrides,
  };
}

async function getViolations() {
  const config = loadConfig(dirtyFixture);
  const files = await crawlFiles(dirtyFixture, config);
  const ctx = { projectRoot: dirtyFixture };
  const nodes = await buildGraph(files, dirtyFixture, config, ctx);
  const raw = checkGraph(nodes, config);
  return { violations: rankViolations(raw, config), config };
}

// ── config exceptions ─────────────────────────────────────────────────────────

describe('applyExceptions', () => {
  it('returns all violations when no exceptions configured', async () => {
    const { violations, config } = await getViolations();
    const { kept, excepted } = applyExceptions(violations, dirtyFixture, config);
    expect(kept).toHaveLength(violations.length);
    expect(excepted).toBe(0);
  });

  it('suppresses violation matching from+to globs', () => {
    const v = makeViolation();
    const config = {
      layers: ['domain', 'infra'],
      zones: {
        domain: { paths: ['src/domain/**'], canImport: [] },
        infra:  { paths: ['src/infra/**'],  canImport: ['domain'] },
      },
      ignore: [],
      exceptions: [{ from: 'src/domain/**', to: 'src/infra/**', reason: 'legacy' }],
    };
    const { kept, excepted } = applyExceptions([v], '/proj', config);
    expect(kept).toHaveLength(0);
    expect(excepted).toBe(1);
  });

  it('suppresses violation matching from glob only (no to)', () => {
    const v = makeViolation();
    const config = {
      layers: [], zones: {}, ignore: [],
      exceptions: [{ from: 'src/domain/**' }],
    };
    const { kept, excepted } = applyExceptions([v], '/proj', config);
    expect(kept).toHaveLength(0);
    expect(excepted).toBe(1);
  });

  it('does not suppress when from glob does not match', () => {
    const v = makeViolation();
    const config = {
      layers: [], zones: {}, ignore: [],
      exceptions: [{ from: 'src/app/**', to: 'src/infra/**' }],
    };
    const { kept, excepted } = applyExceptions([v], '/proj', config);
    expect(kept).toHaveLength(1);
    expect(excepted).toBe(0);
  });

  it('does not suppress when to glob does not match', () => {
    const v = makeViolation();
    const config = {
      layers: [], zones: {}, ignore: [],
      exceptions: [{ from: 'src/domain/**', to: 'src/app/**' }],
    };
    const { kept, excepted } = applyExceptions([v], '/proj', config);
    expect(kept).toHaveLength(1);
    expect(excepted).toBe(0);
  });

  it('config file with exceptions parses correctly', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-exc-'));
    try {
      fs.writeFileSync(path.join(tmp, '.driftrc.json'), JSON.stringify({
        layers: ['domain', 'infra'],
        zones: {
          domain: { paths: ['src/domain/**'], canImport: [] },
          infra:  { paths: ['src/infra/**'],  canImport: ['domain'] },
        },
        ignore: [],
        exceptions: [
          { from: 'src/domain/legacy/**', to: 'src/infra/**', reason: 'to be migrated' },
        ],
      }));
      const config = loadConfig(tmp);
      expect(config.exceptions).toHaveLength(1);
      expect(config.exceptions![0].from).toBe('src/domain/legacy/**');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// ── baseline ──────────────────────────────────────────────────────────────────

describe('baseline fingerprint', () => {
  it('produces stable fingerprint for layer violation', () => {
    const v = makeViolation();
    const fp = fingerprint(v, '/proj');
    expect(fp).toBe('layer:src/domain/Order.ts:src/infra/Database.ts:5');
  });

  it('produces stable fingerprint for circular violation', () => {
    const v = makeViolation({
      type: 'circular',
      cycleChain: ['/proj/src/app/A.ts', '/proj/src/domain/B.ts', '/proj/src/app/A.ts'],
    });
    const fp = fingerprint(v, '/proj');
    // chain is sorted so order doesn't matter
    expect(fp).toMatch(/^circular:/);
    expect(fp).toContain('src/app/A.ts');
    expect(fp).toContain('src/domain/B.ts');
  });

  it('same violation produces same fingerprint across calls', () => {
    const v = makeViolation();
    expect(fingerprint(v, '/proj')).toBe(fingerprint(v, '/proj'));
  });
});

describe('saveBaseline / loadBaseline / filterByBaseline', () => {
  it('round-trips: save then load returns same fingerprints', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-bl-'));
    try {
      const { violations } = await getViolations();
      const baselinePath = path.join(tmp, 'baseline.json');
      saveBaseline(violations, dirtyFixture, baselinePath, '1.5.0');

      expect(fs.existsSync(baselinePath)).toBe(true);
      const loaded = loadBaseline(baselinePath);
      expect(loaded.size).toBe(violations.length);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('filterByBaseline suppresses all violations in baseline', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-bl2-'));
    try {
      const { violations } = await getViolations();
      const baselinePath = path.join(tmp, 'baseline.json');
      saveBaseline(violations, dirtyFixture, baselinePath, '1.5.0');
      const baseline = loadBaseline(baselinePath);

      const { kept, suppressed } = filterByBaseline(violations, baseline, dirtyFixture);
      expect(kept).toHaveLength(0);
      expect(suppressed).toBe(violations.length);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('filterByBaseline passes through new violations not in baseline', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-bl3-'));
    try {
      // Save empty baseline (no violations)
      const baselinePath = path.join(tmp, 'baseline.json');
      saveBaseline([], dirtyFixture, baselinePath, '1.5.0');
      const baseline = loadBaseline(baselinePath);

      const { violations } = await getViolations();
      const { kept, suppressed } = filterByBaseline(violations, baseline, dirtyFixture);
      expect(kept).toHaveLength(violations.length);
      expect(suppressed).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('loadBaseline throws on missing file', () => {
    expect(() => loadBaseline('/nonexistent/baseline.json')).toThrow();
  });
});
