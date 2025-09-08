const llog = require("learninglab-log");
const airtableTools = require("../../utils/ll-airtable-tools");
const { makeSlackImageUrl } = require("../../utils/ll-slack-tools/utils");

// Create Airtable record for a PDF and (optionally) attach a public Slack URL
async function savePdfRecordToAirtable({ metadata, file, fileName, webUser }) {
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
