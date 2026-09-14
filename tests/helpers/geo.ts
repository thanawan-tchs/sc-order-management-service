import { EARTH_RADIUS_KM } from "../../src/domain/distance";

/**
 * A point whose great-circle distance from the origin `{ latitude: 0, longitude: 0 }` is
 * *exactly* `distanceKm` (same longitude as the origin, so the Haversine formula reduces exactly
 * to `EARTH_RADIUS_KM * angular separation` — see tests/domain/distance.test.ts's meridian case,
 * which independently verifies that reduction holds). This is the algebraic inverse of that
 * formula, not an approximation, so `calculateDistanceKm` reproduces `distanceKm` to within float
 * rounding — good enough that any cent-rounded cost derived from it lands exactly where hand
 * arithmetic predicts, even though the raw `distanceKm` field itself may differ by ~1e-13.
 */
export function pointAtDistanceFromOrigin(distanceKm: number): { latitude: number; longitude: number } {
  const deltaLatDeg = (distanceKm / EARTH_RADIUS_KM) * (180 / Math.PI);
  return { latitude: deltaLatDeg, longitude: 0 };
}
