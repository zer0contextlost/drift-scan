import path from 'path';
import fs from 'fs';
import os from 'os';
import { loadConfig } from '../src/config/loader';
import { readTsPathConfig } from '../src/config/tsconfig';

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

describe('readTsPathConfig — JSONC parsing', () => {
  function writeTsconfig(dir: string, content: string) {
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), content);
  }

  it('parses standard JSON tsconfig with paths', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-tsc-'));
    writeTsconfig(tmp, JSON.stringify({
      compilerOptions: { baseUrl: '.', paths: { '@app/*': ['src/*'] } }
    }));
    const cfg = readTsPathConfig(tmp);
    expect(cfg).not.toBeNull();
    expect(cfg!.paths['@app/*']).toEqual(['src/*']);
  });

  it('strips line comments without corrupting string values', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-tsc-'));
    writeTsconfig(tmp, `{
      // top-level comment
      "compilerOptions": {
        "baseUrl": ".",
        "paths": {
          "@foo/*": ["./src/*"] // inline comment
        }
      }
    }`);
    const cfg = readTsPathConfig(tmp);
    expect(cfg).not.toBeNull();
    expect(cfg!.paths['@foo/*']).toEqual(['./src/*']);
  });

  it('handles glob patterns like @pkg/* in path keys without misreading as block comments', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-tsc-'));
    writeTsconfig(tmp, `{
      "compilerOptions": {
        "baseUrl": ".",
        "paths": {
          "@nestjs/common": ["./packages/common"],
          "@nestjs/common/*": ["./packages/common/*"],
          "@nestjs/core/*": ["./packages/core/*"]
        }
      }
    }`);
    const cfg = readTsPathConfig(tmp);
    expect(cfg).not.toBeNull();
    expect(Object.keys(cfg!.paths)).toHaveLength(3);
    expect(cfg!.paths['@nestjs/common/*']).toEqual(['./packages/common/*']);
  });

  it('handles trailing commas after last entries', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-tsc-'));
    writeTsconfig(tmp, `{
      "compilerOptions": {
        "baseUrl": ".",
        "paths": {
          "@a/*": ["./a/*"],
          "@b/*": ["./b/*"],
        },
      },
    }`);
    const cfg = readTsPathConfig(tmp);
    expect(cfg).not.toBeNull();
    expect(cfg!.paths['@b/*']).toEqual(['./b/*']);
  });

  it('returns null when no paths defined', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-tsc-'));
    writeTsconfig(tmp, JSON.stringify({ compilerOptions: { strict: true } }));
    expect(readTsPathConfig(tmp)).toBeNull();
  });
});
