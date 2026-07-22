/**
 * Shared data layer and analysis for the solar-status CLI and Telegram bot.
 * Dependency-free, Node.js 18+. All text/rendering stays in the consumers.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const VERSION = '1.0.0';

const URLS = {
  scales: 'https://services.swpc.noaa.gov/products/noaa-scales.json',
  kp: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
  aurora: 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json',
};
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const CACHE_FILE = path.join(os.homedir(), '.cache', 'solar-status.json');

export async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': `solar-status/${VERSION}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  return response.json();
}

export function cityLabel(city) {
  const admin1 = city.admin1 === city.name ? '' : city.admin1;
  return [city.name, admin1, city.country].filter(Boolean).join(', ');
}

export async function geocode(query, language = 'en') {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=10&language=${language}&format=json`;
  const data = await fetchJson(url);
  return (data.results ?? []).map((r) => ({
    name: r.name,
    admin1: r.admin1 ?? '',
    country: r.country ?? r.country_code ?? '',
    latitude: r.latitude,
    longitude: r.longitude,
    timezone: r.timezone ?? 'UTC',
    population: r.population ?? 0,
  }));
}

async function readCache() {
  try {
    return JSON.parse(await fs.readFile(CACHE_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function saveCache(data) {
  try {
    await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
    await fs.writeFile(CACHE_FILE, JSON.stringify(data));
  } catch {
    // Still works if the cache cannot be written.
  }
}

export async function getData() {
  const cached = await readCache();
  const entries = await Promise.all(
    Object.entries(URLS).map(async ([key, url]) => {
      try {
        return [key, await fetchJson(url), false];
      } catch (error) {
        if (cached[key]) return [key, cached[key], true];
        return [key, null, true, error.message];
      }
    })
  );

  const result = { fetchedAt: new Date().toISOString(), stale: [], errors: [] };
  for (const [key, value, stale, error] of entries) {
    result[key] = value;
    if (stale) result.stale.push(key);
    if (error) result.errors.push(`${key}: ${error}`);
  }
  if (result.scales || result.kp || result.aurora) await saveCache(result);
  return result;
}

export function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** 0 normal, 1 low, 2 elevated, 3 high, 4 severe — index into a label set. */
export function severityIndex(n) {
  if (n <= 0) return 0;
  if (n <= 2) return 1;
  if (n === 3) return 2;
  if (n === 4) return 3;
  return 4;
}

export function nearestAurora(aurora, place) {
  if (!aurora?.coordinates?.length) return null;
  const targetLon = Math.round((place.longitude + 360) % 360);
  const targetLat = Math.round(place.latitude);
  let nearest = null;
  let bestDistance = Infinity;
  for (const point of aurora.coordinates) {
    const [lon, lat, probability] = point;
    const lonDistance = Math.min(Math.abs(lon - targetLon), 360 - Math.abs(lon - targetLon));
    const distance = lonDistance ** 2 + (lat - targetLat) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      nearest = { probability: number(probability), longitude: lon, latitude: lat };
    }
  }
  return nearest;
}

export function sparkline(values) {
  const blocks = '▁▂▃▄▅▆▇█';
  return values.map((v) => blocks[Math.min(7, Math.max(0, Math.floor(v)))]).join('');
}

/** Pure numbers from NOAA data for a lat/lon — no prose, consumers localize. */
export function buildFacts(data, place) {
  if (!data.scales) throw new Error('NOAA scale data is unavailable and no cache exists.');

  const currentRaw = data.scales['0'] ?? {};
  const current = {
    g: number(currentRaw.G?.Scale),
    r: number(currentRaw.R?.Scale),
    s: number(currentRaw.S?.Scale),
  };

  const kpRows = Array.isArray(data.kp) ? data.kp : [];
  const latestKp = kpRows.at(-1) ?? null;
  const kpHistory = kpRows.slice(-8).map((row) => number(row.Kp));
  const forecastRows = ['1', '2', '3'].map((key) => data.scales[key]).filter(Boolean);
  const forecast = forecastRows.map((row) => ({
    date: row.DateStamp,
    g: number(row.G?.Scale),
    radioMinor: number(row.R?.MinorProb),
    radioMajor: number(row.R?.MajorProb),
    radiation: number(row.S?.Prob),
  }));

  const forecastMax = Math.max(0, ...forecast.map((row) => row.g));
  const radioMinor = Math.max(0, ...forecast.map((row) => row.radioMinor));
  const radioMajor = Math.max(0, ...forecast.map((row) => row.radioMajor));
  const radiation = Math.max(0, ...forecast.map((row) => row.radiation));
  const nowMax = Math.max(current.g, current.r, current.s);
  const futureMax = Math.max(
    forecastMax,
    radioMajor >= 25 ? 3 : 0,
    radioMinor >= 50 ? 1 : 0,
    radiation >= 25 ? 1 : 0
  );

  return {
    current,
    kp: latestKp ? number(latestKp.Kp) : null,
    kpObservedAt: latestKp?.time_tag ? `${latestKp.time_tag}Z` : null,
    kpHistory,
    forecast,
    forecastMax,
    radioMinor,
    radioMajor,
    radiation,
    futureMax,
    level: Math.max(nowMax, futureMax),
    gLevel: Math.max(current.g, forecastMax),
    auroraProb: nearestAurora(data.aurora, place)?.probability ?? null,
    noaaUpdatedAt: currentRaw.DateStamp && currentRaw.TimeStamp
      ? `${currentRaw.DateStamp}T${currentRaw.TimeStamp}Z`
      : null,
  };
}
