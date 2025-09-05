const llog = require('learninglab-log');
const Airtable = require('airtable');
const OpenAI = require('openai');

const wait = (seconds) => new Promise(resolve => setTimeout(resolve, seconds * 1000));

/**
 * Fetch agents from the Airtable "Agents" table.
 * Expects each record to have:
 * - Name
 * - FramingPrompt
 * - ExtraInstructions
 * - Icon
 */
async function getAgents() {
  const base = new Airtable({ apiKey: process.env.AIRTABLE_API_TOKEN })
    .base(process.env.AIRTABLE_BKC_BASE_ID);

  return new Promise((resolve, reject) => {
    base('Agents').select({view: "ACTIVE"}).firstPage((err, records) => {
      if (err) return reject(err);
      const agents = records.map(record => ({
        name: record.get('Name'),
        framingPrompt: record.get('FramingPrompt'),
        extraInstructions: record.get('ExtraInstructions'),
        icon: record.get('Icon')
      }));
      llog.magenta("Agents loaded:", agents);
      resolve(agents);
    });
  });
}

/**
 * Get the previous N Slack messages for context.
 * @param {Object} client - Slack client.
 * @param {string} channel - Channel ID.
 * @param {string} latest - Timestamp of the latest message.
 * @param {number} count - Number of messages to retrieve.
 * @returns {Promise<Array>} Array of messages.
 */
async function getPreviousMessages(client, channel, latest, count = 20) {
  try {
    const history = await client.conversations.history({
      channel,
      latest,
      limit: count,
      inclusive: false
    });
    // Return messages in chronological order (oldest first)
    return history.messages.reverse();
  } catch (error) {
    console.error("Error fetching conversation history:", error);
    return [];
  }
}

/**
 * Process a single agent:
 *  - Build the prompt.
 *  - Call OpenAI.
 *  - Post the response to Slack.
 *
 * @param {Object} agent - The agent's configuration.
 * @param {Object} params - Contains Slack client and incoming message.
 * @param {string|null} lastBotResponse - The most recent bot response from a previous agent, if any.
 * @returns {Promise<string>} The AI's response text.
 */
async function processAgent(agent, { client, message }, lastBotResponse = null) {
  // Get previous 20 messages for context.
  const previousMessages = await getPreviousMessages(client, message.channel, message.ts, 20);
  const contextText = previousMessages
    .map(m => `${m.user || 'unknown'}: ${m.text}`)
    .join("\n");

  // Build the prompt including extra instructions, slack context, the original user message, and if available, the most recent bot response.
  let userPrompt = `\n\nThe following is an array of messages from Slack that give you the context for an ongoing conversation:\n${contextText}\n\n`;
  userPrompt += `The user’s original message is: ${message.text}`;
  if (lastBotResponse) {
    userPrompt += `\n\nThe most recent bot response was: ${lastBotResponse}`;
  }
  userPrompt += `\n\n---${agent.extraInstructions}. Please respond in normal text, not in JSON.`;

  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const response = await openai.chat.completions.create({
    model: "gpt-4",
    messages: [
      { role: "system", content: agent.framingPrompt },
      { role: "user", content: userPrompt }
    ],
    max_tokens: 3000,
  });

  const responseText = response.choices[0].message.content.trim();

  await client.chat.postMessage({
    channel: message.channel,
    text: responseText,
    thread_ts: message.thread_ts ? message.thread_ts : message.ts,
    username: agent.name || "Agent",
    icon_url: agent.icon
  });

  return responseText;
}

/**
 * Main module: loops through all agents and processes each.
 */
module.exports = async ({ client, message, say, event }) => {
  llog.cyan("Processing message with multiple agents");

  let agents;
  try {
    agents = await getAgents();
  } catch (error) {
    console.error("Error loading agents:", error);
    return;
  }

  // Variable to store the most recent bot's response.
  let lastBotResponse = null;

  // Loop through each agent and process.
  for (const agent of agents) {
    // Check that the agent has a valid name.
    if (!agent || !agent.name) {
      console.warn("Skipping agent due to missing name:", agent);
      continue;
    }
    try {
      llog.cyan(`Processing agent: ${agent.name}`);
      // Pass in the most recent bot response (if any) to include in the prompt.
      const response = await processAgent(agent, { client, message }, lastBotResponse);
      // Update lastBotResponse for the next agent.
      lastBotResponse = response;
      await wait(1); // Optional delay between agents.
    } catch (err) {
      console.error(`Error processing agent ${agent.name}:`, err);
    }
  }
};
