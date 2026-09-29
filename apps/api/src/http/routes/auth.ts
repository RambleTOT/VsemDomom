/**
 * Вход: POST /auth/max — initData MAX (подпись по алгоритму dev.max.ru) → сессия на 12 часов;
 * POST /auth/dev — вход вне MAX, только при DEV_AUTH=true (конфигурация запрещает его в webhook и production);
 * при DEV_AUTH=false любой запрос — 404 feature_disabled.
 */
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { verifyInitData, type InitDataError } from '../../auth/init-data.ts';
import { issueSession } from '../../auth/session.ts';
import { PARAMS } from '../../config/params.ts';
import { managementCompany, staff } from '../../db/schema.ts';
import { ensureUser, loadMe } from '../../services/me.ts';
import { iso } from '../../services/views.ts';
import { registerApiRoute, type ApiDeps } from '../api-route.ts';
import { ApiError } from '../problem.ts';

const INIT_DATA_ERRORS: Record<InitDataError, string> = {
  malformed: 'initData повреждены',
  duplicate_key: 'Параметр initData повторяется',
  no_hash: 'В initData нет подписи',
  bad_signature: 'Подпись initData не сошлась',
  expired: 'initData устарели — откройте приложение заново',
  no_user: 'В initData нет пользователя',
};

export function registerAuthRoutes(app: FastifyInstance, deps: ApiDeps): void {
  const { config, ctx } = deps;

  registerApiRoute(app, deps, 'authMax', async ({ body }) => {
    const token = config.max.botToken;
    if (!token) {
      throw new ApiError(401, 'invalid_init_data', 'Вход через MAX недоступен', 'Бот не подключён (режим simulator) — используйте dev-вход');
    }
    const now = ctx.clock.now();
    const checked = verifyInitData(body.initData, token, now, { maxAgeSec: config.initDataMaxAgeSec, clockSkewSec: PARAMS.initDataClockSkewSec });
    if (!checked.ok) throw new ApiError(401, 'invalid_init_data', 'Вход не подтверждён', INIT_DATA_ERRORS[checked.error]);
    const userId = checked.data.user.id;
    await ensureUser(ctx, userId, checked.data.user.languageCode);
    const session = await issueSession(config.sessionSecret, { userId, dev: false }, now);
    return {
      status: 200,
      body: { token: session.token, expiresAt: iso(session.expiresAt), user: await loadMe(ctx, userId), startParam: checked.data.startParam, devAuth: false },
    };
  });

  // DEV_AUTH=false (стенд): любой запрос — 404 feature_disabled, до разбора тела.
  registerApiRoute(app, deps, 'authDev', async ({ body }) => {
    const now = ctx.clock.now();
    await ensureUser(ctx, body.userId, 'ru');
    if (body.role === 'uk') {
      // Dev-сотрудник — демо-роль модельной УК.
      const [uk] = await ctx.db.select().from(managementCompany).where(eq(managementCompany.isModel, true)).limit(1);
      if (uk) await ctx.db.insert(staff).values({ userId: body.userId, ukId: uk.id, role: 'curator', isDemo: true }).onConflictDoNothing();
    }
    const session = await issueSession(config.sessionSecret, { userId: body.userId, dev: true }, now);
    return {
      status: 200,
      body: { token: session.token, expiresAt: iso(session.expiresAt), user: await loadMe(ctx, body.userId), startParam: body.startParam ?? null, devAuth: true },
    };
  }, { enabled: config.devAuth });
}
