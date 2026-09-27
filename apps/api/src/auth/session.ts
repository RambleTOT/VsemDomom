/**
 * Сессия мини-приложения: JWT (HS256, SESSION_SECRET) на 12 часов. В токене — только
 * идентификатор MAX и признак dev-входа; роли и проживание читаются из БД при каждом запросе,
 * поэтому удаление данных и смена роли действуют сразу.
 */
import { errors, jwtVerify, SignJWT } from 'jose';
import { PARAMS } from '../config/params.ts';

const ISSUER = 'vsemdomom';
const AUDIENCE = 'vsemdomom-miniapp';
const MS_PER_HOUR = 3_600_000;
const MS_PER_SECOND = 1000;

export interface SessionClaims {
  userId: number;
  dev: boolean;
}

function key(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function issueSession(secret: string, claims: SessionClaims, now: Date): Promise<{ token: string; expiresAt: Date }> {
  const expiresAt = new Date(now.getTime() + PARAMS.sessionTtlHours * MS_PER_HOUR);
  const token = await new SignJWT({ dev: claims.dev })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(String(claims.userId))
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(Math.floor(now.getTime() / MS_PER_SECOND))
    .setExpirationTime(Math.floor(expiresAt.getTime() / MS_PER_SECOND))
    .sign(key(secret));
  return { token, expiresAt };
}

export type SessionCheck = { ok: true; claims: SessionClaims } | { ok: false; reason: 'expired' | 'invalid' };

export async function verifySession(secret: string, token: string, now: Date): Promise<SessionCheck> {
  try {
    const { payload } = await jwtVerify(token, key(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: ['HS256'],
      currentDate: now,
    });
    const userId = Number(payload.sub);
    if (!Number.isSafeInteger(userId) || userId === 0) return { ok: false, reason: 'invalid' };
    return { ok: true, claims: { userId, dev: payload.dev === true } };
  } catch (err) {
    return { ok: false, reason: err instanceof errors.JWTExpired ? 'expired' : 'invalid' };
  }
}
