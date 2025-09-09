// console-file-logger.cjs
// Preload with: nodemon --require ./console-file-logger.cjs app.js
// Text logs: minute-rotated under logs/text (keeps only LOG_KEEP)
// JSONL logs: daily file under logs/jsonl (one JSON object per line)

const fs = require('fs');
const path = require('path');

// Prefer /tmp on Heroku (DYNO present); allow override via LOG_DIR
const IS_HEROKU = !!process.env.DYNO;
const DEFAULT_LOG_DIR = IS_HEROKU ? path.join('/tmp', 'logs') : path.join(process.cwd(), 'logs');
const LOG_DIR    = process.env.LOG_DIR    || DEFAULT_LOG_DIR;
const LOG_PREFIX = process.env.LOG_PREFIX || 'app';
const LOG_KEEP   = parseInt(process.env.LOG_KEEP || '50', 10);
const JSONL_KEEP = parseInt(process.env.JSONL_KEEP || '14', 10); // days/files to keep
const LATEST_LINES = parseInt(process.env.LATEST_LINES || '500', 10); // lines to keep in latest.log

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
const TEXT_DIR  = path.join(LOG_DIR, 'text');
const JSONL_DIR = path.join(LOG_DIR, 'jsonl');
if (!fs.existsSync(TEXT_DIR)) fs.mkdirSync(TEXT_DIR, { recursive: true });
if (!fs.existsSync(JSONL_DIR)) fs.mkdirSync(JSONL_DIR, { recursive: true });

const origStdout = process.stdout.write.bind(process.stdout);
const origStderr = process.stderr.write.bind(process.stderr);

let currentMinute = null;
let stream = null; // text log stream
let currentDay = null;
let jsonlStream = null; // jsonl stream

// Circular buffer for latest.log
let latestBuffer = [];
let latestLineBuffer = '';

function stamp(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}

function logFileFor(d = new Date()) {
  return path.join(TEXT_DIR, `${LOG_PREFIX}_${stamp(d)}.log`);
}

function openStream(d = new Date()) {
  if (stream) stream.end();
  const target = logFileFor(d);
  stream = fs.createWriteStream(target, { flags: 'a' });
  currentMinute = Math.floor(d.getTime() / 60000);
  updateCurrentSymlink(target).catch(() => {});
  cleanupText().catch(() => {});
}

async function cleanupText() {
  const files = (await fs.promises.readdir(TEXT_DIR))
    .filter(f => f.startsWith(LOG_PREFIX) && f.endsWith('.log'))
    .sort();
  
  // Check file sizes and separate empty from non-empty files
  const fileStats = await Promise.all(
    files.map(async f => {
      const filePath = path.join(TEXT_DIR, f);
      try {
        const stats = await fs.promises.stat(filePath);
        return { name: f, path: filePath, size: stats.size };
      } catch {
        return { name: f, path: filePath, size: 0 };
      }
    })
  );
  
  // Delete empty files immediately (< 50 bytes considered empty)
  const emptyFiles = fileStats.filter(f => f.size < 50);
  const nonEmptyFiles = fileStats.filter(f => f.size >= 50);
  
  if (emptyFiles.length > 0) {
    await Promise.all(
      emptyFiles.map(f => 
        fs.promises.rm(f.path).catch(() => {})
      )
    );
  }
  
  // Apply retention limit only to non-empty files
  const toDelete = nonEmptyFiles.length - LOG_KEEP;
  if (toDelete > 0) {
    const filesToDelete = nonEmptyFiles.slice(0, toDelete);
    await Promise.all(
      filesToDelete.map(f =>
        fs.promises.rm(f.path).catch(() => {})
      )
    );
  }
}

function ensureStream() {
  const now = Math.floor(Date.now() / 60000);
  if (stream == null || now !== currentMinute) openStream(new Date());
  ensureJsonlStream();
  ensureLatestStream();
}

// Strip ANSI only for file output; keep colors in terminal
const ANSI_REGEX = /[\u001b\u009b][[\]()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

function stripAnsi(s) {
  try { return s.replace(ANSI_REGEX, ''); } catch { return s; }
}

// Redact common secret patterns before writing to disk
function redactSecrets(s) {
  try {
    return s
      // OpenAI keys (sk-..., sk-proj-...)
      .replace(/sk-(?:proj-)?[A-Za-z0-9_-]{16,}/g, '[REDACTED:OPENAI]')
      // Slack tokens (xoxb-, xoxp-, xoxc-, xoxe-, etc.)
      .replace(/xox[a-z]-[A-Za-z0-9-]{10,}/g, '[REDACTED:SLACK]')
      // Slack app token
      .replace(/xapp-1-[A-Za-z0-9-]{10,}/g, '[REDACTED:SLACK_APP]')
      // Bearer tokens
      .replace(/(Bearer\s+)[A-Za-z0-9._-]{16,}/gi, '$1[REDACTED:BEARER]')
      // Generic JSON fields likely to contain secrets
      .replace(/("(?:api_?key|token|access_?token|authorization)"\s*:\s*")([^"\n]{8,})(")/gi, '$1[REDACTED]$3');
  } catch {
    return s;
  }
}

function toStringChunk(chunk, encoding) {
  if (typeof chunk === 'string') return chunk;
  if (Buffer.isBuffer(chunk)) return chunk.toString(encoding || 'utf8');
  try { return String(chunk); } catch { return '' }
}

function writeBoth(origWrite, chunk, encoding, cb) {
  // 1) Terminal: write original as-is (preserves colors and formatting)
  origWrite(chunk, encoding, () => {});
  // 2) File: sanitize
  ensureStream();
  if (!stream) { cb && cb(); return; }
  const text = toStringChunk(chunk, encoding);
  const sanitized = redactSecrets(stripAnsi(text));
  stream.write(sanitized, 'utf8', cb);
  feedJsonl(sanitized);
  feedLatest(sanitized);
}

process.stdout.write = (chunk, enc, cb) => writeBoth(origStdout, chunk, enc, cb);
process.stderr.write = (chunk, enc, cb) => writeBoth(origStderr, chunk, enc, cb);

openStream();
ensureJsonlStream();
ensureLatestStream();
setInterval(ensureStream, 1000);

async function updateCurrentSymlink(targetPath) {
  try {
    const linkPath = path.join(TEXT_DIR, 'current.log');
    try {
      // Remove existing link or file
      const st = await fs.promises.lstat(linkPath).catch(() => null);
      if (st) await fs.promises.unlink(linkPath).catch(() => {});
    } catch (_) {}
    await fs.promises.symlink(targetPath, linkPath).catch(() => {});
  } catch (_) {}
}

// JSONL helpers
function ymd(d = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}

function jsonlFileFor(d = new Date()) {
  return path.join(JSONL_DIR, `${LOG_PREFIX}_${ymd(d)}.jsonl`);
}

function ensureJsonlStream(d = new Date()) {
  const dayKey = ymd(d);
  if (jsonlStream && currentDay === dayKey) return;
  if (jsonlStream) jsonlStream.end();
  const target = jsonlFileFor(d);
  jsonlStream = fs.createWriteStream(target, { flags: 'a' });
  currentDay = dayKey;
  updateCurrentJsonlSymlink(target).catch(() => {});
  cleanupJsonl().catch(() => {});
}

async function updateCurrentJsonlSymlink(targetPath) {
  try {
    const linkPath = path.join(JSONL_DIR, 'current.jsonl');
    try {
      const st = await fs.promises.lstat(linkPath).catch(() => null);
      if (st) await fs.promises.unlink(linkPath).catch(() => {});
    } catch (_) {}
    await fs.promises.symlink(targetPath, linkPath).catch(() => {});
  } catch (_) {}
}

async function cleanupJsonl() {
  const files = (await fs.promises.readdir(JSONL_DIR))
    .filter(f => f.startsWith(LOG_PREFIX) && f.endsWith('.jsonl'))
    .sort();
  
  // Check file sizes and separate empty from non-empty files
  const fileStats = await Promise.all(
    files.map(async f => {
      const filePath = path.join(JSONL_DIR, f);
      try {
        const stats = await fs.promises.stat(filePath);
        return { name: f, path: filePath, size: stats.size };
      } catch {
        return { name: f, path: filePath, size: 0 };
      }
    })
  );
  
  // Delete empty files immediately (< 50 bytes considered empty)
  const emptyFiles = fileStats.filter(f => f.size < 50);
  const nonEmptyFiles = fileStats.filter(f => f.size >= 50);
  
  if (emptyFiles.length > 0) {
    await Promise.all(
      emptyFiles.map(f => 
        fs.promises.rm(f.path).catch(() => {})
      )
    );
  }
  
  // Apply retention limit only to non-empty files
  const toDelete = nonEmptyFiles.length - JSONL_KEEP;
  if (toDelete > 0) {
    const filesToDelete = nonEmptyFiles.slice(0, toDelete);
    await Promise.all(
      filesToDelete.map(f =>
        fs.promises.rm(f.path).catch(() => {})
      )
    );
  }
}

// JSONL extraction: naive brace-depth parser for pretty JSON blocks
let lineBuffer = '';
let jsonLines = [];
let depth = 0;

function feedJsonl(text) {
  lineBuffer += text;
  let idx;
  while ((idx = lineBuffer.indexOf('\n')) !== -1) {
    const line = lineBuffer.slice(0, idx);
    lineBuffer = lineBuffer.slice(idx + 1);
    processLine(line);
  }
}

function processLine(line) {
  const t = line.trim();
  // start of JSON block
  if (jsonLines.length === 0 && (t.startsWith('{') || t.startsWith('['))) {
    jsonLines.push(line);
    depth += netDepth(line);
    if (depth === 0) flushJsonl();
    return;
  }
  // inside JSON block
  if (jsonLines.length > 0) {
    jsonLines.push(line);
    depth += netDepth(line);
    if (depth === 0) flushJsonl();
  }
}

function netDepth(s) {
  let d = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '{' || c === '[') d++;
    else if (c === '}' || c === ']') d--;
  }
  return d;
}

function flushJsonl() {
  if (!jsonlStream || jsonLines.length === 0) { jsonLines = []; depth = 0; return; }
  const block = jsonLines.join('\n');
  jsonLines = []; depth = 0;
  try {
    const obj = JSON.parse(block);
    jsonlStream.write(JSON.stringify(obj) + '\n');
  } catch (_) {
    // ignore if not valid JSON
  }
}

// Latest log helpers - circular buffer maintaining last N lines
function ensureLatestStream() { /* no-op */ }

function feedLatest(text) {
  if (!text) return;
  latestLineBuffer += text;
  let idx;
  while ((idx = latestLineBuffer.indexOf('\n')) !== -1) {
    const line = latestLineBuffer.slice(0, idx);
    latestLineBuffer = latestLineBuffer.slice(idx + 1);
    latestBuffer.push(line);
    while (latestBuffer.length > LATEST_LINES) latestBuffer.shift();
  }
  writeLatestFile();
}

function writeLatestFile() {
  const latestPath = path.join(TEXT_DIR, 'latest.log');
  try {
    fs.writeFileSync(latestPath, latestBuffer.join('\n'), 'utf8');
  } catch (error) {
    // Silently ignore write errors
  }
}
