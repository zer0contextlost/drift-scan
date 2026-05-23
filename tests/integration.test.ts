import path from 'path';
import { loadConfig } from '../src/config/loader';
import { crawlFiles } from '../src/crawler';
import { buildGraph } from '../src/graph/builder';
import { checkGraph } from '../src/graph/checker';
import { rankViolations } from '../src/rank';

const cleanFixture = path.resolve(__dirname, 'fixtures/clean-arch');
const dirtyFixture = path.resolve(__dirname, 'fixtures/dirty-arch');

describe('integration — clean-arch fixture', () => {
  it('produces zero violations on a well-layered codebase', async () => {
    const config = loadConfig(cleanFixture);
    const files = await crawlFiles(cleanFixture, config);
    const ctx = { projectRoot: cleanFixture };
    const nodes = await buildGraph(files, cleanFixture, config, ctx);
    const raw = checkGraph(nodes, config);
    const violations = rankViolations(raw, config);
    expect(violations).toHaveLength(0);
  });
});

describe('integration — dirty-arch fixture', () => {
  it('detects the domain→infra layer violation', async () => {
    const config = loadConfig(dirtyFixture);
    const files = await crawlFiles(dirtyFixture, config);
    const ctx = { projectRoot: dirtyFixture };
    const nodes = await buildGraph(files, dirtyFixture, config, ctx);
    const raw = checkGraph(nodes, config);
    const violations = rankViolations(raw, config);

    const layerViols = violations.filter((v) => v.type === 'layer');
    expect(layerViols.length).toBeGreaterThanOrEqual(1);

    const domainInfra = layerViols.find(
      (v) => v.fromZone === 'domain' && v.toZone === 'infrastructure'
    );
    expect(domainInfra).toBeDefined();
  });

  it('detects the app↔adapter circular dependency', async () => {
    const config = loadConfig(dirtyFixture);
    const files = await crawlFiles(dirtyFixture, config);
    const ctx = { projectRoot: dirtyFixture };
    const nodes = await buildGraph(files, dirtyFixture, config, ctx);
    const raw = checkGraph(nodes, config);
    const violations = rankViolations(raw, config);

    const circViols = violations.filter((v) => v.type === 'circular');
    expect(circViols.length).toBeGreaterThanOrEqual(1);
  });

  it('ranks critical violations before low ones', async () => {
    const config = loadConfig(dirtyFixture);
    const files = await crawlFiles(dirtyFixture, config);
    const ctx = { projectRoot: dirtyFixture };
    const nodes = await buildGraph(files, dirtyFixture, config, ctx);
    const raw = checkGraph(nodes, config);
    const violations = rankViolations(raw, config);

    const scores = violations.map((v) => v.score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });
});
