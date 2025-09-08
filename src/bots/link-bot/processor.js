const llog = require("learninglab-log");
const { extractLinksFromMessage, isValidUrl, numberEmoji, addReaction } = require("./links");
const { fetchLinkMetadata, saveLinkToAirtable, linkExists } = require("./storage");

/**
 * Process all links found in a Slack message
 */
async function processLinksFromMessage({ client, message }) {
  try {
    // Extract all links from the message
    const urls = extractLinksFromMessage(message);
    const validUrls = urls.filter(isValidUrl);
    
    if (validUrls.length === 0) {
      llog.gray("No valid links found in message");
      return { processedCount: 0, totalLinks: 0 };
    }
    
    llog.cyan(`🔗 Processing ${validUrls.length} links from message`);
    
    let processedCount = 0;
    
    // Process each link
    for (const url of validUrls) {
      try {
        // Check if link already exists to avoid duplicates
        const exists = await linkExists(url, message.channel, message.ts);
        if (exists) {
          llog.gray(`Link already exists, skipping: ${url}`);
          continue;
        }
        
        // Fetch metadata for the link
        llog.blue(`📄 Fetching metadata for: ${url}`);
        const metadata = await fetchLinkMetadata(url);
        
        // Save to Airtable
        await saveLinkToAirtable(url, metadata, message);
        processedCount++;
        
      } catch (error) {
        llog.red(`❌ Failed to process link ${url}: ${error}`);
      }
    }
    
    // Add reaction to indicate processing complete
    if (processedCount > 0) {
      await addReaction(client, numberEmoji(processedCount), message.channel, message.ts);
      llog.green(`✅ Successfully processed ${processedCount}/${validUrls.length} links`);
    }
    
    return {
      processedCount,
      totalLinks: validUrls.length,
      urls: validUrls,
    };
    
  } catch (error) {
    llog.red(`❌ Error processing links from message: ${error}`);
    return { processedCount: 0, totalLinks: 0, error: error.message };
  }
}

/**
 * Check if a message contains links worth processing
 */
function messageHasLinks(message) {
  const urls = extractLinksFromMessage(message);
  return urls.filter(isValidUrl).length > 0;
}

module.exports = {
  processLinksFromMessage,
  messageHasLinks,
};