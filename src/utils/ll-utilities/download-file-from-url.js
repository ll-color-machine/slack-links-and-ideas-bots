// Function to download a file using Axios. Parameters:
// fileUrl: URL of the file to be downloaded
// filePath: Local path where the file should be saved

const axios = require('axios');
const fs = require('fs');

module.exports = async ({ fileUrl, filePath }) => {
    const response = await axios({
      url: fileUrl,
      responseType: 'stream',
    });
    return new Promise((resolve, reject) => {
      response.data
        .pipe(fs.createWriteStream(filePath)) // Ensure to use filePath instead of fileName
        .on('finish', () => resolve())
        .on('error', e => reject(e));
    });
};
