const fsp = require("fs/promises");
const llog = require("learninglab-log");
const OpenAI = require("openai");
const { WebClient } = require("@slack/web-api");

const { downloadPdfFromSlack } = require("./download");
const { buildBlocks } = require("./blocks");
const { normalizeTopic, normalizeStudyType } = require("./normalize");
const { analyzePdfWithOpenAI, extractMetadataFromResponse } = require("./analyze");
const { savePdfRecordToAirtable } = require("./storage");

async function sendError(slackClient, channelId, message, thread_ts) {
  const text = `❌ PDF Processing Error\n\n${message}\n\nPlease try again or contact support.`;
  await slackClient.chat.postMessage({
    channel: channelId,
    text,
    ...(thread_ts ? { thread_ts } : {}),
  });
}

// Standalone function for DI-friendly usage
async function processFile(
  { slackClient, openai, botToken, webUser },
  { file, channelId, thread_ts } = {},
) {
  // Defaults for dependencies when not provided
  if (!slackClient) throw new Error("slackClient is required");
  openai = openai || new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  botToken = botToken || process.env.SLACK_BOT_TOKEN || process.env.SLACK_USER_TOKEN;
  webUser = webUser || new WebClient(process.env.SLACK_USER_TOKEN);

  try {
      const fileName = file?.name || "Unknown.pdf";
      const fileUrl = file?.url_private_download || file?.url_private;
      llog.magenta(`🔄 Starting PDF processing workflow: ${fileName}`);
      if (thread_ts) llog.gray(`📝 Will reply to thread: ${thread_ts}`);

      let tempPath = null;
      try {
        if (!fileUrl) throw new Error("Missing url_private_download for file");

        // 1) Download
        tempPath = await downloadPdfFromSlack(fileUrl, fileName, botToken);

        // 2) Analyze via OpenAI
        llog.yellow("🤖 Extracting PDF metadata...");
        const ai = await analyzePdfWithOpenAI(openai, tempPath);
        if (!ai.success) {
          await sendError(slackClient, channelId, `Metadata extraction failed: ${ai.error || "Unknown error"}`, thread_ts);
          return;
        }

        // 3) Make lightweight metadata (customize with stricter prompts or JSON parsers)
        const metadata = extractMetadataFromResponse(ai.responseText, fileName, ai.parsed);
        metadata.topic = normalizeTopic(metadata.topic);
        metadata.study_type = normalizeStudyType(metadata.study_type);

        llog.green("📊 Metadata Extraction Result (lightweight)");
        llog.blue({ model: ai.model, preview: metadata.summary?.slice(0, 240) + "..." });
        llog.gray(llog.divider);

        // 4) Save to Airtable (record first)
        let airtableRecord = null;
        try {
          airtableRecord = await savePdfRecordToAirtable({ metadata, file, fileName, webUser });
          if (airtableRecord?.id) {
            const baseId = process.env.AIRTABLE_BASE_ID;
            const tableId = process.env.AIRTABLE_PDFS_TABLE_ID || "tblbtIWkj4w8yiIuQ";
            const viewId = process.env.AIRTABLE_PDFS_VIEW_ID || "viwX7m65gHoOAs7ei";
            const atUrl = `https://airtable.com/${baseId}/${tableId}/${viewId}/${airtableRecord.id}?blocks=hide`;
            llog.cyan("🔗 Airtable record URL", atUrl);
          }
        } catch (airErr) {
          llog.red(`❌ Airtable save failed: ${airErr}`);
        }

        // 5) Post results to Slack
        const blocks = buildBlocks({ fileName, metadata, airtableRecord });
        await slackClient.chat.postMessage({
          channel: channelId,
          text: `PDF Analysis Complete: ${fileName}`,
          blocks,
          ...(thread_ts ? { thread_ts } : {}),
        });

        llog.green(`✅ PDF processing completed successfully: ${fileName}`);
      } catch (e) {
        llog.red(`❌ PDF processing failed: ${e}`);
        await sendError(slackClient, channelId, `Processing failed: ${e}`, thread_ts);
      } finally {
        if (tempPath) {
          try { await fsp.unlink(tempPath); llog.gray(`🗑️ Cleaned up temp file: ${tempPath}`); } catch {}
        }
      }
  } catch (outerErr) {
    llog.red(`❌ PDF processing outer error: ${outerErr}`);
    await sendError(slackClient, channelId, `Processing failed: ${outerErr}`, thread_ts);
  }
}

module.exports = { processFile };
