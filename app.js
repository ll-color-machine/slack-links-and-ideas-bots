const { App } = require("@slack/bolt");
var path = require("path");
var fs = require("fs");
const llog = require("learninglab-log");
const handleMessages = require("./src/handlers/message-handler");
const handlers = require("./src/handlers");
const { initRuntimeConfig, refreshRuntimeConfig, syncSlackUsersToAirtable } = require("./src/config");
global.ROOT_DIR = path.resolve(__dirname);

require("dotenv").config({
  path: path.resolve(__dirname, `.env.${process.env.NODE_ENV}`),
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  port: process.env.PORT || 3000,
});


app.message("testing testing", handleMessages.testing);
app.message(/.*/, handleMessages.parseAll);
// Events: wire file_shared and reaction_added for PDF handling and others
app.event("file_shared", handlers.eventHandler.fileShared);
app.event("reaction_added", handlers.eventHandler.reactionAdded);


(async () => {

  // Warm runtime config (users, emojis, prompts, flows)
  await initRuntimeConfig();
  // Ensure Airtable Users table contains all Slack users for this workspace
  await syncSlackUsersToAirtable({ slackClient: app.client }).catch(()=>{});
  // Ensure Airtable Emojis table contains workspace custom emoji names
  await require('./src/config').syncSlackEmojisToAirtable().catch(()=>{});
  // Refresh config again to include any new/updated users immediately
  await refreshRuntimeConfig().catch(()=>{});
  await app.start(process.env.PORT || 3000);
  llog.yellow("⚡️ Bolt app is running!");
  let slackResult = await app.client.chat.postMessage({
    channel: process.env.SLACK_LOGGING_CHANNEL,
    text: "starting up the links-and-ideas-bots",
  });

  
})();
