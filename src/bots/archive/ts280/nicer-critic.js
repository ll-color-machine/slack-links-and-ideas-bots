const llog = require('learninglab-log');
const OpenAI = require('openai');

const nicerCritic = async ({client, message, translationsToEvaluate, criticalText}) => {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });
    const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
            { role: "system", content: "You are a kind and supportive literary critic and translator" },
            { role: "user", content: `Please help the authors of the following translations response to the critic who attacked them. Take the critic's points seriously and retranslate the texts with the criticism in mind, but say something supportive too. Here is the original text: ${message.text}. ----- And here are the translations: ${translationsToEvaluate}.  ------- And, finally, here is the critic's argument: ${criticalText}.` }
        ],
        max_tokens: 5000,
    });

    const responseText = response.choices[0].message.content.trim();

    await client.chat.postMessage({
        channel: message.channel,
        text: responseText,
        thread_ts: message.thread_ts ? message.thread_ts : message.ts,
        username: "The Nicer Critic",
        icon_url: "https://files.slack.com/files-pri/T0HTW3H0V-F080SC82GCU/shiba.jpeg?pub_secret=a1cbba6a0f"
    });

    return responseText;

};

module.exports = nicerCritic;