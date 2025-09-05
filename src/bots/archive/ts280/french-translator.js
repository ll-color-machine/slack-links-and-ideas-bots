const llog = require('learninglab-log');
const OpenAI = require('openai');

const basicTranslator = async ({client, message}) => {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
    const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
            { role: "system", content: "You are a translator." },
            { role: "user", content: `Please translate the following to French:  ${message.text}` }
        ],
        max_tokens: 3000,
    });

    const responseText = response.choices[0].message.content.trim();

    await client.chat.postMessage({
        channel: message.channel,
        text: responseText,
        thread_ts: message.thread_ts ? message.thread_ts : message.ts,
        username: "French Translator",
        icon_url: "https://www.miguelangelmartinez.net/local/cache-vignettes/L750xH726/arton235-88ad2.jpg"
    });
    return(responseText);
};

module.exports = basicTranslator;