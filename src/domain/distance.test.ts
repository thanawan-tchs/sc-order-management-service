import { describe, expect, it } from "vitest";
import { Coordinates, EARTH_RADIUS_KM, calculateDistanceKm } from "./distance";

/**
 * Independent reference implementation (spherical law of cosines) used only to cross-check the
 * Haversine implementation under test. Deliberately a different formula/operation order so a bug
 * shared between "the code" and "the test" can't silently validate itself.
 */
function referenceDistanceKm(a: Coordinates, b: Coordinates): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLng = toRad(b.longitude - a.longitude);

  const cosAngle =
    Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLng);
  // Clamp: float rounding can push a same-point/antipodal cosAngle a hair past +/-1, where
  // acos is undefined (NaN) rather than just imprecise.
  const clamped = Math.min(1, Math.max(-1, cosAngle));
  return EARTH_RADIUS_KM * Math.acos(clamped);
}

// The service's actual 6 warehouses — real coordinates spanning both hemispheres and both sides
// of the prime meridian.
const LOS_ANGELES: Coordinates = { latitude: 33.9425, longitude: -118.408056 };
const NEW_YORK: Coordinates = { latitude: 40.639722, longitude: -73.778889 };
const SAO_PAULO: Coordinates = { latitude: -23.435556, longitude: -46.473056 }; // southern hemisphere
const PARIS: Coordinates = { latitude: 49.009722, longitude: 2.547778 }; // eastern longitude
const WARSAW: Coordinates = { latitude: 52.165833, longitude: 20.967222 }; // eastern longitude
const HONG_KONG: Coordinates = { latitude: 22.308889, longitude: 113.914444 }; // eastern longitude

describe("calculateDistanceKm", () => {
  it("returns ~0 km for the same point", () => {
    expect(calculateDistanceKm(LOS_ANGELES, LOS_ANGELES)).toBeCloseTo(0, 6);
    expect(
      calculateDistanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 })
    ).toBeCloseTo(0, 6);
  });

  it("is symmetric", () => {
    expect(calculateDistanceKm(LOS_ANGELES, NEW_YORK)).toBeCloseTo(
      calculateDistanceKm(NEW_YORK, LOS_ANGELES),
      9
    );
  });

  it("is deterministic across repeated calls", () => {
    const first = calculateDistanceKm(PARIS, WARSAW);
    const second = calculateDistanceKm(PARIS, WARSAW);
    expect(first).toBe(second);
  });

  it("matches the exact closed-form distance along a shared meridian (short distance)", () => {
    // Moving along a meridian is itself a great-circle arc, so distance reduces to
    // R * angular latitude separation — an expected value derived independently of Haversine.
    const a: Coordinates = { latitude: 10, longitude: 30 };
    const b: Coordinates = { latitude: 11, longitude: 30 }; // 1 degree further north
    const expectedKm = EARTH_RADIUS_KM * ((1 * Math.PI) / 180);

    const distance = calculateDistanceKm(a, b);
    expect(distance).toBeCloseTo(expectedKm, 5);
    // ~1 degree of latitude is ~111 km on this sphere — sanity bound on top of the exact check.
    expect(distance).toBeGreaterThan(100);
    expect(distance).toBeLessThan(120);
  });

  it("matches the exact half-circumference distance between antipodal points (long distance)", () => {
    const north: Coordinates = { latitude: 90, longitude: 0 };
    const south: Coordinates = { latitude: -90, longitude: 0 };
    const expectedKm = Math.PI * EARTH_RADIUS_KM;

    const distance = calculateDistanceKm(north, south);
    expect(distance).toBeCloseTo(expectedKm, 5);
    expect(distance).toBeGreaterThan(10000);
  });

  it.each([
    ["LA <-> New York — northern hemisphere, both western longitudes", LOS_ANGELES, NEW_YORK],
    ["Warsaw <-> São Paulo — crosses northern/southern hemispheres", WARSAW, SAO_PAULO],
    ["Paris <-> Hong Kong — both eastern longitudes, crosses prime meridian path", PARIS, HONG_KONG],
    ["São Paulo <-> Hong Kong — southern+western vs. northern+eastern", SAO_PAULO, HONG_KONG],
  ] as const)("matches an independent reference formula: %s", (_label, a, b) => {
    const actual = calculateDistanceKm(a, b);
    const expected = referenceDistanceKm(a, b);

    // Two different but mathematically equivalent formulas — expect close agreement (floating
    // point operation order differs), not bit-for-bit equality.
    expect(actual).toBeCloseTo(expected, 5);
    expect(actual).toBeGreaterThan(0);
  });

  it("produces a finite, non-negative distance for every pair of the 6 real warehouses", () => {
    const warehouses = [LOS_ANGELES, NEW_YORK, SAO_PAULO, PARIS, WARSAW, HONG_KONG];

    for (const a of warehouses) {
      for (const b of warehouses) {
        const distance = calculateDistanceKm(a, b);
        expect(Number.isFinite(distance)).toBe(true);
        expect(distance).toBeGreaterThanOrEqual(0);
        // Nothing on Earth is farther apart than half the circumference.
        expect(distance).toBeLessThanOrEqual(Math.PI * EARTH_RADIUS_KM + 1e-6);
      }
    }
  });
});
