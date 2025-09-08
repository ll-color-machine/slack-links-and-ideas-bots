const llog = require("learninglab-log");
const { processLinksFromMessage, messageHasLinks } = require("./processor");

/**
 * Main link-bot entry point
 * Handles link detection and processing from Slack messages
 */
async function handleMessage({ client, message, event }) {
  try {
    // Process links in the message
    if (messageHasLinks(message)) {
      llog.blue("🔗 Message contains links, processing...");
      const result = await processLinksFromMessage({ client, message });
      return result;
    }
    
    return { processedCount: 0, totalLinks: 0 };
  } catch (error) {
    llog.red(`Link bot error: ${error}`);
    return { processedCount: 0, totalLinks: 0, error: error.message };
  }
}

module.exports = {
  handleMessage,
  processLinksFromMessage,
  messageHasLinks,
};