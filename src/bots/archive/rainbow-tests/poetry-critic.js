const llog = require('learninglab-log');
const OpenAI = require('openai');

const poetryCritic = async ({client, message, poemToCritique}) => {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
    const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
            { role: "system", content: "You are a Literary Critic who writes for the New Yorker in addition to being a Professor at Harvard." },
            { role: "user", content: `Please critique the following poem: ${poemToCritique}. It was written in response to this slack message: ${message.text}` }
        ],
        max_tokens: 5000,
    });

    const responseText = response.choices[0].message.content.trim();

    await client.chat.postMessage({
        channel: message.channel,
        text: responseText,
        thread_ts: message.thread_ts ? message.thread_ts : message.ts,
        username: "Poetry Critic",
        icon_url: "https://files.slack.com/files-pri/T0HTW3H0V-F0812GX8CCR/susan_sontag_1979___lynn_gilbert__headshot_.jpg?pub_secret=93f38fff22"
    });

    return responseText;

};

module.exports = poetryCritic;