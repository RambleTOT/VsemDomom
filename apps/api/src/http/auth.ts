/** Вход в API: заголовок Authorization разбирается один раз на запрос, результат — в req.principal. */
import type { Clock } from '@vsemdomom/core';
import type { FastifyInstance } from 'fastify';
import { authenticate, type Principal } from '../auth/principal.ts';
import type { AppConfig } from '../config/env.ts';

declare module 'fastify' {
  interface FastifyRequest {
    principal: Principal | null;
    authProblem: 'missing' | 'invalid' | 'expired' | null;
  }
}

export function registerAuth(app: FastifyInstance, config: AppConfig, clock: Clock): void {
  app.decorateRequest('principal', null);
  app.decorateRequest('authProblem', null);
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/api/v1/')) return;
    const result = await authenticate(config, req.headers.authorization, clock.now());
    if (result.principal) req.principal = result.principal;
    else req.authProblem = result.problem;
  });
}
