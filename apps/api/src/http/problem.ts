import type { FastifyReply, FastifyRequest } from 'fastify';
import { ServiceError } from '../services/errors.ts';

/** Ошибки API в формате application/problem+json (RFC 9457). */
export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code: string;
  traceId: string;
  [extra: string]: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly title: string;
  readonly extra: Record<string, unknown>;

  constructor(status: number, code: string, title: string, detail?: string, extra: Record<string, unknown> = {}) {
    super(detail ?? title);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.title = title;
    this.extra = extra;
  }
}

export function problemType(code: string): string {
  return `urn:vsemdomom:problem:${code}`;
}

export function buildProblem(
  req: FastifyRequest,
  status: number,
  code: string,
  title: string,
  detail?: string,
  extra: Record<string, unknown> = {},
): ProblemBody {
  return {
    type: problemType(code),
    title,
    status,
    ...(detail === undefined ? {} : { detail }),
    code,
    traceId: req.id,
    ...extra,
  };
}

export function sendProblem(
  req: FastifyRequest,
  reply: FastifyReply,
  status: number,
  code: string,
  title: string,
  detail?: string,
  extra: Record<string, unknown> = {},
): FastifyReply {
  return reply
    .status(status)
    .type('application/problem+json')
    .send(buildProblem(req, status, code, title, detail, extra));
}

/** Ошибка сервиса → problem+json. */
export function fromServiceError(err: unknown): never {
  if (err instanceof ServiceError) {
    switch (err.code) {
      case 'version_conflict':
        throw new ApiError(409, 'version_conflict', 'Авария изменилась', 'Обновите экран и повторите', err.extra);
      case 'invalid_transition':
      case 'merge_target_invalid':
        throw new ApiError(409, 'invalid_transition', 'Такой переход недоступен', err.message, err.extra);
      case 'eta_required':
        throw new ApiError(422, 'eta_required', 'Укажите ориентир');
      case 'eta_in_past':
        throw new ApiError(422, 'eta_in_past', 'Ориентир уже прошёл');
      case 'not_found':
        throw new ApiError(404, 'not_found', 'Не найдено');
    }
  }
  throw err;
}
