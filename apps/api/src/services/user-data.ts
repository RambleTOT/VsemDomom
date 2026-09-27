/**
 * Удаление данных пользователя (/delete в боте и DELETE /api/v1/me): проживание удаляется,
 * участие в авариях и события обезличиваются, журнал личных сообщений очищается.
 * Остаётся только идентификатор MAX с отметкой deleted_at — чтобы бот мог ответить
 * и заново спросить согласие; роль сотрудника УК не трогаем (её выдаёт УК), демо-роль удаляем.
 */
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import {
  apiIdempotency,
  incident,
  incidentEvent,
  incidentParticipant,
  maxUser,
  outboundMessage,
  pollAnswer,
  residency,
  staff,
} from '../db/schema.ts';

export async function deleteUserData(db: Db, userId: number, now: Date): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.update(incidentParticipant).set({ userId: null, residencyId: null }).where(eq(incidentParticipant.userId, userId));
    await tx.update(incidentEvent).set({ actorId: null }).where(eq(incidentEvent.actorId, userId));
    await tx.update(incident).set({ createdBy: null }).where(eq(incident.createdBy, userId));
    await tx.delete(pollAnswer).where(eq(pollAnswer.userId, userId));
    await tx.delete(apiIdempotency).where(eq(apiIdempotency.userId, userId));
    await tx.delete(outboundMessage).where(eq(outboundMessage.userId, userId));
    await tx.delete(residency).where(eq(residency.userId, userId));
    await tx.delete(staff).where(and(eq(staff.userId, userId), eq(staff.isDemo, true)));
    await tx
      .update(maxUser)
      .set({ consentVersion: null, consentAt: null, dialogState: null, dialogStateAt: null, notifyDefault: true, deletedAt: now })
      .where(eq(maxUser.id, userId));
  });
}
