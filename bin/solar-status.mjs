#!/usr/bin/env node

/**
 * solar-status
 * Dependency-free terminal summary of solar activity for your city,
 * using official NOAA SWPC data. Requires Node.js 18+.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline/promises';

const VERSION = '1.0.0';
const URLS = {
  scales: 'https://services.swpc.noaa.gov/products/noaa-scales.json',
  kp: 'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
  aurora: 'https://services.swpc.noaa.gov/json/ovation_aurora_latest.json',
};
const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'solar-status');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
const CACHE_FILE = path.join(os.homedir(), '.cache', 'solar-status.json');
const WIDTH = 66;

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const colorEnabled = process.stdout.isTTY && !has('--no-color') && !process.env.NO_COLOR;
const jsonMode = has('--json');
const interactive = process.stdin.isTTY && process.stdout.isTTY && !jsonMode;

const style = {
  bold: (s) => colorEnabled ? `\x1b[1m${s}\x1b[0m` : s,
  dim: (s) => colorEnabled ? `\x1b[2m${s}\x1b[0m` : s,
  green: (s) => colorEnabled ? `\x1b[32m${s}\x1b[0m` : s,
  yellow: (s) => colorEnabled ? `\x1b[33m${s}\x1b[0m` : s,
  red: (s) => colorEnabled ? `\x1b[31m${s}\x1b[0m` : s,
  magenta: (s) => colorEnabled ? `\x1b[35m${s}\x1b[0m` : s,
  cyan: (s) => colorEnabled ? `\x1b[36m${s}\x1b[0m` : s,
};

function help() {
  console.log(`solar-status ${VERSION} — solar activity for your city

Usage:
  solar-status                  Show one summary (asks for your city on first run)
  solar-status --city "Name"    Change the saved city
  solar-status --watch 300      Refresh every 300 seconds
  solar-status --json           Machine-readable output
  solar-status --no-color       Disable ANSI colors
  solar-status --version        Print version
  solar-status --help           Show this help

Data: NOAA Space Weather Prediction Center + Open-Meteo geocoding.
No API key or external package required. Config: ${CONFIG_FILE}`);
}

if (has('--help') || has('-h')) {
  help();
  process.exit(0);
}
if (has('--version') || has('-v')) {
  console.log(VERSION);
  process.exit(0);
}

function flagValue(flag) {
  const i = args.indexOf(flag);
  if (i < 0) return null;
  const value = args[i + 1];
  if (!value || value.startsWith('--')) {
    console.error(`solar-status: ${flag} requires a value`);
    process.exit(2);
  }
  return value;
}

function watchSeconds() {
  const i = args.indexOf('--watch');
  if (i < 0) return 0;
  const requested = Number(args[i + 1] ?? 300);
  return Number.isFinite(requested) ? Math.max(60, requested) : 300;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'user-agent': `solar-status/${VERSION}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).hostname}`);
  return response.json();
}

// ── City selection ────────────────────────────────────────────────

function cityLabel(city) {
  const admin1 = city.admin1 === city.name ? '' : city.admin1;
  return [city.name, admin1, city.country].filter(Boolean).join(', ');
}

async function geocode(query) {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(query)}&count=10&language=en&format=json`;
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

async function pickCity(query, rl) {
  const matches = await geocode(query);
  if (!matches.length) throw new Error(`no place found for "${query}"`);
  if (matches.length === 1) return matches[0];
  if (!rl) {
    console.error(`solar-status: multiple places match "${query}", using ${cityLabel(matches[0])} (run interactively to choose)`);
    return matches[0];
  }
  const compact = new Intl.NumberFormat('en', { notation: 'compact' });
  console.log(`\nWhich ${style.bold(matches[0].name)}?`);
  matches.forEach((m, i) => {
    const pop = m.population ? style.dim(` · pop. ${compact.format(m.population)}`) : '';
    console.log(`  ${style.cyan(String(i + 1))}. ${cityLabel(m)}${pop}`);
  });
  const answer = await rl.question(`Choice [1-${matches.length}, default 1]: `);
  const n = Number(answer.trim() || 1);
  if (!Number.isInteger(n) || n < 1 || n > matches.length) throw new Error(`invalid choice "${answer.trim()}"`);
  return matches[n - 1];
}

async function readConfig() {
  try {
    const config = JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8'));
    if (config?.name && Number.isFinite(config.latitude) && Number.isFinite(config.longitude)) return config;
  } catch { /* first run */ }
  return null;
}

async function saveConfig(city) {
  await fs.mkdir(CONFIG_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, JSON.stringify(city, null, 2));
}

async function resolveCity() {
  const requested = flagValue('--city');
  let rl = null;
  try {
    if (interactive) {
      rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.on('SIGINT', () => process.exit(130));
    }
    if (requested) {
      const city = await pickCity(requested, rl);
      await saveConfig(city);
      return city;
    }
    const saved = await readConfig();
    if (saved) return saved;
    if (!rl) {
      throw new Error(`no city configured — run solar-status interactively once, or pass --city "Name"`);
    }
    const query = (await rl.question('Your city: ')).trim();
    if (!query) throw new Error('a city name is required');
    const city = await pickCity(query, rl);
    await saveConfig(city);
    console.log(style.dim(`Saved ${cityLabel(city)} — change it anytime with --city "Name"\n`));
    return city;
  } finally {
    rl?.close();
  }
}

// ── Data ──────────────────────────────────────────────────────────

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

async function getData() {
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

function number(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function severityLabel(n) {
  if (n <= 0) return 'NORMAL';
  if (n <= 2) return 'LOW';
  if (n === 3) return 'ELEVATED';
  if (n === 4) return 'HIGH';
  return 'SEVERE';
}

function severityColor(n, text) {
  if (n <= 0) return style.green(text);
  if (n <= 2) return style.yellow(text);
  if (n === 3) return style.red(text);
  return style.magenta(text);
}

function nearestAurora(aurora, city) {
  if (!aurora?.coordinates?.length) return null;
  const targetLon = Math.round((city.longitude + 360) % 360);
  const targetLat = Math.round(city.latitude);
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

function formatLocalTime(date, timezone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function formatForecastDate(dateString) {
  const date = new Date(`${dateString}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  }).format(date);
}

function practicalSummary({ current, forecastMax, radioMinor, radioMajor, radiation }, cityName) {
  const nowMax = Math.max(current.g, current.r, current.s);
  const futureMax = Math.max(forecastMax, radioMajor >= 25 ? 3 : 0, radioMinor >= 50 ? 1 : 0, radiation >= 25 ? 1 : 0);
  const level = Math.max(nowMax, futureMax);
  const overall = severityLabel(level);

  let headline = `No meaningful disruption expected for everyday technology in ${cityName}.`;
  if (futureMax === 1 || futureMax === 2) {
    headline = 'Everyday technology should work normally; specialist systems should watch conditions.';
  } else if (futureMax === 3) {
    headline = 'GPS precision, HF radio, satellites, and grid operations may be affected.';
  } else if (futureMax >= 4) {
    headline = 'Potentially significant technology disruption; follow official warnings.';
  }

  return { overall, level, headline };
}

// Health notes are graded on the geomagnetic (G) level. The honest science:
// evidence for storm effects on wellbeing is mixed, and ground-level
// radiation never increases — say both, every time.
function healthNotes({ gLevel, sLevel, latitude }) {
  const notes = [];
  if (gLevel <= 0) {
    notes.push('Geomagnetic conditions are calm — no plausible effect on how you feel today.');
  } else if (gLevel <= 2) {
    notes.push('Minor to moderate storming. Most people notice nothing at all. Storm-sensitive people sometimes report lighter sleep or mild headaches on days like this; scientific evidence for such effects is mixed and, if real, they are subtle.');
  } else if (gLevel === 3) {
    notes.push('Strong storming. Commonly self-reported on days like this: disturbed sleep, fatigue, headaches, irritability, trouble concentrating. Research remains inconclusive, but if you are storm-sensitive, today may feel "off" — keep your sleep schedule and go easy on caffeine.');
  } else {
    notes.push('Severe storming. Some studies associate storms of this size with sleep disruption and short-term cardiovascular strain (blood pressure, heart-rate variability) in sensitive people. Nothing acute is expected for a healthy person; if you have a heart condition, treat symptoms as you normally would — do not dismiss them as "the storm".');
  }
  if (sLevel >= 1) {
    notes.push(`Radiation storm S${sLevel} in progress: relevant for astronauts and polar-route flights (slightly higher dose than usual), not for anyone on the ground.`);
  }
  if (Math.abs(latitude) >= 55 && gLevel >= 1) {
    notes.push('Your latitude is high, so geomagnetic effects (and aurora chances) run stronger here than at mid-latitudes.');
  }
  notes.push('Ground-level radiation does not increase during geomagnetic storms — the atmosphere and magnetic field shield you.');
  return notes;
}

function buildModel(data, city) {
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
  const summary = practicalSummary({ current, forecastMax, radioMinor, radioMajor, radiation }, city.name);
  const localAurora = nearestAurora(data.aurora, city);
  const gLevel = Math.max(current.g, forecastMax);

  return {
    location: city,
    generatedAt: new Date().toISOString(),
    noaaUpdatedAt: currentRaw.DateStamp && currentRaw.TimeStamp
      ? `${currentRaw.DateStamp}T${currentRaw.TimeStamp}Z`
      : null,
    status: summary.overall,
    statusLevel: summary.level,
    summary: summary.headline,
    current: {
      geomagnetic: `G${current.g}`,
      radioBlackout: `R${current.r}`,
      radiationStorm: `S${current.s}`,
      kp: latestKp ? number(latestKp.Kp) : null,
      kpObservedAt: latestKp?.time_tag ? `${latestKp.time_tag}Z` : null,
      kpHistory,
      levels: current,
    },
    forecast,
    local: {
      consumerTech: forecastMax < 3 ? 'Normal operation expected' : 'Some disruption is possible',
      mobileAndInternet: forecastMax < 4 ? 'Normal operation expected' : 'Indirect disruption is possible',
      gps: forecastMax < 2 ? 'Normal; precision users monitor at G2+' : forecastMax < 3 ? 'Small errors possible for precision users' : 'Errors or degradation possible',
      power: forecastMax < 3 ? 'No household impact expected' : 'Grid operators may take precautions',
      hfRadio: radioMinor >= 50 ? `Minor/moderate blackout chance ${radioMinor}%` : `Low blackout chance ${radioMinor}%`,
      auroraOverheadNextHour: localAurora?.probability ?? null,
    },
    howItMayFeel: healthNotes({ gLevel, sLevel: current.s, latitude: city.latitude }),
    staleFeeds: data.stale,
    errors: data.errors,
  };
}

// ── Rendering ─────────────────────────────────────────────────────

function pad(text, width) {
  return String(text).padEnd(width, ' ');
}

function rule(title = '') {
  if (!title) return style.dim('─'.repeat(WIDTH));
  const label = ` ${title} `;
  return style.dim('──') + style.bold(label) + style.dim('─'.repeat(Math.max(0, WIDTH - label.length - 2)));
}

function wrap(text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && (line + ' ' + word).length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function sparkline(values) {
  const blocks = '▁▂▃▄▅▆▇█';
  return values.map((v) => blocks[Math.min(7, Math.max(0, Math.floor(v)))]).join('');
}

function render(model) {
  const city = model.location;
  const tz = city.timezone;
  const updated = model.noaaUpdatedAt ? formatLocalTime(new Date(model.noaaUpdatedAt), tz) : 'unknown';
  const kp = model.current.kp === null ? 'n/a' : model.current.kp.toFixed(1);
  const levels = model.current.levels;

  console.log(style.cyan(style.bold(`☀ SOLAR STATUS · ${cityLabel(city).toUpperCase()}`)));
  console.log(style.dim(`${formatLocalTime(new Date(), tz)} local · NOAA updated ${updated}`));
  console.log('');
  console.log(`${style.bold('OUTLOOK')}  ${severityColor(model.statusLevel, model.status)}`);
  for (const line of wrap(model.summary, WIDTH)) console.log(line);
  console.log('');
  console.log(rule('NOW'));
  console.log(`  Kp ${style.bold(kp)}  ${style.cyan(sparkline(model.current.kpHistory))} ${style.dim('last 24 h')}`);
  console.log(
    `  Geomagnetic ${severityColor(levels.g, model.current.geomagnetic)}` +
    `   Radio blackout ${severityColor(levels.r, model.current.radioBlackout)}` +
    `   Radiation ${severityColor(levels.s, model.current.radiationStorm)}`
  );
  console.log('');
  console.log(rule('NEXT 3 DAYS · UTC'));
  for (const row of model.forecast) {
    console.log(
      `  ${pad(formatForecastDate(row.date), 11)} ` +
      `${severityColor(row.g, pad(`G${row.g}`, 3))} ` +
      `${style.dim('R1-2')} ${String(row.radioMinor).padStart(2)}%  ` +
      `${style.dim('R3+')} ${String(row.radioMajor).padStart(2)}%  ` +
      `${style.dim('S1+')} ${String(row.radiation).padStart(2)}%`
    );
  }
  console.log('');
  console.log(rule(`TECH IN ${city.name.toUpperCase()}`));
  console.log(`  Phones / internet  ${model.local.mobileAndInternet}`);
  console.log(`  GPS                ${model.local.gps}`);
  console.log(`  Electricity        ${model.local.power}`);
  console.log(`  HF radio           ${model.local.hfRadio}`);
  if (model.local.auroraOverheadNextHour !== null) {
    console.log(`  Aurora overhead    ${model.local.auroraOverheadNextHour}% model probability, next hour`);
  }
  console.log('');
  console.log(rule('HOW IT MAY FEEL'));
  const [main, ...rest] = model.howItMayFeel;
  for (const line of wrap(main, WIDTH - 2)) console.log(`  ${line}`);
  for (const note of rest) {
    for (const line of wrap(note, WIDTH - 2)) console.log(style.dim(`  ${line}`));
  }
  console.log(rule());
  console.log(style.dim('G = geomagnetic · R = radio · S = radiation · 0 normal, 5 severe'));
  console.log(style.dim('R1-2 mainly affects HF/shortwave radio, not cellular or Wi-Fi.'));
  if (model.staleFeeds.length) {
    console.log(style.yellow(`Using cached data for: ${model.staleFeeds.join(', ')}`));
  }
}

// ── Main ──────────────────────────────────────────────────────────

async function run(city) {
  try {
    const data = await getData();
    const model = buildModel(data, city);
    if (jsonMode) console.log(JSON.stringify(model, null, 2));
    else render(model);
  } catch (error) {
    console.error(`solar-status: ${error.message}`);
    process.exitCode = 1;
  }
}

let city;
try {
  city = await resolveCity();
} catch (error) {
  console.error(`solar-status: ${error.message}`);
  process.exit(1);
}

const interval = watchSeconds();
if (!interval) {
  await run(city);
} else {
  while (true) {
    if (!jsonMode && process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[H');
    await run(city);
    if (!jsonMode) console.log(style.dim(`\nRefreshing every ${interval}s · Ctrl-C to stop`));
    await new Promise((resolve) => setTimeout(resolve, interval * 1000));
  }
}
