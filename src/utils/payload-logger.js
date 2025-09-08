const fs = require('fs').promises;
const path = require('path');
const llog = require('learninglab-log');

const LOGS_DIR = '/Users/mk/Development/slack-links-and-ideas-bots/logs/payloads';
const MAX_FILES = 50;
let logCounter = 1;

async function ensureLogDir() {
  try {
    await fs.mkdir(LOGS_DIR, { recursive: true });
  } catch (error) {
    llog.red(`Error creating log directory: ${error}`);
  }
}

async function logEvent(event, type = 'unknown') {
  await logPayload('evlent', event, type);
}

async function logMessage(message, type = 'message') {
  llog.gray(message);
  await logPayload('message', message, type);
}

async function logError(error, context = {}, type = 'error') {
  llog.red(error);
  const errorData = {
    error: error.message || String(error),
    stack: error.stack,
    context
  };
  await logPayload('error', errorData, type);
}

async function logPayload(prefix, payload, type) {
  try {
    await ensureLogDir();
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const paddedCounter = String(logCounter).padStart(3, '0');
    const filename = `${paddedCounter}_${prefix}_${type}_${timestamp}.json`;
    const filepath = path.join(LOGS_DIR, filename);
    
    const logData = {
      timestamp: new Date().toISOString(),
      prefix,
      type,
      payload
    };

    await fs.writeFile(filepath, JSON.stringify(logData, null, 2));
    llog.gray(`📝 Logged ${prefix}:${type} as ${filename}`);

    logCounter++;
    await cleanup();
  } catch (error) {
    llog.red(`Error logging payload: ${error}`);
  }
}

async function cleanup() {
  try {
    const files = await fs.readdir(LOGS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json')).sort();
    
    if (jsonFiles.length <= MAX_FILES) return;

    const filesToDelete = jsonFiles.slice(0, jsonFiles.length - MAX_FILES);
    
    for (const file of filesToDelete) {
      await fs.unlink(path.join(LOGS_DIR, file));
      llog.gray(`🗑️ Cleaned up old log file: ${file}`);
    }
  } catch (error) {
    llog.red(`Error during cleanup: ${error}`);
  }
}

module.exports = {
  logEvent,
  logMessage,  
  logError
};