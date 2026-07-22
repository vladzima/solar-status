# solar-status

Terminal dashboard for solar activity where *you* live — current NOAA storm
scales, Kp index with 24-hour sparkline, 3-day forecast, aurora odds, what it
means for the tech around you, and how the storm may make you feel.

Zero dependencies, no API key. Data comes straight from the
[NOAA Space Weather Prediction Center](https://www.swpc.noaa.gov/) and
[Open-Meteo geocoding](https://open-meteo.com/en/docs/geocoding-api).

<img src="https://raw.githubusercontent.com/vladzima/solar-status/main/screenshot.png" alt="solar-status showing current solar activity for San Francisco" width="620">

## Usage

```sh
npx solar-status
```

On first run it asks for your city and lets you pick the right one (there are
at least four Moscows). The choice is saved; change it anytime:

```sh
solar-status --city "Moscow"
```

Or install globally:

```sh
npm install -g solar-status
```

## Options

| Flag | Effect |
|------|--------|
| `--city "Name"` | Change the saved city (prompts if ambiguous) |
| `--watch 300` | Refresh every N seconds (minimum 60) |
| `--json` | Machine-readable output |
| `--no-color` | Disable ANSI colors |
| `--version` | Print version |
| `--help` | Show help |

Config lives at `~/.config/solar-status/config.json`; last successful NOAA
responses are cached at `~/.cache/solar-status.json` so the tool degrades
gracefully offline.

## Telegram bot

The same dashboard as a Telegram bot — try it live at
[@solar_status_tgbot](https://t.me/solar_status_tgbot), or run your own,
still zero dependencies:

```sh
TELEGRAM_BOT_TOKEN="123:abc" solar-status-bot
```

Create a bot with [@BotFather](https://t.me/BotFather) to get a token. The bot
asks for a shared location or a typed city name, replies with rich HTML
messages (expandable health notes, inline refresh button), and answers in
Russian when the sender's Telegram language is Russian, English otherwise.

`/alerts` lets a user opt into storm notifications — any storm (G1+) or
strong only (G3+), off by default. The bot checks NOAA every 3 hours and
messages subscribers when activity reaches their level (current or 3-day
forecast), once per storm rather than daily; a user who blocks the bot is
opted out automatically. Chat state lives in
`~/.config/solar-status/bot-chats.json`.
Preview the message formatting without a token: `solar-status-bot --demo "Oslo"`.

## What the letters mean

NOAA scales, each 0 (quiet) to 5 (extreme):

- **G** — geomagnetic storms: power grids, GPS precision, aurora
- **R** — radio blackouts: HF/shortwave radio (not cellular or Wi-Fi)
- **S** — solar radiation storms: satellites, astronauts, polar flights

## About the health section

The "how it may feel" section reports what people commonly self-report during
storms (sleep disturbance, headaches, fatigue). The scientific evidence for
these effects is mixed and inconclusive — the tool says so rather than
pretending otherwise. One thing is certain: ground-level radiation does **not**
increase during geomagnetic storms. This is not medical advice.

## Requirements

Node.js 18+.

## License

MIT
