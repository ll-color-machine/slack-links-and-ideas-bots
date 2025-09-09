const llog = require("learninglab-log");
const { Firecrawl } = require("@mendable/firecrawl-js");

const { extractLinksFromMessage, isValidUrl, numberEmoji, addReaction } = require("./links");
const { saveLinkToAirtable, linkExists } = require("./storage");

/**
 * Fetch metadata for a URL using Firecrawl
 */
async function fetchWithFirecrawl(url) {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY is not set");
  const app = new Firecrawl({ apiKey });

  // Request markdown + links + html metadata + summary; we primarily use metadata/summary
  const resp = await app.scrape(url, { formats: ["markdown", "links", "html", "summary"] });
  const data = resp?.data || resp || {};
  const meta = data.metadata || {};

  // Debug: log key Firecrawl results in red (avoid dumping huge HTML)
  try {
    const markdownPreview = (data.markdown || "").slice(0, 600);
    const summaryPreview = (data.summary || "").slice(0, 600);
    llog.red({ firecrawl_debug: { url, ok: !!resp?.success || true, metadata: meta, markdownPreview, summaryPreview } });
  } catch (_) {}

  // Build a lightweight metadata object compatible with our Airtable storage
  const urlObj = new URL(url);
  const image = meta.ogImage || meta.image || null;
  const summary = data.summary || (data.markdown ? String(data.markdown).split(/\n\n+/)[0].slice(0, 1000) : "");
  return {
    title: meta.title || urlObj.hostname,
    description: meta.description || `Link from ${urlObj.hostname}`,
    image: image || null,
    domain: urlObj.hostname,
    pathname: urlObj.pathname,
    summary,
    markdown: data.markdown || "",
    firecrawl: {
      metadata: meta,
      // Avoid storing huge html/markdown; keep source URL and status
      sourceURL: meta.sourceURL || url,
      statusCode: meta.statusCode || null,
    },
  };
}

/**
 * Process links in a Slack message using Firecrawl for metadata
 */
async function handleMessage({ client, message /*, event*/ }) {
  try {
    const allUrls = extractLinksFromMessage(message);
    llog.gray({ firecrawl_urls_extracted: allUrls });
    const urls = allUrls.filter(isValidUrl);
    llog.gray({ firecrawl_urls_valid: urls });
    if (urls.length === 0) return { processedCount: 0, totalLinks: 0 };

    llog.cyan(`🔥 Firecrawl: processing ${urls.length} link(s)`);
    let processedCount = 0;

    for (const url of urls) {
      try {
        // avoid duplicates for the same message
        llog.gray({ firecrawl_link_exists_check: { url, channel: message.channel, ts: message.ts } });
        const exists = await linkExists(url, message.channel, message.ts);
        llog.gray({ firecrawl_link_exists_result: { url, exists } });
        if (exists) { llog.gray(`Skip existing link: ${url}`); continue; }

        // fetch metadata via Firecrawl
        llog.cyan(`🔎 Firecrawl scraping: ${url}`);
        const metadata = await fetchWithFirecrawl(url);
        llog.gray({ firecrawl_metadata_summary: { url, title: metadata.title, domain: metadata.domain, hasSummary: !!metadata.summary } });
        // augment: include Firecrawl metadata in record JSON
        metadata.link_source = "firecrawl";

        await saveLinkToAirtable(url, metadata, message);
        llog.green(`💾 Saved link to Airtable: ${url}`);
        processedCount++;
      } catch (e) {
        llog.red(`Firecrawl failed for ${url}: ${e}`);
      }
    }

    if (processedCount > 0) {
      const emoji = numberEmoji(processedCount);
      llog.cyan({ firecrawl_reaction: { count: processedCount, emoji } });
      await addReaction(client, emoji, message.channel, message.ts);
      llog.green(`✅ Firecrawl saved ${processedCount}/${urls.length} links`);
    }

    return { processedCount, totalLinks: urls.length, urls };
  } catch (error) {
    llog.red(`❌ Firecrawl bot error: ${error}`);
    return { processedCount: 0, totalLinks: 0, error: String(error) };
  }
}

module.exports = { handleMessage };
