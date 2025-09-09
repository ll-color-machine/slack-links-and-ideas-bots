const llog = require("learninglab-log");
const airtableTools = require("../../utils/ll-airtable-tools");
const { makeSlackImageUrl } = require("../../utils/ll-slack-tools/utils");

// Create Airtable record for a PDF and (optionally) attach a public Slack URL
// Accepts optional Slack context for cross-linking
async function savePdfRecordToAirtable({ metadata, file, fileName, webUser, slackChannelId, slackMessageTs, slackUserId }) {
  const baseId = process.env.AIRTABLE_BASE_ID;
  const table = process.env.AIRTABLE_TABLE_PDFS || "PDFs";
  if (!baseId) throw new Error("AIRTABLE_BASE_ID env not set");

  const fields = {
    Title: metadata.title,
    Topic: metadata.topic,
    StudyType: metadata.study_type,
    Summary: metadata.summary,
    environment: process.env.NODE_ENV || 'production',
  };
  if (metadata.year) fields.Year = metadata.year;
  if (metadata.link) fields.Link = metadata.link;
  // Slack cross-refs (lowercase names to match emoji-bot expectations)
  if (slackMessageTs) fields.slack_message_ts = slackMessageTs;
  if (slackChannelId) fields.slack_channel_id = slackChannelId;
  const slackUid = slackUserId || file?.user || null;
  if (slackUid) fields.slack_user_id = slackUid;
  try {
    const postedById = global.APP_CONFIG?.usersById?.[slackUid]?.id;
    if (postedById) fields._posted_by = [postedById];
  } catch (_) {}

  let airtableRecord = await airtableTools.addRecord({ baseId, table, record: fields });
  try {
    const tableId = process.env.AIRTABLE_PDFS_TABLE_ID || "tblbtIWkj4w8yiIuQ";
    const viewId = process.env.AIRTABLE_PDFS_VIEW_ID || "viwX7m65gHoOAs7ei";
    const url = airtableRecord?.id ? `https://airtable.com/${baseId}/${tableId}/${viewId}/${airtableRecord.id}?blocks=hide` : null;
    llog.cyan("🗃️ Airtable PDF record created", { id: airtableRecord?.id, baseId, table, url });
  } catch (_) {}

  // Optional: attach public Slack URL to Airtable if possible
  try {
    if (file?.id && webUser) {
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

  return airtableRecord;
}

module.exports = { savePdfRecordToAirtable };
