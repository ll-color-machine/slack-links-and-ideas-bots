const llog = require("learninglab-log");
const airtableTools = require("../../utils/ll-airtable-tools");

const MAX_MARKDOWN_LEN = Number(process.env.LINKS_MARKDOWN_MAX || 95000);
const MAX_FIRECRAWL_JSON_LEN = Number(process.env.FIRECRAWL_JSON_MAX || 95000);

function formatLinkRecord(url, metadata, message) {
  const timestamp = new Date(parseFloat(message.ts) * 1000).toISOString();

  // Lookup Airtable Users record ID from runtime config by Slack user ID
  let postedById = null;
  try {
    const cfg = global.APP_CONFIG || {};
    const byId = cfg.usersById || {};
    postedById = byId[message.user]?.id || null;
  } catch (_) {}

  return {
    url: url,
    title: metadata.title || "",
    description: metadata.description || "",
    summary: metadata.summary || "",
    markdown: clampMarkdown(metadata.markdown || ""),
    domain: metadata.domain || "",
    pathname: metadata.pathname || "",
    image_url: metadata.image || "",
    image_attachment: metadata.image ? [{ url: metadata.image }] : [],
    slack_channel_id: message.channel,
    slack_message_ts: message.ts,
    slack_user_id: message.user,
    slack_team_id: message.team,
    created_at: timestamp,
    link_metadata: JSON.stringify(metadata, null, 2),
    firecrawl_json: clampFirecrawlJson(JSON.stringify(metadata.firecrawl || {}, null, 2)),
    slack_message_json: JSON.stringify(message, null, 2),
    // Link to Users table via lookup if available
    _posted_by: postedById ? [postedById] : undefined,
  };
}

function clampMarkdown(md) {
  try {
    const s = String(md);
    if (s.length <= MAX_MARKDOWN_LEN) return s;
    const clipped = s.slice(0, MAX_MARKDOWN_LEN);
    llog.gray({ markdown_truncated: { from: s.length, to: clipped.length } });
    return clipped;
  } catch (_) {
    return "";
  }
}

function clampFirecrawlJson(s) {
  try {
    const str = String(s || "");
    if (str.length <= MAX_FIRECRAWL_JSON_LEN) return str;
    const clipped = str.slice(0, MAX_FIRECRAWL_JSON_LEN);
    llog.gray({ firecrawl_json_truncated: { from: str.length, to: clipped.length } });
    return clipped;
  } catch (_) {
    return "";
  }
}

async function saveLinkToAirtable(url, metadata, message) {
  try {
    const baseId = process.env.AIRTABLE_BASE_ID;
    const table = process.env.AIRTABLE_TABLE_LINKS || "Links";
    if (!baseId) throw new Error("AIRTABLE_BASE_ID not configured");

    const record = formatLinkRecord(url, metadata, message);
    const result = await airtableTools.addRecord({ baseId, table, record });
    try { llog.green(`✅ Link saved to Airtable: ${url} → ${result?.id || 'unknown_id'}`); } catch (_) {}
    return result;
  } catch (error) {
    llog.red(`❌ Failed to save link to Airtable: ${url} - ${error}`);
    throw error;
  }
}

async function linkExists(url, channelId, messageTs) {
  try {
    const baseId = process.env.AIRTABLE_BASE_ID;
    const table = process.env.AIRTABLE_TABLE_LINKS || "Links";
    if (!baseId) return false;

    // Prefer URL+TS; if helper fails (undefined) or Airtable errors, fall back to URL-only
    const filterUrlTs = `AND({url} = '${url}', {slack_message_ts} = '${messageTs}')`;
    let existing = await airtableTools.findMany({ baseId, table, filterByFormula: filterUrlTs, maxRecords: 1 });
    if (existing === undefined) {
      const filterUrlOnly = `{url} = '${url}'`;
      existing = await airtableTools.findMany({ baseId, table, filterByFormula: filterUrlOnly, maxRecords: 1 });
      try {
        const foundIds = (existing || []).map((r) => r.id);
        llog.yellow({ linkExists_debug_fallback: { url, messageTs, count: existing?.length || 0, foundIds, filterByFormula: filterUrlOnly } });
      } catch (_) {}
      return Array.isArray(existing) && existing.length > 0;
    }
    try {
      const foundIds = (existing || []).map((r) => r.id);
      llog.gray({ linkExists_debug: { url, messageTs, count: existing?.length || 0, foundIds, filterByFormula: filterUrlTs } });
    } catch (_) {}
    return Array.isArray(existing) && existing.length > 0;
  } catch (error) {
    llog.gray(`Could not check for existing link: ${error}`);
    return false;
  }
}

module.exports = {
  saveLinkToAirtable,
  linkExists,
};
