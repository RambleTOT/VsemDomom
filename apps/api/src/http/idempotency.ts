/**
 * Idempotency-Key на POST /incidents и POST …/recalculation (необязательный): повтор запроса
 * с тем же ключом возвращает первый успешный ответ. Хранится сутки (задача cleanup).
 * Ошибки не сохраняются: повтор проверяется заново и даст тот же ответ по состоянию данных.
 */
import { and, eq } from 'drizzle-orm';
import type { Principal } from '../auth/principal.ts';
import { apiIdempotency } from '../db/schema.ts';
import type { JobContext } from '../jobs/context.ts';
import type { RouteResult } from './api-route.ts';

export async function withIdempotency(
  ctx: JobContext,
  principal: Principal,
  route: string,
  key: string | undefined,
  run: () => Promise<RouteResult>,
): Promise<RouteResult> {
  if (!key) return run();
  const where = and(eq(apiIdempotency.userId, principal.userId), eq(apiIdempotency.route, route), eq(apiIdempotency.key, key));
  const [stored] = await ctx.db.select().from(apiIdempotency).where(where);
  if (stored) return { status: stored.statusCode, body: stored.body };
  const result = await run();
  if (result.status >= 300) return result;
  const inserted = await ctx.db
    .insert(apiIdempotency)
    .values({ userId: principal.userId, route, key, statusCode: result.status, body: result.body ?? null })
    .onConflictDoNothing()
    .returning({ key: apiIdempotency.key });
  if (inserted.length > 0) return result;
  // Параллельный запрос с тем же ключом успел раньше — отдаём его ответ.
  const [first] = await ctx.db.select().from(apiIdempotency).where(where);
  return first ? { status: first.statusCode, body: first.body } : result;
}
