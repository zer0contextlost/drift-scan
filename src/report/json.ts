import { ScanResult } from '../types';

export function formatJson(result: ScanResult): string {
  return JSON.stringify(result, null, 2);
}
