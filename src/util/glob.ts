// Expand brace alternatives: {a,b}/** → [a/**, b/**]. Handles multiple/nested groups.
export function expandBraces(pattern: string): string[] {
  const match = /\{([^{}]+)\}/.exec(pattern);
  if (!match) return [pattern];
  const results: string[] = [];
  for (const alt of match[1].split(',')) {
    const expanded = pattern.slice(0, match.index) + alt.trim() + pattern.slice(match.index + match[0].length);
    results.push(...expandBraces(expanded));
  }
  return results;
}

// Convert a single (brace-free) glob to a RegExp.
export function globToRegex(pattern: string): RegExp {
  const p = pattern.replace(/\/+$/, '');
  const hasWildcard = p.includes('*') || p.includes('?');
  const escaped = p
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\x00DSTAR\x00')
    .replace(/\*/g, '[^/]+')
    .replace(/\x00DSTAR\x00/g, '.*')
    .replace(/\?/g, '[^/]');
  return new RegExp(`^${escaped}${hasWildcard ? '' : '(/.*)?'}$`);
}

// Test whether a forward-slash relative path matches a glob pattern (with brace expansion).
export function matchGlob(pattern: string, relPath: string): boolean {
  return expandBraces(pattern).some((p) => globToRegex(p).test(relPath));
}
