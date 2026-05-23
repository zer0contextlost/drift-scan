import fs from 'fs/promises';
import path from 'path';
import Parser from 'web-tree-sitter';
import { ImportStatement } from '../types';

const MAX_FILE_SIZE = 500_000;

let parserInstance: Parser | null = null;
let initPromise: Promise<void> | null = null;

function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      await Parser.init();
      const wasmPath = path.join(
        path.dirname(require.resolve('tree-sitter-wasms/package.json')),
        'out',
        'tree-sitter-go.wasm',
      );
      const lang = await Parser.Language.load(wasmPath);
      parserInstance = new Parser();
      parserInstance.setLanguage(lang);
    })();
  }
  return initPromise;
}

function walkGo(node: Parser.SyntaxNode, visitor: (n: Parser.SyntaxNode) => void): void {
  const stack: Parser.SyntaxNode[] = [node];
  while (stack.length > 0) {
    const n = stack.pop()!;
    visitor(n);
    for (let i = n.childCount - 1; i >= 0; i--) {
      const child = n.child(i);
      if (child) stack.push(child);
    }
  }
}

// Read the module name from go.mod in or above startDir
export async function readGoModuleName(startDir: string): Promise<string | null> {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, 'go.mod');
    try {
      const content = await fs.readFile(candidate, 'utf-8');
      const match = content.match(/^module\s+(\S+)/m);
      if (match) return match[1];
    } catch {
      // not found here
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

// Convert an import path to a local path by stripping the module prefix
function importPathToLocal(importPath: string, moduleName: string, projectRoot: string): string | null {
  if (!importPath.startsWith(moduleName)) return null;
  const suffix = importPath.slice(moduleName.length).replace(/^\//, '');
  if (!suffix) return projectRoot.split('\\').join('/');
  return path.join(projectRoot, suffix).split('\\').join('/');
}

function processSpec(
  spec: Parser.SyntaxNode,
  filePath: string,
  moduleName: string,
  projectRoot: string,
  imports: ImportStatement[],
): void {
  // In tree-sitter-go grammar:
  //   import_spec: seq(optional(field("name", ...)), field("path", interpreted_string_literal))
  const pathNode = spec.childForFieldName('path');
  if (pathNode && pathNode.type === 'interpreted_string_literal') {
    const raw = pathNode.text.slice(1, -1); // strip surrounding quotes
    const local = importPathToLocal(raw, moduleName, projectRoot);
    if (local !== null) {
      imports.push({ fromFile: filePath, toPath: local, line: spec.startPosition.row + 1 });
    }
    return;
  }
  // Fallback: scan children for interpreted_string_literal directly
  for (let k = 0; k < spec.childCount; k++) {
    const child = spec.child(k);
    if (!child) continue;
    if (child.type === 'interpreted_string_literal') {
      const raw = child.text.slice(1, -1);
      const local = importPathToLocal(raw, moduleName, projectRoot);
      if (local !== null) {
        imports.push({ fromFile: filePath, toPath: local, line: spec.startPosition.row + 1 });
      }
    }
  }
}

export async function extractGoImports(
  filePath: string,
  moduleName: string,
  projectRoot: string,
): Promise<ImportStatement[]> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_SIZE) return [];

    const source = await fs.readFile(filePath, 'utf-8');
    await ensureInit();
    const tree = parserInstance!.parse(source);
    const imports: ImportStatement[] = [];

    walkGo(tree.rootNode, (node) => {
      if (node.type !== 'import_declaration') return;

      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;

        if (child.type === 'import_spec') {
          // Single unparenthesized import: import "path"
          processSpec(child, filePath, moduleName, projectRoot, imports);
        } else if (child.type === 'import_spec_list') {
          // Parenthesized block: import ( "path1" \n "path2" )
          for (let j = 0; j < child.childCount; j++) {
            const spec = child.child(j);
            if (spec && spec.type === 'import_spec') {
              processSpec(spec, filePath, moduleName, projectRoot, imports);
            }
          }
        }
      }
    });

    return imports;
  } catch {
    return [];
  }
}
