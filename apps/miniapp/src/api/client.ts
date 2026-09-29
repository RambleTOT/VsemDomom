/**
 * Запросы к собственному API /api/v1: сессия Bearer, ошибки application/problem+json.
 * Сеть недоступна → ApiError со статусом 0 (экран «Нет соединения»).
 */
export interface ProblemBody {
  type?: string;
  title?: string;
  status?: number;
  code?: string;
  detail?: string;
  traceId?: string;
  [key: string]: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string | null;
  readonly body: ProblemBody | null;

  constructor(status: number, code: string, title: string, detail: string | null, body: ProblemBody | null) {
    super(title);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.body = body;
  }

  get isNetwork(): boolean {
    return this.status === 0;
  }
}

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string | undefined>;
}

const GATEWAY_STATUSES = new Set([502, 503, 504]);

let token: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setSessionToken(value: string | null): void {
  token = value;
}

/** Сессия истекла (401 на запросе с токеном) — экран «Сессия устарела». */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

function buildUrl(path: string, query: RequestOptions['query']): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) if (value !== undefined && value !== '') params.set(key, value);
  const qs = params.toString();
  return `/api/v1${path}${qs ? `?${qs}` : ''}`;
}

export async function request<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json', ...options.headers };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${token}`;
  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      cache: 'no-store',
    });
  } catch {
    throw new ApiError(0, 'network', 'network', null, null);
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    const body = (json && typeof json === 'object' ? json : null) as ProblemBody | null;
    // 502–504 без тела от прокси: API недоступен (перезапуск, обрыв) — для жителя это «Нет соединения», повтор безопасен.
    if (!body && GATEWAY_STATUSES.has(response.status)) throw new ApiError(0, 'network', 'network', null, null);
    if (response.status === 401 && token) onUnauthorized?.();
    throw new ApiError(response.status, body?.code ?? `http_${response.status}`, body?.title ?? String(response.status), body?.detail ?? null, body);
  }
  return json as T;
}
