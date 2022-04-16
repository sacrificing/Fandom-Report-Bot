# Fandom Reported Posts Bot
This JS bot fetches new reported posts from a Fandom wiki, and then sends them to a Discord channel. Just something I recreated.

## Installation
Make sure to use Repl.it for this bot.
'''To install the required packages, run:'''
```console
$ npm install
```

## Configuration
Configuration is set using environment variables. You can also store them in a `.env` file in the same directory.
* `FANDOM_USERNAME` - Fandom account username
* `FANDOM_PASSWORD` - Fandom account password
* `FANDOM_WIKI` - Interwiki to the Fandom wiki (e.g. `test` or `fr.test`)
* `FANDOM_DOMAIN` - Domain for the wiki and Fandom services (optional, defaults to `fandom.com`)
* `WEBHOOK_ID` - Discord webhook ID (number)
* `WEBHOOK_TOKEN` - Discord webhook token
* `INTERVAL` - Amount of time in seconds between checks (optional, defaults to `30`)

## Running
To run the bot after having it configured, use:
```console
$ npm start
```
