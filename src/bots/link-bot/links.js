const llog = require("learninglab-log");

/**
 * Extract URLs from Slack message blocks and text
 */
function extractLinksFromMessage(message) {
  const links = new Set();
  
  // Extract from blocks (rich formatting)
  if (message.blocks) {
    message.blocks
      .flatMap(block => block.elements || [])
      .flatMap(element => element.elements || [])
      .filter(element => element.type === "link")
      .forEach(link => {
        if (link.url) {
          links.add(link.url);
        }
      });
  }
  
  // Extract from plain text using regex
  if (message.text) {
    const urlRegex = /(https?:\/\/[^\s<>]+)/g;
    const matches = message.text.match(urlRegex);
    if (matches) {
      matches.forEach(url => {
        // Clean up Slack's URL formatting (remove < > wrappers)
        const cleanUrl = url.replace(/^<|>$/g, '');
        links.add(cleanUrl);
      });
    }
  }
  
  return Array.from(links);
}

/**
 * Validate and filter URLs
 */
function isValidUrl(url) {
  try {
    const urlObj = new URL(url);
    // Skip common non-content URLs
    const skipDomains = ['slack.com', 'slack-files.com'];
    return !skipDomains.some(domain => urlObj.hostname.includes(domain));
  } catch {
    return false;
  }
}

/**
 * Generate number emoji for reaction count
 */
function numberEmoji(number) {
  const numberWords = {
    0: "zero",
    1: "one", 
    2: "two",
    3: "three",
    4: "four",
    5: "five",
    6: "six", 
    7: "seven",
    8: "eight",
    9: "nine",
    10: "keycap_ten",
  };
  
  if (number > 10) return "keycap_ten";
  return numberWords[number] || "question";
}

/**
 * Add reaction to Slack message
 */
async function addReaction(client, emojiName, channel, timestamp) {
  try {
    await client.reactions.add({
      name: emojiName,
      channel: channel,
      timestamp: timestamp,
    });
  } catch (error) {
    llog.gray(`Could not add reaction ${emojiName}: ${error.data?.error || error}`);
  }
}

module.exports = {
  extractLinksFromMessage,
  isValidUrl,
  numberEmoji,
  addReaction,
};