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
        'tree-sitter-python.wasm',
      );
      const lang = await Parser.Language.load(wasmPath);
      parserInstance = new Parser();
      parserInstance.setLanguage(lang);
    })();
  }
  return initPromise;
}

function walkPython(node: Parser.SyntaxNode, visitor: (n: Parser.SyntaxNode) => void): void {
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

// Resolve a Python module path to a file path relative to project root
function resolveModule(moduleName: string, fromFile: string, projectRoot: string): string {
  // Convert dotted module name to path segments
  const parts = moduleName.split('.');
  const relative = parts.join('/');

  // Try resolving relative to project root first, then relative to the file
  const fromRoot = path.join(projectRoot, relative);
  const fromDir = path.join(path.dirname(fromFile), relative);

  // Return the path that's more likely internal (under project root)
  const absRoot = path.resolve(fromRoot).split('\\').join('/');
  const absDir = path.resolve(fromDir).split('\\').join('/');
  const projAbs = path.resolve(projectRoot).split('\\').join('/');

  if (absRoot.startsWith(projAbs)) return absRoot;
  if (absDir.startsWith(projAbs)) return absDir;
  return moduleName; // external package — keep as-is
}

export async function extractPyImports(filePath: string, projectRoot: string): Promise<ImportStatement[]> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_SIZE) return [];

    const source = await fs.readFile(filePath, 'utf-8');
    await ensureInit();
    const tree = parserInstance!.parse(source);
    const imports: ImportStatement[] = [];

    walkPython(tree.rootNode, (node) => {
      if (node.type === 'import_statement') {
        // import x, y, z
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (!child) continue;
          if (child.type === 'dotted_name' || child.type === 'aliased_import') {
            const name = child.type === 'aliased_import'
              ? child.child(0)?.text ?? ''
              : child.text;
            if (name) {
              imports.push({
                fromFile: filePath,
                toPath: resolveModule(name, filePath, projectRoot),
                line: node.startPosition.row + 1,
              });
            }
          }
        }
      }

      if (node.type === 'import_from_statement') {
        // from x import y
        const moduleNode = node.child(1); // 'from <module>'
        if (moduleNode && (moduleNode.type === 'dotted_name' || moduleNode.type === 'relative_import')) {
          let moduleName = moduleNode.text;
          // relative imports start with dots — resolve relative to file
          if (moduleName.startsWith('.')) {
            const dots = moduleName.match(/^\.+/)?.[0].length ?? 0;
            const rest = moduleName.slice(dots);
            let base = path.dirname(filePath);
            for (let i = 1; i < dots; i++) base = path.dirname(base);
            const resolved = rest
              ? path.join(base, rest.split('.').join('/')).split('\\').join('/')
              : base.split('\\').join('/');
            imports.push({ fromFile: filePath, toPath: resolved, line: node.startPosition.row + 1 });
          } else {
            imports.push({
              fromFile: filePath,
              toPath: resolveModule(moduleName, filePath, projectRoot),
              line: node.startPosition.row + 1,
            });
          }
        }
      }
    });

    return imports;
  } catch {
    return [];
  }
}
