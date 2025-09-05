const llog = require('learninglab-log');
const OpenAI = require('openai');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

// Helper function to download Slack file
async function downloadSlackImage(fileUrl, fileName, token) {
    try {
        const response = await axios.get(fileUrl, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
            responseType: 'arraybuffer', // Download the file as a binary buffer
        });

        const filePath = path.join(global.ROOT_DIR, "_temp", fileName); // Save the file locally
        await fs.writeFile(filePath, response.data);
        llog.green(`Image downloaded successfully: ${filePath}`);
        return filePath;
    } catch (error) {
        llog.red(`Failed to download image: ${error}`);
    }
}

// Helper function to encode image to base64
async function encodeImage(imagePath) {
    const imageBuffer = await fs.readFile(imagePath);
    return imageBuffer.toString('base64');
}

// Helper function to remove image after processing
async function removeImage(imagePath) {
    try {
        await fs.unlink(imagePath); // Remove the file
        llog.green(`Image removed successfully: ${imagePath}`);
    } catch (error) {
        llog.red(`Failed to remove image: ${error}`);
    }
}

async function getLast30Messages({ client, channel }) {
    try {
        const result = await client.conversations.history({
            channel: channel,
            limit: 30, // Get the last 30 messages
        });

        const messages = result.messages;

        // Display messages
        messages.forEach((msg, index) => {
            console.log(`${index + 1}: ${msg.text} (Timestamp: ${msg.ts})`);
        });
        return messages;
    } catch (error) {
        console.error('Error fetching messages:', error);
    }
}

const multiStepTranslator = async ({ client, message, say, event }) => {
    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    llog.magenta("logging all messages");
    llog.gray(message);

    // If the message has files
    if (message.files && message.files.length > 0) {
        llog.blue("Message has files");

        // Process each file (assuming only image files here for simplicity)
        for (const file of message.files) {
            if (file.mimetype.startsWith("image/")) {
                // Download the image from Slack
                const slackToken = process.env.SLACK_USER_TOKEN;
                const filePath = await downloadSlackImage(file.url_private_download, file.name, slackToken);

                if (filePath) {
                    // Base64 encode the downloaded image
                    const base64Image = await encodeImage(filePath);

                    // Send the image to OpenAI for description
                    const response = await openai.chat.completions.create({
                        model: "gpt-4o",
                        messages: [
                          { role: "system", content: "You are an image analyst." },
                          {
                            role: "user",
                            content: [


                            //   ################################################################################################################################################
                            //   ################################################################################################################################################
                            //   ################################################################################################################################################
                            //   ################################################################################################################################################
                            //   CHANGE THE LINE BELOW TO TWEAK THE IMAGE PROMPT
                            //   ################################################################################################################################################
                            //   ################################################################################################################################################
                            //   ################################################################################################################################################
                            //   ################################################################################################################################################

                              { type: "text", text: "This is an image of a storyboard from a film or else a scene from the film. If there are index cards with notes, you have the storyboard. Please imagine a good title for this film and write a Netflix promo for the film---just return the title in bold and then the description" },
                              {
                                type: "image_url", 
                                image_url: {
                                  "url": `data:image/jpeg;base64,${base64Image}`,
                                },
                              },
                            ],
                          },
                        ],
                        max_tokens: 500,
                    });

                    const responseText = response.choices[0].message.content.trim();

                    await client.chat.postMessage({
                        channel: message.channel,
                        text: responseText,
                        thread_ts: message.thread_ts ? message.thread_ts : message.ts,
                         //   ################################################################################################################################################
                        //   ################################################################################################################################################
                        //   ################################################################################################################################################
                        //   ################################################################################################################################################
                        //   CHANGE THE LINE BELOW TO CHANGE THE NAME OF THE IMAGE HANDLING BOT
                        //   ################################################################################################################################################
                        //   ################################################################################################################################################
                        //   ################################################################################################################################################
                        //   ################################################################################################################################################
                        username: "Netflix Promo",
                        icon_url: "https://cdn4.iconfinder.com/data/icons/logos-and-brands/512/227_Netflix_logo-1024.png"
                    });
                    await removeImage(filePath)
                    return; // Exit after processing the image
                }
            }
        }
    }

    // If no files, continue with text processing
    const messages = await getLast30Messages({ client: client, channel: message.channel });
    const messageText = messages.map(msg => ({
        text: msg.text,
        username: msg.username || msg.user, // Use username if exists, otherwise use user
    }));
    const response = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [


                        //   ################################################################################################################################################
                        //   ################################################################################################################################################
                        //   ################################################################################################################################################
                        //   ################################################################################################################################################
                        //   CHANGE THE LINES BELOW TO CHANGE THE BEHAVIOR OF THE FIRST BOT
                        //   ################################################################################################################################################
                        //   ################################################################################################################################################
                        //   ################################################################################################################################################
                        //   ################################################################################################################################################


            { role: "system", content: "You are a dramaturge ." },
            { role: "user", content: `You are a dramaturge assisting in the production of a play about the lives of students at an Ivy League college. Your role is to provide rich, research-based insights into the academic and social dynamics of such a setting to ensure that the portrayal is authentic and nuanced. Begin by researching the cultural characteristics of Ivy League institutions, such as academic rigor, campus traditions, and social structures. Look into issues that are relevant to contemporary students, such as mental health, academic pressure, privilege, and diversity, and gather anecdotes or common challenges students face in such an environment.
            As you prepare materials for the creative team, suggest ways to incorporate authentic details into character dialogue, relationships, and motivations. Consider how status, reputation, and family expectations might influence each character’s behavior. Offer guidance on specific set and costume elements to reflect the unique architectural styles, symbols, and student rituals of Ivy League campuses. Create a glossary of common terms, phrases, and campus-specific jargon, and recommend resources that help bring the world of the play to life for both actors and audiences.: ${JSON.stringify(messageText)}. Please reply with what you would say to the creative team, giving special attention to the new message, which is ${message.text}` }
        ],
        max_tokens: 1000,
    });

    const responseText = response.choices[0].message.content.trim();

    await client.chat.postMessage({
        channel: message.channel,
        text: responseText,
        thread_ts: message.thread_ts ? message.thread_ts : message.ts,
        username: "Dramaturge",
        icon_url: "https://files.slack.com/files-pri/T0HTW3H0V-F080549S6QP/shak_bot-2.jpg?pub_secret=41e098d05f"
    });

    const scriptWriterResponse = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [

                        //   ################################################################################################################################################
                        //   ################################################################################################################################################
                        //   ################################################################################################################################################
                        //   ################################################################################################################################################
                        //   CHANGE THE LINES BELOW TO CHANGE THE BEHAVIOR OF THE SECOND BOT
                        //   ################################################################################################################################################
                        //   ################################################################################################################################################
                        //   ################################################################################################################################################
                        //   ################################################################################################################################################


            { role: "system", content: "You are a playwright working from materials provided to you by a dramaturge along with dialogue between students and bots." },
            { role: "user", content: `You are a playwright tasked with rewriting a scene for a play set at an Ivy League college, using both the insights provided by the dramaturge (${responseText}) and the existing dialogue or narrative structure (${JSON.stringify(messageText)}).

            Review the following stream of Slack messages carefully to understand the characters, their dynamics, and the key themes that need to be enhanced. Then, using ${responseText} as a guide, rewrite the scene to deepen the portrayal of Ivy League student life, reflecting themes such as academic pressure, privilege, and identity struggles. Make sure the dialogue is authentic to an Ivy League setting, incorporating specific campus jargon, references to traditions, and other sensory details that reveal the unique culture and atmosphere of an elite college.

            As you rewrite, pay attention to moments where character actions or dialogue can reveal economic or social differences subtly, aligning with the dramaturge’s recommendations. Aim to bring out layers of ambition, vulnerability, and self-doubt in a way that feels true to each character and their background. Your goal is to create a scene that feels grounded in both the dramaturgical research and the existing story arc from ${JSON.stringify(messageText)}. Be sure to make the most recent message central to the narrative: ${message.text}` }
        ],
        max_tokens: 1000,
    });

    await client.chat.postMessage({
        channel: message.channel,
        text: scriptWriterResponse.choices[0].message.content.trim(),
        thread_ts: message.thread_ts ? message.thread_ts : message.ts,
        username: "Playwright",
        icon_url: "https://files.slack.com/files-pri/T0HTW3H0V-F080549JYJ3/shak_bot-1.jpg?pub_secret=6ac1c276d9"
    });
}





module.exports = multiStepTranslator