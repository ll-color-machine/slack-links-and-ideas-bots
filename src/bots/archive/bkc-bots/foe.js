const llog = require('learninglab-log');
const OpenAI = require('openai');

const poet = async ({client, message}) => {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
    const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
            { role: "system", content: "You are a poet." },
            { role: "user", content: `Please write an 8 line poem in rhyming couplets of iambic pentameter inspired by this text from a Slack thread:  ${message.text}` }
        ],
        max_tokens: 3000,
    });

    const responseText = response.choices[0].message.content.trim();

    await client.chat.postMessage({
        channel: message.channel,
        text: responseText,
        thread_ts: message.thread_ts ? message.thread_ts : message.ts,
        username: "Poet",
        icon_url: "https://m.media-amazon.com/images/M/MV5BY2M0MWUxYWQtY2IyYS00YjA5LTllNmUtYTRiNzUxOTk2MjBlXkEyXkFqcGc@._V1_.jpg"
    });
    return(responseText);
};

module.exports = poet;