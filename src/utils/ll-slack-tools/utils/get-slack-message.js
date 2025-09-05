const axios = require("axios");
const llog = require("learninglab-log");
const fs = require("fs");

const getSlackMessage = async ({ ts, channel }) => {
  try {
    const response = await axios.get(
      "https://slack.com/api/conversations.history",
      {
        headers: {
          Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        },
        params: {
          channel: channel, // Replace with your channel ID
          latest: ts,
          limit: 1,
          inclusive: true,
        },
      },
    );

    if (response.data.ok) {
      llog.cyan(response.data);
      return response.data.messages[0];
    } else {
      throw new Error(response.data.error);
    }
  } catch (error) {
    throw new Error(`Failed to retrieve channels: ${error.message}`);
  }
};

module.exports = getSlackMessage;
