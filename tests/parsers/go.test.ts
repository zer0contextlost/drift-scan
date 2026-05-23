import path from 'path';
import { extractGoImports, readGoModuleName } from '../../src/parsers/go';

const fixture = path.resolve(__dirname, '../fixtures/go-arch');
const moduleName = 'example.com/myapp';

describe('readGoModuleName', () => {
  it('reads module name from go.mod', async () => {
    const name = await readGoModuleName(fixture);
    expect(name).toBe('example.com/myapp');
  });

  it('returns null when no go.mod exists', async () => {
    const name = await readGoModuleName('/nonexistent/path');
    expect(name).toBeNull();
  });
});

describe('extractGoImports', () => {
  it('extracts internal imports from infra/postgres.go', async () => {
    const filePath = path.join(fixture, 'internal/infra/postgres.go');
    const imports = await extractGoImports(filePath, moduleName, fixture);
    expect(imports.length).toBeGreaterThanOrEqual(1);
    expect(imports.some((i) => i.toPath.includes('domain'))).toBe(true);
  });

  it('extracts the violation import from domain/bad_model.go', async () => {
    const filePath = path.join(fixture, 'internal/domain/bad_model.go');
    const imports = await extractGoImports(filePath, moduleName, fixture);
    expect(imports.some((i) => i.toPath.includes('infra'))).toBe(true);
  });

  it('does not include external stdlib imports', async () => {
    // postgres.go only imports example.com/myapp/... — external packages (none here)
    // would be filtered by importPathToLocal returning null
    const filePath = path.join(fixture, 'internal/infra/postgres.go');
    const imports = await extractGoImports(filePath, moduleName, fixture);
    expect(imports.every((i) => i.toPath.startsWith(fixture.split('\\').join('/')))).toBe(true);
  });

  it('returns empty for a file with no imports', async () => {
    const filePath = path.join(fixture, 'internal/domain/user.go');
    const imports = await extractGoImports(filePath, moduleName, fixture);
    expect(imports).toHaveLength(0);
  });

  it('returns empty for a nonexistent file', async () => {
    const imports = await extractGoImports('/nonexistent/file.go', moduleName, fixture);
    expect(imports).toHaveLength(0);
  });
});
