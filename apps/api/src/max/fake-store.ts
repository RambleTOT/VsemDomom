import type { Db } from '../db/client.ts';
import { fakeMaxCall } from '../db/schema.ts';
import type { FakeCall, FakeCallStore } from './fake.ts';

/** Журнал симулятора в таблице fake_max_call: его читает страница «Симулятор чата». */
export class DbFakeCallStore implements FakeCallStore {
  private readonly db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  async record(call: FakeCall): Promise<void> {
    await this.db.insert(fakeMaxCall).values({
      method: call.method,
      path: call.path,
      query: call.query,
      body: call.body,
      responseStatus: call.responseStatus,
      response: call.response,
      createdAt: call.at,
    });
  }
}
