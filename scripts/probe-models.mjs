// Quick probe: which OpenRouter models does this key+region actually allow?
// Usage: node scripts/probe-models.mjs
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync('data/app.db');
const key = db.prepare(`SELECT value FROM settings WHERE key = 'ai_api_key'`).get()?.value;
if (!key) { console.log('no key stored in the app'); process.exit(1); }

const candidates = [
  'deepseek/deepseek-chat',
  'deepseek/deepseek-chat-v3-0324:free',
  'google/gemini-2.5-flash',
  'google/gemini-2.0-flash-001',
  'meta-llama/llama-3.3-70b-instruct',
  'qwen/qwen-2.5-72b-instruct',
  'mistralai/mistral-small-3.1-24b-instruct:free',
  'openai/gpt-4o-mini',
];

for (const model of candidates) {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, max_tokens: 8, messages: [{ role: 'user', content: 'Say OK' }] }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok) {
      const text = body?.choices?.[0]?.message?.content || '';
      console.log(`✅ ${model} — reply: ${JSON.stringify(text).slice(0, 40)}`);
    } else {
      const msg = body?.error?.message || `HTTP ${res.status}`;
      console.log(`❌ ${model} — ${res.status}: ${msg.slice(0, 110)}`);
    }
  } catch (err) {
    console.log(`❌ ${model} — ${err.message}`);
  }
}
