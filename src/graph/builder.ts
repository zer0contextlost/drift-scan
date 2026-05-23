import path from 'path';
import { DependencyNode, DriftConfig } from '../types';
import { extractImports, ParserContext } from '../parsers';
import { expandBraces, globToRegex } from '../util/glob';

function toFwdSlash(p: string): string {
  return p.split('\\').join('/');
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
