import fs from 'fs';
import path from 'path';

// Strips JSONC comments and trailing commas without corrupting string values.
function stripJsonc(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    // Inside a string — copy verbatim until closing quote, handling escapes
    if (src[i] === '"') {
      out += src[i++];
      while (i < src.length) {
        if (src[i] === '\\') { out += src[i++]; out += src[i++] ?? ''; }
        else if (src[i] === '"') { out += src[i++]; break; }
        else { out += src[i++]; }
      }
      continue;
    }
    // Line comment
    if (src[i] === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    // Block comment
    if (src[i] === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    // Trailing comma before ] or }
    if (src[i] === ',') {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (src[j] === ']' || src[j] === '}') { i++; continue; }
    }
    out += src[i++];
  }
  return out;
}

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
    const parsed = JSON.parse(stripJsonc(content));
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
