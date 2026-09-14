export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Mean Earth radius in kilometers (IUGG value) — the single constant every distance in this
 *  service is computed against, so results stay internally consistent. */
export const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance between two lat/lng points, in kilometers, via the Haversine formula.
 * Pure and dependency-free (no Koa, no database) — consumed by shipping cost (ticket 06) and
 * allocation (ticket 07).
 *
 * Documented assumptions:
 * - Earth is modeled as a perfect sphere of radius `EARTH_RADIUS_KM`, not the WGS84 ellipsoid.
 *   This is the standard simplification for this use case: the error versus an ellipsoidal
 *   model is at most ~0.5%, negligible next to the $0.01/kg/km shipping rate it feeds into.
 * - Inputs are plain decimal-degree coordinates (latitude in [-90, 90], longitude in
 *   [-180, 180]). Range is validated upstream by `orderRequestSchema` (ticket 02) and by the
 *   fixed warehouse seed data (ticket 03); this function does not re-validate range itself and
 *   will produce a mathematically well-defined but meaningless result for out-of-range input.
 */
export function calculateDistanceKm(a: Coordinates, b: Coordinates): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);

  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);

  const h = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  const centralAngle = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

  return EARTH_RADIUS_KM * centralAngle;
}
