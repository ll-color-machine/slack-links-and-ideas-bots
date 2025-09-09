const fs = require('fs').promises;
const path = require('path');
const llog = require('learninglab-log');

// Portable payload log directory
const IS_HEROKU = !!process.env.DYNO;
const BASE_LOG_DIR = process.env.LOG_DIR || (IS_HEROKU ? path.join('/tmp', 'logs') : path.join(process.cwd(), 'logs'));
const LOGS_DIR = process.env.PAYLOAD_LOG_DIR || path.join(BASE_LOG_DIR, 'payloads');
// Gate file logging by env: default OFF on Heroku, ON locally unless overridden
const ENABLE_FILE_LOG = String(process.env.PAYLOAD_FILE_LOG ?? (IS_HEROKU ? 'false' : 'true')).toLowerCase() === 'true';
const MAX_FILES = 50;
let logCounter = 1;

async function ensureLogDir() {
  if (!ENABLE_FILE_LOG) return;
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
    if (!ENABLE_FILE_LOG) {
      // Echo a concise preview to console only
      try {
        llog.gray({ payload_log_preview: { prefix, type, size: JSON.stringify(payload)?.length || 0 } });
      } catch (_) {}
      return;
    }
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
  if (!ENABLE_FILE_LOG) return;
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
