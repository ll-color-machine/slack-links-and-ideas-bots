const llog = require('learninglab-log');
const OpenAI = require('openai');

const japaneseTranslator = async ({client, message}) => {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
    const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
            { role: "system", content: "You are a translator." },
            { role: "user", content: `Please translate the following to Japanese:  ${message.text}` }
        ],
        max_tokens: 3000,
    });

    const responseText = response.choices[0].message.content.trim();

    await client.chat.postMessage({
        channel: message.channel,
        text: responseText,
        thread_ts: message.thread_ts ? message.thread_ts : message.ts,
        username: "Japanese Translator",
        icon_url: "https://files.slack.com/files-pri/T0HTW3H0V-F080S9TMEJ0/kawakami-mieko_kein-copyright-1440x1440.jpg?pub_secret=b56553bca8"
    });
    return(responseText);

};

module.exports = japaneseTranslator;