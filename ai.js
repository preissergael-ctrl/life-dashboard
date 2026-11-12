/* =========================================================
   AI assistant: turns a sentence like "I got 200 pesos from my
   friend" into app actions, using the Claude API.

   Your API key is encrypted with your password (AES-GCM, key
   derived with PBKDF2) and saved only on this device. The unlocked
   key lives in memory until you close the app or press Lock.
   ========================================================= */
import Anthropic from './vendor/anthropic-sdk.mjs';

const KEY_STORE = 'lifedash:aikey';
const PBKDF2_ITERATIONS = 310000;

export const MODELS = {
  'claude-opus-5-5': 'Claude Opus 5.5',
  'claude-haiku-5-5': 'Claude Haiku 5.5',
};

let apiKey = null; // decrypted key, memory only

/* ---------- Encrypted key storage ---------- */

const enc = new TextEncoder();
const dec = new TextDecoder();
const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

function readStore() {
  try { return JSON.parse(localStorage.getItem(KEY_STORE)); } catch { return null; }
}

/** 'none' (no key saved), 'locked', or 'unlocked' */
export function status() {
  if (!readStore()) return 'none';
  return apiKey ? 'unlocked' : 'locked';
}

export async function saveKey(key, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aes = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, enc.encode(key));
  localStorage.setItem(KEY_STORE, JSON.stringify({
    v: 1, iterations: PBKDF2_ITERATIONS, salt: toB64(salt), iv: toB64(iv), ct: toB64(ct),
  }));
  apiKey = key;
}

export async function unlock(password) {
  const s = readStore();
  if (!s) throw new Error('No API key saved yet.');
  const aes = await deriveKey(password, fromB64(s.salt), s.iterations);
  try {
    apiKey = dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(s.iv) }, aes, fromB64(s.ct)));
  } catch {
    throw new Error('Wrong password.');
  }
}

export function lock() { apiKey = null; }

export function removeKey() {
  apiKey = null;
  localStorage.removeItem(KEY_STORE);
}

/* ---------- Asking Claude ---------- */

const SYSTEM_PROMPT = `You turn short notes from the user into actions for their personal Life Dashboard app, which has a to-do list and a money log. Return every action the message asks for, and no others.

How to fill each action:
- add_task: task_text is a short, clear title (drop filler like "remind me to"). due is a YYYY-MM-DD date worked out from today's date, or "" when no date is given. Events, appointments and reminders are tasks with a due date.
- complete_task: only for a task that appears in the open-task list; put its id in task_id.
- add_entry: money the user received is income, money they spent or paid is expense. amount is a positive number in the user's currency. Use the closest category from the matching list, or Other if none fits. note is a few words of context, such as who or what. date is today unless the user says otherwise.
- Fields that don't apply to an action: use "" for text and 0 for numbers.

reply is one short, friendly sentence in the user's language that confirms what you did. If the message is unclear (for example, an amount or a task is missing) or asks for something the app can't do, return no actions and use reply to say so or ask a short question.`;

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['actions', 'reply'],
  properties: {
    actions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind', 'task_text', 'due', 'task_id', 'entry_type', 'amount', 'category', 'note', 'date'],
        properties: {
          kind: { type: 'string', enum: ['add_task', 'complete_task', 'add_entry'] },
          task_text: { type: 'string' },
          due: { type: 'string' },
          task_id: { type: 'string' },
          entry_type: { type: 'string', enum: ['expense', 'income', ''] },
          amount: { type: 'number' },
          category: { type: 'string' },
          note: { type: 'string' },
          date: { type: 'string' },
        },
      },
    },
    reply: { type: 'string' },
  },
};

function contextMessage(text, ctx) {
  const tasks = ctx.openTasks.length
    ? ctx.openTasks.map((t) => `- id ${t.id}: ${t.text}${t.due ? ` (due ${t.due})` : ''}`).join('\n')
    : '(none)';
  return `Today is ${ctx.weekday}, ${ctx.today}. Currency: ${ctx.currency}.
Expense categories: ${ctx.expenseCategories.join(', ')}
Income categories: ${ctx.incomeCategories.join(', ')}
Open tasks:
${tasks}

User's message:
${text}`;
}

/** The API error message the server sent, if any (e.g. "Your credit balance is too low..."). */
function serverMessage(err) {
  return err?.error?.error?.message || '';
}

/**
 * Sends one sentence to Claude and returns { actions, reply }.
 * Throws an Error with a friendly message on failure.
 */
export async function ask(text, model, ctx) {
  if (!apiKey) throw new Error('Unlock the AI first.');
  if (!MODELS[model]) model = 'claude-opus-5-5';

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  const params = {
    model,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: contextMessage(text, ctx) }],
    output_config: {
      effort: 'low', // simple extraction: fast and cheap
      format: { type: 'json_schema', schema: RESULT_SCHEMA },
    },
  };

  let response;
  try {
    response = model === 'claude-opus-5-5'
      // If Opus declines for safety reasons, the server retries on a suitable model automatically.
      ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : await client.messages.create(params);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('Your API key was rejected. Remove it in Settings and add it again.');
    if (err instanceof Anthropic.PermissionDeniedError) throw new Error(serverMessage(err) || 'This API key is not allowed to use that model.');
    if (err instanceof Anthropic.RateLimitError) throw new Error('Too many requests right now. Try again in a minute.');
    if (err instanceof Anthropic.BadRequestError) throw new Error(serverMessage(err) || 'Claude could not read that request.');
    if (err instanceof Anthropic.APIConnectionError) throw new Error('No connection to Claude. Check your internet.');
    if (err instanceof Anthropic.APIError) throw new Error(`Claude is having trouble (error ${err.status}). Try again soon.`);
    throw err;
  }

  if (response.stop_reason === 'refusal') throw new Error("Claude couldn't help with that one.");
  if (response.stop_reason === 'max_tokens') throw new Error('That was too long for one go. Try a shorter message.');

  const textBlock = response.content.find((b) => b.type === 'text');
  let result;
  try {
    result = JSON.parse(textBlock?.text ?? '');
  } catch {
    throw new Error('Claude sent back something unexpected. Try again.');
  }
  if (!Array.isArray(result.actions) || typeof result.reply !== 'string') {
    throw new Error('Claude sent back something unexpected. Try again.');
  }
  return result;
}

window.LifeAI = { MODELS, status, saveKey, unlock, lock, removeKey, ask };
window.dispatchEvent(new Event('lifeai-ready'));
