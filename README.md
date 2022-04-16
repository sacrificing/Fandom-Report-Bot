![MasterHead](https://media.discordapp.net/attachments/956749954322407474/964963709179015188/image.png?width=1440&height=432)
# Fandom Reported Posts Bot
This JS bot fetches new reported posts from a Fandom wiki, and then sends them to a Discord channel. Just something I recreated.

## Installation
Make sure to use Repl.it for this bot.
To install the required packages, run:
```console
$ npm install
```

## Configuration
The configuration is set using environment variables. Store the variable in a `.env` file in the same directory that you used for Repl.it.
* `FANDOM_USERNAME` - Fandom account username
* `FANDOM_PASSWORD` - Fandom account password
* `FANDOM_WIKI` - Interwiki to the Fandom wiki (e.g. `test` or `fr.test`)
* `FANDOM_DOMAIN` - Domain for the wiki and Fandom services (optional, defaults to `fandom.com`)
* `WEBHOOK_ID` - Discord webhook ID (number)
* `WEBHOOK_TOKEN` - Discord webhook token
* `INTERVAL` - Amount of time in seconds between checks (optional, defaults to `30`)

## Running
To run the bot after having it configured, use these commands shown below:
```console
$ npm start
```
