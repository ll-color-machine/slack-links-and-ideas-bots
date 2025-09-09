# handle retries etc

mk—yep, this style (a plain module with top-level `App` + an async IIFE) is totally idiomatic for Bolt. Quick sanity check + small fixes:

### ✅ Good / idiomatic here

* Single `App` instance with `socketMode: true`.
* Top-level `await app.start(...)` inside an IIFE.
* Splitting handlers (`handleMessages`, `handlers`) and wiring routes in `app.js`.
* Doing runtime warm-up (sync users, refresh config) **before** starting the app (Web API works pre-start).

### ⚠️ Nits / fixes I’d make

1. **`port` in `new App({...})` is ignored**
   Only `app.start(port)` uses it. Remove the `port` field from the constructor to avoid confusion.

```js
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET, // harmless in socket mode
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  // port: X  <-- remove
});
```

2. **Filter noisy `message` events**
   Your `app.message(/.*/, ...)` will catch bot and edited messages. Guard to prevent loops/waste:

```js
app.message(/.*/, async (args) => {
  const { message, event, client, say } = args;
  if (event.subtype || event.bot_id) return;       // ignore bots/edits
  return handleMessages.parseAll(args);            // pass full context to handler
});
```

(Keep the `"testing testing"` route first; that’s fine.)

3. **Ensure handlers accept Bolt’s full payload**
   If your handler is `function parseAll({ message, event, client, context, say }) { ... }`, you can pass it directly:

```js
app.message("testing testing", handleMessages.testing);
app.message(/.*/, handleMessages.parseAll); // parseAll({ message, event, say, client, context })
```

If your handler signature is currently `(text) => {}`, switch to the object form so you can `say`, `client`, etc.

4. **Retries & idempotency (events like `file_shared`)**
   Slack will retry on timeouts/5xx. Dedupe by `event_id` or `file.id`:

```js
app.event('file_shared', async (args) => {
  const { event, context } = args;
  if (context.retryNum) return; // ignore retried deliveries
  // …process once…
  return handlers.eventHandler.fileShared(args);
});
```

5. **Startup post: guard for missing access / not-in-channel**
   Posting on boot can 1) fail if the bot isn’t in the channel, 2) 5xx. Wrap it:

```js
try {
  await app.client.chat.postMessage({
    channel: process.env.SLACK_LOGGING_CHANNEL,
    text: "starting up the links-and-ideas-bots",
  });
} catch (e) {
  llog.red("Boot post failed", e?.data || e);
}
```

6. **Env loading fallback**
   If you sometimes don’t have `.env.production`, add a fallback to plain `.env`:

```js
const envPath = path.resolve(__dirname, `.env.${process.env.NODE_ENV || 'development'}`);
require('dotenv').config({ path: fs.existsSync(envPath) ? envPath : path.resolve(__dirname, '.env') });
```

7. **Avoid `global.ROOT_DIR` if you can**
   Prefer exporting a constant from a small `paths.js`:

```js
// src/paths.js
module.exports.ROOT_DIR = __dirname;
```

Then `const { ROOT_DIR } = require('./src/paths');`

8. **Graceful shutdown**
   Even in socket mode, it’s good hygiene:

```js
const stop = async (sig) => {
  llog.yellow(`Received ${sig}, shutting down...`);
  try { await app.stop?.(); } catch {}
  process.exit(0);
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
```

9. **Scopes for `file_shared` path**
   Make sure you’ve got `files:read`, `channels:history` (or relevant `im:history`, etc.), and handle `url_private(_download)` with the bot token header.

---

### Minimal patched `app.js` (your style, with the fixes)

```js
const { App } = require("@slack/bolt");
const path = require("path");
const fs = require("fs");
const llog = require("learninglab-log");
const handleMessages = require("./src/handlers/message-handler");
const handlers = require("./src/handlers");
const { initRuntimeConfig, refreshRuntimeConfig, syncSlackUsersToAirtable } = require("./src/config");

const envPath = path.resolve(__dirname, `.env.${process.env.NODE_ENV || 'development'}`);
require("dotenv").config({
  path: fs.existsSync(envPath) ? envPath : path.resolve(__dirname, ".env"),
});

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET, // ok in socket mode
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

app.message("testing testing", handleMessages.testing);

app.message(/.*/, async (args) => {
  const { event } = args;
  if (event.subtype || event.bot_id) return; // skip bots/edits
  return handleMessages.parseAll(args);
});

// Events
app.event("file_shared", async (args) => {
  const { context } = args;
  if (context.retryNum) return;   // dedupe retries
  return handlers.eventHandler.fileShared(args);
});

app.event("reaction_added", handlers.eventHandler.reactionAdded);

(async () => {
  await initRuntimeConfig();
  await syncSlackUsersToAirtable({ slackClient: app.client }).catch(() => {});
  await refreshRuntimeConfig().catch(() => {});

  const port = Number(process.env.PORT) || 3000;
  await app.start(port);
  llog.yellow(`⚡️ Bolt app is running (socket mode) [port=${port}]`);

  try {
    if (process.env.SLACK_LOGGING_CHANNEL) {
      await app.client.chat.postMessage({
        channel: process.env.SLACK_LOGGING_CHANNEL,
        text: "starting up the links-and-ideas-bots",
      });
    }
  } catch (e) {
    llog.red("Boot post failed", e?.data || e);
  }

  const stop = async (sig) => {
    llog.yellow(`Received ${sig}, shutting down...`);
    try { await app.stop?.(); } catch {}
    process.exit(0);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
})();
```

If you paste your `message-handler` and `handlers.eventHandler` signatures, I’ll check the params/acks and the `file_shared` flow (scopes, `files.info`, `url_private_download`, retries) for any hidden footguns.


----

Good eye—`context.retryNum` isn’t something you invent, it’s something **Slack Bolt injects** when it detects the request you’re handling is a **retry of a previous event delivery**.

Here’s what’s going on:

---

### Why Slack retries

* Slack’s Events API **expects a 200 OK within 3 seconds**.
* If your app is slow, errors, or network hiccups occur, Slack assumes the event wasn’t processed.
* It will resend the exact same event payload, with extra HTTP headers like:

  * `X-Slack-Retry-Num: 1`
  * `X-Slack-Retry-Reason: http_timeout` or `failed_request`

---

### How Bolt surfaces this

Bolt copies those headers into the `context` object it passes to your listener.

So:

```js
app.event('file_shared', async ({ event, context }) => {
  console.log(context.retryNum);     // → e.g. "1"
  console.log(context.retryReason);  // → e.g. "http_timeout"
});
```

* `context.retryNum` = how many times Slack has retried this event.
* `context.retryReason` = why (timeout, http\_error, etc.).

---

### Why check it

If your handler isn’t idempotent (e.g. it saves to Airtable, posts a message, kicks off a download), you can get **duplicates** when Slack retries.

So a simple pattern is:

```js
if (context.retryNum) return;  // bail on retries
```

That guarantees your handler only runs on the **first** delivery.

If you want more control, you could instead dedupe by `event_id` (Slack guarantees every event has a unique ID in the payload), but `context.retryNum` is a quick way to avoid accidental double-processing.

---

✅ **Summary**:
`context.retryNum` is Bolt’s way of telling you *“Slack has already sent this event before; this is retry #N.”*
You check it so you can ignore retries or make your handler idempotent.

---

Do you want me to sketch the **idempotent pattern using `event_id`**? That’s a bit more robust than just skipping retries, since it covers the case where Slack retries because *your first attempt actually failed partway*.


---

## but

---

Short answer: you’re right—you shouldn’t blindly drop retries. Treat Slack delivery as **at-least-once** and make your handler **idempotent** so a retry either (a) does nothing because work is already done, or (b) safely resumes/duplicates without side-effects.

Here’s a pragmatic pattern:

## Core rules

1. **Ack fast, do work async.**
   For commands/actions: `await ack()` in <3s, then enqueue work. For events, keep the listener thin and enqueue immediately.

2. **Use an idempotency key.**
   Good keys:

* Pure event: `event.event_id`
* File-specific: `${event.event_id}:${event.file_id}` **or** `${file.id}:${channel}` (Slack may emit multiple file\_shared events—per channel/recipient).

3. **Record state in a durable store.**
   Keep a small “inbox” table/Redis keys with states: `pending` → `processing` → `done` (and `failed`).

4. **On retry:**

* If `done`: no-op.
* If `processing`: no-op (another worker is handling it).
* If `pending`/missing: enqueue again.

`context.retryNum` is just a hint (“this is a retry”); the *decision* should come from your own state.

---

## Minimal Redis lock + dedupe (safe, simple)

```js
// deps: ioredis or redis client
const redis = /* ... */;
const TTL_SEC = 24 * 60 * 60; // dedupe window

function keyFor(event) {
  // pick what makes sense for you:
  const fileId = event.file?.id || event.file_id;
  return fileId ? `fs:${fileId}:${event.channel}` : `evt:${event.event_id}`;
}

async function processFileShared({ event, client, context }) {
  const key = keyFor(event);

  // Try to acquire a short "processing" lock (prevents parallel dupes)
  const gotLock = await redis.set(`lock:${key}`, '1', 'NX', 'EX', 300); // 5 min
  if (!gotLock) {
    // Someone else is already processing; let them finish
    return;
  }

  try {
    // Dedup: if already marked done, skip
    const done = await redis.get(`done:${key}`);
    if (done) return;

    // ... do your work here (download file, parse, write to Airtable/S3, etc.) ...

    // Mark as done (longer TTL)
    await redis.set(`done:${key}`, '1', 'EX', TTL_SEC);
  } catch (err) {
    // Optional: increment failures, log, etc.
    throw err; // allow your worker framework to retry, or swallow and log
  } finally {
    // Always release the processing lock
    await redis.del(`lock:${key}`);
  }
}
```

Wire it in your listener:

```js
app.event('file_shared', async ({ event, client, context }) => {
  // You can log context.retryNum / context.retryReason if you like
  // but do NOT base correctness on it—use your state above.
  await processFileShared({ event, client, context });
});
```

---

## Queue-based variant (BullMQ / SQS) — my preferred

Enqueue with an idempotent job ID; the queue guarantees no duplicate enqueues:

```js
// BullMQ
queue.add('fileShared', { event }, {
  jobId: keyFor(event),        // idempotency
  attempts: 5, backoff: { type: 'exponential', delay: 5000 },
  removeOnComplete: true, removeOnFail: false,
});

// Worker
worker.process(async (job) => {
  const key = job.id;
  // Check "done" key/table; if present, return
  // Otherwise do the work, then mark done
});
```

SQS/SNS, Cloud Tasks, etc. have similar “dedupe keys” or FIFO message group IDs.

---

## Downstream idempotency (belt-and-suspenders)

Even with the above, make writes idempotent:

* **Airtable**: Upsert by an `ExternalID` field (your `key`); use `updateBy` logic or search first.
* **S3**: Deterministic object key (e.g., `files/${file.id}`); overwrites are fine.
* **DB**: `INSERT ... ON CONFLICT DO NOTHING/UPDATE`.

---

## Handling real failures

Your question: *“If try #1 failed, should I confirm something is in flight before dismissing try #2?”*
The lock pattern above does exactly that:

* If a worker is **currently** processing (lock exists), skip duplicate work and let it finish.
* If the previous attempt **crashed** (lock gone, no `done` marker), the **retry will re-acquire the lock and process**. That’s what you want.

`context.retryNum > 0` can be useful for **logging/metrics**, but correctness should rely on your **idempotency key + durable state**.

---

## Quick checklist

* [ ] Ack fast; push heavy work to a queue/worker.
* [ ] Derive a stable idempotency key (event\_id / file.id + channel).
* [ ] Acquire a short processing lock (Redis `SET NX EX`) before work.
* [ ] Mark “done” on success with a reasonable TTL; check before work.
* [ ] Make downstream writes idempotent (Airtable/S3/DB).
* [ ] Log `context.retryNum`/`retryReason`, but **don’t** use them as your gate.

With this, retries are your friend: if run #1 dies, run #2 will safely pick up; if run #1 succeeded, run #2 becomes a no-op.
