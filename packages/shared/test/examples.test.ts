import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  HouseDetailSchema,
  IncidentDetailSchema,
  MeSchema,
  RecalculationResponseSchema,
  ResultSchema,
  UkIncidentDetailSchema,
  UkIncidentsResponseSchema,
} from '../src/index.ts';

// Примеры ответов для моков потока B (msw) — должны совпадать с контрактом.
const examples: [string, z.ZodType][] = [
  ['me.json', MeSchema],
  ['house-detail.json', HouseDetailSchema],
  ['incident-open.json', IncidentDetailSchema],
  ['incident-discrepancy.json', IncidentDetailSchema],
  ['uk-incidents.json', UkIncidentsResponseSchema],
  ['uk-incident.json', UkIncidentDetailSchema],
  ['result.json', ResultSchema],
  ['recalculation.json', RecalculationResponseSchema],
];

describe('примеры ответов API', () => {
  for (const [file, schema] of examples) {
    it(`${file} соответствует контракту`, () => {
      const data: unknown = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'examples', file), 'utf8'));
      const parsed = schema.safeParse(data);
      expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    });
  }
});
