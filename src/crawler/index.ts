import glob from 'fast-glob';
import { sep } from 'path';
import { DriftConfig } from '../types';

function toFwdSlash(p: string): string {
  return p.split('\\').join('/');
}

const DEFAULT_IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/.git/**',
  '**/*.min.js',
  '**/*.min.ts',
  '**/*.d.ts',        // declaration files — not source, may have synthetic imports
  '**/*.gen.ts',
  '**/*.generated.ts',
  '**/*.generated.js',
  '**/__pycache__/**',
  '**/vendor/**',
  '**/public/**',
];

// Test file patterns are excluded by default; users can override via config.ignore
const TEST_IGNORE = [
  '**/*.test.ts',
  '**/*.test.tsx',
  '**/*.test.js',
  '**/*.spec.ts',
  '**/*.spec.tsx',
  '**/*.spec.js',
  '**/__tests__/**',
  '**/test/**',
  '**/tests/**',
  '**/testdata/**',
  '**/*_test.go',
  '**/test_*.py',
  '**/*_test.py',
  '**/conftest.py',
];

export async function crawlFiles(rootDir: string, config: DriftConfig): Promise<string[]> {
  const ignore = [...DEFAULT_IGNORE, ...TEST_IGNORE, ...config.ignore];

  const files = await glob(['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx', '**/*.py', '**/*.go'], {
    cwd: toFwdSlash(rootDir),
    ignore,
    absolute: true,
  });

  return files.map((f) => f.split('/').join(sep)).sort();
}
