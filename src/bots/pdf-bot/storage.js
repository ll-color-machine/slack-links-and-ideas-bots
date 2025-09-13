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
  // Slack cross-refs stored on PDFs table (only fields that exist in your base)
  if (slackMessageTs) fields.slack_message_ts = slackMessageTs;
  const slackUid = slackUserId || file?.user || null;
  try {
    const postedById = global.APP_CONFIG?.usersById?.[slackUid]?.id;
    // Your base uses `_user` (link to Users) rather than `_posted_by`
    if (postedById) fields._user = [postedById];
  } catch (_) {}

  let airtableRecord = await airtableTools.addRecord({ baseId, table, record: fields });
  try {
    const tableId = process.env.AIRTABLE_PDFS_TABLE_ID || "tblbtIWkj4w8yiIuQ";
    const viewId = process.env.AIRTABLE_PDFS_VIEW_ID || "viwX7m65gHoOAs7ei";
    const url = airtableRecord?.id ? `https://airtable.com/${baseId}/${tableId}/${viewId}/${airtableRecord.id}?blocks=hide` : null;
    llog.cyan("🗃️ Airtable PDF record created", { id: airtableRecord?.id, baseId, table, url });
  } catch (_) {}

  // Optional: attach a public Slack URL to Airtable if possible.
  // NOTE: Calling files.sharedPublicURL causes Slackbot to post a notice in the channel.
  // To suppress those notices, set ALLOW_PUBLIC_FILE_LINKS=false (default) to skip making files public.
  try {
    const allowPublic = /^(1|true|yes|on)$/i.test(String(process.env.ALLOW_PUBLIC_FILE_LINKS || 'false'));
    if (file?.id) {
      let permalink = file.permalink; // may exist on event payload
      let permalink_public = file.permalink_public; // only present if already public

      // Prefer existing public link if available; avoid creating a new one
      if (!permalink_public && allowPublic && webUser) {
        // This call may trigger a Slackbot message in the channel
        const pub = await webUser.files.sharedPublicURL({ file: file.id });
        permalink = pub?.file?.permalink || permalink;
        permalink_public = pub?.file?.permalink_public || permalink_public;
      }

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
