// const { makeSlackImageURL } = require("./utils/make-slack-image-url");
// const { imageToAirtable } = require("./event-handlers/image-to-airtable");
const getSlackMessage = require("./utils/get-slack-message.js");
const getSlackFileInfo = require("./utils/get-file-info.js");

module.exports.getSlackMessage = getSlackMessage;
module.exports.getSlackFileInfo = getSlackFileInfo;
// module.exports.makeSlackImageURL = makeSlackImageURL;
// module.exports.imageToAirtable = imageToAirtable;
