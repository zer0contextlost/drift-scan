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

function resolveModule(moduleName: string, fromFile: string, projectRoot: string): string[] {
  const relative = moduleName.split('.').join('/');
  const projAbs = path.resolve(projectRoot).split('\\').join('/');
  const candidates: string[] = [];

  // Same-directory resolution (for flat projects where cwd is added to sys.path)
  const fromDir = path.join(path.dirname(fromFile), relative);
  const absDir = path.resolve(fromDir).split('\\').join('/');
  if (absDir.startsWith(projAbs)) candidates.push(absDir);

  // Project-root resolution (for installed packages / top-level modules)
  const fromRoot = path.join(projectRoot, relative);
  const absRoot = path.resolve(fromRoot).split('\\').join('/');
  if (absRoot.startsWith(projAbs)) candidates.push(absRoot);

  return candidates.length > 0 ? candidates : [moduleName];
}

function isSuppressed(lineNum: number, lines: string[]): boolean {
  const idx = lineNum - 1;
  const hasIgnore = (l: string | undefined) => l !== undefined && /drift-ignore/.test(l);
  return hasIgnore(lines[idx]) || hasIgnore(lines[idx - 1]);
}

function resolveRelative(moduleName: string, fromFile: string): string {
  // moduleName starts with one or more dots: `.x`, `..x`, `...`
  const dots = moduleName.match(/^\.+/)?.[0].length ?? 1;
  const rest = moduleName.slice(dots).split('.').join('/');
  let base = path.dirname(fromFile);
  for (let i = 1; i < dots; i++) base = path.dirname(base);
  return rest
    ? path.join(base, rest).split('\\').join('/')
    : base.split('\\').join('/');
}

// Returns true if the node is inside an `if TYPE_CHECKING:` block
function isInsideTypeCheckingGuard(node: Parser.SyntaxNode): boolean {
  let cur: Parser.SyntaxNode | null = node.parent;
  while (cur) {
    if (cur.type === 'if_statement') {
      const cond = cur.childForFieldName('condition');
      if (cond && /\bTYPE_CHECKING\b/.test(cond.text)) return true;
    }
    cur = cur.parent;
  }
  return false;
}

export async function extractPyImports(filePath: string, projectRoot: string): Promise<ImportStatement[]> {
  try {
    const stat = await fs.stat(filePath);
    if (stat.size > MAX_FILE_SIZE) return [];

    const source = await fs.readFile(filePath, 'utf-8');
    const lines = source.split('\n');
    await ensureInit();
    const tree = parserInstance!.parse(source);
    const imports: ImportStatement[] = [];

    walkPython(tree.rootNode, (node) => {
      // import x  /  import x as y  /  import x, y
      if (node.type === 'import_statement') {
        const typeOnly = isInsideTypeCheckingGuard(node);
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (!child) continue;
          const lineNum = node.startPosition.row + 1;
          const suppress = isSuppressed(lineNum, lines);
          if (child.type === 'dotted_name') {
            for (const toPath of resolveModule(child.text, filePath, projectRoot)) {
              imports.push({ fromFile: filePath, toPath, line: lineNum, suppress, typeOnly });
            }
          } else if (child.type === 'aliased_import') {
            const nameNode = child.childForFieldName('name') ?? child.child(0);
            if (nameNode) {
              for (const toPath of resolveModule(nameNode.text, filePath, projectRoot)) {
                imports.push({ fromFile: filePath, toPath, line: lineNum, suppress, typeOnly });
              }
            }
          }
        }
      }

      // from x import y  /  from . import y  /  from ..x import y
      if (node.type === 'import_from_statement') {
        const moduleNode =
          node.childForFieldName('module_name') ?? node.child(1);
        if (!moduleNode) return;

        const moduleName = moduleNode.text;
        if (!moduleName || moduleName === 'import') return;

        const lineNum = node.startPosition.row + 1;
        const suppress = isSuppressed(lineNum, lines);
        const typeOnly = isInsideTypeCheckingGuard(node);
        if (moduleName.startsWith('.')) {
          imports.push({
            fromFile: filePath,
            toPath: resolveRelative(moduleName, filePath),
            line: lineNum,
            suppress,
            typeOnly,
          });
        } else {
          for (const toPath of resolveModule(moduleName, filePath, projectRoot)) {
            imports.push({ fromFile: filePath, toPath, line: lineNum, suppress, typeOnly });
          }
        }
      }
    });

    return imports;
  } catch {
    return [];
  }
}
