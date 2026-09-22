import { Coordinates, EARTH_RADIUS_KM } from "../../src/domain/distance";

export function pointAtDistanceFrom(origin: Coordinates, distanceKm: number): Coordinates {
  const deltaLatDeg = (distanceKm / EARTH_RADIUS_KM) * (180 / Math.PI);
  return { latitude: origin.latitude + deltaLatDeg, longitude: origin.longitude };
}

export function pointAtDistanceFromOrigin(distanceKm: number): Coordinates {
  return pointAtDistanceFrom({ latitude: 0, longitude: 0 }, distanceKm);
}
