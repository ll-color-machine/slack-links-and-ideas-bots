const llog = require("learninglab-log");
const airtableTools = require("../../utils/ll-airtable-tools");

/**
 * Fetch Open Graph data using WebFetch tool
 * Falls back to basic URL parsing if OG data unavailable
 */
async function fetchLinkMetadata(url) {
  try {
    // For now, we'll do basic URL parsing
    // TODO: Could integrate with WebFetch tool for full OG scraping
    const urlObj = new URL(url);
    
    return {
      title: urlObj.hostname,
      description: `Link from ${urlObj.hostname}`,
      image: null,
      domain: urlObj.hostname,
      pathname: urlObj.pathname,
    };
  } catch (error) {
    llog.red(`Error parsing URL metadata for ${url}: ${error}`);
    return {
      title: url,
      description: "Unable to parse URL",
      image: null,
      domain: "unknown",
      pathname: "",
    };
  }
}

/**
 * Format link data for Airtable record
 */
function formatLinkRecord(url, metadata, message) {
  const timestamp = new Date(parseFloat(message.ts) * 1000).toISOString();
  
  return {
    url: url,
    title: metadata.title || "",
    description: metadata.description || "",
    summary: metadata.summary || "",
    domain: metadata.domain || "",
    pathname: metadata.pathname || "",
    image_url: metadata.image || "",
    slack_channel_id: message.channel,
    slack_message_ts: message.ts,
    slack_user_id: message.user,
    slack_team_id: message.team,
    created_at: timestamp,
    link_metadata: JSON.stringify(metadata, null, 2),
    slack_message_json: JSON.stringify(message, null, 2),
    status: "pending", // For future processing workflow
  };
}

/**
 * Save link record to Airtable
 */
async function saveLinkToAirtable(url, metadata, message) {
  try {
    const baseId = process.env.AIRTABLE_BASE_ID;
    const table = process.env.AIRTABLE_TABLE_LINKS || "Links";
    
    if (!baseId) {
      throw new Error("AIRTABLE_BASE_ID not configured");
    }
    
    const record = formatLinkRecord(url, metadata, message);
    
    const result = await airtableTools.addRecord({
      baseId,
      table,
      record,
    });
    
    llog.green(`✅ Link saved to Airtable: ${url}`);
    return result;
    
  } catch (error) {
    llog.red(`❌ Failed to save link to Airtable: ${url} - ${error}`);
    throw error;
  }
}

/**
 * Check if link already exists in Airtable (to avoid duplicates)
 */
async function linkExists(url, channelId, messageTs) {
  try {
    const baseId = process.env.AIRTABLE_BASE_ID;
    const table = process.env.AIRTABLE_TABLE_LINKS || "Links";
    
    if (!baseId) return false;
    
    // Search for existing records with same URL and message timestamp
    const filterByFormula = `AND({url} = '${url}', {slack_message_ts} = '${messageTs}')`;
    const existing = await airtableTools.findMany({
      baseId,
      table,
      filterByFormula,
      maxRecords: 1,
    });
    try {
      const foundIds = (existing || []).map(r => r.id);
      llog.gray({ linkExists_debug: { url, messageTs, count: existing?.length || 0, foundIds, filterByFormula } });
    } catch (_) {}
    
    return existing && existing.length > 0;
  } catch (error) {
    llog.gray(`Could not check for existing link: ${error}`);
    return false; // Assume doesn't exist if we can't check
  }
}

module.exports = {
  fetchLinkMetadata,
  formatLinkRecord,
  saveLinkToAirtable,
  linkExists,
};
