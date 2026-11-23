# Xeneon-Widgets

Custom iCUE widgets for the Corsair XENEON EDGE.

| Widget | Description |
| --- | --- |
| [f1-tracker](f1-tracker/) | Countdown to the next F1 race and driver and constructor championship standings |
| [badminton-tracker](badminton-tracker/) | BWF World Tour matches for today and tomorrow with results, seeds and a nationality filter, plus a list of ongoing and upcoming tournaments |
| [spotify](spotify/) | XE Player for Spotify: playback controller with album art, seek, volume, shuffle and repeat, plus a queue view of the next 5 songs. Supports Small and Medium sizes.
| [sports-tracker](sports-tracker/) | XE Sports Tracker: the F1 tracker and Badminton tracker in one widget. Switch sport manually, or let it rotate to the next enabled sport after 30 seconds without touch input. Each sport can be turned on or off in the settings |

## Install

Go to releases. Download .icuewidget file. Import in iCUE

- [Badminton Tracker v1.1.0](https://github.com/AlexKipping/Alex-Xeneon-Edge-Widgets/releases/tag/badminton-tracker-v1.1.0)
- [F1 Tracker v1.1.0](https://github.com/AlexKipping/Alex-Xeneon-Edge-Widgets/releases/tag/f1-tracker-v1.1.0)
- [XE Player for Spotify v1.0.0](https://github.com/AlexKipping/Alex-Xeneon-Edge-Widgets/releases/tag/XE-Player-for-Spotify-v1.0.0)
- [XE Sports Tracker v1.0.0](https://github.com/AlexKipping/Alex-Xeneon-Edge-Widgets/releases/tag/XE-Sports-Tracker-v1.0.0)

## Badminton Tracker setup

Download the widget from the [Badminton Tracker v1.1.0 release](https://github.com/AlexKipping/Alex-Xeneon-Edge-Widgets/releases/tag/badminton-tracker-v1.1.0). It needs a free [Parse.bot](https://parse.bot) account, because it reads BWF data through the Parse.bot BWF Badminton API.

1. Create a Parse.bot account and copy your API key.
2. Import the widget in iCUE and paste the key into the widget setting **Parse.bot API key** (under Data).
3. Optionally pick a nationality filter, how often the widget refreshes, and whether to turn on **Refresh optimise**.

The free Parse.bot tier includes 200 credits per month and 5 requests per minute, and each API call costs 1 credit. To stay within that, the widget caches responses and only refreshes automatically from the day before a tournament starts until its last day. Tournaments that have not started yet are fetched at most every 12 hours. The refresh button always fetches new data. The footer shows how many API calls the widget has made this month.

**Refresh optimise** cuts usage further when a nationality is selected. The widget stops refreshing while none of that country's matches are active and refreshes at each match's start time, then at the normal interval while a match is on. If no match is known, it checks again after midnight. It does nothing when the filter is set to All. Match times are read as the device's local time.

The data is scraped from bwfbadminton.com, so it is unofficial and shows no live scores.

## XE Player for Spotify setup

This is an unofficial widget and is not affiliated with or endorsed by Spotify. Requires Spotify Premium. The widget talks to the Spotify Web API directly using OAuth with PKCE, so each user creates their own Spotify app.

1. Open the [setup page](https://alexkipping.github.io/Alex-Xeneon-Edge-Widgets/spotify/) and follow the steps to create a Spotify app and generate a Client ID and refresh token.
2. Import the widget in iCUE and paste the Client ID and refresh token into its settings.

The widget is based on [Cxeify](https://github.com/AlexSch95/cxeify-widget) by AlexSch95, expanded to fit my needs and wishes. Used under the MIT license (see [spotify/LICENSE](spotify/LICENSE)).

## XE Sports Tracker

Combines the F1 tracker and the Badminton tracker. A sport switcher sits at the left of the header and the active sport's own tabs at the right. After the inactivity time (default 30 s, adjustable 10 to 300 s) with no touch, click, scroll or key input, the widget moves to the next enabled sport and keeps rotating until someone interacts again. The rotation can be turned off, and it is skipped when only one sport is enabled. A disabled sport makes no network requests, so the Parse.bot API key is only used while Badminton is enabled.

All settings sit in one General group: start sport, rotation, text color, one Show switch per sport, then each sport's own settings with a sport prefix. Badminton nationality is a dropdown. See the Badminton tracker section above for the Parse.bot key.

### Adding a sport

1. Create `scripts/sports/<id>.js` that wraps its code in an IIFE and ends with `Sports.register({ id, label, enabledProp, accentProp, defaultAccent, controls, start, applyProps, onShow })` (see `scripts/core.js` for what each field does).
2. In `index.html` add a `<section class="sport" id="sport-<id>">` whose first child is the sport's controls element (tabs, buttons), prefix every element id with the sport's short name, and add the script tag before `scripts/app.js`.
3. Add `styles/<id>.css` with every selector scoped under `#sport-<id>`, and link it.
4. Add the `enable<Sport>` switch, the sport's own settings (labels prefixed with the sport name) to the iCUE meta block and the General group in `index.html`, add the sport to the `startSport` values, and add the new labels to `translation.json`.
