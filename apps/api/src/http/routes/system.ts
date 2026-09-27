import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../types.ts';

export function registerSystemRoutes(app: FastifyInstance, deps: AppDeps): void {
  const health = async () => ({ status: 'ok' as const });
  app.get('/health', { logLevel: 'warn' }, health);
  app.get('/api/v1/health', { logLevel: 'warn' }, health);

  app.get('/ready', { logLevel: 'warn' }, async (_req, reply) => {
    const results = await Promise.all(
      deps.readiness.map(async (c) => {
        try {
          const r = await c.check();
          return [c.name, r] as const;
        } catch (err) {
          return [c.name, { ok: false, detail: err instanceof Error ? err.message : 'ошибка проверки' }] as const;
        }
      }),
    );
    const ok = results.every(([, r]) => r.ok);
    return reply.status(ok ? 200 : 503).send({
      status: ok ? 'ok' : 'fail',
      checks: Object.fromEntries(results.map(([name, r]) => [name, r.ok ? 'ok' : (r.detail ?? 'fail')])),
    });
  });

  app.get('/api/v1/version', async () => ({
    commit: deps.config.build.commit,
    builtAt: deps.config.build.builtAt ?? null,
    maxMode: deps.config.max.mode,
    demoMode: deps.config.demo.enabled,
    features: deps.config.features,
  }));
}
