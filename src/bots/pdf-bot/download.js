const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const axios = require("axios");

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

module.exports = { downloadPdfFromSlack };

