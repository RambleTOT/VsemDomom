/** Геометрия модельного дома: квартиры пронумерованы подряд по подъездам, внутри подъезда — по этажам. */
export interface HouseGeometry {
  entrances: number;
  floors: number;
  flatsPerFloor: number;
  flatFrom: number;
  flatTo: number;
}

export interface FlatLocation {
  entrance: number;
  floor: number;
}

export function isFlatInRange(house: HouseGeometry, flatNo: number): boolean {
  return Number.isInteger(flatNo) && flatNo >= house.flatFrom && flatNo <= house.flatTo;
}

export function isEntranceInRange(house: Pick<HouseGeometry, 'entrances'>, entrance: number): boolean {
  return Number.isInteger(entrance) && entrance >= 1 && entrance <= house.entrances;
}

export function isFloorInRange(house: Pick<HouseGeometry, 'floors'>, floor: number): boolean {
  return Number.isInteger(floor) && floor >= 1 && floor <= house.floors;
}

/** Подъезд и этаж квартиры; null — квартира вне диапазона или за пределами сетки дома. */
export function flatLocation(house: HouseGeometry, flatNo: number): FlatLocation | null {
  if (!isFlatInRange(house, flatNo)) return null;
  const perEntrance = house.floors * house.flatsPerFloor;
  const index = flatNo - house.flatFrom;
  const entrance = Math.floor(index / perEntrance) + 1;
  const floor = Math.floor((index % perEntrance) / house.flatsPerFloor) + 1;
  if (entrance > house.entrances) return null;
  return { entrance, floor };
}
