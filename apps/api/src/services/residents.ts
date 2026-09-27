/**
 * Очередь подтверждения жильцов (F10 уровень 2, U04): заявки уровня 0–1 в домах УК сотрудника.
 * «Подтвердить» — уровень 2 и сообщение жильцу в личку (если диалог начат); «Отклонить» — заявка
 * уходит из очереди, уровень не меняется. Имён нет: только квартира, роль и откуда пришёл.
 * Модельные жители (история, демо-соседи) в очередь не попадают.
 */
import { renderResidencyConfirmed } from '@vsemdomom/core';
import type { ResidentsResponseSchema } from '@vsemdomom/shared';
import { and, asc, eq, inArray, lt, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import type { Executor } from '../db/client.ts';
import type { HouseRow, ResidencyRow } from '../db/queries.ts';
import { house, maxUser, residency } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';
import { enqueueOutbound } from '../jobs/outbound.ts';
import { audit, staffActor } from './audit.ts';
import { iso } from './views.ts';

type Reader = Pick<Executor, 'select'>;
type ResidentRequest = z.infer<typeof ResidentsResponseSchema>['items'][number];

/** Заявка в очереди: ждёт решения, уровень 0–1, не модельный житель. */
export function pendingResidentWhere(houseIds: readonly number[]): SQL | undefined {
  return and(inArray(residency.houseId, [...houseIds]), eq(residency.reviewStatus, 'pending'), lt(residency.trustLevel, 2), eq(residency.isModel, false));
}

/** Заявки домов (старые сверху — очередь). */
export async function pendingResidents(db: Reader, houses: readonly HouseRow[]): Promise<ResidentRequest[]> {
  if (houses.length === 0) return [];
  const rows = await db
    .select({ residency, house })
    .from(residency)
    .innerJoin(house, eq(house.id, residency.houseId))
    .where(pendingResidentWhere(houses.map((h) => h.id)))
    .orderBy(asc(residency.createdAt), asc(residency.id));
  return rows.map(({ residency: r, house: h }) => ({
    id: r.publicId,
    house: { id: h.publicId, label: h.label, address: h.address },
    flatNo: r.flatNo,
    role: r.role,
    trustLevel: r.trustLevel,
    source: r.source,
    createdAt: iso(r.createdAt),
  }));
}

/** Проживание по публичному ID вместе с домом; модельные жители не отдаются. */
export async function residencyByPublicId(db: Reader, publicId: string): Promise<{ residency: ResidencyRow; house: HouseRow } | null> {
  const [row] = await db.select({ residency, house }).from(residency).innerJoin(house, eq(house.id, residency.houseId)).where(eq(residency.publicId, publicId));
  return row && !row.residency.isModel ? row : null;
}

export interface ResidentDecision {
  trustLevel: ResidencyRow['trustLevel'];
  reviewStatus: 'confirmed' | 'rejected';
}

/**
 * Решение УК. Подтверждение — уровень 2 (повторное ничего не меняет и второе сообщение не шлёт).
 * Отклонение уровень не меняет; уже подтверждённого (уровень 2) не отменяет.
 */
export async function decideResident(
  ctx: JobContext,
  input: { residencyId: number; house: HouseRow; staffUserId: number; decision: 'confirmed' | 'rejected' },
): Promise<ResidentDecision | null> {
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    const [res] = await tx.select().from(residency).where(eq(residency.id, input.residencyId)).for('update');
    if (!res) return null;
    const actor = staffActor(input.staffUserId);
    if (res.trustLevel === 2) return { trustLevel: 2, reviewStatus: 'confirmed' };
    if (input.decision === 'rejected') {
      await tx.update(residency).set({ reviewStatus: 'rejected', updatedAt: now }).where(eq(residency.id, res.id));
      await audit(tx, { actor, action: 'resident_reject', entity: 'residency', entityId: res.publicId, at: now });
      return { trustLevel: res.trustLevel, reviewStatus: 'rejected' };
    }
    await tx
      .update(residency)
      .set({ trustLevel: 2, reviewStatus: 'confirmed', confirmedAt: now, confirmedBy: actor, updatedAt: now })
      .where(eq(residency.id, res.id));
    await audit(tx, { actor, action: 'resident_confirm', entity: 'residency', entityId: res.publicId, at: now });
    const [user] = await tx.select({ dialogActive: maxUser.dialogActive }).from(maxUser).where(eq(maxUser.id, res.userId));
    if (user?.dialogActive) {
      await enqueueOutbound(tx, ctx.queue, {
        kind: 'dm',
        idempotencyKey: `resident:confirmed:${res.id}:${now.getTime()}`,
        target: { userId: res.userId },
        message: renderResidencyConfirmed({ by: 'uk', flat: res.flatNo, isModel: input.house.isModel }, ctx.i18n),
      });
    }
    return { trustLevel: 2, reviewStatus: 'confirmed' };
  });
}
