const process = require("process");

// Helper: chunk long text roughly at line breaks to keep Block Kit sections safe
function chunkTextAtLineBreaks(text, maxLength = 2800) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const chunks = [];
  let current = "";
  for (const line of lines) {
    if ((current + "\n" + line).length > maxLength) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = current ? current + "\n" + line : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

// Build Slack blocks for the analysis message
function buildBlocks({ fileName, metadata, airtableRecord }) {
  const baseId = process.env.AIRTABLE_BASE_ID;
  const blocks = [
    { type: "header", text: { type: "plain_text", text: `📄 PDF Analysis Complete: ${fileName}` } },
    { type: "section", text: { type: "mrkdwn", text: "*📋 METADATA EXTRACTED:*" } },
    {
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*Title:*\n${metadata?.title || "N/A"}` },
        { type: "mrkdwn", text: `*Year:*\n${metadata?.year || "N/A"}` },
        { type: "mrkdwn", text: `*Topic:*\n${metadata?.topic || "Other"}` },
        { type: "mrkdwn", text: `*Study Type:*\n${metadata?.study_type || "Review"}` },
      ],
    },
  ];

  if (metadata?.link && metadata.link !== "N/A") {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*🔗 Link:* ${metadata.link}` } });
  }

  const summaryText = `*📝 SUMMARY:*\n${metadata?.summary || "No summary available."}`;
  const chunks = chunkTextAtLineBreaks(summaryText, 2800);
  blocks.push({ type: "divider" });
  for (const chunk of chunks) {
    blocks.push({ type: "section", text: { type: "mrkdwn", text: chunk } });
  }
  blocks.push({ type: "divider" });

  let footerText = "🤖 Analyzed by OpenAI";
  if (airtableRecord && baseId) {
    const tableId = process.env.AIRTABLE_PDFS_TABLE_ID || "tblbtIWkj4w8yiIuQ";
    const viewId = process.env.AIRTABLE_PDFS_VIEW_ID || "viwX7m65gHoOAs7ei";
    const url = `https://airtable.com/${baseId}/${tableId}/${viewId}/${airtableRecord.id}?blocks=hide`;
    footerText = `🤖 Analyzed by OpenAI • 🗃️ <${url}|View in Airtable>`;
  }
  blocks.push({ type: "section", text: { type: "mrkdwn", text: footerText } });
  return blocks;
}

module.exports = { chunkTextAtLineBreaks, buildBlocks };

