import path from 'path';
import fs from 'fs';
import os from 'os';
import { loadConfig } from '../src/config/loader';
import { crawlFiles } from '../src/crawler';
import { buildGraph } from '../src/graph/builder';
import { checkGraph } from '../src/graph/checker';
import { rankViolations } from '../src/rank';

const dirtyFixture = path.resolve(__dirname, 'fixtures/dirty-arch');

describe('drift-ignore suppression — TypeScript', () => {
  it('suppressed import does not produce a violation', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-suppress-'));
    try {
      // Mirror the dirty-arch structure but add drift-ignore to the violation
      fs.mkdirSync(path.join(tmp, 'src', 'domain'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'src', 'infra'), { recursive: true });

      fs.writeFileSync(path.join(tmp, '.driftrc.json'), JSON.stringify({
        layers: ['domain', 'infra'],
        zones: {
          domain: { paths: ['src/domain/**'], canImport: [] },
          infra:  { paths: ['src/infra/**'],  canImport: ['domain'] },
        },
        ignore: [],
      }));

      // This file has the violation suppressed
      fs.writeFileSync(path.join(tmp, 'src', 'domain', 'Order.ts'), [
        '// drift-ignore',
        "import { db } from '../infra/Database';",
        'export interface Order { id: string; }',
      ].join('\n'));

      fs.writeFileSync(path.join(tmp, 'src', 'infra', 'Database.ts'), [
        'export const db = { query: async () => {} };',
      ].join('\n'));

      const config = loadConfig(tmp);
      const files = await crawlFiles(tmp, config);
      const ctx = { projectRoot: tmp };
      const nodes = await buildGraph(files, tmp, config, ctx);
      const raw = checkGraph(nodes, config);
      const violations = rankViolations(raw, config);
      const layerViols = violations.filter((v) => v.type === 'layer');
      expect(layerViols).toHaveLength(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('suppression on same line is respected', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-suppress2-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src', 'domain'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'src', 'infra'), { recursive: true });

      fs.writeFileSync(path.join(tmp, '.driftrc.json'), JSON.stringify({
        layers: ['domain', 'infra'],
        zones: {
          domain: { paths: ['src/domain/**'], canImport: [] },
          infra:  { paths: ['src/infra/**'],  canImport: ['domain'] },
        },
        ignore: [],
      }));

      fs.writeFileSync(path.join(tmp, 'src', 'domain', 'Order.ts'), [
        "import { db } from '../infra/Database'; // drift-ignore",
        'export interface Order { id: string; }',
      ].join('\n'));

      fs.writeFileSync(path.join(tmp, 'src', 'infra', 'Database.ts'), [
        'export const db = { query: async () => {} };',
      ].join('\n'));

      const config = loadConfig(tmp);
      const files = await crawlFiles(tmp, config);
      const ctx = { projectRoot: tmp };
      const nodes = await buildGraph(files, tmp, config, ctx);
      const raw = checkGraph(nodes, config);
      const violations = rankViolations(raw, config);
      expect(violations.filter((v) => v.type === 'layer')).toHaveLength(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('unsuppressed import still produces a violation', async () => {
    const config = loadConfig(dirtyFixture);
    const files = await crawlFiles(dirtyFixture, config);
    const ctx = { projectRoot: dirtyFixture };
    const nodes = await buildGraph(files, dirtyFixture, config, ctx);
    const raw = checkGraph(nodes, config);
    const violations = rankViolations(raw, config);
    expect(violations.filter((v) => v.type === 'layer').length).toBeGreaterThan(0);
  });
});

describe('config validation', () => {
  it('throws when canImport references an unknown zone', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-cfg-'));
    try {
      fs.writeFileSync(path.join(tmp, '.driftrc.json'), JSON.stringify({
        layers: ['domain'],
        zones: {
          domain: { paths: ['src/domain/**'], canImport: ['nonexistent'] },
        },
        ignore: [],
      }));
      expect(() => loadConfig(tmp)).toThrow(/unknown zone "nonexistent"/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('throws when layers references a zone not defined in zones', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-cfg2-'));
    try {
      fs.writeFileSync(path.join(tmp, '.driftrc.json'), JSON.stringify({
        layers: ['domain', 'ghost'],
        zones: {
          domain: { paths: ['src/domain/**'], canImport: [] },
        },
        ignore: [],
      }));
      expect(() => loadConfig(tmp)).toThrow(/not defined in zones/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('accepts valid config without throwing', () => {
    expect(() => loadConfig(dirtyFixture)).not.toThrow();
  });
});

describe('TypeScript path alias resolution', () => {
  it('resolves @-prefixed path alias to absolute path', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-alias-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src', 'domain'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'src', 'app'), { recursive: true });

      fs.writeFileSync(path.join(tmp, '.driftrc.json'), JSON.stringify({
        layers: ['domain', 'app'],
        zones: {
          domain: { paths: ['src/domain/**'], canImport: [] },
          app:    { paths: ['src/app/**'],    canImport: ['domain'] },
        },
        ignore: [],
      }));

      // tsconfig with path alias @domain → src/domain
      fs.writeFileSync(path.join(tmp, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@domain/*': ['src/domain/*'] },
        },
      }));

      // app imports domain via alias — should be ALLOWED (app canImport domain)
      fs.writeFileSync(path.join(tmp, 'src', 'app', 'Service.ts'), [
        "import { User } from '@domain/User';",
        'export class Service {}',
      ].join('\n'));

      fs.writeFileSync(path.join(tmp, 'src', 'domain', 'User.ts'), [
        'export interface User { id: string; }',
      ].join('\n'));

      const { readTsPathConfig } = await import('../src/config/tsconfig');
      const config = loadConfig(tmp);
      const files = await crawlFiles(tmp, config);
      const tsPathConfig = readTsPathConfig(tmp) ?? undefined;
      const ctx = { projectRoot: tmp, tsPathConfig };
      const nodes = await buildGraph(files, tmp, config, ctx);
      const raw = checkGraph(nodes, config);
      const violations = raw.filter((v) => v.type === 'layer');
      // app is allowed to import domain → no violation
      expect(violations).toHaveLength(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('flags alias-resolved import that crosses a forbidden boundary', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-alias2-'));
    try {
      fs.mkdirSync(path.join(tmp, 'src', 'domain'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'src', 'infra'), { recursive: true });

      fs.writeFileSync(path.join(tmp, '.driftrc.json'), JSON.stringify({
        layers: ['domain', 'infra'],
        zones: {
          domain: { paths: ['src/domain/**'], canImport: [] },
          infra:  { paths: ['src/infra/**'],  canImport: ['domain'] },
        },
        ignore: [],
      }));

      fs.writeFileSync(path.join(tmp, 'tsconfig.json'), JSON.stringify({
        compilerOptions: {
          baseUrl: '.',
          paths: { '@infra/*': ['src/infra/*'] },
        },
      }));

      // domain imports infra via alias — VIOLATION
      fs.writeFileSync(path.join(tmp, 'src', 'domain', 'Order.ts'), [
        "import { db } from '@infra/Database';",
        'export interface Order { id: string; }',
      ].join('\n'));

      fs.writeFileSync(path.join(tmp, 'src', 'infra', 'Database.ts'), [
        'export const db = { query: async () => {} };',
      ].join('\n'));

      const { readTsPathConfig } = await import('../src/config/tsconfig');
      const config = loadConfig(tmp);
      const files = await crawlFiles(tmp, config);
      const tsPathConfig = readTsPathConfig(tmp) ?? undefined;
      const ctx = { projectRoot: tmp, tsPathConfig };
      const nodes = await buildGraph(files, tmp, config, ctx);
      const raw = checkGraph(nodes, config);
      const violations = raw.filter((v) => v.type === 'layer');
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0].fromZone).toBe('domain');
      expect(violations[0].toZone).toBe('infra');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
