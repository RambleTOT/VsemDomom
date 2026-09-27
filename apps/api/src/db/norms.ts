import type { NormRecord } from '@vsemdomom/core';
import type { Db } from './client.ts';
import { norm } from './schema.ts';

type NormRow = typeof norm.$inferSelect;

/** Строка таблицы norm → запись справочника для ядра (numeric приходит строкой). */
export function toNormRecord(row: NormRow): NormRecord {
  return {
    id: row.id,
    code: row.code,
    serviceType: row.serviceType,
    event: row.event,
    title: row.title,
    value: Number(row.value),
    unit: row.unit,
    ratePercent: row.ratePercent,
    calcStrategy: row.calcStrategy,
    round: row.round,
    regionCode: row.regionCode,
    condition: row.condition,
    basisDoc: row.basisDoc,
    basisPoint: row.basisPoint,
    basisQuote: row.basisQuote,
    textPlain: row.textPlain,
    editionDate: row.editionDate,
    validFrom: row.validFrom,
    validTo: row.validTo,
    checkedAt: row.checkedAt,
    sourceUrl: row.sourceUrl,
  };
}

export async function loadNorms(db: Pick<Db, 'select'>): Promise<NormRecord[]> {
  const rows = await db.select().from(norm);
  return rows.map(toNormRecord);
}
