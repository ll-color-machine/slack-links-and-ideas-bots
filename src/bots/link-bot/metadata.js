const llog = require("learninglab-log");

/**
 * Enhanced metadata fetcher that could be extended with WebFetch or open-graph-scraper
 * For now provides basic URL parsing with room for future enhancement
 */
async function fetchEnhancedMetadata(url) {
  try {
    const urlObj = new URL(url);
    
    // Basic metadata from URL structure
    const basicMetadata = {
      title: urlObj.hostname,
      description: `Link from ${urlObj.hostname}`,
      image: null,
      domain: urlObj.hostname,
      pathname: urlObj.pathname,
      protocol: urlObj.protocol,
    };
    
    // TODO: Enhance with actual web scraping
    // Could integrate with WebFetch tool:
    // const ogData = await webFetch(url, "Extract title, description and image from this page");
    
    // For specific domains, we could add custom parsing
    if (urlObj.hostname.includes('github.com')) {
      const pathParts = urlObj.pathname.split('/').filter(p => p);
      if (pathParts.length >= 2) {
        basicMetadata.title = `${pathParts[0]}/${pathParts[1]}`;
        basicMetadata.description = `GitHub repository: ${pathParts[0]}/${pathParts[1]}`;
      }
    } else if (urlObj.hostname.includes('youtube.com') || urlObj.hostname.includes('youtu.be')) {
      basicMetadata.title = "YouTube Video";
      basicMetadata.description = "YouTube video link";
    } else if (urlObj.hostname.includes('stackoverflow.com')) {
      basicMetadata.title = "Stack Overflow Question";
      basicMetadata.description = "Programming Q&A from Stack Overflow";
    }
    
    return basicMetadata;
    
  } catch (error) {
    llog.red(`Error parsing enhanced URL metadata for ${url}: ${error}`);
    return {
      title: url,
      description: "Unable to parse URL",
      image: null,
      domain: "unknown",
      pathname: "",
      protocol: "unknown:",
    };
  }
}

/**
 * Future enhancement: Use WebFetch for full Open Graph scraping
 * This would replace the basic parsing above
 */
async function fetchOpenGraphData(url) {
  // TODO: Implement with WebFetch tool
  // const response = await webFetch(url, 
  //   "Extract the page title, description, and preview image URL. " +
  //   "Look for Open Graph meta tags (og:title, og:description, og:image) " + 
  //   "or standard HTML meta tags as fallback."
  // );
  
  // For now, return enhanced basic metadata
  return await fetchEnhancedMetadata(url);
}

module.exports = {
  fetchEnhancedMetadata,
  fetchOpenGraphData,
};