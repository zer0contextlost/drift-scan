import { DependencyNode } from '../types';

function norm(p: string): string {
  return p.split('\\').join('/');
}

/** Resolve a raw import path to an absolute file path in the node map. */
export function resolveToFile(
  toPath: string,
  nodeByFile: Map<string, DependencyNode>,
): string | null {
  const stripped = norm(toPath).replace(/\.(js|jsx)$/, '');
  const toNorm = norm(toPath);

  for (const file of nodeByFile.keys()) {
    const fileNorm = norm(file);
    for (const base of toNorm === stripped ? [toNorm] : [toNorm, stripped]) {
      if (
        fileNorm === base ||
        fileNorm === base + '.ts' ||
        fileNorm === base + '.tsx' ||
        fileNorm === base + '.js' ||
        fileNorm === base + '.jsx' ||
        fileNorm === base + '.py' ||
        fileNorm === base + '.go' ||
        fileNorm === base + '/index.ts' ||
        fileNorm === base + '/index.js' ||
        fileNorm === base + '/__init__.py' ||
        (fileNorm.startsWith(base + '/') && fileNorm.endsWith('.go'))
      ) {
        return file;
      }
    }
  }
  return null;
}
