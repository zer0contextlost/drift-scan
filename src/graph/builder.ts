import path from 'path';
import { DependencyNode, DriftConfig } from '../types';
import { extractImports, ParserContext } from '../parsers';

function toFwdSlash(p: string): string {
  return p.split('\\').join('/');
}

// Expand brace alternatives: `{a,b}/**` → [`a/**`, `b/**`]. Handles multiple/nested groups.
function expandBraces(pattern: string): string[] {
  const match = /\{([^{}]+)\}/.exec(pattern);
  if (!match) return [pattern];
  const alternatives = match[1].split(',');
  const results: string[] = [];
  for (const alt of alternatives) {
    const expanded = pattern.slice(0, match.index) + alt.trim() + pattern.slice(match.index + match[0].length);
    results.push(...expandBraces(expanded));
  }
  return results;
}

// Convert a single (brace-free) glob pattern to a RegExp.
//   **  → any path including slashes
//   *   → any non-slash chars
//   ?   → single non-slash char
//   bare path with no wildcards → directory prefix (path itself or any child)
function globToRegex(pattern: string): RegExp {
  const p = pattern.replace(/\/+$/, ''); // strip trailing slashes
  const hasWildcard = p.includes('*') || p.includes('?');

  const escaped = p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex specials (no braces left at this point)
    .replace(/\*\*/g, '\x00DSTAR\x00')      // protect ** before single-star replace
    .replace(/\*/g, '[^/]+')
    .replace(/\x00DSTAR\x00/g, '.*')
    .replace(/\?/g, '[^/]');

  const suffix = hasWildcard ? '' : '(/.*)?';
  return new RegExp(`^${escaped}${suffix}$`);
}

export function assignZone(file: string, rootDir: string, config: DriftConfig): string | null {
  const relFile = toFwdSlash(path.relative(rootDir, file));
  for (const [zoneName, zone] of Object.entries(config.zones)) {
    for (const pattern of zone.paths) {
      for (const expanded of expandBraces(pattern)) {
        if (globToRegex(expanded).test(relFile)) return zoneName;
      }
    }
  }
  return null;
}

export async function buildNodeForFile(
  file: string,
  rootDir: string,
  config: DriftConfig,
  ctx: ParserContext,
): Promise<DependencyNode> {
  const imports = await extractImports(file, ctx);
  return { file, zone: assignZone(file, rootDir, config), imports };
}

export async function buildGraph(
  files: string[],
  rootDir: string,
  config: DriftConfig,
  ctx: ParserContext,
): Promise<DependencyNode[]> {
  return Promise.all(files.map((file) => buildNodeForFile(file, rootDir, config, ctx)));
}
