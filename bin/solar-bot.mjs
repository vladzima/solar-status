#!/usr/bin/env node

/**
 * solar-status Telegram bot: the same NOAA data as the CLI, delivered as
 * rich HTML messages (expandable quotes, inline keyboards, localized
 * commands). Location comes from a shared pin or a typed city name; replies
 * are Russian when the sender's Telegram language is Russian, else English.
 *
 * Usage: TELEGRAM_BOT_TOKEN=... solar-status-bot   (token from @BotFather)
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { VERSION, buildFacts, cityLabel, fetchJson, geocode, getData, severityIndex, sparkline, sunElevation } from './core.mjs';

const demoCity = process.argv.includes('--demo')
  ? process.argv[process.argv.indexOf('--demo') + 1] ?? 'Moscow'
  : null;
const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN && !demoCity) {
  console.error('solar-status-bot: set TELEGRAM_BOT_TOKEN (create a bot with @BotFather)');
  process.exit(1);
}
const API = `https://api.telegram.org/bot${TOKEN}`;
const CHATS_FILE = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  'solar-status',
  'bot-chats.json'
);

// ── Localization ──────────────────────────────────────────────────

const T = {
  en: {
    intro: '☀️ <b>Solar Status</b>\nSpace weather for your spot on Earth: NOAA storm scales, Kp index, aurora odds — and what it means for tech and how you may feel.\n\nHow should I find your location?',
    btnShare: '📍 Share my location',
    btnType: '🏙 Type a city',
    placeholder: 'Pick an option below',
    askCity: 'Which city? Send me its name.',
    cityPlaceholder: 'City name…',
    notFound: (q) => `Couldn't find “${q}” — try another spelling.`,
    pickOne: 'Which one did you mean?',
    expired: 'That list has expired — send the city name again.',
    unavailable: '⚠️ NOAA data is unavailable right now — try again in a few minutes.',
    btnRefresh: '🔄 Refresh',
    btnChange: '📍 Change location',
    refreshed: 'Up to date ✓',
    title: 'Solar status',
    outlook: 'Outlook',
    severity: ['NORMAL', 'LOW', 'ELEVATED', 'HIGH', 'SEVERE'],
    headline: (fm) =>
      fm >= 4 ? 'Potentially significant technology disruption — follow official warnings.'
      : fm === 3 ? 'GPS precision, HF radio, satellites and power grids may be affected.'
      : fm >= 1 ? 'Everyday technology should work normally; specialist systems are watching conditions.'
      : 'No meaningful disruption expected for everyday technology.',
    now: 'Right now',
    kpNote: 'last 24 h',
    aurora: (p) => `🌌 Aurora overhead: ${p}% chance in the next hour`,
    auroraNow: (p) => `🌌 Aurora: ${p}% chance overhead — it's dark at your location, worth a look`,
    auroraLater: (p) => `🌌 Aurora: ${p}% chance overhead — check the sky after dark`,
    rNowDay: (r) => `📻 R${r} blackout: your side of Earth is sunlit — HF radio is affected in your area now`,
    rNowNight: (r) => `📻 R${r} blackout: it's night where you are — no local impact`,
    forecastTitle: 'Next 3 days (UTC)',
    techTitle: 'Tech impact',
    phones: (fm) => `📱 Phones &amp; internet: ${fm < 4 ? 'normal operation' : 'indirect disruption possible'}`,
    gps: (fm) => `🛰 GPS: ${fm < 2 ? 'normal' : fm < 3 ? 'small errors possible for precision users' : 'errors or degradation possible'}`,
    power: (fm) => `⚡ Electricity: ${fm < 3 ? 'no household impact expected' : 'grid operators may take precautions'}`,
    feelTitle: '💤 How it may feel',
    feel: (g) =>
      g <= 0 ? 'Geomagnetic conditions are calm — no plausible effect on how you feel today.'
      : g <= 2 ? 'Minor to moderate storming. Most people notice nothing at all; storm-sensitive people sometimes report lighter sleep or mild headaches. Scientific evidence for such effects is mixed and, if real, they are subtle.'
      : g === 3 ? 'Strong storming. Commonly self-reported on days like this: disturbed sleep, fatigue, headaches, irritability. Research remains inconclusive, but if you are storm-sensitive, keep your sleep schedule and go easy on caffeine.'
      : 'Severe storming. Some studies associate storms of this size with sleep disruption and short-term cardiovascular strain in sensitive people. Nothing acute is expected for a healthy person.',
    sNote: (s) => `Radiation storm S${s} is relevant for astronauts and polar-route flights, not for anyone on the ground.`,
    latNote: 'Your latitude is high, so geomagnetic effects (and aurora chances) run stronger here.',
    shield: 'Ground-level radiation does not increase during geomagnetic storms — the atmosphere and magnetic field shield you.',
    legend: 'G — geomagnetic · R — radio blackout · S — radiation · scale 0–5',
    updated: (time) => `NOAA SWPC · updated ${time}`,
    btnAlerts: '🔔 Alerts',
    alertsMenu: (current) => `🔔 <b>Storm alerts</b>\nI check NOAA every 3 hours and message you when solar activity reaches your chosen level — happening now or in the 3-day forecast.\n\nCurrent setting: <b>${current}</b>`,
    alertOff: '🔕 Off',
    alertAny: '🟡 Any storm (G1+)',
    alertStrong: '🔴 Strong storms (G3+)',
    alertSet: (label) => `Alerts: ${label}`,
    alertNow: (word) => `🚨 <b>Solar alert — ${word} activity right now</b>`,
    alertSoon: (word) => `🚨 <b>Solar alert — ${word} activity expected within 3 days</b>`,
    commands: [
      { command: 'status', description: 'Solar status for your location' },
      { command: 'alerts', description: 'Configure storm alerts' },
      { command: 'start', description: 'Set or change your location' },
    ],
  },
  ru: {
    intro: '☀️ <b>Солнечная активность</b>\nКосмическая погода для вашей точки на Земле: шкалы бурь NOAA, Kp-индекс, шансы на полярное сияние — и что это значит для техники и самочувствия.\n\nКак определить ваше местоположение?',
    btnShare: '📍 Отправить геолокацию',
    btnType: '🏙 Ввести город',
    placeholder: 'Выберите вариант ниже',
    askCity: 'Какой город? Напишите название.',
    cityPlaceholder: 'Название города…',
    notFound: (q) => `Не нашёл «${q}» — попробуйте другое написание.`,
    pickOne: 'Какой именно?',
    expired: 'Список устарел — отправьте название города ещё раз.',
    unavailable: '⚠️ Данные NOAA сейчас недоступны — попробуйте через пару минут.',
    btnRefresh: '🔄 Обновить',
    btnChange: '📍 Сменить место',
    refreshed: 'Данные актуальны ✓',
    title: 'Солнечная активность',
    outlook: 'Активность',
    severity: ['СПОКОЙНАЯ', 'НИЗКАЯ', 'ПОВЫШЕННАЯ', 'ВЫСОКАЯ', 'ЭКСТРЕМАЛЬНАЯ'],
    headline: (fm) =>
      fm >= 4 ? 'Возможны серьёзные сбои техники — следите за официальными предупреждениями.'
      : fm === 3 ? 'Возможны сбои GPS, КВ-радиосвязи, спутников и энергосетей.'
      : fm >= 1 ? 'Бытовая техника будет работать нормально; специализированные системы следят за обстановкой.'
      : 'Заметных помех для повседневной техники не ожидается.',
    now: 'Сейчас',
    kpNote: 'за 24 ч',
    aurora: (p) => `🌌 Полярное сияние: вероятность ${p}% в ближайший час`,
    auroraNow: (p) => `🌌 Сияние: вероятность ${p}% над вами — у вас уже темно, стоит выглянуть`,
    auroraLater: (p) => `🌌 Сияние: вероятность ${p}% над вами — посмотрите на небо после темноты`,
    rNowDay: (r) => `📻 Радиопомехи R${r}: ваша сторона Земли освещена — КВ-связь у вас сейчас затронута`,
    rNowNight: (r) => `📻 Радиопомехи R${r}: у вас ночь — локального влияния нет`,
    forecastTitle: 'Ближайшие 3 дня (UTC)',
    techTitle: 'Влияние на технику',
    phones: (fm) => `📱 Телефоны и интернет: ${fm < 4 ? 'без сбоев' : 'возможны косвенные сбои'}`,
    gps: (fm) => `🛰 GPS: ${fm < 2 ? 'в норме' : fm < 3 ? 'возможны небольшие погрешности точных систем' : 'возможны сбои и погрешности'}`,
    power: (fm) => `⚡ Электричество: ${fm < 3 ? 'без влияния на быт' : 'энергосети принимают меры предосторожности'}`,
    feelTitle: '💤 Как это может ощущаться',
    feel: (g) =>
      g <= 0 ? 'Геомагнитная обстановка спокойная — влияния на самочувствие сегодня не ожидается.'
      : g <= 2 ? 'Слабая или умеренная буря. Большинство людей ничего не замечают; метеочувствительные иногда отмечают чуткий сон или лёгкую головную боль. Научные данные о таких эффектах противоречивы, а сами эффекты, если и есть, слабые.'
      : g === 3 ? 'Сильная буря. В такие дни часто жалуются на нарушенный сон, усталость, головную боль и раздражительность. Исследования неоднозначны, но если вы метеочувствительны — берегите режим сна и не злоупотребляйте кофеином.'
      : 'Экстремальная буря. Некоторые исследования связывают такие бури с нарушениями сна и краткосрочной нагрузкой на сердечно-сосудистую систему у чувствительных людей. Здоровому человеку ничего острого не грозит.',
    sNote: (s) => `Радиационная буря S${s} актуальна для космонавтов и полярных авиарейсов, а не для людей на земле.`,
    latNote: 'Вы на высокой широте — геомагнитные эффекты (и шансы на сияние) здесь сильнее, чем в средних широтах.',
    shield: 'Радиационный фон у земли во время магнитных бурь не растёт — атмосфера и магнитное поле защищают вас.',
    legend: 'G — геомагнитная буря · R — радиопомехи · S — радиация · шкала 0–5',
    updated: (time) => `NOAA SWPC · обновлено ${time}`,
    btnAlerts: '🔔 Оповещения',
    alertsMenu: (current) => `🔔 <b>Оповещения о бурях</b>\nКаждые 3 часа я проверяю данные NOAA и напишу, когда солнечная активность достигнет выбранного уровня — по факту или по трёхдневному прогнозу.\n\nТекущая настройка: <b>${current}</b>`,
    alertOff: '🔕 Выключены',
    alertAny: '🟡 Любая буря (G1+)',
    alertStrong: '🔴 Сильные бури (G3+)',
    alertSet: (label) => `Оповещения: ${label}`,
    alertNow: (word) => `🚨 <b>Солнечная активность ${word} — прямо сейчас</b>`,
    alertSoon: (word) => `🚨 <b>Солнечная активность ${word} — ожидается в ближайшие 3 дня</b>`,
    commands: [
      { command: 'status', description: 'Солнечная активность для вашего места' },
      { command: 'alerts', description: 'Настроить оповещения о бурях' },
      { command: 'start', description: 'Указать или сменить местоположение' },
    ],
  },
};

// Regular bots don't get Mini App initData; the equivalent signal is the
// sender's language_code on every update.
const langOf = (user) => ((user?.language_code ?? '').startsWith('ru') ? 'ru' : 'en');

// ── Telegram plumbing ─────────────────────────────────────────────

async function tg(method, payload = {}) {
  const response = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(60_000),
  });
  const data = await response.json();
  if (!data.ok) throw new Error(`${method}: ${data.description ?? `HTTP ${response.status}`}`);
  return data.result;
}

// chatId -> { place, locale, alerts: { threshold, lastLevel }, matches };
// everything but matches survives restarts. Alerts are opt-in: threshold 0
// or no alerts object means the user never enabled them.
const chats = new Map();

async function loadChats() {
  try {
    for (const [id, entry] of Object.entries(JSON.parse(await fs.readFile(CHATS_FILE, 'utf8')))) {
      // Pre-alerts versions stored the bare place object.
      chats.set(Number(id), entry.latitude !== undefined ? { place: entry } : entry);
    }
  } catch { /* first run */ }
}

async function saveChats() {
  const out = {};
  for (const [id, state] of chats) {
    if (state.place) out[id] = { place: state.place, locale: state.locale, alerts: state.alerts };
  }
  await fs.mkdir(path.dirname(CHATS_FILE), { recursive: true });
  await fs.writeFile(CHATS_FILE, JSON.stringify(out));
}

// ── Message building ──────────────────────────────────────────────

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function formatDay(dateString, locale) {
  return new Intl.DateTimeFormat(locale === 'ru' ? 'ru' : 'en-GB', {
    timeZone: 'UTC', weekday: 'short', day: '2-digit', month: 'short',
  }).format(new Date(`${dateString}T12:00:00Z`));
}

function formatUtc(iso, locale) {
  return `${new Intl.DateTimeFormat(locale === 'ru' ? 'ru' : 'en-GB', {
    timeZone: 'UTC', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(iso))} UTC`;
}

function statusMessage(facts, place, t, locale) {
  const sev = severityIndex(facts.level);
  const dot = ['🟢', '🟡', '🟠', '🔴', '🟣'][sev];
  const kp = facts.kp === null ? 'n/a' : facts.kp.toFixed(1);
  const forecast = facts.forecast
    .map((row) => `${formatDay(row.date, locale)} — G${row.g} · R ${row.radioMinor}% · S ${row.radiation}%`)
    .join('\n');

  const feel = [t.feel(facts.gLevel)];
  if (facts.current.s >= 1) feel.push(t.sNote(facts.current.s));
  if (Math.abs(place.latitude) >= 55 && facts.gLevel >= 1) feel.push(t.latNote);
  feel.push(t.shield);

  const lines = [
    `☀️ <b>${t.title} · ${esc(place.label)}</b>`,
    '',
    `${dot} <b>${t.outlook}: ${t.severity[sev]}</b>`,
    t.headline(facts.futureMax),
    '',
    `<b>${t.now}</b>`,
    `Kp <b>${kp}</b> <code>${sparkline(facts.kpHistory)}</code> <i>${t.kpNote}</i>`,
    `G${facts.current.g} · R${facts.current.r} · S${facts.current.s}`,
  ];
  if (facts.current.r >= 1) lines.push(facts.sunUp ? t.rNowDay(facts.current.r) : t.rNowNight(facts.current.r));
  if (facts.auroraProb >= 10) lines.push(facts.dark ? t.auroraNow(facts.auroraProb) : t.auroraLater(facts.auroraProb));
  else if (facts.auroraProb !== null && facts.auroraProb > 0) lines.push(t.aurora(facts.auroraProb));
  lines.push(
    '',
    `<b>${t.forecastTitle}</b>`,
    `<pre>${forecast}</pre>`,
    `<b>${t.techTitle}</b>`,
    t.phones(facts.forecastMax),
    t.gps(facts.forecastMax),
    t.power(facts.forecastMax),
    '',
    `<blockquote expandable><b>${t.feelTitle}</b>\n${feel.join('\n\n')}</blockquote>`,
    `<i>${t.legend}</i>`,
    `<i>${t.updated(facts.noaaUpdatedAt ? formatUtc(facts.noaaUpdatedAt, locale) : '—')}</i>`
  );
  return lines.join('\n');
}

// ── Flows ─────────────────────────────────────────────────────────

function sendIntro(chatId, t) {
  return tg('sendMessage', {
    chat_id: chatId,
    text: t.intro,
    parse_mode: 'HTML',
    reply_markup: {
      keyboard: [[{ text: t.btnShare, request_location: true }, { text: t.btnType }]],
      resize_keyboard: true,
      one_time_keyboard: true,
      input_field_placeholder: t.placeholder,
    },
  });
}

const statusKeyboard = (t) => ({
  inline_keyboard: [
    [{ text: t.btnRefresh, callback_data: 'refresh' }, { text: t.btnChange, callback_data: 'change' }],
    [{ text: t.btnAlerts, callback_data: 'alerts' }],
  ],
});

async function statusPayload(chatId, place, t, locale) {
  const facts = buildFacts(await getData(), place);
  return {
    chat_id: chatId,
    text: statusMessage(facts, place, t, locale),
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: statusKeyboard(t),
  };
}

// ── Alerts ────────────────────────────────────────────────────────

const alertLabel = (t, threshold) =>
  threshold === 3 ? t.alertStrong : threshold === 1 ? t.alertAny : t.alertOff;

function alertsMenuPayload(chatId, state, t) {
  return {
    chat_id: chatId,
    text: t.alertsMenu(alertLabel(t, state.alerts?.threshold ?? 0)),
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [
        [{ text: t.alertAny, callback_data: 'alert:1' }],
        [{ text: t.alertStrong, callback_data: 'alert:3' }],
        [{ text: t.alertOff, callback_data: 'alert:0' }],
      ],
    },
  };
}

// Notify when activity reaches the threshold and exceeds what we last
// alerted about; re-arm once it drops back below the threshold.
function alertDecision(level, threshold, lastLevel) {
  if (!threshold || level < threshold) return { notify: false, reset: true };
  return { notify: level > lastLevel, reset: false };
}

async function checkAlerts() {
  let data = null;
  for (const [chatId, state] of chats) {
    if (!state.place || !(state.alerts?.threshold > 0)) continue;
    try {
      data ??= await getData();
      const facts = buildFacts(data, state.place);
      const decision = alertDecision(facts.level, state.alerts.threshold, state.alerts.lastLevel ?? 0);
      if (decision.reset) state.alerts.lastLevel = 0;
      if (!decision.notify) continue;
      state.alerts.lastLevel = facts.level;
      const locale = state.locale ?? 'en';
      const t = T[locale];
      const nowMax = Math.max(facts.current.g, facts.current.r, facts.current.s);
      const word = t.severity[severityIndex(facts.level)];
      const banner = nowMax >= state.alerts.threshold ? t.alertNow(word) : t.alertSoon(word);
      await tg('sendMessage', {
        chat_id: chatId,
        text: `${banner}\n\n${statusMessage(facts, state.place, t, locale)}`,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: statusKeyboard(t),
      });
    } catch (error) {
      // tg-neurobot pattern: 403 Forbidden = user blocked the bot — opt them out.
      if (/forbidden/i.test(error.message)) state.alerts.threshold = 0;
      else console.error(`solar-status-bot: alert for ${chatId}: ${error.message}`);
    }
  }
  await saveChats().catch(() => {});
}

async function sendStatus(chatId, place, t, locale) {
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
  await tg('sendMessage', await statusPayload(chatId, place, t, locale));
}

async function placeFromCoords(latitude, longitude, locale) {
  try {
    const r = await fetchJson(
      `https://nominatim.openstreetmap.org/reverse?lat=${latitude}&lon=${longitude}&format=jsonv2&zoom=10&accept-language=${locale}`
    );
    const a = r.address ?? {};
    const name = a.city || a.town || a.village || a.municipality || r.name;
    if (name) return { name, label: [name, a.country].filter(Boolean).join(', '), latitude, longitude };
  } catch { /* fall back to raw coordinates */ }
  const label = `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
  return { name: label, label, latitude, longitude };
}

async function chooseCity(chatId, state, match, t, locale) {
  state.place = { name: match.name, label: cityLabel(match), latitude: match.latitude, longitude: match.longitude };
  state.matches = null;
  await saveChats();
  return sendStatus(chatId, state.place, t, locale);
}

async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const locale = langOf(msg.from);
  const t = T[locale];
  const state = chats.get(chatId) ?? {};
  chats.set(chatId, state);
  state.locale = locale;

  if (msg.location) {
    await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
    state.place = await placeFromCoords(msg.location.latitude, msg.location.longitude, locale);
    await saveChats();
    return sendStatus(chatId, state.place, t, locale);
  }

  const text = (msg.text ?? '').trim();
  if (!text) return;
  if (text.startsWith('/start')) return sendIntro(chatId, t);
  if (text.startsWith('/status')) {
    return state.place ? sendStatus(chatId, state.place, t, locale) : sendIntro(chatId, t);
  }
  if (text.startsWith('/alerts')) {
    return state.place ? tg('sendMessage', alertsMenuPayload(chatId, state, t)) : sendIntro(chatId, t);
  }
  if (text === T.en.btnType || text === T.ru.btnType) {
    return tg('sendMessage', {
      chat_id: chatId,
      text: t.askCity,
      reply_markup: { force_reply: true, input_field_placeholder: t.cityPlaceholder },
    });
  }

  // Any other text is a city search, same as the CLI's --city.
  await tg('sendChatAction', { chat_id: chatId, action: 'typing' });
  const matches = await geocode(text, locale);
  if (!matches.length) return tg('sendMessage', { chat_id: chatId, text: t.notFound(text) });
  if (matches.length === 1) return chooseCity(chatId, state, matches[0], t, locale);
  state.matches = matches.slice(0, 5);
  return tg('sendMessage', {
    chat_id: chatId,
    text: t.pickOne,
    reply_markup: {
      inline_keyboard: state.matches.map((m, i) => [{ text: cityLabel(m), callback_data: `city:${i}` }]),
    },
  });
}

async function handleCallback(query) {
  const chatId = query.message?.chat?.id;
  if (!chatId) return tg('answerCallbackQuery', { callback_query_id: query.id });
  const locale = langOf(query.from);
  const t = T[locale];
  const state = chats.get(chatId) ?? {};
  chats.set(chatId, state);
  state.locale = locale;
  const data = query.data ?? '';

  if (data === 'alerts') {
    await tg('answerCallbackQuery', { callback_query_id: query.id });
    return tg('sendMessage', alertsMenuPayload(chatId, state, t));
  }
  if (data.startsWith('alert:')) {
    const threshold = Number(data.slice(6)) || 0;
    state.alerts = { threshold, lastLevel: threshold ? state.alerts?.lastLevel ?? 0 : 0 };
    await saveChats();
    await tg('editMessageText', { ...alertsMenuPayload(chatId, state, t), message_id: query.message.message_id })
      .catch((error) => {
        if (!/message is not modified/.test(error.message)) throw error;
      });
    return tg('answerCallbackQuery', { callback_query_id: query.id, text: t.alertSet(alertLabel(t, threshold)) });
  }
  if (data === 'change') {
    await tg('answerCallbackQuery', { callback_query_id: query.id });
    return sendIntro(chatId, t);
  }
  if (data === 'refresh') {
    if (!state.place) {
      await tg('answerCallbackQuery', { callback_query_id: query.id });
      return sendIntro(chatId, t);
    }
    const payload = await statusPayload(chatId, state.place, t, locale);
    await tg('editMessageText', { ...payload, message_id: query.message.message_id }).catch((error) => {
      if (!/message is not modified/.test(error.message)) throw error;
    });
    return tg('answerCallbackQuery', { callback_query_id: query.id, text: t.refreshed });
  }
  if (data.startsWith('city:')) {
    const match = state.matches?.[Number(data.slice(5))];
    await tg('answerCallbackQuery', { callback_query_id: query.id });
    if (!match) return tg('sendMessage', { chat_id: chatId, text: t.expired });
    await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: query.message.message_id }).catch(() => {});
    return chooseCity(chatId, state, match, t, locale);
  }
  return tg('answerCallbackQuery', { callback_query_id: query.id });
}

async function handle(update) {
  const msg = update.message;
  const query = update.callback_query;
  try {
    if (msg) await handleMessage(msg);
    else if (query) await handleCallback(query);
  } catch (error) {
    console.error(`solar-status-bot: ${error.message}`);
    const chatId = msg?.chat?.id ?? query?.message?.chat?.id;
    if (chatId) {
      const t = T[langOf(msg?.from ?? query?.from)];
      await tg('sendMessage', { chat_id: chatId, text: t.unavailable }).catch(() => {});
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────

// `solar-status-bot --demo "City"` prints the rendered HTML for both
// locales and exits — a token-free check of the message builder and
// the alert trigger logic.
if (demoCity) {
  const { strict: assert } = await import('node:assert');
  assert.deepEqual(alertDecision(0, 1, 0), { notify: false, reset: true });
  assert.deepEqual(alertDecision(1, 1, 0), { notify: true, reset: false });
  assert.deepEqual(alertDecision(3, 3, 3), { notify: false, reset: false }); // no repeat while it lasts
  assert.deepEqual(alertDecision(4, 3, 3), { notify: true, reset: false }); // escalation re-alerts
  assert.deepEqual(alertDecision(2, 3, 3), { notify: false, reset: true }); // re-arm after the storm
  assert.deepEqual(alertDecision(5, 0, 0), { notify: false, reset: true }); // alerts off

  // Sun position: equator at equinox noon ≈ overhead; poles in solstice extremes.
  assert.ok(sunElevation(0, 0, new Date('2026-03-20T12:00:00Z')) > 80);
  assert.ok(sunElevation(90, 0, new Date('2026-06-21T12:00:00Z')) > 20);
  assert.ok(sunElevation(90, 0, new Date('2026-12-21T12:00:00Z')) < -20);
  console.log('alert + sun logic OK\n');

  const [match] = await geocode(demoCity);
  if (!match) {
    console.error(`solar-status-bot: no place found for "${demoCity}"`);
    process.exit(1);
  }
  const place = { name: match.name, label: cityLabel(match), latitude: match.latitude, longitude: match.longitude };
  const facts = buildFacts(await getData(), place);
  for (const locale of ['en', 'ru']) {
    console.log(`--- ${locale} ---\n${statusMessage(facts, place, T[locale], locale)}\n`);
  }
  process.exit(0);
}

const me = await tg('getMe');
await tg('setMyCommands', { commands: T.en.commands });
await tg('setMyCommands', { commands: T.ru.commands, language_code: 'ru' });
await loadChats();
console.log(`solar-status-bot ${VERSION} — polling as @${me.username} (Ctrl-C to stop)`);

const ALERT_CHECK_MS = 3 * 60 * 60 * 1000;
checkAlerts().catch((error) => console.error(`solar-status-bot: ${error.message}`));
setInterval(() => checkAlerts().catch((error) => console.error(`solar-status-bot: ${error.message}`)), ALERT_CHECK_MS);

let offset = 0;
while (true) {
  let updates = [];
  try {
    updates = await tg('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] });
  } catch (error) {
    console.error(`solar-status-bot: ${error.message}`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  for (const update of updates) {
    offset = update.update_id + 1;
    await handle(update);
  }
}
