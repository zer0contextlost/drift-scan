import path from 'path';
import { loadConfig } from '../src/config/loader';
import { crawlFiles } from '../src/crawler';
import { buildGraph } from '../src/graph/builder';
import { checkGraph } from '../src/graph/checker';
import { rankViolations } from '../src/rank';

const fixture = path.resolve(__dirname, 'fixtures/python-arch');

describe('integration — python-arch fixture', () => {
  async function scan() {
    const config = loadConfig(fixture);
    const files = await crawlFiles(fixture, config);
    const ctx = { projectRoot: fixture };
    const nodes = await buildGraph(files, fixture, config, ctx);
    const raw = checkGraph(nodes, config);
    return rankViolations(raw, config);
  }

  it('crawls Python source files', async () => {
    const config = loadConfig(fixture);
    const files = await crawlFiles(fixture, config);
    expect(files.some((f) => f.endsWith('.py'))).toBe(true);
  });

  it('detects domain→infra violation in bad_service.py', async () => {
    const violations = await scan();
    const layerViols = violations.filter((v) => v.type === 'layer');
    expect(layerViols.length).toBeGreaterThanOrEqual(1);
    const domainInfra = layerViols.find(
      (v) => v.fromZone === 'domain' && v.toZone === 'infrastructure'
    );
    expect(domainInfra).toBeDefined();
    expect(domainInfra?.fromFile).toContain('bad_service.py');
  });

  it('does not flag infra importing domain (permitted)', async () => {
    const violations = await scan();
    const wrongWay = violations.find(
      (v) => v.type === 'layer' && v.fromZone === 'infrastructure' && v.toZone === 'domain'
    );
    expect(wrongWay).toBeUndefined();
  });

  it('does not flag os/sys stdlib as violations', async () => {
    const violations = await scan();
    // infra/db.py imports os — os is external and must not appear as a violation
    const osViolation = violations.find(
      (v) => v.toFile?.includes('os') || v.toFile === 'os'
    );
    expect(osViolation).toBeUndefined();
  });
});
