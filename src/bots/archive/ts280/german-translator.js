const llog = require('learninglab-log');
const OpenAI = require('openai');

const germanTranslator = async ({client, message}) => {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
    const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
            { role: "system", content: "You are a translator." },
            { role: "user", content: `Please translate the following to German:  ${message.text}` }
        ],
        max_tokens: 3000,
    });

    const responseText = response.choices[0].message.content.trim();

    await client.chat.postMessage({
        channel: message.channel,
        text: responseText,
        thread_ts: message.thread_ts ? message.thread_ts : message.ts,
        username: "German Translator",
        icon_url: "https://files.slack.com/files-pri/T0HTW3H0V-F080SAV0J0L/220px-wittgenstein2.jpg?pub_secret=ea67022d63"
    });

    return(responseText)

};

module.exports = germanTranslator;