import path from 'path';
import { extractTsImports } from '../../src/parsers/typescript';

const domainUser = path.resolve(__dirname, '../fixtures/clean-arch/src/domain/User.ts');
const appService = path.resolve(__dirname, '../fixtures/clean-arch/src/app/UserService.ts');
const dirtyOrder = path.resolve(__dirname, '../fixtures/dirty-arch/src/domain/Order.ts');

describe('extractTsImports', () => {
  it('returns empty for a file with no imports', async () => {
    const imports = await extractTsImports(domainUser);
    // User.ts has no imports
    expect(imports).toHaveLength(0);
  });

  it('extracts relative imports from UserService.ts', async () => {
    const imports = await extractTsImports(appService);
    expect(imports.length).toBeGreaterThanOrEqual(2);
    expect(imports.some((i) => i.toPath.includes('User'))).toBe(true);
    expect(imports.some((i) => i.toPath.includes('UserRepository'))).toBe(true);
  });

  it('extracts the infra import from dirty Order.ts', async () => {
    const imports = await extractTsImports(dirtyOrder);
    expect(imports.some((i) => i.toPath.includes('Database'))).toBe(true);
  });

  it('records correct line numbers', async () => {
    const imports = await extractTsImports(dirtyOrder);
    // The import is on line 2 in dirty Order.ts
    expect(imports[0].line).toBeGreaterThan(0);
  });

  it('returns empty for a nonexistent file', async () => {
    const imports = await extractTsImports('/nonexistent/file.ts');
    expect(imports).toHaveLength(0);
  });
});
