const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const axios = require("axios");
const llog = require("learninglab-log");
const OpenAI = require("openai");
const airtableTools = require("../../utils/ll-airtable-tools");
const { WebClient } = require("@slack/web-api");
const { makeSlackImageUrl } = require("../../utils/ll-slack-tools/utils");

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

// Download a Slack-private file to _temp with auth token
async function downloadPdfFromSlack(fileUrl, fileName, token) {
  const destDir = path.join(global.ROOT_DIR || process.cwd(), "_temp");
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
  const safeName = fileName || `file-${Date.now()}.pdf`;
  const filePath = path.join(destDir, safeName);
  const res = await axios.get(fileUrl, {
    headers: { Authorization: `Bearer ${token}` },
    responseType: "arraybuffer",
  });
  await fsp.writeFile(filePath, res.data);
  return filePath;
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

// Normalize fields
function normalizeTopic(topic) {
  const valid = [
    "Learning outcomes",
    "Tool development",
    "Professional practice",
    "Student perspectives",
    "User experience and interaction",
    "Theoretical background",
    "AI literacy",
    "Other",
  ];
  if (!topic) return "Other";
  if (valid.includes(topic)) return topic;
  const t = String(topic).toLowerCase();
  const match = valid.find((v) => v.toLowerCase() === t);
  if (!match) {
    llog.yellow(`⚠️ Unknown topic '${topic}', defaulting to 'Other'`);
    return "Other";
  }
  return match;
}

function normalizeStudyType(studyType) {
  const valid = ["Review", "Experimental", "Quantitative", "Qualitative", "Mixed-methods", "Observational"];
  if (!studyType) return "Review";
  if (valid.includes(studyType)) return studyType;
  const t = String(studyType).toLowerCase();
  const match = valid.find((v) => v.toLowerCase() === t);
  if (!match) {
    llog.yellow(`⚠️ Unknown study type '${studyType}', defaulting to 'Review'`);
    return "Review";
  }
  return match;
}

// Analyze the PDF via OpenAI Responses API
async function analyzePdfWithOpenAI(openai, pdfPath) {
  try {
    llog.yellow("🤖 Uploading PDF to OpenAI using Responses API...");
    const upload = await openai.files.create({ file: fs.createReadStream(pdfPath), purpose: "user_data" });

    const summaryPrompt = `Please analyze this PDF document and provide a structured summary:\n\n**DOCUMENT SUMMARY:**\n- **Main Topic**: [Brief description of the document's primary focus]\n- **Key Points**: [3-5 bullet points of the most important information]\n- **Document Type**: [Research paper, report, manual, etc.]\n- **Target Audience**: [Who this document is intended for]\n- **Key Takeaways**: [2-3 actionable insights or conclusions]\n\n**TECHNICAL DETAILS** (if applicable):\n- **Methodology**: [Research methods, approaches used]\n- **Data/Evidence**: [Key statistics, findings, or evidence presented]\n- **Tools/Technologies**: [Any specific tools, technologies, or frameworks mentioned]\n\n**RELEVANCE ASSESSMENT:**\n- **Academic Value**: [High/Medium/Low - why?]\n- **Practical Applications**: [How can this be applied?]\n- **Related Topics**: [What other areas does this connect to?]`;

    const models = ["gpt-5", "gpt-4o", "gpt-4o-mini"];
    let response = null;
    let used = null;
    for (const model of models) {
      try {
        llog.yellow(`🎯 Trying model: ${model}`);
        response = await openai.responses.create({
          model,
          input: [
            {
              role: "user",
              content: [
                { type: "input_file", file_id: upload.id },
                { type: "input_text", text: summaryPrompt },
              ],
            },
          ],
        });
        used = model;
        llog.green(`✅ Success with ${model}`);
        break;
      } catch (e) {
        const msg = String(e);
        llog.yellow(`❌ ${model} failed: ${msg}`);
        continue;
      }
    }

    // Best-effort cleanup
    try { await openai.files.del(upload.id); } catch {}

    return { success: true, model: used, responseText: response?.output_text || "" };
  } catch (e) {
    llog.red(`OpenAI API Error: ${e}`);
    return { success: false, error: String(e) };
  }
}

// Extract lightweight metadata heuristically from OpenAI response
function extractMetadataFromResponse(text, fallbackTitle = "Untitled") {
  // Minimal parse; in practice you might structure prompt to return JSON.
  const summary = text?.trim() || "No summary available.";
  return {
    title: fallbackTitle,
    topic: "Other",
    study_type: "Review",
    year: undefined,
    link: undefined,
    summary,
  };
}

function PDFSummarizerBot({ slackClient }) {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const botToken = process.env.SLACK_BOT_TOKEN || process.env.SLACK_USER_TOKEN;
  const webUser = new WebClient(process.env.SLACK_USER_TOKEN);

  return {
    async processFile(file, channelId, { thread_ts } = {}) {
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
          await this.sendError(channelId, `Metadata extraction failed: ${ai.error || "Unknown error"}`, thread_ts);
          return;
        }

        // 3) Make lightweight metadata (customize with stricter prompts or JSON parsers)
        const metadata = extractMetadataFromResponse(ai.responseText, fileName);
        metadata.topic = normalizeTopic(metadata.topic);
        metadata.study_type = normalizeStudyType(metadata.study_type);

        llog.green("📊 Metadata Extraction Result (lightweight)");
        llog.blue({ model: ai.model, preview: metadata.summary?.slice(0, 240) + "..." });
        llog.divider();

        // 4) Save to Airtable (record first)
        let airtableRecord = null;
        try {
          const baseId = process.env.AIRTABLE_BASE_ID;
          const table = process.env.AIRTABLE_TABLE_PDFS || "PDFs";
          if (!baseId) throw new Error("AIRTABLE_BASE_ID env not set");

          const fields = {
            Title: metadata.title,
            Topic: metadata.topic,
            StudyType: metadata.study_type,
            Summary: metadata.summary,
          };
          if (metadata.year) fields.Year = metadata.year;
          if (metadata.link) fields.Link = metadata.link;

          airtableRecord = await airtableTools.addRecord({ baseId, table, record: fields });

          // Optional: attach public Slack URL to Airtable if possible
          try {
            if (file?.id) {
              // create a public URL and attach to Airtable
              const pub = await webUser.files.sharedPublicURL({ file: file.id });
              const permalink = pub?.file?.permalink;
              const permalink_public = pub?.file?.permalink_public;
              if (permalink && permalink_public) {
                const publicUrl = makeSlackImageUrl(permalink, permalink_public);
                const updated = await airtableTools.updateRecord({
                  baseId,
                  table,
                  recordId: airtableRecord.id,
                  updatedFields: { File: [{ url: publicUrl, filename: fileName }] },
                });
                airtableRecord = updated || airtableRecord;
              }
            }
          } catch (e) {
            llog.yellow(`⚠️ Record created but file URL attach failed: ${e}`);
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
        await this.sendError(channelId, `Processing failed: ${e}`, thread_ts);
      } finally {
        if (tempPath) {
          try { await fsp.unlink(tempPath); llog.gray(`🗑️ Cleaned up temp file: ${tempPath}`); } catch {}
        }
      }
    },

    async sendError(channelId, message, thread_ts) {
      const text = `❌ PDF Processing Error\n\n${message}\n\nPlease try again or contact support.`;
      await slackClient.chat.postMessage({
        channel: channelId,
        text,
        ...(thread_ts ? { thread_ts } : {}),
      });
    },
  };
}

module.exports = PDFSummarizerBot;

