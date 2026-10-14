# Xeneon-Widgets

Custom iCUE widgets for the Corsair XENEON EDGE.

| Widget | Description |
| --- | --- |
| [f1-tracker](f1-tracker/) | Countdown to the next F1 race and driver and constructor championship standings |
| [badminton-tracker](badminton-tracker/) | BWF World Tour matches for today and tomorrow with results, seeds and a nationality filter, plus a list of ongoing and upcoming tournaments |

## Install

Go to releases. Download .icuewidget file. Import in iCUE

## Badminton Tracker setup

The Badminton Tracker needs a free [Parse.bot](https://parse.bot) account, because it reads BWF data through the Parse.bot BWF Badminton API.

1. Create a Parse.bot account and copy your API key.
2. Import the widget in iCUE and paste the key into the widget setting **Parse.bot API key** (under Data).
3. Optionally pick a nationality filter and how often the widget refreshes.

The free Parse.bot tier includes 200 credits per month and 5 requests per minute, and each API call costs 1 credit. To stay within that, the widget caches responses and only refreshes automatically from the day before a tournament starts until its last day. The refresh button always fetches new data. The footer shows how many API calls the widget has made this month. The data is scraped from bwfbadminton.com, so it is unofficial and shows no live scores.
