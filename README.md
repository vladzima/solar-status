# solar-status

Terminal dashboard for solar activity where *you* live — current NOAA storm
scales, Kp index with 24-hour sparkline, 3-day forecast, aurora odds, what it
means for the tech around you, and how the storm may make you feel.

Zero dependencies, no API key. Data comes straight from the
[NOAA Space Weather Prediction Center](https://www.swpc.noaa.gov/) and
[Open-Meteo geocoding](https://open-meteo.com/en/docs/geocoding-api).

![solar-status showing current solar activity for San Francisco](https://raw.githubusercontent.com/vladzima/solar-status/main/screenshot.png)

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
