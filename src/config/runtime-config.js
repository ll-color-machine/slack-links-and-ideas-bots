const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const llog = require("learninglab-log");
const airtableTools = require("../utils/ll-airtable-tools");
const { WebClient } = require("@slack/web-api");

const ROOT = global.ROOT_DIR || process.cwd();
const CACHE_DIR = path.join(ROOT, "_cache");
const CACHE_PATH = process.env.CONFIG_CACHE_PATH || path.join(CACHE_DIR, "config.json");
const REFRESH_MS = Number(process.env.CONFIG_REFRESH_MS || 5 * 60 * 1000); // 5 minutes

let state = {
  loadedAt: 0,          // ephemeral (not persisted)
  usersById: {},        // in-memory index (not persisted)
  users: [],
  emojisByName: {},     // in-memory index (not persisted)
  emojis: [],
  promptsByName: {},    // in-memory index (not persisted)
  prompts: [],
  flowsByName: {},      // in-memory index (not persisted)
  flows: [],
};

async function ensureDir(dir) {
  if (!fs.existsSync(dir)) await fsp.mkdir(dir, { recursive: true });
}

async function readSnapshot() {
  try {
    const raw = await fsp.readFile(CACHE_PATH, "utf8");
    const json = JSON.parse(raw);
    if (json && typeof json === "object") return json;
  } catch (_) {}
  return null;
}

// Persist only minimal arrays, not indices or loadedAt, to keep snapshot small and stable
async function writeSnapshot(data) {
  try {
    // Ensure the directory of CACHE_PATH (supports external paths like /tmp/config.json)
    const targetDir = path.dirname(CACHE_PATH);
    await ensureDir(targetDir);
    const minimal = {
      users: data.users || [],
      emojis: data.emojis || [],
      prompts: data.prompts || [],
      flows: data.flows || [],
    };
    const next = JSON.stringify(minimal, null, 2);
    try {
      const cur = await fsp.readFile(CACHE_PATH, "utf8");
      if (cur === next) {
        return; // avoid rewriting identical content (prevents nodemon restarts)
      }
    } catch (_) {}
    await fsp.writeFile(CACHE_PATH, next, "utf8");
  } catch (e) {
    llog.gray(`Skipping snapshot write: ${e}`);
  }
}

function normalizeKey(s) {
  return String(s || "").trim();
}

function toIndex(arr, keyFn) {
  const out = {};
  for (const item of arr) {
    const k = keyFn(item);
    if (k) out[k] = item;
  }
  return out;
}

// Map Airtable records to plain objects with expected fields
function mapEmojiRecord(rec) {
  const get = (f) => rec.get(f);
  const name = normalizeKey(get("name"));
  return {
    id: rec.id,
    name,
    action_type: normalizeKey(get("action_type")), // e.g., agent | flow
    prompt_name: normalizeKey(get("_prompt_name") || get("prompt_name")),
    prompt_template: get("_prompt_template") || get("prompt_template") || null,
    flow_name: normalizeKey(get("flow") || get("_flow_name")),
  };
}

function mapPromptRecord(rec) {
  const get = (f) => rec.get(f);
  const name = normalizeKey(get("name") || get("Name"));
  return {
    id: rec.id,
    name,
    template: get("template") || get("Template") || get("prompt_template") || null,
  };
}

function mapFlowRecord(rec) {
  const get = (f) => rec.get(f);
  const name = normalizeKey(get("name") || get("Name"));
  return {
    id: rec.id,
    name,
    steps: get("steps") || get("Steps") || null,
  };
}

function mapUserRecord(rec) {
  const get = (f) => rec.get(f);
  const slackId = normalizeKey(
    get("slack_user_id") || // our sync field
    get("slack_id") ||
    get("SlackId") ||
    get("Slack ID")
  );
  return {
    id: rec.id,
    slackId,
    name: normalizeKey(get("name") || get("Name")),
    role: normalizeKey(get("role") || get("Role")),
  };
}

async function fetchAll({ baseId }) {
  if (!baseId) throw new Error("AIRTABLE_BASE_ID env not set");

  const max = 1000;
  const [emojiRecs, promptRecs, flowRecs, userRecs] = await Promise.all([
    airtableTools.findMany({ baseId, table: process.env.AIRTABLE_TABLE_EMOJIS || "Emojis", maxRecords: max }),
    airtableTools.findMany({ baseId, table: process.env.AIRTABLE_TABLE_PROMPTS || "Prompts", maxRecords: max }),
    airtableTools.findMany({ baseId, table: process.env.AIRTABLE_TABLE_FLOWS || "Flows", maxRecords: max }),
    airtableTools.findMany({ baseId, table: process.env.AIRTABLE_TABLE_USERS || "Users", maxRecords: max }),
  ]);

  const emojis = (emojiRecs || []).map(mapEmojiRecord).filter((e) => e.name);
  const prompts = (promptRecs || []).map(mapPromptRecord).filter((p) => p.name);
  const flows = (flowRecs || []).map(mapFlowRecord).filter((f) => f.name);
  const users = (userRecs || []).map(mapUserRecord).filter((u) => u.slackId);

  return { emojis, prompts, flows, users };
}

async function refreshRuntimeConfig() {
  try {
    const baseId = process.env.AIRTABLE_BASE_ID;
    const { emojis, prompts, flows, users } = await fetchAll({ baseId });

    state = {
      loadedAt: Date.now(),
      emojis,
      prompts,
      flows,
      users,
      emojisByName: toIndex(emojis, (e) => e.name),
      promptsByName: toIndex(prompts, (p) => p.name),
      flowsByName: toIndex(flows, (f) => f.name),
      usersById: toIndex(users, (u) => u.slackId),
    };

    await writeSnapshot(state); // writes minimal snapshot
    global.APP_CONFIG = state;
    llog.green("✅ Runtime config refreshed from Airtable");
    return state;
  } catch (e) {
    llog.yellow(`⚠️ Runtime config refresh failed: ${e}`);
    return state;
  }
}

async function initRuntimeConfig() {
  // Try snapshot first for fast startup
  const snap = await readSnapshot();
  if (snap) {
    // Rebuild indices from minimal snapshot
    const { emojis = [], prompts = [], flows = [], users = [] } = snap || {};
    state = {
      loadedAt: Date.now(),
      emojis,
      prompts,
      flows,
      users,
      emojisByName: toIndex(emojis, (e) => e.name),
      promptsByName: toIndex(prompts, (p) => p.name),
      flowsByName: toIndex(flows, (f) => f.name),
      usersById: toIndex(users, (u) => u.slackId),
    };
    global.APP_CONFIG = state;
    llog.gray("Loaded runtime config snapshot from disk");
  }
  await refreshRuntimeConfig();

  // Background refresh
  if (REFRESH_MS > 0) {
    setInterval(() => {
      refreshRuntimeConfig().catch(() => {});
    }, REFRESH_MS).unref();
  }

  return state;
}

function getRuntimeConfig() {
  return state;
}

function getEmojiAction(name) {
  const k = normalizeKey(name);
  return state.emojisByName[k] || null;
}

module.exports = {
  initRuntimeConfig,
  refreshRuntimeConfig,
  getRuntimeConfig,
  getEmojiAction,
  syncSlackUsersToAirtable,
  syncSlackEmojisToAirtable,
  ensureEmojiExists,
};

// --- Slack → Airtable Users sync (append-only, per workspace) ---
async function syncSlackUsersToAirtable({ slackClient }) {
  try {
    const baseId = process.env.AIRTABLE_BASE_ID;
    const table = process.env.AIRTABLE_TABLE_USERS || "Users";
    const imageField = process.env.AIRTABLE_FIELD_USER_IMAGE || "image";
    const verbose = String(process.env.AIRTABLE_USERS_SYNC_VERBOSE || '').toLowerCase() === 'true';
    if (!process.env.AIRTABLE_API_TOKEN || !baseId) {
      llog.gray("BKC: skip users sync (missing Airtable env)");
      return { added: 0, updated: 0, total: 0 };
    }
    if (!slackClient) {
      llog.gray("BKC: skip users sync (missing slackClient)");
      return { added: 0, updated: 0, total: 0 };
    }

    // 1) Fetch all current Airtable users to build a set of known slack_user_id
    const existing = await airtableTools.findMany({ baseId, table, maxRecords: 10000 });
    const bySlackId = {};
    for (const rec of existing) {
      const id = String(rec.get("slack_user_id") || "").trim();
      if (id) bySlackId[id] = rec;
    }

    // 2) Fetch all Slack users for the current workspace
    const slackUsers = await listAllSlackUsers(slackClient);
    let added = 0, updated = 0;
    // helper to pick the best avatar URL (prefer 1024, then largest available)
    const pickAvatar = (profile = {}) => {
      const order = ["image_1024", "image_512", "image_192", "image_72", "image_original", "image_48", "image_32", "image_24"]; 
      let url = null;
      for (const k of order) { if (profile[k]) { url = profile[k]; break; } }
      if (!url) {
        // fallback: search any image_* key with largest size
        const entries = Object.entries(profile).filter(([k,v]) => /^image_\d+$/.test(k) && v);
        entries.sort((a,b) => parseInt(b[0].split('_')[1]) - parseInt(a[0].split('_')[1]));
        url = entries[0]?.[1] || null;
      }
      if (!url) return null;
      try {
        const base = url.split('?')[0];
        const filename = base.substring(base.lastIndexOf('/') + 1) || 'avatar.jpg';
        return { url, filename };
      } catch { return { url, filename: 'avatar.jpg' }; }
    };

    for (const u of slackUsers) {
      const slackId = u.id;
      const name = u.profile?.real_name || u.real_name || u.name || "";
      if (!slackId) continue;
      const existingRec = bySlackId[slackId];
      const avatar = pickAvatar(u.profile || {});
      const imageAttachment = avatar ? [{ url: avatar.url, filename: avatar.filename }] : undefined;
      const userJson = JSON.stringify(u);
      if (!existingRec) {
        const record = { "slack_user_id": slackId, name, slack_user_json: userJson };
        if (imageAttachment) record[imageField] = imageAttachment;
        await airtableTools.addRecord({
          baseId,
          table,
          record,
        }).catch(() => {});
        if (verbose) llog.cyan({ action: 'added', slackId, name, image: !!imageAttachment });
        added++;
      } else {
        const curName = existingRec.get("name") || "";
        const patches = {};
        if (name && name !== curName) {
          patches.name = name;
        }
        // Always keep most recent Slack JSON snapshot if field exists
        if (typeof existingRec.get === 'function' && ('slack_user_json' in existingRec.fields || existingRec.get('slack_user_json') !== undefined)) {
          const curJson = existingRec.get('slack_user_json') || '';
          if (curJson !== userJson) patches.slack_user_json = userJson;
        }
        // Update avatar if file missing or filename changed
        if (imageAttachment) {
          try {
            const cur = existingRec.get(imageField);
            const curFilename = Array.isArray(cur) && cur[0] ? cur[0].filename : '';
            if (!curFilename || curFilename !== avatar.filename) {
              patches[imageField] = imageAttachment;
            }
          } catch (_) {
            // If field missing or error, skip changing avatar rather than forcing noisy updates
            if (verbose) llog.gray({ note: 'image field missing or unreadable', slackId });
          }
        }
        const changed = Object.keys(patches);
        if (changed.length > 0) {
          if (verbose) llog.yellow({ action: 'update', slackId, changed });
          await airtableTools.updateRecord({
            baseId,
            table,
            recordId: existingRec.id,
            updatedFields: patches,
          }).catch(() => {});
          updated++;
        }
      }
    }
    const total = slackUsers.length;
    llog.gray(`Users sync: ${added} added, ${updated} updated, ${total} workspace users checked`);
    return { added, updated, total };
  } catch (e) {
    llog.yellow(`Users sync failed: ${e}`);
    return { added: 0, updated: 0, total: 0 };
  }
}

async function listAllSlackUsers(client) {
  const out = [];
  let cursor = undefined;
  do {
    const resp = await client.users.list({ limit: 200, cursor }).catch((e) => { llog.yellow(`users.list failed: ${e?.data?.error || e}`); return null; });
    if (!resp || !resp.members) break;
    for (const m of resp.members) {
      if (m.deleted) continue;
      if (m.is_bot && !m.is_owner && !m.is_admin) continue; // skip typical bot users
      out.push(m);
    }
    cursor = resp.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return out;
}

// --- Slack → Airtable Emojis sync (append/update names + url + attachment) ---
async function syncSlackEmojisToAirtable() {
  try {
    const baseId = process.env.AIRTABLE_BASE_ID;
    const table = process.env.AIRTABLE_TABLE_EMOJIS || "Emojis";
    // Airtable field names (customize via env to match your base)
    const fieldName = process.env.AIRTABLE_EMOJIS_NAME_FIELD || "name";
    // Default URL field matches your screenshot: "public_image_link"
    const fieldUrl = process.env.AIRTABLE_EMOJIS_URL_FIELD || "public_image_link";
    // Optional alias field (disabled by default); set env to enable
    const fieldAlias = process.env.AIRTABLE_EMOJIS_ALIAS_FIELD || null;
    const fieldImage = process.env.AIRTABLE_EMOJIS_IMAGE_FIELD || "image"; // Attachment field
    const fieldType = process.env.AIRTABLE_EMOJIS_TYPE_FIELD || null; // Optional single select/text
    if (!process.env.AIRTABLE_API_TOKEN || !baseId) {
      llog.gray("BKC: skip emojis sync (missing Airtable env)");
      return { added: 0, total: 0 };
    }

    // Prefer bot token for emoji.list since bot has emoji:read in your app
    // Fallback to user token only if a bot token isn't available
    const token = process.env.SLACK_BOT_TOKEN || process.env.SLACK_USER_TOKEN;
    if (!token) {
      llog.gray("BKC: skip emojis sync (missing Slack token)");
      return { added: 0, total: 0 };
    }
    const client = new WebClient(token);
    const resp = await client.emoji.list().catch((e) => { llog.yellow(`emoji.list failed: ${e?.data?.error || e}`); return null; });
    const emojiMap = resp?.emoji || {};
    const names = Object.keys(emojiMap);
    if (names.length === 0) return { added: 0, total: 0 };

    // Fetch existing Airtable emoji names
    const existing = await airtableTools.findMany({ baseId, table, maxRecords: 10000 });
    const have = {};
    const existingMap = {};
    for (const rec of existing || []) {
      try {
        const n = String(rec.get("name") || rec.get("Name") || rec.get(fieldName) || "").trim();
        if (n) {
          have[n] = true;
          existingMap[n] = {
            id: rec.id,
            url: rec.get(fieldUrl) || rec.get("public_image_link") || rec.get("url") || rec.get("URL"),
            alias: fieldAlias ? (rec.get(fieldAlias) || rec.get("alias") || rec.get("Alias")) : undefined,
            hasImage: !!(rec.get(fieldImage) || rec.get("image") || rec.get("Image")),
            type: fieldType ? rec.get(fieldType) : undefined
          };
        }
      } catch { }
    }

    let added = 0;
    let updated = 0;
    // Helper to resolve aliases to a concrete URL
    const resolveEmoji = (n, depth = 0) => {
      if (depth > 10) return { url: undefined, alias: undefined };
      const val = emojiMap[n];
      if (!val) return { url: undefined, alias: undefined };
      if (typeof val === 'string' && val.startsWith('alias:')) {
        const base = val.slice(6);
        const r = resolveEmoji(base, depth + 1);
        return { url: r.url, alias: base };
      }
      return { url: val, alias: undefined };
    };

    for (const name of names) {
      const { url, alias } = resolveEmoji(name);
      const attachment = url && url.startsWith('http') ? [{ url }] : undefined;

      if (!have[name]) {
        const fields = { [fieldName]: name };
        if (url) fields[fieldUrl] = url;
        if (fieldAlias && alias) fields[fieldAlias] = alias;
        if (attachment) fields[fieldImage] = attachment;
        if (fieldType) fields[fieldType] = fields[fieldType] || "custom";
        const addRes = await airtableTools.addRecord({ baseId, table, record: fields }).catch(() => null);
        if (addRes && addRes.id) added++;
      } else {
        // Update missing url/alias/image if not present
        const ex = existingMap[name] || {};
        const toUpdate = {};
        if (url && !ex.url) toUpdate[fieldUrl] = url;
        if (fieldAlias && alias && !ex.alias) toUpdate[fieldAlias] = alias;
        if (attachment && !ex.hasImage) toUpdate[fieldImage] = attachment;
        if (fieldType && !ex.type) toUpdate[fieldType] = "custom";
        if (Object.keys(toUpdate).length && ex.id) {
          const upRes = await airtableTools.updateRecord({ baseId, table, recordId: ex.id, updatedFields: toUpdate }).catch(() => null);
          if (upRes && upRes.id) updated++;
        }
      }
    }
    llog.gray(`Emojis sync: ${added} added, ${updated} updated, ${names.length} total in Slack`);
    return { added, updated, total: names.length };
  } catch (e) {
    llog.yellow(`Emojis sync failed: ${e}`);
    return { added: 0, total: 0 };
  }
}

// Ensure an emoji name exists in the Airtable Emojis table.
// Useful for auto-registering first-time reactions (including standard emojis).
async function ensureEmojiExists(name) {
  try {
    const n = String(name || '').trim();
    if (!n) return null;
    if (state.emojisByName && state.emojisByName[n]) return state.emojisByName[n];
    const baseId = process.env.AIRTABLE_BASE_ID;
    const table = process.env.AIRTABLE_TABLE_EMOJIS || 'Emojis';
    if (!process.env.AIRTABLE_API_TOKEN || !baseId) return null;
    const rec = await airtableTools.addRecord({ baseId, table, record: { name: n } }).catch(()=>null);
    if (rec) {
      llog.gray(`Auto-registered emoji in Airtable: ${n}`);
      await refreshRuntimeConfig().catch(()=>{});
    }
    return rec;
  } catch (_) { return null; }
}
