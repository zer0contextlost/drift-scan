import path from 'path';
import { DependencyNode, DriftConfig } from '../types';
import { extractImports, ParserContext } from '../parsers';

function toFwdSlash(p: string): string {
  return p.split('\\').join('/');
}

// Convert a glob pattern to a regex. Handles:
//   **   → matches any path segment (including slashes)
//   *    → matches any non-slash chars
//   no * → treated as directory prefix (matches path itself or any file underneath)
function globToRegex(pattern: string): RegExp {
  const hasWildcard = pattern.includes('*');

  let escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex specials except * which we handle
    .replace(/\*\*/g, '\x00DS\x00')        // placeholder for **
    .replace(/\*/g, '[^/]+')               // * → one or more non-slash chars
    .replace(/\x00DS\x00/g, '.*');         // ** → anything including slashes

  // If no wildcard, treat as directory prefix: match the dir itself or any child
  if (!hasWildcard) {
    escaped = `${escaped}(/.*)?`;
  }

  return new RegExp(`^${escaped}$`);
}

function assignZone(file: string, rootDir: string, config: DriftConfig): string | null {
  const relFile = toFwdSlash(path.relative(rootDir, file));
  for (const [zoneName, zone] of Object.entries(config.zones)) {
    for (const pattern of zone.paths) {
      if (globToRegex(pattern).test(relFile)) {
        return zoneName;
      }
    }
  }
  return null;
}

export async function buildGraph(
  files: string[],
  rootDir: string,
  config: DriftConfig,
  ctx: ParserContext,
): Promise<DependencyNode[]> {
  const nodes = await Promise.all(
    files.map(async (file) => {
      const imports = await extractImports(file, ctx);
      return {
        file,
        zone: assignZone(file, rootDir, config),
        imports,
      };
    })
  );
  return nodes;
}
