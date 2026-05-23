import fs from 'fs';
import path from 'path';

export interface TsPathConfig {
  paths: Record<string, string[]>;
  baseUrl: string;
}

// Reads compilerOptions.paths and baseUrl from tsconfig.json in the project root.
// Returns null if tsconfig doesn't exist or has no path aliases.
export function readTsPathConfig(projectRoot: string): TsPathConfig | null {
  try {
    const tsconfigPath = path.join(projectRoot, 'tsconfig.json');
    const content = fs.readFileSync(tsconfigPath, 'utf-8');
    // tsconfig is JSONC — strip comments before parsing
    const stripped = content
      .replace(/\/\/[^\n]*/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '');
    const parsed = JSON.parse(stripped);
    const co = parsed?.compilerOptions;
    if (!co || typeof co.paths !== 'object' || co.paths === null) return null;

    const baseUrl = co.baseUrl
      ? path.resolve(projectRoot, co.baseUrl).split('\\').join('/')
      : projectRoot.split('\\').join('/');

    return { paths: co.paths as Record<string, string[]>, baseUrl };
  } catch {
    return null;
  }
}
