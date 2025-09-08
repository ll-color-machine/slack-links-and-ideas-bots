# slack-links-and-ideas-bots

A Slack Bolt app (Node.js) that listens to messages and events, processes PDFs with OpenAI, and syncs runtime config and users via Airtable.

## Quickstart

- Prereqs: Node 18+, npm, a Slack app with Socket Mode enabled.
- Copy env template and fill in values:
  - `cp .env.dev.example .env.dev`
- Install deps and start in dev mode:
  - `npm install`
  - `npm run dev`

The app loads environment variables from `.env.${NODE_ENV}`. The dev script sets `NODE_ENV=dev`.

## Environment

See `.env.dev.example` for a complete list. Required for core features:

- Slack: `SLACK_BOT_TOKEN`, `SLACK_APP_TOKEN`, `SLACK_SIGNING_SECRET`, `SLACK_LOGGING_CHANNEL`
- Airtable: `AIRTABLE_API_TOKEN`, `AIRTABLE_BASE_ID`
- OpenAI (PDF analysis): `OPENAI_API_KEY`

Optional: table names (`AIRTABLE_TABLE_USERS`, `AIRTABLE_TABLE_EMOJIS`, `AIRTABLE_TABLE_PROMPTS`, `AIRTABLE_TABLE_FLOWS`), `SLACK_USER_TOKEN` (for certain file operations), and logging/config tunables.

## Slack Scopes (suggested)

- `chat:write`, `files:read`, `reactions:read`
- `users:read` (required for user sync)
- `channels:read`, `groups:read`, `im:read`, `mpim:read`
- `channels:history`, `groups:history`, `im:history`, `mpim:history`

Events: `message.channels`, `message.groups`, `message.im`, `message.mpim`, `reaction_added`, `file_shared`.

## Scripts

- `npm run dev` — Nodemon, loads `.env.dev` and logs to `logs/`
- `npm start` — Production start (`NODE_ENV=production`)
