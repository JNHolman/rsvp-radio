"use strict";

/**
 * Solar day/night phase for the RSVP kiosk, without a weather/API dependency.
 * Sunrise: sun's upper edge reaches horizon (-0.833 degrees altitude).
 * Civil dusk: sun reaches -6 degrees altitude after sunset.
 *
 * The host timezone must be the venue's timezone, e.g.
 * TZ=America/Kentucky/Louisville.
 * Longitude is negative west of Greenwich.
 */
const RAD = Math.PI / 180;
const J1970 = 2440588;
const J2000 = 2451545;
const DAY_MS = 86400000;
const J0 = 0.0009;
const EARTH_OBLIQUITY = 23.4397 * RAD;

function toJulian(date) { return date.getTime() / DAY_MS - 0.5 + J1970; }
function fromJulian(day) { return new Date((day + 0.5 - J1970) * DAY_MS); }
function toDays(date) { return toJulian(date) - J2000; }
function solarMeanAnomaly(d) { return RAD * (357.5291 + 0.98560028 * d); }
function eclipticLongitude(m) {
  const center = RAD * (1.9148 * Math.sin(m) + 0.0200 * Math.sin(2 * m) + 0.0003 * Math.sin(3 * m));
  return m + center + 102.9372 * RAD + Math.PI;
}
function sunDeclination(l) { return Math.asin(Math.sin(EARTH_OBLIQUITY) * Math.sin(l)); }
function julianCycle(d, lw) { return Math.round(d - J0 - lw / (2 * Math.PI)); }
function approxTransit(angle, lw, cycle) { return J0 + (angle + lw) / (2 * Math.PI) + cycle; }
function solarTransit(ds, anomaly, longitude) {
  return J2000 + ds + 0.0053 * Math.sin(anomaly) - 0.0069 * Math.sin(2 * longitude);
}
function hourAngle(altitude, latitude, declination) {
  const cosAngle = (Math.sin(altitude) - Math.sin(latitude) * Math.sin(declination)) /
    (Math.cos(latitude) * Math.cos(declination));
  return cosAngle >= -1 && cosAngle <= 1 ? Math.acos(cosAngle) : null;
}

function getSunTimes(date, latitude, longitude) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new TypeError("Invalid date");
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 ||
      !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new RangeError("Invalid solar coordinates");
  }
  // Local noon anchors the calculation to the venue's calendar day.
  const noon = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  const lw = -longitude * RAD;
  const phi = latitude * RAD;
  const cycle = julianCycle(toDays(noon), lw);
  const ds = approxTransit(0, lw, cycle);
  const m = solarMeanAnomaly(ds);
  const l = eclipticLongitude(m);
  const declination = sunDeclination(l);
  const transit = solarTransit(ds, m, l);

  function event(altitudeDegrees, rising) {
    const angle = hourAngle(altitudeDegrees * RAD, phi, declination);
    if (angle === null) return null;
    const set = solarTransit(approxTransit(angle, lw, cycle), m, l);
    return fromJulian(rising ? transit - (set - transit) : set);
  }

  return { sunrise: event(-0.833, true), dusk: event(-6, false) };
}

function getSolarPhase(date, latitude, longitude) {
  const { sunrise, dusk } = getSunTimes(date, latitude, longitude);
  if (!sunrise || !dusk) return { phase: null, sunrise, dusk, nextTransition: null };
  const now = date.getTime();
  const isDay = now >= sunrise.getTime() && now < dusk.getTime();
  let nextTransition;
  if (isDay) nextTransition = dusk;
  else if (now < sunrise.getTime()) nextTransition = sunrise;
  else {
    const tomorrow = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 12);
    nextTransition = getSunTimes(tomorrow, latitude, longitude).sunrise;
  }
  return { phase: isDay ? "day" : "night", sunrise, dusk, nextTransition };
}

module.exports = { getSunTimes, getSolarPhase };
