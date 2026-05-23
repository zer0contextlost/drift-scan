import { checkGraph } from '../src/graph/checker';
import { DependencyNode, DriftConfig } from '../src/types';

const config: DriftConfig = {
  layers: ['domain', 'application', 'infrastructure'],
  zones: {
    domain:         { paths: ['src/domain/**'], canImport: [] },
    application:    { paths: ['src/app/**'],    canImport: ['domain'] },
    infrastructure: { paths: ['src/infra/**'],  canImport: ['domain', 'application'] },
  },
  ignore: [],
};

function makeNode(file: string, zone: string | null, imports: Array<{ toPath: string; line: number }>): DependencyNode {
  return {
    file,
    zone,
    imports: imports.map((i) => ({ fromFile: file, toPath: i.toPath, line: i.line })),
  };
}

describe('checkGraph — layer violations', () => {
  it('flags domain importing infrastructure', () => {
    const infra = makeNode('/proj/src/infra/db.ts', 'infrastructure', []);
    const domain = makeNode('/proj/src/domain/User.ts', 'domain', [
      { toPath: '/proj/src/infra/db.ts', line: 1 },
    ]);
    const violations = checkGraph([domain, infra], config);
    const layerViols = violations.filter((v) => v.type === 'layer');
    expect(layerViols).toHaveLength(1);
    expect(layerViols[0].fromZone).toBe('domain');
    expect(layerViols[0].toZone).toBe('infrastructure');
  });

  it('allows infrastructure importing domain', () => {
    const domain = makeNode('/proj/src/domain/User.ts', 'domain', []);
    const infra = makeNode('/proj/src/infra/repo.ts', 'infrastructure', [
      { toPath: '/proj/src/domain/User.ts', line: 1 },
    ]);
    const violations = checkGraph([domain, infra], config);
    expect(violations.filter((v) => v.type === 'layer')).toHaveLength(0);
  });

  it('allows application importing domain', () => {
    const domain = makeNode('/proj/src/domain/User.ts', 'domain', []);
    const app = makeNode('/proj/src/app/UserService.ts', 'application', [
      { toPath: '/proj/src/domain/User.ts', line: 1 },
    ]);
    const violations = checkGraph([domain, app], config);
    expect(violations.filter((v) => v.type === 'layer')).toHaveLength(0);
  });

  it('flags application importing infrastructure', () => {
    const infra = makeNode('/proj/src/infra/db.ts', 'infrastructure', []);
    const app = makeNode('/proj/src/app/Svc.ts', 'application', [
      { toPath: '/proj/src/infra/db.ts', line: 3 },
    ]);
    const violations = checkGraph([app, infra], config);
    const layerViols = violations.filter((v) => v.type === 'layer');
    expect(layerViols).toHaveLength(1);
    expect(layerViols[0].fromZone).toBe('application');
  });
});

describe('checkGraph — undeclared zone', () => {
  it('flags unzoned file importing from a declared zone', () => {
    const domain = makeNode('/proj/src/domain/User.ts', 'domain', []);
    const orphan = makeNode('/proj/scripts/seed.ts', null, [
      { toPath: '/proj/src/domain/User.ts', line: 2 },
    ]);
    const violations = checkGraph([orphan, domain], config);
    expect(violations.filter((v) => v.type === 'undeclared')).toHaveLength(1);
  });
});

describe('checkGraph — circular dependencies', () => {
  const circConfig: DriftConfig = {
    layers: ['application', 'adapter'],
    zones: {
      application: { paths: ['src/app/**'], canImport: ['adapter'] },
      adapter:     { paths: ['src/adapters/**'], canImport: ['application'] },
    },
    ignore: [],
  };

  it('detects a 2-file cross-zone cycle', () => {
    const app = makeNode('/proj/src/app/A.ts', 'application', [
      { toPath: '/proj/src/adapters/B.ts', line: 1 },
    ]);
    const adp = makeNode('/proj/src/adapters/B.ts', 'adapter', [
      { toPath: '/proj/src/app/A.ts', line: 1 },
    ]);
    const violations = checkGraph([app, adp], circConfig);
    expect(violations.filter((v) => v.type === 'circular').length).toBeGreaterThan(0);
  });
});
