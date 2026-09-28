/**
 * Кто вызывает API: сессия мини-приложения (JWT) или тестовый токен проверяющих
 * (CHECKER_TOKEN_*, только при CHECKER_API_ENABLED=true и только для дома-песочницы).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '../config/env.ts';
import { CHECKER_USERS } from '../config/params.ts';
import { verifySession } from './session.ts';

export type Principal =
  | { kind: 'session'; userId: number; dev: boolean }
  | { kind: 'checker'; userId: number; role: 'resident' | 'uk' };

export type AuthResult = { principal: Principal } | { principal: null; problem: 'missing' | 'invalid' | 'expired' };

/** Сравнение за постоянное время; хеши выравнивают длину — длина токена не утекает. */
function sameSecret(a: string, b: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(a), digest(b));
}

function checkerPrincipal(config: AppConfig, token: string): Principal | null {
  if (!config.checker.enabled) return null;
  const { resident, resident2, uk } = config.checker.tokens;
  if (resident && sameSecret(token, resident)) return { kind: 'checker', userId: CHECKER_USERS.resident, role: 'resident' };
  if (resident2 && sameSecret(token, resident2)) return { kind: 'checker', userId: CHECKER_USERS.resident2, role: 'resident' };
  if (uk && sameSecret(token, uk)) return { kind: 'checker', userId: CHECKER_USERS.uk, role: 'uk' };
  return null;
}

const BEARER = /^Bearer\s+(\S+)$/i;

export async function authenticate(config: AppConfig, header: string | undefined, now: Date): Promise<AuthResult> {
  if (!header) return { principal: null, problem: 'missing' };
  const token = BEARER.exec(header)?.[1];
  if (!token) return { principal: null, problem: 'invalid' };
  const checker = checkerPrincipal(config, token);
  if (checker) return { principal: checker };
  const session = await verifySession(config.sessionSecret, token, now);
  if (!session.ok) return { principal: null, problem: session.reason };
  return { principal: { kind: 'session', userId: session.claims.userId, dev: session.claims.dev } };
}
