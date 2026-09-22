import { expect } from "chai";
import { Coordinates, EARTH_RADIUS_KM, calculateDistanceKm } from "./distance";

function referenceDistanceKm(a: Coordinates, b: Coordinates): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const dLng = toRad(b.longitude - a.longitude);

  const cosAngle =
    Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const clamped = Math.min(1, Math.max(-1, cosAngle));
  return EARTH_RADIUS_KM * Math.acos(clamped);
}

const LOS_ANGELES: Coordinates = { latitude: 33.9425, longitude: -118.408056 };
const NEW_YORK: Coordinates = { latitude: 40.639722, longitude: -73.778889 };
const SAO_PAULO: Coordinates = { latitude: -23.435556, longitude: -46.473056 }; // southern hemisphere
const PARIS: Coordinates = { latitude: 49.009722, longitude: 2.547778 }; // eastern longitude
const WARSAW: Coordinates = { latitude: 52.165833, longitude: 20.967222 }; // eastern longitude
const HONG_KONG: Coordinates = { latitude: 22.308889, longitude: 113.914444 }; // eastern longitude

describe("calculateDistanceKm", () => {
  it("returns ~0 km for the same point", () => {
    expect(calculateDistanceKm(LOS_ANGELES, LOS_ANGELES)).to.be.closeTo(0, 1e-6);
    expect(
      calculateDistanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0 })
    ).to.be.closeTo(0, 1e-6);
  });

  it("is symmetric", () => {
    expect(calculateDistanceKm(LOS_ANGELES, NEW_YORK)).to.be.closeTo(
      calculateDistanceKm(NEW_YORK, LOS_ANGELES),
      1e-9
    );
  });

  it("is deterministic across repeated calls", () => {
    const first = calculateDistanceKm(PARIS, WARSAW);
    const second = calculateDistanceKm(PARIS, WARSAW);
    expect(first).to.equal(second);
  });

  it("matches the exact closed-form distance along a shared meridian (short distance)", () => {
    const a: Coordinates = { latitude: 10, longitude: 30 };
    const b: Coordinates = { latitude: 11, longitude: 30 }; // 1 degree further north
    const expectedKm = EARTH_RADIUS_KM * ((1 * Math.PI) / 180);

    const distance = calculateDistanceKm(a, b);
    expect(distance).to.be.closeTo(expectedKm, 1e-5);
    expect(distance).to.be.greaterThan(100);
    expect(distance).to.be.lessThan(120);
  });

  it("matches the exact half-circumference distance between antipodal points (long distance)", () => {
    const north: Coordinates = { latitude: 90, longitude: 0 };
    const south: Coordinates = { latitude: -90, longitude: 0 };
    const expectedKm = Math.PI * EARTH_RADIUS_KM;

    const distance = calculateDistanceKm(north, south);
    expect(distance).to.be.closeTo(expectedKm, 1e-5);
    expect(distance).to.be.greaterThan(10000);
  });

  const referenceFormulaCases = [
    ["LA <-> New York — northern hemisphere, both western longitudes", LOS_ANGELES, NEW_YORK],
    ["Warsaw <-> São Paulo — crosses northern/southern hemispheres", WARSAW, SAO_PAULO],
    ["Paris <-> Hong Kong — both eastern longitudes, crosses prime meridian path", PARIS, HONG_KONG],
    ["São Paulo <-> Hong Kong — southern+western vs. northern+eastern", SAO_PAULO, HONG_KONG],
  ] as const;

  for (const [label, a, b] of referenceFormulaCases) {
    it(`matches an independent reference formula: ${label}`, () => {
      const actual = calculateDistanceKm(a, b);
      const expected = referenceDistanceKm(a, b);

      expect(actual).to.be.closeTo(expected, 1e-5);
      expect(actual).to.be.greaterThan(0);
    });
  }

  it("produces a finite, non-negative distance for every pair of the 6 real warehouses", () => {
    const warehouses = [LOS_ANGELES, NEW_YORK, SAO_PAULO, PARIS, WARSAW, HONG_KONG];

    for (const a of warehouses) {
      for (const b of warehouses) {
        const distance = calculateDistanceKm(a, b);
        expect(Number.isFinite(distance)).to.equal(true);
        expect(distance).to.be.at.least(0);
        expect(distance).to.be.at.most(Math.PI * EARTH_RADIUS_KM + 1e-6);
      }
    }
  });
});
