/** Источник «сейчас». Ядро получает время параметром, сервисы — через Clock. */
export interface Clock {
  now(): Date;
}

/** Часы для тестов и сценария: время двигается только явно. */
export class ManualClock implements Clock {
  private current: number;

  constructor(start: Date) {
    this.current = start.getTime();
  }

  now(): Date {
    return new Date(this.current);
  }

  set(at: Date): void {
    this.current = at.getTime();
  }

  advance(ms: number): Date {
    this.current += ms;
    return this.now();
  }
}
