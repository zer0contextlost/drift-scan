import { assignZone } from '../src/graph/builder';
import { DriftConfig } from '../src/types';

const config: DriftConfig = {
  layers: ['domain', 'application', 'infrastructure'],
  zones: {
    domain:         { paths: ['src/domain/**'], canImport: [] },
    application:    { paths: ['src/app/**'],    canImport: ['domain'] },
    infrastructure: { paths: ['src/infra/**'],  canImport: ['domain', 'application'] },
  },
  ignore: [],
};

const root = '/project';

describe('assignZone — basic glob patterns', () => {
  it('matches ** glob', () => {
    expect(assignZone('/project/src/domain/User.ts', root, config)).toBe('domain');
  });

  it('matches deep nested file', () => {
    expect(assignZone('/project/src/domain/entities/orders/Order.ts', root, config)).toBe('domain');
  });

  it('returns null for unmatched file', () => {
    expect(assignZone('/project/src/utils/helpers.ts', root, config)).toBeNull();
  });

  it('does not match sibling directory prefix', () => {
    // src/domainX should not match src/domain/**
    const cfg: DriftConfig = {
      layers: ['domain'],
      zones: { domain: { paths: ['src/domain/**'], canImport: [] } },
      ignore: [],
    };
    expect(assignZone('/project/src/domainX/foo.ts', root, cfg)).toBeNull();
  });
});

describe('assignZone — brace expansion', () => {
  it('matches first alternative', () => {
    const cfg: DriftConfig = {
      layers: ['core'],
      zones: { core: { paths: ['{src/domain,src/core}/**'], canImport: [] } },
      ignore: [],
    };
    expect(assignZone('/project/src/domain/User.ts', root, cfg)).toBe('core');
  });

  it('matches second alternative', () => {
    const cfg: DriftConfig = {
      layers: ['core'],
      zones: { core: { paths: ['{src/domain,src/core}/**'], canImport: [] } },
      ignore: [],
    };
    expect(assignZone('/project/src/core/Entity.ts', root, cfg)).toBe('core');
  });

  it('does not match outside alternatives', () => {
    const cfg: DriftConfig = {
      layers: ['core'],
      zones: { core: { paths: ['{src/domain,src/core}/**'], canImport: [] } },
      ignore: [],
    };
    expect(assignZone('/project/src/infra/db.ts', root, cfg)).toBeNull();
  });
});

describe('assignZone — bare directory (no wildcard)', () => {
  it('matches file inside directory with no wildcard pattern', () => {
    const cfg: DriftConfig = {
      layers: ['domain'],
      zones: { domain: { paths: ['src/domain'], canImport: [] } },
      ignore: [],
    };
    expect(assignZone('/project/src/domain/User.ts', root, cfg)).toBe('domain');
  });

  it('matches deeply nested file with no wildcard pattern', () => {
    const cfg: DriftConfig = {
      layers: ['domain'],
      zones: { domain: { paths: ['src/domain'], canImport: [] } },
      ignore: [],
    };
    expect(assignZone('/project/src/domain/entities/User.ts', root, cfg)).toBe('domain');
  });
});

describe('assignZone — trailing slash', () => {
  it('strips trailing slash and still matches', () => {
    const cfg: DriftConfig = {
      layers: ['domain'],
      zones: { domain: { paths: ['src/domain/'], canImport: [] } },
      ignore: [],
    };
    expect(assignZone('/project/src/domain/User.ts', root, cfg)).toBe('domain');
  });
});

describe('assignZone — ? wildcard', () => {
  it('matches single char with ?', () => {
    const cfg: DriftConfig = {
      layers: ['domain'],
      // 'domai?' matches exactly one more char after 'domai' → matches 'domain' (n)
      zones: { domain: { paths: ['src/domai?/**'], canImport: [] } },
      ignore: [],
    };
    expect(assignZone('/project/src/domain/User.ts', root, cfg)).toBe('domain');
    // 'domainX' is 7 chars — one ? can only match one, so this does NOT match
    expect(assignZone('/project/src/domainX/User.ts', root, cfg)).toBeNull();
  });

  it('does not match slash with ?', () => {
    const cfg: DriftConfig = {
      layers: ['domain'],
      zones: { domain: { paths: ['src/do?ain/**'], canImport: [] } },
      ignore: [],
    };
    // 'do?ain' matches 'domain' (one char between do and ain) but not 'do/main'
    expect(assignZone('/project/src/domain/User.ts', root, cfg)).toBe('domain');
    expect(assignZone('/project/src/do/main/User.ts', root, cfg)).toBeNull();
  });
});

describe('assignZone — single * wildcard', () => {
  it('matches one path segment with *', () => {
    const cfg: DriftConfig = {
      layers: ['any'],
      zones: { any: { paths: ['src/*/index.ts'], canImport: [] } },
      ignore: [],
    };
    expect(assignZone('/project/src/domain/index.ts', root, cfg)).toBe('any');
    expect(assignZone('/project/src/infra/index.ts', root, cfg)).toBe('any');
  });

  it('does not match across slashes with single *', () => {
    const cfg: DriftConfig = {
      layers: ['any'],
      zones: { any: { paths: ['src/*/index.ts'], canImport: [] } },
      ignore: [],
    };
    expect(assignZone('/project/src/domain/sub/index.ts', root, cfg)).toBeNull();
  });
});
