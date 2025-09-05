const llog = require('learninglab-log');
const ts280 = require('../bots/archive/ts280/index');
const rainbowTests = require('../bots/archive/rainbow-tests/index');
const bkc = require('../bots/archive/bkc-bots')

const isBotMessage = (message) => {
    return message.subtype === "bot_message";
};

const isInSubthread = (message) => {
    return message.thread_ts && message.thread_ts !== message.ts;
};

exports.parseAll = async ({ client, message, say, event }) => {
    llog.cyan("got a message the day of the rainbow tests")

        // Check if the message is a bot message
    // if (isBotMessage(message)) {
    //     llog.yellow("Skipped: Bot message detected");
    //     return;
    // }

    // Check if the message is in a subthread
    if (isInSubthread(message)) {
        llog.magenta("Message is in a subthread");
        // Add specific logic for subthread messages here if needed
        return;
    }



    llog.gray(message);
    if (message.text) {
        const result = await bkc({ client, message, say, event })
    } else {
        llog.blue("message has no text")
    }
}

