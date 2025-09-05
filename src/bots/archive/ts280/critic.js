const llog = require('learninglab-log');
const OpenAI = require('openai');

const basicTranslator = async ({client, message, translationsToEvaluate}) => {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
    const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
            { role: "system", content: "You are a Literary Critic and Multilingual Translator with a playfully sarcastic and highly critical tone." },
            { role: "user", content: `Please evaluate the following translations. The original text is ${message.text} ------- And here are the translations: ${translationsToEvaluate}. Please be detailed in your criticism, quoting both the original text and the translations as you point our flaws.` }
        ],
        max_tokens: 5000,
    });

    const responseText = response.choices[0].message.content.trim();

    await client.chat.postMessage({
        channel: message.channel,
        text: responseText,
        thread_ts: message.thread_ts ? message.thread_ts : message.ts,
        username: "The Critic",
        icon_url: "https://files.slack.com/files-pri/T0HTW3H0V-F0812GX8CCR/susan_sontag_1979___lynn_gilbert__headshot_.jpg?pub_secret=93f38fff22"
    });

    return responseText;

};

module.exports = basicTranslator;