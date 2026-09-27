/** Одноразовые токены ссылок (привязка чата c_, собственник o_): случайные, в БД — только хеш. */
import { createHash, randomBytes } from 'node:crypto';

const TOKEN_BYTES = 18;

export function newToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
