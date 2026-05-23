import fs from 'fs';
import path from 'path';
import { DriftConfig } from '../types';

export function loadConfig(dir: string): DriftConfig {
  const configPath = findConfig(dir);
  if (!configPath) {
    throw new Error(
      `No .driftrc.json found in ${dir} or any parent directory.\n` +
      `Create one with "layers" and "zones" fields to get started.`
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch (e) {
    throw new Error(`Failed to parse ${configPath}: ${(e as Error).message}`);
  }

  return validate(raw, configPath);
}

function findConfig(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    const candidate = path.join(current, '.driftrc.json');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function validate(raw: unknown, configPath: string): DriftConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`${configPath}: must be a JSON object`);
  }
  const obj = raw as Record<string, unknown>;

  if (!Array.isArray(obj['layers']) || obj['layers'].some((l) => typeof l !== 'string')) {
    throw new Error(`${configPath}: "layers" must be an array of strings`);
  }
  const layers = obj['layers'] as string[];

  if (typeof obj['zones'] !== 'object' || obj['zones'] === null || Array.isArray(obj['zones'])) {
    throw new Error(`${configPath}: "zones" must be an object`);
  }
  const rawZones = obj['zones'] as Record<string, unknown>;
  const zones: DriftConfig['zones'] = {};

  for (const [name, zone] of Object.entries(rawZones)) {
    if (typeof zone !== 'object' || zone === null) {
      throw new Error(`${configPath}: zones.${name} must be an object`);
    }
    const z = zone as Record<string, unknown>;
    if (!Array.isArray(z['paths']) || z['paths'].some((p) => typeof p !== 'string')) {
      throw new Error(`${configPath}: zones.${name}.paths must be an array of strings`);
    }
    if (!Array.isArray(z['canImport']) || z['canImport'].some((c) => typeof c !== 'string')) {
      throw new Error(`${configPath}: zones.${name}.canImport must be an array of strings`);
    }
    zones[name] = { paths: z['paths'] as string[], canImport: z['canImport'] as string[] };
  }

  const ignore = Array.isArray(obj['ignore'])
    ? (obj['ignore'] as string[]).filter((i) => typeof i === 'string')
    : [];

  // Cross-reference validation
  for (const layer of layers) {
    if (!zones[layer]) {
      throw new Error(`${configPath}: layers includes "${layer}" which is not defined in zones`);
    }
  }
  for (const [name, zone] of Object.entries(zones)) {
    for (const dep of zone.canImport) {
      if (!zones[dep]) {
        throw new Error(`${configPath}: zones.${name}.canImport references unknown zone "${dep}"`);
      }
    }
  }

  return { layers, zones, ignore };
}
