import { Coordinates, EARTH_RADIUS_KM } from "../../src/domain/distance";

/**
 * A point whose great-circle distance from `origin` is *exactly* `distanceKm` (same longitude as
 * `origin`, offset only in latitude, so the Haversine formula reduces exactly to
 * `EARTH_RADIUS_KM * angular separation` — see tests/domain/distance.test.ts's meridian case,
 * which independently verifies that reduction holds regardless of which meridian it's on). This
 * is the algebraic inverse of that formula, not an approximation, so `calculateDistanceKm`
 * reproduces `distanceKm` to within float rounding — good enough that any cent-rounded cost
 * derived from it lands exactly where hand arithmetic predicts, even though the raw `distanceKm`
 * field itself may differ by ~1e-13. Only valid for small offsets near the equator (what every
 * test using this needs) — doesn't account for pole-crossing.
 */
export function pointAtDistanceFrom(origin: Coordinates, distanceKm: number): Coordinates {
  const deltaLatDeg = (distanceKm / EARTH_RADIUS_KM) * (180 / Math.PI);
  return { latitude: origin.latitude + deltaLatDeg, longitude: origin.longitude };
}

/** `pointAtDistanceFrom` anchored at `{ latitude: 0, longitude: 0 }` — the common case. */
export function pointAtDistanceFromOrigin(distanceKm: number): Coordinates {
  return pointAtDistanceFrom({ latitude: 0, longitude: 0 }, distanceKm);
}
