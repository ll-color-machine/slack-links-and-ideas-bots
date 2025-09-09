const llog = require("learninglab-log");

function extractLinksFromMessage(message) {
  const links = new Set();

  if (message.blocks) {
    message.blocks
      .flatMap((block) => block.elements || [])
      .flatMap((element) => element.elements || [])
      .filter((element) => element.type === "link")
      .forEach((link) => { if (link.url) links.add(link.url); });
  }

  if (message.text) {
    const urlRegex = /(https?:\/\/[^\s<>]+)/g;
    const matches = message.text.match(urlRegex);
    if (matches) {
      matches.forEach((url) => links.add(url.replace(/^<|>$/g, "")));
    }
  }

  return Array.from(links);
}

function isValidUrl(url) {
  try {
    const u = new URL(url);
    const skipDomains = ["slack.com", "slack-files.com"]; // non-content
    return !skipDomains.some((d) => u.hostname.includes(d));
  } catch {
    return false;
  }
}

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

async function addReaction(client, emojiName, channel, timestamp) {
  try {
    await client.reactions.add({ name: emojiName, channel, timestamp });
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

