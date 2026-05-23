import fs from 'fs/promises';
import path from 'path';
import { parse, TSESTreeOptions } from '@typescript-eslint/typescript-estree';
import type { TSESTree } from '@typescript-eslint/typescript-estree';
import { ImportStatement } from '../types';
import { TsPathConfig } from '../config/tsconfig';
import { ParserContext } from './index';

const parseOptions: TSESTreeOptions = {
  jsx: true,
  loc: true,
  range: true,
  tokens: false,
  comment: false,
  allowInvalidAST: true,
};

const MAX_FILE_SIZE = 500_000;
const MAX_LINE_LENGTH = 5000;

function walk(root: TSESTree.Node, visitor: Partial<Record<string, (n: TSESTree.Node) => void>>): void {
  const stack: TSESTree.Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    const fn = visitor[node.type];
    if (fn) fn(node);
    const keys = Object.keys(node);
    for (let i = keys.length - 1; i >= 0; i--) {
      const key = keys[i];
      if (key === 'type' || key === 'loc' || key === 'range' || key === 'parent') continue;
      const value = (node as unknown as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        for (let j = value.length - 1; j >= 0; j--) {
          const item = value[j];
          if (item !== null && typeof item === 'object' && 'type' in item) {
            stack.push(item as TSESTree.Node);
          }
        }
      } else if (value !== null && typeof value === 'object' && 'type' in value) {
        stack.push(value as TSESTree.Node);
      }
    }
  }
}

// Resolve a tsconfig path alias like @domain/User → absolute path
function resolvePathAlias(raw: string, cfg: TsPathConfig): string | null {
  for (const [pattern, targets] of Object.entries(cfg.paths)) {
    if (!targets.length) continue;

    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2); // e.g. '@domain'
      if (raw.startsWith(prefix + '/')) {
        const suffix = raw.slice(prefix.length + 1); // 'User' or 'entities/User'
        const target = targets[0];
        const resolved = target.endsWith('/*')
          ? path.join(cfg.baseUrl, target.slice(0, -2), suffix)
          : path.join(cfg.baseUrl, target, suffix);
        return resolved.split('\\').join('/');
      }
    } else if (raw === pattern) {
      return path.join(cfg.baseUrl, targets[0]).split('\\').join('/');
    }
  }
  return null;
}

function normalizePath(raw: string, fromFile: string, tsPathConfig?: TsPathConfig): string {
  if (raw.startsWith('.')) {
    return path.resolve(path.dirname(fromFile), raw).split('\\').join('/');
  }
  if (tsPathConfig) {
    const alias = resolvePathAlias(raw, tsPathConfig);
    if (alias) return alias;
  }
  return raw; // external package — keep as-is
}

// Returns true if the given 1-based line number, or the line above it, contains a drift-ignore comment.
function isSuppressed(lineNum: number, lines: string[]): boolean {
  const idx = lineNum - 1; // convert to 0-based
  const hasIgnore = (l: string | undefined) => l !== undefined && /drift-ignore/.test(l);
  return hasIgnore(lines[idx]) || hasIgnore(lines[idx - 1]);
}

export async function extractTsImports(filePath: string, ctx?: ParserContext): Promise<ImportStatement[]> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_SIZE) return [];

    const source = await fs.readFile(filePath, 'utf-8');

    // Skip minified files
    let pos = 0;
    for (let i = 0; i < 30 && pos < source.length; i++) {
      const nl = source.indexOf('\n', pos);
      const end = nl === -1 ? source.length : nl;
      if (end - pos > MAX_LINE_LENGTH) return [];
      pos = end + 1;
    }

    const lines = source.split('\n');
    const ast = parse(source, parseOptions) as TSESTree.Program;
    const imports: ImportStatement[] = [];
    const tsPathConfig = ctx?.tsPathConfig;

    walk(ast, {
      ImportDeclaration(node) {
        const n = node as TSESTree.ImportDeclaration;
        if (typeof n.source.value === 'string') {
          const lineNum = n.loc?.start.line ?? 0;
          imports.push({
            fromFile: filePath,
            toPath: normalizePath(n.source.value, filePath, tsPathConfig),
            line: lineNum,
            typeOnly: n.importKind === 'type',
            suppress: lineNum > 0 ? isSuppressed(lineNum, lines) : false,
          });
        }
      },
      // require('...')
      CallExpression(node) {
        const n = node as TSESTree.CallExpression;
        if (
          n.callee.type === 'Identifier' &&
          (n.callee as TSESTree.Identifier).name === 'require' &&
          n.arguments.length === 1 &&
          n.arguments[0].type === 'Literal'
        ) {
          const val = (n.arguments[0] as TSESTree.Literal).value;
          if (typeof val === 'string') {
            const lineNum = n.loc?.start.line ?? 0;
            imports.push({
              fromFile: filePath,
              toPath: normalizePath(val, filePath, tsPathConfig),
              line: lineNum,
              suppress: lineNum > 0 ? isSuppressed(lineNum, lines) : false,
            });
          }
        }
      },
      // export { x } from '...'
      ExportNamedDeclaration(node) {
        const n = node as TSESTree.ExportNamedDeclaration;
        if (n.source && typeof n.source.value === 'string') {
          const lineNum = n.loc?.start.line ?? 0;
          imports.push({
            fromFile: filePath,
            toPath: normalizePath(n.source.value, filePath, tsPathConfig),
            line: lineNum,
            suppress: lineNum > 0 ? isSuppressed(lineNum, lines) : false,
          });
        }
      },
      // dynamic import('...')
      ImportExpression(node) {
        const n = node as TSESTree.ImportExpression;
        if (n.source.type === 'Literal') {
          const val = (n.source as TSESTree.Literal).value;
          if (typeof val === 'string') {
            const lineNum = n.loc?.start.line ?? 0;
            imports.push({
              fromFile: filePath,
              toPath: normalizePath(val, filePath, tsPathConfig),
              line: lineNum,
              suppress: lineNum > 0 ? isSuppressed(lineNum, lines) : false,
            });
          }
        }
      },
      ExportAllDeclaration(node) {
        const n = node as TSESTree.ExportAllDeclaration;
        if (typeof n.source.value === 'string') {
          const lineNum = n.loc?.start.line ?? 0;
          imports.push({
            fromFile: filePath,
            toPath: normalizePath(n.source.value, filePath, tsPathConfig),
            line: lineNum,
            suppress: lineNum > 0 ? isSuppressed(lineNum, lines) : false,
          });
        }
      },
    });

    return imports;
  } catch {
    return [];
  }
}
