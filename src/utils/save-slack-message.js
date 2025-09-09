const llog = require('learninglab-log');
const airtableTools = require('./ll-airtable-tools');
const { getRuntimeConfig } = require('../config');

/**
 * Upserts a Slack message into Airtable `SlackMessages` (or env override).
 * Fields: slack_ts (key), slack_json (stringified), slack_channel
 */
module.exports.upsertSlackMessage = async function upsertSlackMessage({ message, event }) {
  try {
    const baseId = process.env.AIRTABLE_BASE_ID;
    const table = process.env.AIRTABLE_TABLE_SLACK_MESSAGES || 'SlackMessages';
    const apiKey = process.env.AIRTABLE_API_TOKEN;
    if (!apiKey || !baseId) {
      llog.gray('Skip SlackMessages upsert: missing Airtable env');
      return { skipped: true, reason: 'missing_env' };
    }

    const ts = String(message?.ts || event?.ts || message?.message_ts || '').trim();
    if (!ts) {
      llog.gray('Skip SlackMessages upsert: missing ts');
      return { skipped: true, reason: 'missing_ts' };
    }

    const channel = String(event?.channel || message?.channel || '').trim();
    const userId = String(message?.user || '').trim();
    const json = JSON.stringify({ message, event });
    const envVal = process.env.NODE_ENV || 'production';

    // Optional: link message -> Users table record by Slack ID
    const cfg = getRuntimeConfig ? getRuntimeConfig() : global.APP_CONFIG;
    const userRec = cfg?.usersById ? cfg.usersById[userId] : null;
    const userField = process.env.AIRTABLE_FIELD_MSG_USER || '_user'; // Airtable link field (to Users)
    const linkPatch = userRec?.id ? { [userField]: [userRec.id] } : {};

    const hasUnknownFieldErr = (res) => !!res && (res.error === 'UNKNOWN_FIELD_NAME' || /Unknown field name/i.test(String(res.message||'')));

    // Idempotent: check by slack_ts
    const existing = await airtableTools.findOneByValue({
      baseId,
      table,
      field: 'slack_ts',
      value: ts,
    }).catch(() => null);

    if (existing && existing.id) {
      let res = await airtableTools.updateRecord({
        baseId,
        table,
        recordId: existing.id,
        updatedFields: { slack_json: json, slack_channel: channel, environment: envVal, ...linkPatch },
      });
      if (hasUnknownFieldErr(res)) {
        llog.yellow(`Airtable field ${userField} missing; updating without user link`);
        res = await airtableTools.updateRecord({
          baseId,
          table,
          recordId: existing.id,
          updatedFields: { slack_json: json, slack_channel: channel, environment: envVal },
        });
      }
      return { action: 'updated', id: existing.id };
    }

    let created = await airtableTools.addRecord({
      baseId,
      table,
      record: { slack_ts: ts, slack_json: json, slack_channel: channel, environment: envVal, ...linkPatch },
    });
    if (hasUnknownFieldErr(created)) {
      llog.yellow(`Airtable field ${userField} missing; creating without user link`);
      created = await airtableTools.addRecord({
        baseId,
        table,
        record: { slack_ts: ts, slack_json: json, slack_channel: channel, environment: envVal },
      });
    }

    return created?.id ? { action: 'created', id: created.id } : { failed: true };
  } catch (err) {
    llog.red(err);
    return { failed: true, error: String(err) };
  }
}
