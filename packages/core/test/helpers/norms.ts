import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NormHouseContext, NormRecord } from '../../src/index.ts';

interface SeedNorm extends Omit<NormRecord, 'id' | 'value'> {
  value: string;
}

/** Справочник из seeds/norms.json — тесты работают на тех же нормах, что и сервис. */
export function seedNorms(): NormRecord[] {
  const raw = JSON.parse(readFileSync(join(import.meta.dirname, '../../../../seeds/norms.json'), 'utf8')) as SeedNorm[];
  return raw.map((n, i) => ({ ...n, id: i + 1, value: Number(n.value) }));
}

export const house1: NormHouseContext = {
  regionCode: null,
  timezone: 'Europe/Moscow',
  powerSources: 2,
  hotWaterDeadEnd: false,
};

export const H = 3_600_000;
export const MIN = 60_000;
export const at = (iso: string) => new Date(iso);
