/** Ошибки предметной области: сервисы не знают про HTTP, маршруты переводят их в problem+json. */
export type ServiceErrorCode =
  | 'version_conflict'
  | 'invalid_transition'
  | 'eta_required'
  | 'eta_in_past'
  | 'merge_target_invalid'
  | 'not_found';

export class ServiceError extends Error {
  readonly code: ServiceErrorCode;
  readonly extra: Record<string, unknown>;

  constructor(code: ServiceErrorCode, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.extra = extra;
  }
}
