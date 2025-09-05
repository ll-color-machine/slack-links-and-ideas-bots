# Airtable‑Driven Slack Bot Ensemble — **JS v0.2 (Ingestor‑First)**

> Goal: Use **plain JavaScript** (no TS) with **Slack Bolt**. Pull bot configs from Airtable later, but **Agent #1 (Ingestor)** always runs on **every message** and saves it to Airtable. If the message contains **links, PDFs, videos, or images**, they’re processed and stored in their respective Airtable asset tables. Links are **scraped** for metadata.

---

## 0) What this version does
- Listens to Slack messages (channels, groups, IMs) and `file_shared` events.
- Creates one record per message in **Airtable → Messages**.
- Extracts and **scrapes links** → stores metadata in **Airtable → Links**.
- Detects **PDF / Video / Image** files → stores file metadata in **Airtable → PDFs / Videos / Images**.
- Optionally requests **public file links** from Slack (`files.sharedPublicURL`) if you want to attach URLs in Airtable (toggle by env var).

*(Future: Triggers + multiple agents from Airtable; chaining, cooldowns, posting, etc.)*

---

## 1) Airtable schema (minimum viable)

Create a base with these tables (you can rename; update env vars accordingly):

**Messages**
- `SlackTs` (text)
- `ChannelId` (text)
- `UserId` (text)
- `Text` (long text)
- `Permalink` (url)
- `ThreadTs` (text)
- `IsBot` (checkbox)
- `LinkCount` (number)
- `FileCount` (number)

**Links**
- `MessageSlackTs` (text) — or use Airtable link to Messages if you prefer
- `Url` (url)
- `Title` (text)
- `Description` (long text)
- `Publisher` (text)
- `Author` (text)
- `Image` (url)
- `Logo` (url)
- `StatusCode` (number)
- `FetchedAt` (date)

**PDFs**
- `MessageSlackTs` (text)
- `SlackFileId` (text)
- `Name` (text)
- `Mimetype` (text)
- `Size` (number)
- `Permalink` (url)
- `AttachmentURL` (url) — optional public URL if enabled

**Videos**
- `MessageSlackTs` (text)
- `SlackFileId` (text)
- `Name` (text)
- `Mimetype` (text)
- `Size` (number)
- `Permalink` (url)
- `AttachmentURL` (url)

**Images**
- `MessageSlackTs` (text)
- `SlackFileId` (text)
- `Name` (text)
- `Mimetype` (text)
- `Size` (number)
- `Permalink` (url)
- `AttachmentURL` (url)

> You can switch `MessageSlackTs` to a proper **Link to another record** if you want relational joins. Using plain text keeps v0 simple and avoids needing to upsert and patch relations.

---

## 2) Slack app — scopes & events

**Bot scopes (OAuth & Permissions):**
- `app_mentions:read`
- `channels:history`, `groups:history`, `im:history`, `mpim:history`
- `channels:read`, `groups:read`, `im:read`, `mpim:read`
- `chat:write`
- `files:read` *(to read file metadata)*
- *(Optional)* `links:read` *(only if you later use `link_shared` events)*

**Event subscriptions:**
- `message.channels`, `message.groups`, `message.im`, `message.mpim`
- `app_mention`
- `file_shared`

**Interactivity:** Not required for v0.

---

## 3) Environment

Create `.env` from this template:

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...      # Socket Mode
SLACK_SIGNING_SECRET=...
AIRTABLE_API_TOKEN=...
AIRTABLE_BASE_ID=appXXXXXXXXXXXXXX
AIRTABLE_TABLE_MESSAGES=Messages
AIRTABLE_TABLE_LINKS=Links
AIRTABLE_TABLE_PDFS=PDFs
AIRTABLE_TABLE_VIDEOS=Videos
AIRTABLE_TABLE_IMAGES=Images
ALLOW_PUBLIC_FILE_LINKS=false   # if true, call files.sharedPublicURL
PORT=3000
```

---

## 4) Project layout (plain JS)

```
slack-ensemble-js/
  src/
    index.js            # app entry, Bolt init
    handlers.js         # wires events to ingestor
    ingestor.js         # Agent #1: save message + assets
    airtable.js         # Airtable helpers
    scraper.js          # link scraping via metascraper
    utils/
      extractLinks.js   # extract & normalize URLs from Slack text
  .env.example
  package.json
  README.md
```

---

## 5) Install

```sh
pnpm init -y
pnpm add @slack/bolt airtable pino dotenv metascraper metascraper-author metascraper-description metascraper-image metascraper-logo metascraper-publisher metascraper-title metascraper-url
```

*(Node 18+ provides global `fetch`, so no extra HTTP lib needed.)*

Add scripts to `package.json`:
```json
{
  "type": "commonjs",
  "scripts": {
    "dev": "node src/index.js",
    "start": "node src/index.js"
  }
}
```

---

## 6) Code — **index.js**
```js
require('dotenv/config');
const { App } = require('@slack/bolt');
const pino = require('pino');
const { registerHandlers } = require('./handlers');

const log = pino({ level: process.env.LOG_LEVEL || 'info' });

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN, // Socket Mode
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  port: Number(process.env.PORT) || 3000,
  logger: { // minimal bridge to pino
    debug: (...args) => log.debug(args),
    info: (...args) => log.info(args),
    warn: (...args) => log.warn(args),
    error: (...args) => log.error(args)
  }
});

registerHandlers(app, log);

(async () => {
  await app.start();
  log.info('⚡️ Slack Ingestor running');
})();
```

---

## 7) Code — **handlers.js**
```js
const { ingestMessage } = require('./ingestor');

function isFromBot(message) {
  return !!(message.bot_id || message.subtype === 'bot_message');
}

function isMessageEvent(message) {
  // Ignore edits/deletes etc. Only ingest new user messages with text/files
  if (message.subtype && message.subtype !== 'file_share') return false;
  return true;
}

module.exports.registerHandlers = (app, log) => {
  // All messages (channels, groups, ims, mpims)
  app.message(async ({ client, message, event, say, context }) => {
    try {
      if (!isMessageEvent(message) || isFromBot(message)) return;
      await ingestMessage({ client, log, message });
    } catch (err) {
      log.error({ err }, 'message handler failed');
    }
  });

  // When a file is shared without obvious message text
  app.event('file_shared', async ({ client, event, context, body }) => {
    try {
      // The event contains file id, channel id may be in body.container?.channel_id
      // We’ll attempt to fetch the message via files.info → shares
      const fileId = event?.file_id || event?.file?.id;
      if (!fileId) return;
      await ingestMessage({ client, log, message: { type: 'file_shared_event', file_id: fileId } });
    } catch (err) {
      log.error({ err }, 'file_shared handler failed');
    }
  });
};
```

---

## 8) Code — **ingestor.js** (Agent #1)
```js
const { saveMessage, saveLink, savePdf, saveVideo, saveImage } = require('./airtable');
const { extractLinks } = require('./utils/extractLinks');
const { scrapeLink } = require('./scraper');

async function getPermalink(client, channel, messageTs) {
  try {
    const res = await client.chat.getPermalink({ channel, message_ts: messageTs });
    return res?.permalink || '';
  } catch (_) {
    return '';
  }
}

async function expandFileById(client, fileId) {
  try {
    const info = await client.files.info({ file: fileId });
    return info?.file || null;
  } catch (_) {
    return null;
  }
}

async function maybeMakePublic(client, fileId) {
  if (String(process.env.ALLOW_PUBLIC_FILE_LINKS).toLowerCase() !== 'true') return null;
  try {
    await client.files.sharedPublicURL({ file: fileId });
    const info = await client.files.info({ file: fileId });
    return info?.file?.permalink_public || null;
  } catch (_) {
    return null;
  }
}

function classify(file) {
  const mime = (file.mimetype || '').toLowerCase();
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  return 'other';
}

async function processFiles({ client, messageSlackTs, channel, files = [] }) {
  for (const f of files) {
    const kind = classify(f);
    const publicUrl = await maybeMakePublic(client, f.id);
    const base = {
      MessageSlackTs: messageSlackTs,
      SlackFileId: f.id,
      Name: f.name,
      Mimetype: f.mimetype,
      Size: f.size,
      Permalink: f.permalink,
      AttachmentURL: publicUrl || ''
    };
    if (kind === 'pdf') await savePdf(base);
    else if (kind === 'video') await saveVideo(base);
    else if (kind === 'image') await saveImage(base);
    // ignore "other" for v0
  }
}

async function processLinks({ messageSlackTs, urls = [] }) {
  for (const url of urls) {
    try {
      const meta = await scrapeLink(url);
      await saveLink({
        MessageSlackTs: messageSlackTs,
        Url: url,
        Title: meta.title || '',
        Description: meta.description || '',
        Publisher: meta.publisher || '',
        Author: meta.author || '',
        Image: meta.image || '',
        Logo: meta.logo || '',
        StatusCode: meta.statusCode || null,
        FetchedAt: new Date().toISOString()
      });
    } catch (_) {
      // still write the bare URL if scraping fails
      await saveLink({ MessageSlackTs: messageSlackTs, Url: url });
    }
  }
}

async function ingestMessage({ client, log, message }) {
  // If we were invoked by file_shared event, lift the file + shares and synthesize a pseudo message
  if (message?.type === 'file_shared_event' && message.file_id) {
    const file = await expandFileById(client, message.file_id);
    if (!file) return;

    // Find at least one channel where it was shared
    const shares = file.shares || {};
    const groups = Object.values(shares?.private || {})[0] || [];
    const chans = Object.values(shares?.public || {})[0] || [];
    const shareObj = (groups[0] || chans[0]) || {};

    const channel = shareObj.channel_id || shareObj.channel || file?.channels?.[0];
    const ts = shareObj.ts || file?.timestamp || String(Date.now() / 1000);

    const permalink = file.permalink || '';
    const msgRecord = await saveMessage({
      SlackTs: ts,
      ChannelId: channel || '',
      UserId: file.user || '',
      Text: file.title || '',
      Permalink: permalink,
      ThreadTs: '',
      IsBot: false,
      LinkCount: 0,
      FileCount: 1
    });

    await processFiles({ client, messageSlackTs: ts, channel, files: [file] });
    return;
  }

  // Normal message handling
  const channel = message.channel;
  const ts = message.ts;
  const text = message.text || '';
  const user = message.user || '';
  const thread_ts = message.thread_ts || '';
  const permalink = await getPermalink(client, channel, ts);

  const urls = extractLinks(text);
  const files = Array.isArray(message.files) ? message.files : [];

  await saveMessage({
    SlackTs: ts,
    ChannelId: channel,
    UserId: user,
    Text: text,
    Permalink: permalink,
    ThreadTs: thread_ts,
    IsBot: false,
    LinkCount: urls.length,
    FileCount: files.length
  });

  if (urls.length) await processLinks({ messageSlackTs: ts, urls });
  if (files.length) await processFiles({ client, messageSlackTs: ts, channel, files });
}

module.exports = { ingestMessage };
```

---

## 9) Code — **airtable.js**
```js
const Airtable = require('airtable');

const base = new Airtable({ apiKey: process.env.AIRTABLE_API_TOKEN })
  .base(process.env.AIRTABLE_BASE_ID);

const T = {
  messages: process.env.AIRTABLE_TABLE_MESSAGES || 'Messages',
  links: process.env.AIRTABLE_TABLE_LINKS || 'Links',
  pdfs: process.env.AIRTABLE_TABLE_PDFS || 'PDFs',
  videos: process.env.AIRTABLE_TABLE_VIDEOS || 'Videos',
  images: process.env.AIRTABLE_TABLE_IMAGES || 'Images'
};

async function create(table, fields) {
  return new Promise((resolve, reject) => {
    base(table).create(fields, (err, record) => {
      if (err) return reject(err);
      resolve(record);
    });
  });
}

async function saveMessage(fields) {
  return create(T.messages, fields);
}

async function saveLink(fields) {
  return create(T.links, fields);
}

async function savePdf(fields) {
  return create(T.pdfs, fields);
}

async function saveVideo(fields) {
  return create(T.videos, fields);
}

async function saveImage(fields) {
  return create(T.images, fields);
}

module.exports = { saveMessage, saveLink, savePdf, saveVideo, saveImage };
```

---

## 10) Code — **scraper.js** (link metadata)
```js
const metascraper = require('metascraper');
const msAuthor = require('metascraper-author');
const msDesc = require('metascraper-description');
const msImage = require('metascraper-image');
const msLogo = require('metascraper-logo');
const msPublisher = require('metascraper-publisher');
const msTitle = require('metascraper-title');
const msUrl = require('metascraper-url');

const scraper = metascraper([
  msAuthor(),
  msDesc(),
  msImage(),
  msLogo(),
  msPublisher(),
  msTitle(),
  msUrl()
]);

async function scrapeLink(url) {
  let status = null;
  const res = await fetch(url, { redirect: 'follow' });
  status = res.status;
  const html = await res.text();
  const metadata = await scraper({ html, url });
  return { ...metadata, statusCode: status };
}

module.exports = { scrapeLink };
```

---

## 11) Code — **utils/extractLinks.js**
```js
// Extract Slack‑formatted <url|label> and bare URLs
const SLACK_LINK_RE = /<(https?:\/\/[^|>]+)(?:\|[^>]+)?>/gi;
const URL_RE = /https?:\/\/[^\s<>]+/gi;

function unique(arr) { return Array.from(new Set(arr)); }

function extractLinks(text = '') {
  const a = [];
  let m;
  while ((m = SLACK_LINK_RE.exec(text))) a.push(m[1]);
  const naked = text.match(URL_RE) || [];
  return unique(a.concat(naked));
}

module.exports = { extractLinks };
```

---

## 12) Run locally
```sh
cp .env.example .env  # fill in tokens & base ids
pnpm dev
```
Invite the bot to a test channel and post:
- A normal text message with a couple of links.
- A PDF upload, an image, and a video clip.

Then check Airtable tables for new rows.

---

## 13) Next steps (roadmap)
- Add **Airtable‑driven “Triggers”** table + router (keyword/regex/channel/etc.).
- Add **Agents** table and map triggers → agents; run after the Ingestor.
- Add **Routines** for file post‑processing (PDF text extraction, thumbnails, duration, etc.).
- Add **Admin slash commands** (e.g., `/ingestor on|off`, `/linktest <url>`).
- Add retry & dead‑letter queue for failed scrapes/saves.

