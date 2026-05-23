import fs from 'fs/promises';
import path from 'path';
import { parse, TSESTreeOptions } from '@typescript-eslint/typescript-estree';
import type { TSESTree } from '@typescript-eslint/typescript-estree';
import { ImportStatement } from '../types';

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

function normalizePath(raw: string, fromFile: string): string {
  if (!raw.startsWith('.')) return raw;
  return path.resolve(path.dirname(fromFile), raw).split('\\').join('/');
}

export async function extractTsImports(filePath: string): Promise<ImportStatement[]> {
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

    const ast = parse(source, parseOptions) as TSESTree.Program;
    const imports: ImportStatement[] = [];

    walk(ast, {
      ImportDeclaration(node) {
        const n = node as TSESTree.ImportDeclaration;
        if (typeof n.source.value === 'string') {
          imports.push({
            fromFile: filePath,
            toPath: normalizePath(n.source.value, filePath),
            line: n.loc?.start.line ?? 0,
            typeOnly: n.importKind === 'type',
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
            imports.push({
              fromFile: filePath,
              toPath: normalizePath(val, filePath),
              line: n.loc?.start.line ?? 0,
            });
          }
        }
      },
      // export { x } from '...'
      ExportNamedDeclaration(node) {
        const n = node as TSESTree.ExportNamedDeclaration;
        if (n.source && typeof n.source.value === 'string') {
          imports.push({
            fromFile: filePath,
            toPath: normalizePath(n.source.value, filePath),
            line: n.loc?.start.line ?? 0,
          });
        }
      },
      // dynamic import('...')
      ImportExpression(node) {
        const n = node as TSESTree.ImportExpression;
        if (n.source.type === 'Literal') {
          const val = (n.source as TSESTree.Literal).value;
          if (typeof val === 'string') {
            imports.push({
              fromFile: filePath,
              toPath: normalizePath(val, filePath),
              line: n.loc?.start.line ?? 0,
            });
          }
        }
      },
      ExportAllDeclaration(node) {
        const n = node as TSESTree.ExportAllDeclaration;
        if (typeof n.source.value === 'string') {
          imports.push({
            fromFile: filePath,
            toPath: normalizePath(n.source.value, filePath),
            line: n.loc?.start.line ?? 0,
          });
        }
      },
    });

    return imports;
  } catch {
    return [];
  }
}
