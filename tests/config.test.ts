import path from 'path';
import { loadConfig } from '../src/config/loader';

const cleanFixture = path.resolve(__dirname, 'fixtures/clean-arch');
const dirtyFixture = path.resolve(__dirname, 'fixtures/dirty-arch');

describe('loadConfig', () => {
  it('loads a valid config', () => {
    const config = loadConfig(cleanFixture);
    expect(config.layers).toEqual(['domain', 'application', 'infrastructure']);
    expect(Object.keys(config.zones)).toContain('domain');
    expect(config.zones['domain'].canImport).toEqual([]);
  });

  it('loads dirty-arch config with 4 layers', () => {
    const config = loadConfig(dirtyFixture);
    expect(config.layers).toHaveLength(4);
    expect(config.zones['adapter'].canImport).toContain('application');
  });

  it('throws on missing config', () => {
    expect(() => loadConfig('/nonexistent/path/xyz')).toThrow('.driftrc.json');
  });
});
