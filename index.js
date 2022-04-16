import fs from 'fs/promises'
import process from 'process'
import got from 'got'
import { CookieJar } from 'tough-cookie'
import { WebhookClient, MessageEmbed } from 'discord.js'

import { createRequire } from 'module';
const require = createRequire(import.meta.url);

require('dotenv').config();

/**
 * @classdesc Main class for the bot
 * 
 * @property {object} config - Configuration provided by the user, including secrets
 * @property {WebhookClient} webhook - Discord webhook client
 * @property {Got} api - Client for Fandom APIs, with stored cookies from [logging in]{@link ReportedPostsBot#fandomLogin}
 * @property {Set} cache - Reported posts that have already been sent
 * @property {NodeJS.Timeout} interval - [Polling function]{@link ReportedPostsBot#poll} interval
 */
class ReportedPostsBot {
	/**
	 * Initializes the Discord webhook, API client, and cache
	 */
	constructor() {
		this.config = {
			devMode: process.env.ENVIRONMENT?.toLowerCase()?.startsWith('dev') || false,
			webhook: {
				id: process.env.WEBHOOK_ID || null,
				token: process.env.WEBHOOK_TOKEN || null
			},
			fandom: {
				wiki: process.env.FANDOM_WIKI || null,
				domain: process.env.FANDOM_DOMAIN || 'fandom.com',
				username: process.env.FANDOM_USERNAME || null,
				password: process.env.FANDOM_PASSWORD || null
			},
			interval: (process.env.INTERVAL || 30) * 1000
		};

		if (this.config.devMode && process.env.DEV_WEBHOOK_ID && process.env.DEV_WEBHOOK_TOKEN) {
			this.config.webhook = {
				id: process.env.DEV_WEBHOOK_ID,
				token: process.env.DEV_WEBHOOK_TOKEN
			}
		}

		// Check for missing config
		if (Object.values(this.config).flat(1).includes(null)) {
			this.finish();
			throw console.error('Missing required config variable(s)');
		}

		// Discord webhook
		this.webhook = new WebhookClient({
			id: this.config.webhook.id,
			token: this.config.webhook.token
		});

		// API client
		this.config.fandom.wikiUrl = this.getWikiUrl(this.config.fandom.wiki, this.config.fandom.domain);

		let pkg = require('./package.json');
		this.cookieJar = new CookieJar();
		this.api = got.extend({
			cookieJar: this.cookieJar,
			headers: {
				'User-Agent': `${pkg.name} v${pkg.version} (${pkg.homepage})`,
				'X-Fandom-Auth': 1
			}
		});

		// Cache
		this.cache = new Set();
		if (!this.config.devMode) {
			try {
				this.cache = new Set(require('./cache.json'));
				console.info('Loaded cache');
			} catch (err) {
				console.info('Didn\'t load cache');
			}
		}
	}

	/**
	 * Logs into Fandom in the API client
	 * @returns {Promise} - API response or error
	 */
	async fandomLogin() {
		return new Promise(async (resolve, reject) => {
			try {
				let response = await this.api.post(`https://services.${this.config.fandom.domain}/mobile-fandom-app/fandom-auth/login`, {
					form: {
						username: this.config.fandom.username,
						password: this.config.fandom.password
					}
				}).json();

				// Set auth cookie
				const expiry = new Date();
				expiry.setFullYear(expiry.getFullYear() + 100);
				await this.cookieJar.setCookie(`access_token=${response.access_token}; Domain=fandom.com; Path=/; Expires=${expiry.toUTCString()}; Max-Age=15552000; Secure; HttpOnly; Version=1`, 'https://fandom.com/');

				// Test that login worked
				let whoami = await this.api.get('https://services.fandom.com/whoami').json();

				console.info(`Logged into Fandom as ID ${whoami.userId}`);
				resolve(response);
			} catch (err) {
				console.error('Failed to log in:', err.response.body);
				return await new Promise(resolve => setTimeout(async () => {
					resolve();
					return await this.fandomLogin();
				}, 10000))
			}
		});
	}

	/**
	 * Save this.cache to cache.json
	 */
	saveCache() {
		if (!this.config.devMode) fs.writeFile('cache.json', JSON.stringify(Array.from(this.cache)), () => {});
	}

	/**
	 * Utility to get a wiki URL from domain and interwiki
	 * @param {string} interwiki - Interwiki (subdomain or lang.subdomain)
	 * @param {string} domain - Root domain of the wiki and services (like fandom.com)
	 * @returns {string} - Root wiki URL
	 */
	getWikiUrl(interwiki, domain) {
		if (interwiki.includes('.')) {
			let [lang, subdomain] = interwiki.split('.');
			return `https://${subdomain}.${domain}/${lang}`;
		}
		return `https://${interwiki}.${domain}`;
	}

	/**
	 * Utility to trim a string to a length
	 * @param {string} text - Input text
	 * @param {number} length - Maximum length
	 * @param {string} [elipsis=…] - Text to use an an elipsis if trimmed
	 * @returns {string} - Trimmed string
	 */
	trimEllip(text, length, elipsis = '…') {
		text = text.trim(); // Remove whitespace padding
		return text.length > length ?
			text.substring(0, length - elipsis.length) + elipsis
			: text;
	}

	/** 
	 * Utility to kind of convert post ADF into plain text (good enough for a preview)
	 * @param {string} adf - ADF JSON
	 * @returns {string} - Plain text
	 */
	adfToText(adf) {
		let plainText = '';

		try {
			let json = JSON.parse(adf);

			for (let paragraph of json.content) {
				if (paragraph.type === 'paragraph') {
					let paragraphText = '';
					for (let content of paragraph.content) {
						if (content.text) {
							paragraphText += content.text;
						}
					}
					if (paragraphText) plainText += paragraphText + '\n';
				}
			}
		} catch (err) { }

		return plainText;
	}

	/**
	 * Initiator
	 */
	async run() {
		await this.fandomLogin();

		this.poll();
		this.interval = setInterval(
			this.poll.bind(this),
			this.config.interval
		);
	}

	/**
	 * Polling function
	 * 
	 * Queries the API for all reported posts and schedules them to be sent if not already sent
	 */
	async poll() {
		try {
			let response = await this.api.get(this.config.fandom.wikiUrl + '/wikia.php', {
				searchParams: {
					controller: 'DiscussionModeration',
					method: 'getReportedPosts',
					format: 'json',
					limit: 100,
					t: Date.now()
				}
			}).json();

			let embeds = [],
				pageIds = new Set([]),
				userIds = new Set([]);

			for (let post of response._embedded['doc:posts']) {
				if (!this.cache.has(post.id) && !post.isDeleted) {
					this.cache.add(post.id);

					// @todo support for anons
					let data = {
						title: post.title,
						body: this.adfToText(post.jsonModel) || post.rawContent,
						image: post._embedded?.contentImages?.[0]?.url,
						timestamp: post.creationDate.epochSecond * 1000,
						author: {
							name: post.createdBy.name,
							id: post.createdBy.id,
							avatar: post.createdBy.avatarUrl
						},
						postId: post.id,
						threadId: post.threadId,
						containerType: post._embedded.thread?.[0]?.containerType,
						containerId: post._embedded.thread?.[0]?.containerId,
						containerName: post.forumName,
						isReply: post.isReply,
						isLocked: post._embedded.thread?.[0]?.isLocked,
						poll: post.poll,
						quiz: post.quiz
					}

					if (data.containerType === 'ARTICLE_COMMENT') pageIds.add(data.containerId);
					if (data.containerType === 'WALL') {
						data.wallOwnerId = response._embedded.wallOwners?.find(wall => wall.wallContainerId === data.containerId).userId;
						userIds.add(data.wallOwnerId);
					}
					embeds.push(data);
				}
			}

			// Load article details
			if (pageIds || userIds) this.containerCache = (await this.api.get(this.config.fandom.wikiUrl + '/wikia.php', {
				searchParams: {
					controller: 'FeedsAndPosts',
					method: 'getArticleNamesAndUsernames',
					stablePageIds: Array.from(pageIds).join(','),
					userIds: Array.from(userIds).join(',')
				}
			}).json());

			// Split embeds into chunks of 10 and send them
			if (embeds.length) {
				// Show newest posts last
				embeds = embeds.reverse();
				// Create new arrays of 10 or less items and populate them
				[...Array(Math.ceil(embeds.length / 10))].map((_, i) => embeds.slice(i * 10, i * 10 + 10))
				// Generate and send embeds for each
				.map(list => {
					this.webhook.send({ embeds: list.map(data => this.generateEmbed(data)) });
				})
			};
			this.saveCache();
		} catch (err) {
			if (err.response?.statusCode === 403) this.fandomLogin();
			else console.error(err);
		}
	}

	/**
	 * Generates a Discord embed from collected post data
	 * @param {object} data - Collected post data
	 * @returns {MessageEmbed}
	 */
	generateEmbed(data) {
		let embed = new MessageEmbed()
			.setColor(0xE1390B)
			.setURL(this.getPostUrl(data))
			.setAuthor(
				this.trimEllip(data.author.name, 256),
				data.author.avatar,
				`${this.config.fandom.wikiUrl}/wiki/Special:UserProfileActivity/${data.author.name.replaceAll(' ', '_')}`
			)
			.setTimestamp(data.timestamp);
		
		if (data.title) {
			embed.setTitle(this.trimEllip(data.title, 256));
			embed.setDescription(this.trimEllip(data.body, 500));
		} else if (data.body) {
			embed.setTitle(this.trimEllip(data.body, 256));
		} else {
			embed.setTitle('(untitled)');
		}

		if (data.poll) {
			embed.addField('Poll', this.trimEllip(data.poll.answers.map(a => '• ' + a.text).join('\n'), 1024), true)
		}

		if (data.image) embed.setImage(data.image);

		let footer = '';

		if (data.isLocked) footer += '\uD83D\uDD12\uFE0E';
		if (data.isReply) footer += '↶';
		if (data.poll) footer += '\uD83D\uDCCA\uFE0E';
		if (data.quiz) footer += '\uD83D\uDD51\uFE0E';

		if (footer.length) footer += ' ';

		// @todo add container link? would require switching to fields
		switch (data.containerType) {
			case 'FORUM':
				footer += `Discussions • ${data.containerName}`; break;
			case 'ARTICLE_COMMENT':
				footer += `Article comment • ${this.containerCache.articleNames[data.containerId].title}`; break;
			case 'WALL':
				footer += `Message Wall • ${this.containerCache.userIds[data.wallOwnerId].username}`; break;
		}

		embed.setFooter(footer);

		return embed;
	}

	/**
	 * Get the URL to a post or it's container
	 * @param {object} data - Collected post data
	 * @param {boolean} getContainer - Get the post's container instead of the post itself (category for posts, article for comments, wall for messages)
	 * @returns {string} - URL to container
	 */
	getPostUrl(data, getContainer = false) {
		let url = new URL(this.config.fandom.wikiUrl + '/');

		switch (data.containerType) {
			case 'FORUM':
				if (getContainer) {
					url.pathname += 'f';
					url.searchParams.set('catid', data.containerId);
				} else {
					url.pathname += `f/p/${data.threadId}` + (data.isReply ? `/r/${data.postId}` : '');
				}
				break;
			case 'ARTICLE_COMMENT':
				url.pathname += this.containerCache.articleNames[data.containerId].relativeUrl;
				url.hash = 'articleComments';
				if (!getContainer) {
					url.searchParams.set('commentId', data.threadId);
					if (data.isReply) url.searchParams.set('replyId', data.postId);
				}
				break;
			case 'WALL':
				url.pathname += `wiki/Message_Wall:${this.containerCache.userIds[data.wallOwnerId].username.replaceAll(' ', '_')}`;
				if (!getContainer) {
					url.searchParams.set('threadId', data.threadId);
					if (data.isReply) url.hash = data.postId;
				}
				break;
		}

		return url.toString();
	}

	/**
	 * Cleans up the interval and client
	 * @param {string} [reason] - Reason for exiting
	 */
	finish() {
		console.info('Exiting...');
		if (this.interval) clearInterval(this.interval);
		this.webhook?.destroy();
	}
}

const myBot = new ReportedPostsBot();
myBot.run();
