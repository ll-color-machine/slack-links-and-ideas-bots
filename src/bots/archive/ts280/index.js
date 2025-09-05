const llog = require('learninglab-log');
const frenchTranslator = require('./french-translator');
const germanTranslator = require('./german-translator');
const japaneseTranslator = require('./japanese-translator');
const critic = require('./critic');
const nicerCritic = require('./nicer-critic');

const wait = (seconds) => new Promise(resolve => setTimeout(resolve, seconds*1000));

module.exports = async ({ client, message, say, event }) => {
    llog.cyan("got a message the day of the ts280 demo")
    const frenchResult = await frenchTranslator({ client, message, say, event });
    await wait(3);
    const germanResult = await germanTranslator({ client, message, say, event });
    await wait(3);
    const japaneseResult = await japaneseTranslator({ client, message, say, event });
    const criticResult = await critic({
        client: client,
        message: message,
        translationsToEvaluate: `Translations below:
        FRENCH TRANSLATION: ${frenchResult}
        GERMAN TRANSLATION: ${germanResult}
        JAPANESE TRANSLATION: ${japaneseResult}
        `
    })
    const nicerCriticResult = await nicerCritic({
        client: client,
        message: message,
        translationsToEvaluate: `Translations below:
        FRENCH TRANSLATION: ${frenchResult}
        GERMAN TRANSLATION: ${germanResult}
        JAPANESE TRANSLATION: ${japaneseResult}
        `,
        criticalText: criticResult
    })
}

