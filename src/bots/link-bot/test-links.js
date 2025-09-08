// Simple test script for link processing
const { extractLinksFromMessage, isValidUrl } = require('./links');
const { fetchLinkMetadata } = require('./storage');
const llog = require('learninglab-log');

// Mock message with various link formats
const testMessage = {
  text: "Check out this article https://example.com/article and this one <https://github.com/test/repo>",
  blocks: [
    {
      type: "section",
      elements: [
        {
          type: "rich_text_section",
          elements: [
            {
              type: "link",
              url: "https://stackoverflow.com/questions/test"
            }
          ]
        }
      ]
    }
  ],
  channel: "C1234567890",
  user: "U1234567890", 
  ts: "1609459200.001400"
};

async function testLinkExtraction() {
  llog.blue("=== Testing Link Extraction ===");
  
  const links = extractLinksFromMessage(testMessage);
  llog.cyan("Extracted links:", links);
  
  const validLinks = links.filter(isValidUrl);
  llog.green("Valid links:", validLinks);
  
  if (validLinks.length > 0) {
    llog.blue("=== Testing Metadata Extraction ===");
    const metadata = await fetchLinkMetadata(validLinks[0]);
    llog.yellow("Sample metadata:", metadata);
  }
}

if (require.main === module) {
  testLinkExtraction().catch(console.error);
}

module.exports = { testLinkExtraction };