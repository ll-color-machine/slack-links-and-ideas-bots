const axios = require("axios");
const llog = require("learninglab-log");
const fs = require("fs");

const getFileInfo = async ({ file }) => {
  try {
    const response = await axios.get("https://slack.com/api/files.info", {
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
      params: {
        file: file,
      },
    });
    if (response.data.ok) {
      llog.cyan(response.data);
      return response.data.file;
    } else {
      throw new Error(response.data.error);
    }
  } catch (error) {
    throw new Error(`Failed to retrieve channels: ${error.message}`);
  }
};

module.exports = getFileInfo;
