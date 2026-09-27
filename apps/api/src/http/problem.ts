import type { FastifyReply, FastifyRequest } from 'fastify';

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
