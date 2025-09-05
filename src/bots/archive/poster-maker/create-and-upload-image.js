const fs = require('fs');
const path = require('path');
const axios = require('axios');
const Replicate = require('replicate');

/**
 * Creates an image via Replicate and uploads it to Slack.
 *
 * @param {object} client - The Slack client instance.
 * @param {object} scene - An object with at least a "channel" property indicating the Slack channel.
 * @param {string} prompt - The text prompt to generate the image.
 * @param {string} thread_ts - (Optional) The Slack thread timestamp for posting.
 * @returns {object} The response from Slack’s file upload completion.
 */
async function createAndUploadImage(client, scene, prompt, thread_ts) {
  // 1. Generate the image using Replicate
  const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
  });
  
  const input = {
    prompt,
    num_outputs: 1,
    aspect_ratio: "1:1",
    output_format: "webp",
    output_quality: 80,
  };
  
  const output = await replicate.run("black-forest-labs/flux-schnell", { input });
  // Assume the first output is the image URL.
  const imageUrl = output[0];
  
  // 2. Download the image
  const timestamp = Date.now();
  const filename = `replicate_${timestamp}.webp`;
  const tempDir = path.join(process.cwd(), '_temp');  // You can change this to your preferred temp folder.
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  const imagePath = path.join(tempDir, filename);
  
  const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
  fs.writeFileSync(imagePath, response.data);
  
  const fileSizeInBytes = fs.statSync(imagePath).size;
  
  // 3. Get Slack's upload URL for the external file
  const uploadUrlResponse = await client.files.getUploadURLExternal({
    channels: scene.channel,
    filename,
    thread_ts,
    length: fileSizeInBytes,
  });
  
  if (!uploadUrlResponse.ok) {
    throw new Error(`Failed to get upload URL: ${uploadUrlResponse.error}`);
  }
  
  const uploadUrl = uploadUrlResponse.upload_url;
  const file_id = uploadUrlResponse.file_id;
  
  // 4. Upload the file contents using Axios
  const fileStream = fs.createReadStream(imagePath);
  await axios.post(uploadUrl, fileStream, {
    headers: {
      'Content-Type': 'image/webp', // Adjust if using another image format.
      'Content-Length': fileSizeInBytes,
    },
  });
  
  // 5. Complete the upload process
  const completeUploadResponse = await client.files.completeUploadExternal({
    files: [
      {
        id: file_id,
        title: "Generated Image",
      },
    ],
    channel_id: scene.channel,
    thread_ts,
    channels: [scene.channel], // Ensure the file is shared to the channel.
  });
  
  if (!completeUploadResponse.ok) {
    throw new Error(`Failed to complete upload: ${completeUploadResponse.error}`);
  }
  
  return completeUploadResponse;
}

module.exports = createAndUploadImage;
