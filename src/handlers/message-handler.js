const llog = require('learninglab-log');
const ts280 = require('../bots/archive/ts280/index');
const rainbowTests = require('../bots/archive/rainbow-tests/index');
const bkc = require('../bots/archive/bkc-bots');
const payloadLogger = require('../utils/payload-logger');
const { upsertSlackMessage } = require('../utils/save-slack-message');
const firecrawlBot = require('../bots/firecrawl-bot');

const isBotMessage = (message) => {
    return message.subtype === "bot_message";
};

const isInSubthread = (message) => {
    return message.thread_ts && message.thread_ts !== message.ts;
};

exports.parseAll = async ({ client, message, say, event }) => {
    await payloadLogger.logMessage(message, 'parseAll');
    // Save every message to Airtable (includes subthreads and bot messages)
    upsertSlackMessage({ message, event }).catch(()=>{});

    // Optional: restrict active processing to a single links channel
    try {
        const linksChannelOnly = /^(1|true|yes|on)$/i.test(String(process.env.LINKS_CHANNEL_ONLY || 'false'));
        const linksChannel = String(process.env.SLACK_LINKS_CHANNEL || '').trim();
        if (linksChannelOnly && linksChannel && message.channel && message.channel !== linksChannel) {
            llog.gray({ links_channel_only_skip: { in: message.channel, allowed: linksChannel } });
            return; // still saved above; skip further processing
        }
    } catch (_) {}
    llog.cyan("slack links-and-ideas-bots receiving message...")

    // Check if the message is a bot message
    if (isBotMessage(message)) {
        llog.yellow("Skipped: Bot message detected");
        return;
    }

    // Check if the message is in a subthread
    if (isInSubthread(message)) {
        llog.magenta("Message is in a subthread");
        // We still saved it above; skip further processing if desired
        return;
    }

    // Process links in the message (runs in parallel with other processing)
    firecrawlBot.handleMessage({ client, message, event }).catch(error => {
        llog.red(`Link processing error: ${error}`);
    });

    llog.gray(message);
    if (message.text) {
        await bkc({ client, message, say, event });
    } else {
        llog.blue("message has no text")
    }
}
