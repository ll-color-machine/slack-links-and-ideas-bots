const llog = require("learninglab-log");
const airtableTools = require(`../utils/ll-airtable-tools`);
const PDFBot = require("../bots/pdf-bot");
// const { handleSlackedFcpxml } =  require('../bots/fcpxml-bot/fcpxml-tools')
const path = require("path");
// const appHomeHandler = require('./app-home-handler')
// const handleImageFile = require(`../bots/image-bot/external-link-listener`)
// const makeGif = require('../bots/gif-bot/make-gif')
// const momentBot = require('../bots/moment-bot')

exports.fileShared = async ({ event, client }) => {
  try {
    llog.cyan("📁 FILE SHARED EVENT:");
    llog.blue(event);

    const fileId = event.file_id;
    const channelId = event.channel_id;

    if (!fileId) {
      llog.red("❌ No file_id in file_shared event");
      return;
    }

    // Fetch full file info
    const info = await client.files.info({ file: fileId });
    const file = info?.file || {};
    llog.yellow("📋 File details:");
    llog.blue(file);

    // Determine thread timestamp if available from shares
    let thread_ts = null;
    try {
      const shares = file.shares || {};
      if (shares.public && shares.public[channelId] && shares.public[channelId][0]) {
        thread_ts = shares.public[channelId][0].ts;
        llog.cyan(`📍 Found message timestamp for thread: ${thread_ts}`);
      }
    } catch (e) {
      // Non-fatal
      llog.gray("No thread timestamp found in shares");
    }

    const fileName = file.name || "";
    const mimetype = file.mimetype || "";
    const isPdf = mimetype === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");

    if (!isPdf) {
      llog.gray(`⏭️ Skipping non-PDF file: ${fileName} (type: ${mimetype})`);
      return;
    }

    llog.green(`🔍 PDF detected: ${fileName}`);

    // Process with PDF bot
    const pdfBot = PDFBot({ slackClient: client });
    await pdfBot.processFile(file, channelId, { thread_ts });
  } catch (error) {
    llog.red(`❌ Error handling file_shared event: ${error}`);
    llog.blue(event);
  }
};

const handleVisionRequest = async ({ event, client }) => {
  if (event.item && event.item.type === "message") {
    llog.white(event);
    const channelId = event.item.channel;
    const messageTs = event.item.ts; // Timestamp of the message
    try {
      // Call the conversations.history method with the necessary parameters
      const images = [];
      const result = await client.conversations.history({
        channel: channelId,
        oldest: messageTs,
        inclusive: true,
        limit: 1,
      });
      llog.blue(result);
      // Check if the message contains attachments with images
      if (result.messages && result.messages.length > 0) {
        const message = result.messages[0];
        if (message.files && message.files.length > 0) {
          const attachments = message.files;
          // Loop through the attachments and check if there is an image
          for (const attachment of attachments) {
            if (attachment.url_private || attachment.permalink_public) {
              // Log the URL of the image attachment
              images.push(attachment);
              llog.blue(
                `Found an image attachment: ${attachment.url_private || attachment.permalink_public}`,
              );
            }
          }
        }
      }
    } catch (error) {
      llog.red(error);
    }
  }
};

const explainRequest = async ({ event, client }) => {
  try {
    const thisMessage = await client.conversations.history({
      channel: event.item.channel,
      latest: event.item.ts,
      inclusive: true,
      limit: 1,
    });
    const previousMessages = await client.conversations.history({
      channel: event.item.channel,
      latest: event.item.ts,
      inclusive: false,
      limit: 5,
    });
    llog.cyan(thisMessage);
    llog.yellow(previousMessages);
    return "successful explainRequest";
  } catch (error) {
    llog.red(`Error in explainRequest: ${error}`);
  }
};

exports.reactionAdded = async ({ event, client }) => {
  llog.yellow(`got a reactionAdded: ${event.type}:`);
  llog.cyan(event);
  // Trigger PDF processing when :books: is added to a message containing PDFs
  try {
    if (event.reaction === "books") {
      const channel = event?.item?.channel;
      const timestamp = event?.item?.ts;
      if (!channel || !timestamp) return;

      const history = await client.conversations.history({
        channel,
        latest: timestamp,
        limit: 1,
        inclusive: true,
      });

      const message = history?.messages?.[0];
      if (!message) return;

      const files = message.files || [];
      const pdfs = files.filter((f) => {
        const name = (f.name || "").toLowerCase();
        return f.mimetype === "application/pdf" || name.endsWith(".pdf");
      });

      if (pdfs.length === 0) {
        llog.yellow("📚 Books reaction added but no PDF files found in message");
        return;
      }

      const pdfBot = PDFBot({ slackClient: client });
      for (const file of pdfs) {
        llog.magenta(`🔄 Processing PDF from books reaction: ${file.name || "Unknown"}`);
        await pdfBot.processFile(file, channel, { thread_ts: timestamp });
      }
      return; // Do not fall through
    }
  } catch (err) {
    llog.red(`❌ Error handling books reaction: ${err}`);
  }
  if (event.reaction == "eyeglasses") {
    llog.blue("vision request");
    let result = await handleVisionRequest({ event, client });
    llog.magenta(result);
  }
  if (event.reaction == "waitwhat") {
    llog.blue("what, what? please explain request.");
    let result = await explainRequest({ event, client });
    llog.magenta(result);
  } else {
  }
};

exports.reactionRemoved = async ({ event }) => {
  llog.yellow(`got a reactionRemoved ${event.type}:`);
  llog.cyan(event);
};

// exports.appHomeOpened = appHomeHandler

exports.parseAll = async ({ event }) => {
  const handledEvents = [
    "message",
    "reaction_added",
    "reaction_removed",
    // "app_home_opened",
    "file_shared"
  ];
  if (handledEvents.includes(event.type)) {
    llog.blue(`got an event of type ${event.type}, handling this elsewhere`);
    // magenta(event)
  } else {
    llog.yellow(`currently unhandled event of type ${event.type}:`);
    llog.cyan(JSON.stringify(event));
  }
  // const result = await momentBot.momentEventListener(event)
};
