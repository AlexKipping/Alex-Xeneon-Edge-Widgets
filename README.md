# Xeneon-Widgets

Custom iCUE widgets for the Corsair XENEON EDGE.

| Widget | Description |
| --- | --- |
| [f1-tracker](f1-tracker/) | Countdown to the next F1 race and driver and constructor championship standings |
| [badminton-tracker](badminton-tracker/) | BWF World Tour matches for today and tomorrow with results, seeds and a nationality filter, plus a list of ongoing and upcoming tournaments |

## Install

Go to releases. Download .icuewidget file. Import in iCUE

- [Badminton Tracker v1.1.0](https://github.com/AlexKipping/Alex-Xeneon-Edge-Widgets/releases/tag/badminton-tracker-v1.1.0)
- [F1 Tracker v1.1.0](https://github.com/AlexKipping/Alex-Xeneon-Edge-Widgets/releases/tag/f1-tracker-v1.1.0)

## Badminton Tracker setup

Download the widget from the [Badminton Tracker v1.1.0 release](https://github.com/AlexKipping/Alex-Xeneon-Edge-Widgets/releases/tag/badminton-tracker-v1.1.0). It needs a free [Parse.bot](https://parse.bot) account, because it reads BWF data through the Parse.bot BWF Badminton API.

1. Create a Parse.bot account and copy your API key.
2. Import the widget in iCUE and paste the key into the widget setting **Parse.bot API key** (under Data).
3. Optionally pick a nationality filter, how often the widget refreshes, and whether to turn on **Refresh optimise**.

The free Parse.bot tier includes 200 credits per month and 5 requests per minute, and each API call costs 1 credit. To stay within that, the widget caches responses and only refreshes automatically from the day before a tournament starts until its last day. Tournaments that have not started yet are fetched at most every 12 hours. The refresh button always fetches new data. The footer shows how many API calls the widget has made this month.

**Refresh optimise** cuts usage further when a nationality is selected. The widget stops refreshing while none of that country's matches are active and refreshes at each match's start time, then at the normal interval while a match is on. If no match is known, it checks again after midnight. It does nothing when the filter is set to All. Match times are read as the device's local time.

The data is scraped from bwfbadminton.com, so it is unofficial and shows no live scores.
