#!/usr/bin/env node
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { Command } from 'commander';
import { loadConfig } from './config/loader';
import { crawlFiles } from './crawler';
import { buildGraph, buildNodeForFile } from './graph/builder';
import { checkGraph } from './graph/checker';
import { rankViolations } from './rank';
import { printReport } from './report/terminal';
import { formatJson } from './report/json';
import { formatSarif } from './report/sarif';
import { buildZoneGraph, formatMermaid, formatDot } from './report/graph';
import { filterBySeverity } from './report/filters';
import { applyExceptions } from './report/exceptions';
import { saveBaseline, loadBaseline, filterByBaseline } from './report/baseline';
import { printStats } from './report/stats';
import { readGoModuleName } from './parsers/go';
import { readTsPathConfig } from './config/tsconfig';
import { Severity, ScanResult, Violation, DriftConfig, DependencyNode } from './types';

const VERSION = '1.5.0';

const program = new Command();

program
  .name('drift')
  .description('Detect architectural drift in multi-language codebases')
  .version(VERSION);

// ─── scan ────────────────────────────────────────────────────────────────────

program
  .command('scan [dir]')
  .description('Scan a directory for architectural violations')
  .option('--json', 'output JSON')
  .option('--sarif', 'output SARIF 2.1 (GitHub code scanning)')
  .option('--since <ref>', 'only scan files changed since git ref (e.g. main)')
  .option('--fail-on <severity>', 'exit 1 if violations at this severity or above exist')
  .option('--min-severity <severity>', 'only show violations at this severity or above')
  .option('--output <file>', 'write report to a file instead of stdout')
  .option('--watch', 'watch for file changes and re-scan automatically')
  .option('--save-baseline <file>', 'save current violations as a baseline and exit')
  .option('--from-baseline <file>', 'only report violations not present in baseline file')
  .action(async (
    dir: string | undefined,
    opts: {
      json?: boolean;
      sarif?: boolean;
      since?: string;
      failOn?: string;
      minSeverity?: string;
      output?: string;
      watch?: boolean;
      saveBaseline?: string;
      fromBaseline?: string;
    },
  ) => {
    const targetDir = path.resolve(dir ?? '.');

    let config: DriftConfig;
    try {
      config = loadConfig(targetDir);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }

    const runScan = async (): Promise<{ result: ScanResult; exitCode: number; noEmit?: boolean }> => {
      const start = Date.now();
      let files = await crawlFiles(targetDir, config);
      if (opts.since) files = filterBySince(files, opts.since, targetDir);

      const goModuleName = await readGoModuleName(targetDir) ?? undefined;
      const tsPathConfig = readTsPathConfig(targetDir) ?? undefined;
      const ctx = { projectRoot: targetDir, goModuleName, tsPathConfig };
      const nodes = await buildGraph(files, targetDir, config, ctx);
      const raw = checkGraph(nodes, config);
      let violations = rankViolations(raw, config);

      // Apply config-level exceptions
      const { kept: afterExceptions, excepted } = applyExceptions(violations, targetDir, config);
      violations = afterExceptions;

      // --save-baseline: persist current violations and exit
      if (opts.saveBaseline) {
        saveBaseline(violations, targetDir, opts.saveBaseline, VERSION);
        console.log(`baseline saved to ${opts.saveBaseline} (${violations.length} violations)`);
        return { result: { version: VERSION, scannedFiles: files.length, violations, durationMs: Date.now() - start }, exitCode: 0, noEmit: true };
      }

      // --from-baseline: suppress violations already in baseline
      let baselineSuppressed = 0;
      if (opts.fromBaseline) {
        try {
          const baseline = loadBaseline(opts.fromBaseline);
          const { kept, suppressed } = filterByBaseline(violations, baseline, targetDir);
          violations = kept;
          baselineSuppressed = suppressed;
        } catch (e) {
          console.error((e as Error).message);
          process.exit(1);
        }
      }

      if (opts.minSeverity) {
        violations = filterBySeverity(violations, opts.minSeverity as Severity);
      }

      const result: ScanResult = {
        version: VERSION,
        scannedFiles: files.length,
        violations,
        durationMs: Date.now() - start,
        excepted,
        baselineSuppressed,
      };

      let exitCode = 0;
      if (opts.failOn) {
        const threshold = opts.failOn as Severity;
        const order: Severity[] = ['low', 'medium', 'high', 'critical'];
        if (violations.some((v) => order.indexOf(v.severity) >= order.indexOf(threshold))) {
          exitCode = 1;
        }
      }

      return { result, exitCode };
    };

    const emit = async (result: ScanResult): Promise<void> => {
      let output: string;
      if (opts.sarif) {
        output = formatSarif(result);
      } else if (opts.json) {
        output = formatJson(result);
      } else {
        if (opts.output) {
          // capture terminal output to string for file write
          const lines: string[] = [];
          const orig = console.log.bind(console);
          console.log = (...args: unknown[]) => lines.push(args.join(' '));
          await printReport(result, targetDir);
          console.log = orig;
          fs.writeFileSync(opts.output, lines.join('\n') + '\n');
          console.log(`report written to ${opts.output}`);
          return;
        }
        await printReport(result, targetDir);
        return;
      }

      if (opts.output) {
        fs.writeFileSync(opts.output, output + '\n');
        console.log(`report written to ${opts.output}`);
      } else {
        console.log(output);
      }
    };

    if (opts.watch) {
      const chokidar = await import('chokidar');
      const { default: chalk } = await import('chalk');

      const goModuleName = await readGoModuleName(targetDir) ?? undefined;
      const tsPathConfig = readTsPathConfig(targetDir) ?? undefined;
      const ctx = { projectRoot: targetDir, goModuleName, tsPathConfig };

      let debounce: ReturnType<typeof setTimeout> | null = null;
      let running = false;
      let nodeCache: Map<string, DependencyNode> | null = null;

      const buildAndEmit = async (nodes: DependencyNode[], start: number) => {
        const raw = checkGraph(nodes, config);
        let violations = rankViolations(raw, config);
        if (opts.minSeverity) violations = filterBySeverity(violations, opts.minSeverity as Severity);
        const result: ScanResult = {
          version: VERSION,
          scannedFiles: nodeCache!.size,
          violations,
          durationMs: Date.now() - start,
        };
        await emit(result);
      };

      const doScan = async (changedFile?: string) => {
        if (running) return;
        running = true;
        process.stdout.write('\x1Bc');
        const label = changedFile ? path.relative(targetDir, changedFile) : 'full scan';
        console.log(chalk.gray(`  watching ${targetDir} · ${label} · Ctrl+C to stop\n`));
        try {
          const start = Date.now();
          const isConfig = changedFile && path.basename(changedFile) === '.driftrc.json';

          if (!nodeCache || !changedFile || isConfig) {
            // Full scan: initial run or config file changed
            if (isConfig) {
              try { config = loadConfig(targetDir); } catch { /* keep old */ }
            }
            const files = await crawlFiles(targetDir, config);
            const nodes = await buildGraph(files, targetDir, config, ctx);
            nodeCache = new Map(nodes.map((n) => [n.file, n]));
            await buildAndEmit(nodes, start);
          } else {
            // Incremental: re-parse only the changed file
            if (fs.existsSync(changedFile)) {
              const node = await buildNodeForFile(changedFile, targetDir, config, ctx);
              nodeCache.set(changedFile, node);
            } else {
              nodeCache.delete(changedFile);
            }
            await buildAndEmit(Array.from(nodeCache.values()), start);
          }
        } catch (e) {
          console.error((e as Error).message);
        }
        running = false;
      };

      await doScan();

      const watcher = chokidar.watch([targetDir], {
        ignored: [/node_modules/, /\.git/, /dist/],
        ignoreInitial: true,
        persistent: true,
      });

      const onChange = (filePath: string) => {
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => doScan(filePath), 300);
      };

      watcher.on('change', onChange).on('add', onChange).on('unlink', onChange);
      return; // keep process alive
    }

    const { result, exitCode, noEmit } = await runScan();
    if (!noEmit) await emit(result);
    if (exitCode !== 0) process.exit(exitCode);
  });

// ─── explain ─────────────────────────────────────────────────────────────────

program
  .command('explain <file>')
  .description('Show all violations involving a specific file')
  .option('--json', 'output JSON')
  .option('--sarif', 'output SARIF')
  .option('--min-severity <severity>', 'only show violations at this severity or above')
  .action(async (file: string, opts: { json?: boolean; sarif?: boolean; minSeverity?: string }) => {
    const targetFile = path.resolve(file);
    const rootDir = path.resolve('.');
    const start = Date.now();

    let config: DriftConfig;
    try {
      config = loadConfig(path.dirname(targetFile));
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }

    const goModuleName = await readGoModuleName(rootDir) ?? undefined;
    const tsPathConfig = readTsPathConfig(rootDir) ?? undefined;
    const ctx = { projectRoot: rootDir, goModuleName, tsPathConfig };
    const files = await crawlFiles(rootDir, config);
    const nodes = await buildGraph(files, rootDir, config, ctx);
    const raw = checkGraph(nodes, config);
    let violations = rankViolations(raw, config);

    violations = violations.filter(
      (v: Violation) => v.fromFile === targetFile || v.toFile === targetFile
    );

    if (opts.minSeverity) {
      violations = filterBySeverity(violations, opts.minSeverity as Severity);
    }

    const result: ScanResult = {
      version: VERSION,
      scannedFiles: files.length,
      violations,
      durationMs: Date.now() - start,
    };

    if (opts.sarif) {
      console.log(formatSarif(result));
    } else if (opts.json) {
      console.log(formatJson(result));
    } else {
      await printReport(result, rootDir);
    }
  });

// ─── stats ───────────────────────────────────────────────────────────────────

program
  .command('stats [dir]')
  .description('Show architecture health: zone sizes, import counts, violation breakdown')
  .action(async (dir: string | undefined) => {
    const targetDir = path.resolve(dir ?? '.');

    let config: DriftConfig;
    try {
      config = loadConfig(targetDir);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }

    const goModuleName = await readGoModuleName(targetDir) ?? undefined;
    const tsPathConfig = readTsPathConfig(targetDir) ?? undefined;
    const ctx = { projectRoot: targetDir, goModuleName, tsPathConfig };
    const files = await crawlFiles(targetDir, config);
    const nodes = await buildGraph(files, targetDir, config, ctx);
    const raw = checkGraph(nodes, config);
    const violations = rankViolations(raw, config);
    const { kept } = applyExceptions(violations, targetDir, config);

    await printStats(nodes, kept, config, targetDir);
  });

// ─── graph ───────────────────────────────────────────────────────────────────

program
  .command('graph [dir]')
  .description('Output the inter-zone dependency graph (Mermaid or DOT)')
  .option('--dot', 'output Graphviz DOT instead of Mermaid')
  .option('--output <file>', 'write graph to a file')
  .action(async (dir: string | undefined, opts: { dot?: boolean; output?: string }) => {
    const targetDir = path.resolve(dir ?? '.');

    let config: DriftConfig;
    try {
      config = loadConfig(targetDir);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }

    const goModuleName = await readGoModuleName(targetDir) ?? undefined;
    const ctx = { projectRoot: targetDir, goModuleName };
    const files = await crawlFiles(targetDir, config);
    const nodes = await buildGraph(files, targetDir, config, ctx);

    const edges = buildZoneGraph(nodes, config);
    const output = opts.dot ? formatDot(edges, config) : formatMermaid(edges, config);

    if (opts.output) {
      fs.writeFileSync(opts.output, output + '\n');
      console.log(`graph written to ${opts.output}`);
    } else {
      console.log(output);
    }
  });

// ─── init ────────────────────────────────────────────────────────────────────

program
  .command('init [dir]')
  .description('Scaffold a .driftrc.json for a project by inspecting its directory structure')
  .action(async (dir: string | undefined) => {
    const targetDir = path.resolve(dir ?? '.');
    const configPath = path.join(targetDir, '.driftrc.json');

    if (fs.existsSync(configPath)) {
      console.error(`.driftrc.json already exists at ${configPath}`);
      process.exit(1);
    }

    const { default: chalk } = await import('chalk');

    const srcDir = fs.existsSync(path.join(targetDir, 'src'))
      ? path.join(targetDir, 'src')
      : targetDir;

    const subdirs = fs.readdirSync(srcDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') &&
        !['node_modules', 'dist', 'build', '__pycache__'].includes(d.name))
      .map((d) => d.name);

    const KNOWN_LAYERS: string[] = [
      'domain', 'core', 'model', 'entity',
      'app', 'application', 'service', 'usecase', 'use-case',
      'adapter', 'interface',
      'infrastructure', 'infra', 'persistence', 'repository', 'db',
      'api', 'http', 'cli', 'cmd',
    ];
    const detected = subdirs.filter((d) => KNOWN_LAYERS.includes(d.toLowerCase()));
    const unknown = subdirs.filter((d) => !KNOWN_LAYERS.includes(d.toLowerCase()));

    const LAYER_ORDER: Record<string, number> = {
      domain: 0, core: 0, model: 0, entity: 0,
      app: 1, application: 1, service: 1, usecase: 1, 'use-case': 1,
      adapter: 2, interface: 2,
      infrastructure: 3, infra: 3, persistence: 3, repository: 3, db: 3,
      api: 4, http: 4, cli: 4, cmd: 4,
    };
    const sorted = [...detected].sort(
      (a, b) => (LAYER_ORDER[a.toLowerCase()] ?? 9) - (LAYER_ORDER[b.toLowerCase()] ?? 9)
    );

    const prefix = srcDir === path.join(targetDir, 'src') ? 'src/' : '';
    const zones: Record<string, { paths: string[]; canImport: string[] }> = {};
    sorted.forEach((name, idx) => {
      zones[name] = {
        paths: [`${prefix}${name}/**`],
        canImport: sorted.slice(0, idx),
      };
    });

    const config = {
      layers: sorted,
      zones,
      ignore: ['**/*.test.ts', '**/*.spec.ts', '**/*.test.py', '**/*_test.go'],
    };

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');

    console.log('');
    console.log(`  ${chalk.green('✓')} created ${configPath}`);
    if (sorted.length > 0) console.log(`  detected layers: ${sorted.join(' → ')}`);
    if (unknown.length > 0) {
      console.log(`  ${chalk.yellow('!')} unrecognized dirs not assigned to any zone: ${unknown.join(', ')}`);
      console.log(`    add them to zones{} or ignore[] in .driftrc.json`);
    }
    if (sorted.length === 0) {
      console.log(`  ${chalk.yellow('!')} no recognizable layer directories found — edit .driftrc.json to define your zones`);
    }
    console.log('');
  });

// ─── helpers ─────────────────────────────────────────────────────────────────

function filterBySince(files: string[], ref: string, cwd: string): string[] {
  try {
    const output = execSync(`git diff --name-only ${ref}`, { cwd, encoding: 'utf-8' });
    const changed = new Set(
      output.split('\n').map((f) => f.trim()).filter(Boolean).map((f) => path.resolve(cwd, f))
    );
    return files.filter((f) => changed.has(f));
  } catch {
    console.error(`Warning: could not run git diff --name-only ${ref}; scanning all files`);
    return files;
  }
}

program.parse(process.argv);
