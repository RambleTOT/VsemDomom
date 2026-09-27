/** Запросы, общие для бота и API. */
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from './client.ts';
import { house, houseChat, managementCompany, maxUser, residency, staff } from './schema.ts';

type Reader = Pick<Db, 'select'>;

export type HouseRow = typeof house.$inferSelect;
export type HouseChatRow = typeof houseChat.$inferSelect;
export type ResidencyRow = typeof residency.$inferSelect;
export type UserRow = typeof maxUser.$inferSelect;

export async function houseByPublicId(db: Reader, publicId: string): Promise<HouseRow | null> {
  const [row] = await db.select().from(house).where(eq(house.publicId, publicId));
  return row ?? null;
}

export async function houseById(db: Reader, id: number): Promise<HouseRow | null> {
  const [row] = await db.select().from(house).where(eq(house.id, id));
  return row ?? null;
}

/** Модельные дома для выбора жителем (песочница API скрыта). */
export async function listResidentialHouses(db: Reader): Promise<HouseRow[]> {
  return db.select().from(house).where(eq(house.isSandbox, false)).orderBy(asc(house.label));
}

export async function userById(db: Reader, id: number): Promise<UserRow | null> {
  const [row] = await db.select().from(maxUser).where(eq(maxUser.id, id));
  return row ?? null;
}

export async function residenciesOf(db: Reader, userId: number): Promise<{ residency: ResidencyRow; house: HouseRow }[]> {
  return db
    .select({ residency, house })
    .from(residency)
    .innerJoin(house, eq(residency.houseId, house.id))
    .where(eq(residency.userId, userId))
    .orderBy(asc(residency.createdAt));
}

export async function residencyIn(db: Reader, userId: number, houseId: number): Promise<ResidencyRow | null> {
  const [row] = await db.select().from(residency).where(and(eq(residency.userId, userId), eq(residency.houseId, houseId)));
  return row ?? null;
}

export async function chatOfHouse(db: Reader, houseId: number): Promise<HouseChatRow | null> {
  const [row] = await db.select().from(houseChat).where(eq(houseChat.houseId, houseId));
  return row ?? null;
}

export async function houseOfChat(db: Reader, chatId: number): Promise<{ chat: HouseChatRow; house: HouseRow } | null> {
  const [row] = await db.select({ chat: houseChat, house }).from(houseChat).innerJoin(house, eq(houseChat.houseId, house.id)).where(eq(houseChat.chatId, chatId));
  return row ?? null;
}

export async function staffOf(db: Reader, userId: number) {
  return db
    .select({ staff, uk: managementCompany })
    .from(staff)
    .innerJoin(managementCompany, eq(staff.ukId, managementCompany.id))
    .where(eq(staff.userId, userId));
}

export function dmHouse(h: HouseRow) {
  return { publicId: h.publicId, label: h.label, address: h.address, flatFrom: h.flatFrom, flatTo: h.flatTo, isModel: h.isModel };
}
