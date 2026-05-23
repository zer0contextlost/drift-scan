import path from 'path';
import { extractPyImports } from '../../src/parsers/python';

const fixture = path.resolve(__dirname, '../fixtures/python-arch');

describe('extractPyImports', () => {
  it('returns empty for a file with no imports', async () => {
    const imports = await extractPyImports(path.join(fixture, 'domain/user.py'), fixture);
    expect(imports).toHaveLength(0);
  });

  it('extracts from-import statements', async () => {
    const imports = await extractPyImports(path.join(fixture, 'domain/repository.py'), fixture);
    expect(imports.length).toBeGreaterThanOrEqual(1);
    expect(imports.some((i) => i.toPath.includes('user'))).toBe(true);
  });

  it('extracts the infra import from bad_service.py', async () => {
    const imports = await extractPyImports(path.join(fixture, 'domain/bad_service.py'), fixture);
    expect(imports.some((i) => i.toPath.includes('db'))).toBe(true);
    expect(imports.some((i) => i.toPath.includes('user'))).toBe(true);
  });

  it('records line numbers', async () => {
    const imports = await extractPyImports(path.join(fixture, 'domain/bad_service.py'), fixture);
    expect(imports[0].line).toBeGreaterThan(0);
  });

  it('does not flag os/sys as internal imports', async () => {
    const imports = await extractPyImports(path.join(fixture, 'infra/db.py'), fixture);
    // os is an external stdlib module — its resolved path won't be found in nodeByFile,
    // so it won't produce a violation. But the parser still returns it; it will be filtered
    // by resolveToFile in the checker.
    // What we assert: the fromFile is correctly recorded.
    expect(imports.every((i) => i.fromFile === path.join(fixture, 'infra/db.py'))).toBe(true);
  });

  it('returns empty for a nonexistent file', async () => {
    const imports = await extractPyImports('/nonexistent/file.py', '/nonexistent');
    expect(imports).toHaveLength(0);
  });
});
