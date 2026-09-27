/**
 * Доступ (раздел 11 ТЗ): житель — только дом, где у него проживание; УК — только дома своей УК;
 * checker-токены — только дом-песочница (для остальных песочница скрыта).
 */
import { and, eq } from 'drizzle-orm';
import type { Principal } from '../auth/principal.ts';
import type { Executor } from '../db/client.ts';
import { houseByPublicId, residenciesOf, staffOf, userById, type HouseRow, type ResidencyRow, type UserRow } from '../db/queries.ts';
import { house } from '../db/schema.ts';
import type { IncidentViewer } from '../services/incident-view.ts';
import { ApiError } from './problem.ts';

type Reader = Pick<Executor, 'select'>;

export interface Viewer {
  principal: Principal;
  userId: number;
  user: UserRow | null;
  residencies: { residency: ResidencyRow; house: HouseRow }[];
  staffUkIds: number[];
}

export async function loadViewer(db: Reader, principal: Principal): Promise<Viewer> {
  const [user, residencies, staff] = await Promise.all([userById(db, principal.userId), residenciesOf(db, principal.userId), staffOf(db, principal.userId)]);
  return { principal, userId: principal.userId, user, residencies, staffUkIds: staff.map((s) => s.uk.id) };
}

export function residencyIn(viewer: Viewer, houseId: number): ResidencyRow | null {
  return viewer.residencies.find((r) => r.house.id === houseId)?.residency ?? null;
}

export function isStaffOf(viewer: Viewer, h: Pick<HouseRow, 'ukId'>): boolean {
  return viewer.staffUkIds.includes(h.ukId);
}

/** Песочница — только для проверяющих, остальные дома — не для них. */
export function sandboxAllowed(viewer: Viewer, h: Pick<HouseRow, 'isSandbox'>): boolean {
  return viewer.principal.kind === 'checker' ? h.isSandbox : !h.isSandbox;
}

export const notFound = (what = 'Не найдено') => new ApiError(404, 'not_found', what);

/** Дом по публичному ID с учётом песочницы; иначе 404. */
export async function visibleHouse(db: Reader, viewer: Viewer, publicId: string): Promise<HouseRow> {
  const h = await houseByPublicId(db, publicId);
  if (!h || !sandboxAllowed(viewer, h)) throw notFound('Дом не найден');
  return h;
}

/** Житель этого дома или сотрудник его УК; иначе 403. */
export function assertHouseAccess(viewer: Viewer, h: HouseRow): void {
  if (!sandboxAllowed(viewer, h)) throw notFound('Дом не найден');
  if (!residencyIn(viewer, h.id) && !isStaffOf(viewer, h)) throw new ApiError(403, 'not_resident', 'Нет доступа к дому', 'Укажите дом и квартиру в профиле');
}

/** Действие жителя: нужно проживание в доме. */
export function assertResident(viewer: Viewer, h: HouseRow): ResidencyRow {
  if (!sandboxAllowed(viewer, h)) throw notFound('Дом не найден');
  const res = residencyIn(viewer, h.id);
  if (!res) throw new ApiError(403, 'not_resident', 'Действие доступно жителям дома', 'Укажите дом и квартиру в профиле');
  return res;
}

export function incidentViewer(viewer: Viewer, h: HouseRow): IncidentViewer {
  return { userId: viewer.userId, residency: residencyIn(viewer, h.id), isStaff: isStaffOf(viewer, h), user: viewer.user };
}

export async function houseById(db: Reader, id: number): Promise<HouseRow> {
  const [h] = await db.select().from(house).where(and(eq(house.id, id)));
  if (!h) throw notFound();
  return h;
}
