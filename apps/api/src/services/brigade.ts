/**
 * «Бригада на месте» глазами жителей (F06, FEATURE_BRIGADE_CONFIRM): «Подтверждаю» / «Бригады нет»
 * в статусе brigade_on_site. Отметка — у участника (нажавший становится участником); событие
 * в хронологии — когда отметили не меньше двух квартир уровня доверия 1–2 (порог из параметров).
 */
import { flatLocation, type EventSource } from '@vsemdomom/core';
import { and, eq, isNotNull } from 'drizzle-orm';
import { cardLater } from '../chat/card.ts';
import { PARAMS } from '../config/params.ts';
import { house, incident, incidentEvent, incidentParticipant, maxUser, residency } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';

export type BrigadeResult = 'saved' | 'not_applicable';

export async function observeBrigade(ctx: JobContext, input: { incidentId: number; userId: number; seen: boolean; source: EventSource }): Promise<BrigadeResult> {
  if (!ctx.config.features.brigadeConfirm) return 'not_applicable';
  const now = ctx.clock.now();
  return ctx.db.transaction(async (tx) => {
    const [inc] = await tx.select().from(incident).where(eq(incident.id, input.incidentId)).for('update');
    if (inc?.status !== 'brigade_on_site') return 'not_applicable';
    const [h] = await tx.select().from(house).where(eq(house.id, inc.houseId));
    const [res] = await tx.select().from(residency).where(and(eq(residency.userId, input.userId), eq(residency.houseId, inc.houseId)));
    const [existing] = await tx
      .select()
      .from(incidentParticipant)
      .where(and(eq(incidentParticipant.incidentId, inc.id), eq(incidentParticipant.userId, input.userId)));
    if (existing) {
      await tx.update(incidentParticipant).set({ brigadeSeen: input.seen, brigadeSeenAt: now }).where(eq(incidentParticipant.id, existing.id));
    } else {
      const loc = res && h ? flatLocation(h, res.flatNo) : null;
      const [user] = await tx.select({ notifyDefault: maxUser.notifyDefault }).from(maxUser).where(eq(maxUser.id, input.userId));
      await tx.insert(incidentParticipant).values({
        incidentId: inc.id,
        userId: input.userId,
        residencyId: res?.id ?? null,
        entrance: loc?.entrance ?? null,
        floor: loc?.floor ?? null,
        trustLevelAtJoin: res?.trustLevel ?? 0,
        notify: user?.notifyDefault ?? true,
        brigadeSeen: input.seen,
        brigadeSeenAt: now,
        joinedAt: now,
      });
    }
    // Порог — по квартирам жителей уровня 1–2.
    const marks = await tx
      .select({ flatNo: residency.flatNo, trust: residency.trustLevel })
      .from(incidentParticipant)
      .innerJoin(residency, eq(residency.id, incidentParticipant.residencyId))
      .where(and(eq(incidentParticipant.incidentId, inc.id), eq(incidentParticipant.brigadeSeen, input.seen), isNotNull(incidentParticipant.brigadeSeen)));
    const flats = new Set(marks.filter((m) => m.trust >= 1).map((m) => m.flatNo)).size;
    const type = input.seen ? 'residents_brigade_confirmed' : 'residents_no_brigade';
    if (flats >= PARAMS.confirmThresholdFlats) {
      const [already] = await tx
        .select({ id: incidentEvent.id })
        .from(incidentEvent)
        .where(and(eq(incidentEvent.incidentId, inc.id), eq(incidentEvent.type, type)))
        .limit(1);
      if (!already) {
        await tx.insert(incidentEvent).values({ incidentId: inc.id, type, actorType: 'resident', source: input.source, payload: { flats }, occurredAt: now });
      }
    }
    // Счётчик «Бригаду отметили» в карточке — видимый ответ на нажатие.
    await cardLater(ctx.queue, inc.id, tx);
    return 'saved';
  });
}
