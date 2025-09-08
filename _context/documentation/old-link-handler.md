# old link handler

```

const at = require("../../../utils/ll-airtable-tools");
const llog = require("learninglab-log");
const axios = require("axios");
const ogs = require("open-graph-scraper");
const mkUltraIcon = "";
const mkTaskBot = require("./mk-task-bot");

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
  if (number > 9) {
    return numberWords[10];
  }
  return numberWords[number] || null;
}

async function addReaction(client, emojiName, channel, timestamp) {
  try {
    await client.reactions.add({
      name: emojiName,
      channel: channel,
      timestamp: timestamp,
    });
  } catch (error) {
    console.error(`Could not add reaction ${emojiName}:`, error);
  }
}

async function linksToAirtable(client, message) {
  const links =
    message.blocks
      ?.flatMap((block) => block.elements ?? [])
      .flatMap((element) => element.elements ?? [])
      .filter((element) => element.type === "link")
      .map((link) => link.url) ?? [];
  let successCount = 0; // To keep track of the number of successfully added links
  for (const url of links) {
    try {
      const ogData = await fetchOpenGraphData(url);
      const linkRecord = formatLinkRecord(url, ogData, message.channel);
      await at.addRecord({
        table: "Links",
        baseId: process.env.AIRTABLE_MK_WORK_IN_PROGRESS_BASE,
        record: linkRecord,
      });
      successCount++; // Increment the count for each successful addition
    } catch (error) {
      llog.red(`Error fetching OpenGraph data for URL: ${url}`, error);
      // Here you could also accumulate errors if you need them later.
    }
  }
  await addReaction(
    client,
    numberEmoji(successCount),
    message.channel,
    message.ts,
  );
  return { successCount };
}

function formatSlackRecord(message) {
  return {
    SlackTs: message.ts,
    Json: JSON.stringify(message, null, 4),
    ChannelId: message.channel,
    Text: message.text,
  };
}

async function messageToAirtable(client, message) {
  let slackRecord = formatSlackRecord(message);
  let airtableResult = await at.addRecord({
    table: "Slacks",
    baseId: process.env.AIRTABLE_MK_WORK_IN_PROGRESS_BASE,
    record: slackRecord,
  });
  llog.cyan("airtable result:", airtableResult);
  // React to the original message with a rocket emoji to indicate it's been handled
  await addReaction(client, "rocket", message.channel, message.ts);
  return "success";
}

module.exports.handleMessage = async ({ client, message, say }) => {
  let initialResponse = await addReaction(
    client,
    "robot_face",
    message.channel,
    message.ts,
  );
  let atMessageResult = await messageToAirtable(client, message);
  let atLinksResult = await linksToAirtable(client, message);
  let mkTaskBotResult = await mkTaskBot({ client, message });
};

async function fetchOpenGraphData(url) {
  try {
    const ogData = await ogs({ url });
    llog.cyan(ogData.result); // Assuming llog.cyan was meant to log the result in cyan. Use console.log or any logger as per your setup.
    return ogData.result;
  } catch (error) {
    console.error(error); // Log the error or handle it as needed.
    return {}; // Return an empty object or any placeholder you deem appropriate.
  }
}

function formatLinkRecord(url, ogData, channelId) {
  const imageUrl = ogData.ogImage?.[0]?.url || "";
  return {
    LinkId: url,
    Title: ogData.ogTitle || "",
    Description: ogData.ogDescription || "",
    URL: url,
    ImageURL: imageUrl,
    ImageAttachment: imageUrl ? [{ url: imageUrl }] : [],
    OgData: JSON.stringify(ogData, null, 4),
    ChannelId: channelId,
  };
}

```