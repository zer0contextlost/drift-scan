import { ImportStatement } from '../types';
import { extractTsImports } from './typescript';
import { extractPyImports } from './python';
import { extractGoImports } from './go';

export interface ParserContext {
  projectRoot: string;
  goModuleName?: string;
}

export async function extractImports(filePath: string, ctx: ParserContext): Promise<ImportStatement[]> {
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.js') || lower.endsWith('.jsx')) {
    return extractTsImports(filePath);
  }
  if (lower.endsWith('.py')) {
    return extractPyImports(filePath, ctx.projectRoot);
  }
  if (lower.endsWith('.go')) {
    if (!ctx.goModuleName) return [];
    return extractGoImports(filePath, ctx.goModuleName, ctx.projectRoot);
  }
  return [];
}

export { extractTsImports, extractPyImports, extractGoImports };
