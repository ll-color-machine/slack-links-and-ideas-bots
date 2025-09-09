const llog = require('learninglab-log');
const OpenAI = require('openai');
const airtableTools = require('../../utils/ll-airtable-tools');
const { getEmojiAction } = require('../../config');
const messageHandler = require('../../handlers/message-handler');
const { processFile: processPdfFile } = require('../pdf-bot');

const MAX_CONTEXT_CHARS = Number(process.env.EMOJI_CONTEXT_MAX || 18000);
const MAX_PROMPT_SAVE = Number(process.env.EMOJI_PROMPT_MAX || 95000);
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5';

async function handleReaction({ client, event }) {
  try {
    const emoji = String(event.reaction || '').trim();
    if (!emoji) return;
    const action = getEmojiAction(emoji);
    if (!action || action.action_type !== 'agent') return; // Only handle agent-type emojis

    llog.cyan({ emoji_agent_trigger: { emoji, action } });

    const channel = event?.item?.channel;
    const ts = event?.item?.ts;
    if (!channel || !ts) {
      llog.yellow('emoji-bot: missing channel/ts');
      return;
    }

    // 0) Backfill if this message hasn't been indexed yet
    await backfillIfMissing({ client, event });

    // 1) Collect context from Airtable
    const ctx = await collectContext({ ts, channel });
    const prompt = buildPrompt(action, ctx);
    const clippedPrompt = prompt.length > MAX_CONTEXT_CHARS ? prompt.slice(0, MAX_CONTEXT_CHARS) : prompt;

    // 2) Generate with OpenAI
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    llog.yellow(`emoji-bot: generating with ${OPENAI_MODEL}`);
    const resp = await openai.responses.create({ model: OPENAI_MODEL, input: clippedPrompt });
    const text = resp?.output_text || '(no output)';

    // 3) Post reply in thread
    const header = `:${emoji}: ${action.prompt_name || 'Agent Response'}`;
    const threadPost = await client.chat.postMessage({ channel, thread_ts: ts, text: `${header}\n\n${text}` });
    llog.green('emoji-bot: response posted');

    // 4) Also send to discuss channel if configured
    let discussPost = null;
    try {
      const discussChannel = process.env.SLACK_BOTS_DISCUSS_LINKS_CHANNEL;
      if (discussChannel) {
        // Try to get permalink to the original message for context
        let linkLine = '';
        try {
          const perm = await client.chat.getPermalink({ channel, message_ts: ts });
          if (perm?.permalink) linkLine = `Original: ${perm.permalink}`;
        } catch (_) {}
        const discussText = `${header}\n${linkLine}\n\n${text}`;
        discussPost = await client.chat.postMessage({ channel: discussChannel, text: discussText });
      }
    } catch (e) { llog.gray(`emoji-bot: discuss post failed: ${e}`); }

    // 5) Save to Airtable Responses
    try {
      await saveResponseToAirtable({
        event, ctx, header, text,
        response: resp,
        slackThreadPost: threadPost,
        slackDiscussPost: discussPost,
        emojiName: emoji,
        prompt: clippedPrompt.slice(0, MAX_PROMPT_SAVE),
      });
    } catch (e) { llog.gray(`emoji-bot: save response failed: ${e}`); }
  } catch (error) {
    llog.red(`emoji-bot error: ${error}`);
  }
}

function buildPrompt(action, ctx) {
  const tmpl = Array.isArray(action.prompt_template) ? action.prompt_template.join('\n') : String(action.prompt_template || '');
  const parts = [];
  parts.push(tmpl);
  parts.push('\n---\nContext from Slack message and related records:');
  if (ctx.messageText) parts.push(`Message text:\n${ctx.messageText}`);
  if (ctx.links && ctx.links.length) {
    parts.push(`\nLinks (${ctx.links.length}):`);
    for (const l of ctx.links) {
      const md = l.markdown || l.summary || '';
      const mdClip = md.length > 6000 ? md.slice(0, 6000) : md;
      parts.push(`- URL: ${l.url}\n  Title: ${l.title || ''}\n  Domain: ${l.domain || ''}\n  Summary/Markdown:\n${mdClip}`);
    }
  }
  if (ctx.pdfs && ctx.pdfs.length) {
    parts.push(`\nPDFs (${ctx.pdfs.length}):`);
    for (const p of ctx.pdfs) {
      parts.push(`- Title: ${p.Title || ''}\n  Year: ${p.Year || ''}\n  Summary:\n${(p.Summary || '').slice(0, 4000)}`);
    }
  }
  return parts.join('\n');
}

async function collectContext({ ts, channel }) {
  const baseId = process.env.AIRTABLE_BASE_ID;
  const tLinks = process.env.AIRTABLE_TABLE_LINKS || 'Links';
  const tMsgs = process.env.AIRTABLE_TABLE_SLACK_MESSAGES || 'SlackMessages';
  const tPdfs = process.env.AIRTABLE_TABLE_PDFS || 'PDFs';
  const ctx = { messageText: '', links: [], pdfs: [], messageUserSlackId: '' };
  if (!baseId) return ctx;

  // Slack message text
  try {
    const msgRecs = await airtableTools.findMany({ baseId, table: tMsgs, filterByFormula: `{slack_ts} = '${ts}'`, maxRecords: 1 });
    const rec = Array.isArray(msgRecs) ? msgRecs[0] : null;
    if (rec && typeof rec.get === 'function') {
      const json = rec.get('slack_json');
      if (json) {
        try { const parsed = JSON.parse(json); ctx.messageText = parsed?.message?.text || ''; ctx.messageUserSlackId = parsed?.message?.user || ''; } catch { ctx.messageText = ''; }
      }
    }
  } catch (e) { llog.gray(`emoji-bot: msg fetch failed: ${e}`); }

  // Links for this message
  try {
    const linkRecs = await airtableTools.findMany({ baseId, table: tLinks, filterByFormula: `{slack_message_ts} = '${ts}'`, maxRecords: 25 });
    for (const r of linkRecs || []) {
      const get = (f) => (typeof r.get === 'function' ? r.get(f) : (r.fields ? r.fields[f] : undefined));
      ctx.links.push({
        url: get('url') || '',
        title: get('title') || '',
        summary: get('summary') || '',
        markdown: get('markdown') || '',
        domain: get('domain') || '',
      });
    }
  } catch (e) { llog.gray(`emoji-bot: links fetch failed: ${e}`); }

  // PDFs related to this message (best-effort — depends on schema)
  try {
    // If you add a slack_message_ts field to PDFs, this will work:
    const pdfRecs = await airtableTools.findMany({ baseId, table: tPdfs, filterByFormula: `{slack_message_ts} = '${ts}'`, maxRecords: 10 });
    for (const r of pdfRecs || []) ctx.pdfs.push(r.fields || {});
  } catch (_) {}

  return ctx;
}

module.exports = { handleReaction };

async function saveResponseToAirtable({ event, ctx, header, text, response, slackThreadPost, slackDiscussPost, emojiName, prompt }) {
  const baseId = process.env.AIRTABLE_BASE_ID;
  const table = process.env.AIRTABLE_TABLE_RESPONSES || 'Responses';
  if (!baseId) return;

  // Lookup user Airtable IDs
  let requestedById = null;
  let messageUserId = null;
  try { requestedById = (global.APP_CONFIG?.usersById?.[event.user]?.id) || null; } catch (_) {}
  try { messageUserId = (global.APP_CONFIG?.usersById?.[ctx.messageUserSlackId]?.id) || null; } catch (_) {}

  const record = {
    title: `${emojiName}: ${header.replace(/^:[^:]+:\s*/,'')}`,
    text,
    slack_ts: event?.item?.ts || '',
    response_json: safeJson(response),
    slack_json: safeJson(slackDiscussPost || slackThreadPost || {}),
    _prompt: prompt || '',
    environment: process.env.NODE_ENV || 'production',
    _requested_by_user: requestedById ? [requestedById] : undefined,
    _message_user: messageUserId ? [messageUserId] : undefined,
  };

  try {
    const res = await airtableTools.addRecord({ baseId, table, record });
    llog.cyan({ emoji_response_saved: { id: res?.id, table } });
  } catch (e) {
    llog.yellow(`emoji-bot: failed saving response: ${e}`);
  }
}

function safeJson(obj) {
  try { return JSON.stringify(obj, null, 2); } catch { return ''; }
}

// If message not present in Airtable (and/or links/pdfs missing), fetch and run normal processors
async function backfillIfMissing({ client, event }) {
  try {
    const baseId = process.env.AIRTABLE_BASE_ID;
    if (!baseId) return;
    const ts = event?.item?.ts; const channel = event?.item?.channel;
    const tMsgs = process.env.AIRTABLE_TABLE_SLACK_MESSAGES || 'SlackMessages';
    const tLinks = process.env.AIRTABLE_TABLE_LINKS || 'Links';
    const tPdfs  = process.env.AIRTABLE_TABLE_PDFS  || 'PDFs';

    const msgRecs = await airtableTools.findMany({ baseId, table: tMsgs, filterByFormula: `{slack_ts} = '${ts}'`, maxRecords: 1 }) || [];
    const linkRecs = await airtableTools.findMany({ baseId, table: tLinks, filterByFormula: `{slack_message_ts} = '${ts}'`, maxRecords: 1 }) || [];
    const pdfRecs  = await airtableTools.findMany({ baseId, table: tPdfs,  filterByFormula: `{slack_message_ts} = '${ts}'`, maxRecords: 1 }) || [];

    const needsMsg = msgRecs.length === 0;
    const needsLinks = linkRecs.length === 0;
    const needsPdfs = pdfRecs.length === 0;
    if (!needsMsg && !needsLinks && !needsPdfs) return;

    // Fetch the source message from Slack
    const hist = await client.conversations.history({ channel, latest: ts, inclusive: true, limit: 1 }).catch(()=>null);
    const message = hist?.messages?.[0];
    if (!message) return;

    // Run message-handler to upsert and process links
    if (needsMsg || needsLinks) {
      try { await messageHandler.parseAll({ client, message, say: async()=>{}, event: message }); } catch (e) { llog.gray(`backfill message-handler failed: ${e}`); }
    }

    // Process any PDFs directly from the message
    if (needsPdfs) {
      const files = Array.isArray(message.files) ? message.files : [];
      const pdfs = files.filter((f)=>{
        const name = (f.name||'').toLowerCase();
        return f.mimetype === 'application/pdf' || name.endsWith('.pdf');
      });
      for (const file of pdfs) {
        try { await processPdfFile({ slackClient: client }, { file, channelId: channel, thread_ts: ts }); } catch (e) { llog.gray(`backfill pdf failed: ${e}`); }
      }
    }
  } catch (e) {
    llog.gray(`emoji-bot backfill failed: ${e}`);
  }
}
