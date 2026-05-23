import path from 'path';
import { loadConfig } from '../src/config/loader';
import { crawlFiles } from '../src/crawler';
import { buildGraph } from '../src/graph/builder';
import { checkGraph } from '../src/graph/checker';
import { rankViolations } from '../src/rank';
import { readGoModuleName } from '../src/parsers/go';

const fixture = path.resolve(__dirname, 'fixtures/go-arch');

describe('integration — go-arch fixture', () => {
  async function scan() {
    const config = loadConfig(fixture);
    const files = await crawlFiles(fixture, config);
    const goModuleName = await readGoModuleName(fixture) ?? undefined;
    const ctx = { projectRoot: fixture, goModuleName };
    const nodes = await buildGraph(files, fixture, config, ctx);
    const raw = checkGraph(nodes, config);
    return rankViolations(raw, config);
  }

  it('reads the go module name', async () => {
    const mod = await readGoModuleName(fixture);
    expect(mod).toBe('example.com/myapp');
  });

  it('crawls Go source files', async () => {
    const config = loadConfig(fixture);
    const files = await crawlFiles(fixture, config);
    expect(files.some((f) => f.endsWith('.go'))).toBe(true);
  });

  it('detects domain→infra violation in bad_model.go', async () => {
    const violations = await scan();
    const layerViols = violations.filter((v) => v.type === 'layer');
    expect(layerViols.length).toBeGreaterThanOrEqual(1);
    const domainInfra = layerViols.find(
      (v) => v.fromZone === 'domain' && v.toZone === 'infrastructure'
    );
    expect(domainInfra).toBeDefined();
    expect(domainInfra?.fromFile).toContain('bad_model.go');
  });

  it('allows infra importing domain', async () => {
    const violations = await scan();
    const wrongWay = violations.find(
      (v) => v.type === 'layer' && v.fromZone === 'infrastructure' && v.toZone === 'domain'
    );
    expect(wrongWay).toBeUndefined();
  });
});
