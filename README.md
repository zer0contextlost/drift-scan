# drift-scan

Detect architectural drift in multi-language codebases. Declare layer rules once in `.driftrc.json`; drift-scan parses TypeScript, Python, and Go imports and flags every violation.

```
npm install -g drift-scan
drift scan ./my-project
```

---

## How it works

1. You define **zones** (domain, service, infrastructure, etc.) and which zones each one is allowed to import.
2. drift-scan crawls every `.ts`, `.py`, and `.go` file, extracts their imports, and builds a dependency graph.
3. Any import that crosses a zone boundary in the wrong direction is a violation.

Violations are ranked by blast radius: fanout (how many files in the same zone import the offending file) multiplied by how central the zone is. Scores map to `critical / high / medium / low`.

---

## Config

`.driftrc.json` in the project root:

```json
{
  "layers": ["domain", "application", "infrastructure"],
  "zones": {
    "domain": {
      "paths": ["src/domain/**"],
      "canImport": []
    },
    "application": {
      "paths": ["src/application/**"],
      "canImport": ["domain"]
    },
    "infrastructure": {
      "paths": ["src/infrastructure/**"],
      "canImport": ["domain", "application"]
    }
  },
  "ignore": ["**/*.test.ts", "**/*.spec.ts"]
}
```

`drift init [dir]` scaffolds a config by inspecting directory names.

---

## Commands

```
drift scan [dir]          scan for violations (default: current directory)
drift explain <file>      show all violations involving a specific file
drift graph [dir]         print the inter-zone dependency graph
drift init [dir]          scaffold a .driftrc.json
```

### scan options

| Flag | Description |
|------|-------------|
| `--json` | Output JSON |
| `--sarif` | Output SARIF 2.1 (GitHub code scanning) |
| `--since <ref>` | Only scan files changed since a git ref (e.g. `main`) |
| `--fail-on <severity>` | Exit 1 if violations at this severity or above exist |
| `--min-severity <severity>` | Only show violations at or above this severity |
| `--output <file>` | Write report to file instead of stdout |
| `--watch` | Watch for file changes and re-scan automatically |

### graph options

| Flag | Description |
|------|-------------|
| `--dot` | Output Graphviz DOT instead of Mermaid |
| `--output <file>` | Write graph to file |

---

## Violation types

| Type | Description |
|------|-------------|
| `layer` | A zone imports from a zone it is not permitted to depend on |
| `circular` | A cross-zone dependency cycle exists |
| `undeclared` | A file outside any zone imports from a declared zone |

`import type` violations are flagged with `[type-only]` and scored lower — they carry no runtime risk.

---

## Severity

| Score | Severity |
|-------|----------|
| ≥ 12 | critical |
| ≥ 8 | high |
| ≥ 4 | medium |
| < 4 | low |

Score = `fanout × 2 + zone_centrality` (circular: `cycle_length + zone_centrality`).

---

## CI integration

### GitHub Actions — SARIF upload

```yaml
- name: Scan architecture
  run: drift scan --sarif --output drift.sarif

- name: Upload to code scanning
  uses: github/codeql-action/upload-sarif@v3
  with:
    sarif_file: drift.sarif
```

### Exit code

`drift scan --fail-on high` exits 1 when any `high` or `critical` violation is found.

---

## Language support

| Language | Import styles |
|----------|--------------|
| TypeScript / JavaScript | `import`, `require()`, `import()`, `export … from`, `import type` |
| Python | `import x`, `from x import y`, relative imports |
| Go | `import "github.com/org/repo/internal/pkg"` (module-relative) |

---

## Requirements

- Node.js ≥ 18

---

## License

MIT — [zer0contextlost](https://github.com/zer0contextlost)
