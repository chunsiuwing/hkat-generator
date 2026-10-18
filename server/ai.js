// OpenAI-compatible AI client (works with OpenAI, DeepSeek, Groq, OpenRouter, Ollama, LM Studio...).
import { getSetting, setSetting } from './db.js';

export class AIError extends Error {
  constructor(message, status = 500, detail = '') {
    super(message);
    this.status = status;
    this.detail = detail;
  }
}

const ENV_DEFAULTS = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
};

export function getAIConfig() {
  return {
    baseUrl: (getSetting('ai_base_url') || process.env.OPENAI_BASE_URL || ENV_DEFAULTS.baseUrl).replace(/\/+$/, ''),
    apiKey: getSetting('ai_api_key') || process.env.OPENAI_API_KEY || ENV_DEFAULTS.apiKey,
    model: getSetting('ai_model') || process.env.OPENAI_MODEL || ENV_DEFAULTS.model,
  };
}

export function setAIConfig({ baseUrl, apiKey, model }) {
  if (baseUrl !== undefined) setSetting('ai_base_url', String(baseUrl || '').trim());
  if (apiKey !== undefined) setSetting('ai_api_key', String(apiKey || '').trim());
  if (model !== undefined) setSetting('ai_model', String(model || '').trim());
  return getAIConfigStatus();
}

export function getAIConfigStatus() {
  const cfg = getAIConfig();
  return {
    configured: Boolean(cfg.apiKey) || process.env.MOCK_AI === '1',
    mock: process.env.MOCK_AI === '1',
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    keyMasked: cfg.apiKey ? `${cfg.apiKey.slice(0, 3)}…${cfg.apiKey.slice(-4)}` : '',
    keyInEnv: Boolean(process.env.OPENAI_API_KEY),
  };
}

/** Call the chat completions API and parse a strict JSON object out of the reply. */
export async function chatJSON({ system, user, temperature = 0.6, maxTokens = 4000, timeoutMs = 240000, mock = null }) {
  if (process.env.MOCK_AI === '1') {
    await new Promise((r) => setTimeout(r, 600));
    if (!mock) throw new AIError('MOCK_AI is on but no mock data was provided for this call.', 500);
    return typeof mock === 'function' ? mock() : mock;
  }

  const cfg = getAIConfig();
  if (!cfg.apiKey) {
    throw new AIError(
      '未設定 AI API Key。請到「⚙️ 設定」貼上 API Key，或在 .env 檔案中填寫 OPENAI_API_KEY。 (No API key configured — add one in Settings or .env)',
      400
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const payload = {
    model: cfg.model,
    temperature,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
  };

  // Some OpenAI-compatible providers reject response_format / max_tokens.
  // Try the full payload first, then fall back to a plainer one.
  const attempts = [payload, { ...payload, response_format: undefined }, { ...payload, response_format: undefined, max_tokens: undefined, max_completion_tokens: maxTokens }];

  let res = null;
  let lastError = null;
  try {
    for (let i = 0; i < attempts.length; i++) {
      const body = { ...attempts[i] };
      if (body.response_format === undefined) delete body.response_format;
      res = await fetch(`${cfg.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (res.ok) break;
      const errText = await res.text().catch(() => '');
      lastError = { status: res.status, body: errText };
      const compatIssue = res.status === 400 && /response_format|max_tokens|max_completion_tokens|json_object/i.test(errText);
      if (!compatIssue || i === attempts.length - 1) break;
      console.warn(`[ai] retrying without unsupported option (HTTP ${res.status})`);
    }
  } catch (err) {
    if (err.name === 'AbortError') throw new AIError('AI 回應超時（AI request timed out），請稍後再試。', 504);
    throw new AIError(`無法連接 AI 服務（Cannot reach AI service）：${err.message}`, 502, String(cfg.baseUrl));
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = lastError?.body || (await res.text().catch(() => ''));
    throw new AIError(`AI 服務回應錯誤（AI service error）：HTTP ${res.status}`, res.status, body.slice(0, 500));
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content) throw new AIError('AI 沒有返回內容（empty AI response）。', 502, JSON.stringify(data).slice(0, 300));

  return parseJSONContent(content);
}

/** Tolerant JSON extraction: strips ``` fences and finds the outermost object. */
export function parseJSONContent(content) {
  let text = String(content).trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      const candidate = text.slice(start, end + 1);
      try { return JSON.parse(candidate); } catch { /* fall through */ }
    }
    throw new AIError('AI 返回的不是有效的 JSON（AI reply was not valid JSON）。', 502, text.slice(0, 400));
  }
}

/* ---------------- connection test & friendly hints ---------------- */

export const PROVIDERS = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', note: '需要 OpenAI 帳號；部分地區可能被封鎖' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-chat', note: '一個 key 可用多個模型（模型名要用 provider/model 格式）' },
  { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', note: '便宜，中英文都好' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', note: '極快，有免費額度' },
  { id: 'ollama', label: 'Ollama（本地）', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b', note: '完全離線，要先安裝 Ollama 並 pull 模型' },
  { id: 'lmstudio', label: 'LM Studio（本地）', baseUrl: 'http://localhost:1234/v1', model: 'local-model', note: '圖形介面的本地模型' },
];

export function friendlyAIError(status, bodyText) {
  const text = String(bodyText || '');
  if (status === 401 || /invalid.*api.?key|incorrect api key|authentication/i.test(text)) {
    return 'API Key 不正確，或者 Base URL 選錯了（例如用了 OpenRouter 的 key 但 Base URL 仍是 OpenAI）。請檢查兩者是否配對。 (Wrong API key, or Base URL does not match the key provider.)';
  }
  if (/not available in your region|geo|region/i.test(text)) {
    return '這個模型在你所在地區不可用。請改用 deepseek/deepseek-chat、qwen/qwen-2.5-72b-instruct 或 meta-llama/llama-3.3-70b-instruct。 (Model blocked in your region — try one of those instead.)';
  }
  if (status === 404 || /model.*not.*found|no endpoints found|does not exist/i.test(text)) {
    return '模型名稱不正確。OpenRouter 要用「provider/model」格式（例如 openai/gpt-4o-mini、deepseek/deepseek-chat）；其他供應商要用它自己的模型名。 (Wrong model name — OpenRouter needs the "provider/model" format.)';
  }
  if (status === 402 || /credits|insufficient|quota|exceeded/i.test(text)) {
    return '帳戶額度不足或已用完，請到該 AI 供應商的網站充值或檢查用量。 (Out of credits/quota.)';
  }
  if (status === 429) {
    return '請求太頻繁或速率受限，稍等 30 秒再試。 (Rate limited — wait a moment.)';
  }
  return `AI 服務回應錯誤 HTTP ${status}。${text.slice(0, 200)}`;
}

/** Tiny real request to verify key + base URL + model all work together. */
export async function testAIConnection() {
  const cfg = getAIConfig();
  if (!cfg.apiKey) throw new AIError('未設定 API Key。 (No API key set.)', 400);
  if (process.env.MOCK_AI === '1') return { ok: true, mock: true, model: cfg.model, sample: 'OK (mock)' };

  let res, text;
  try {
    res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, max_tokens: 8, messages: [{ role: 'user', content: 'Reply with the single word OK' }] }),
      signal: AbortSignal.timeout(45000),
    });
    text = await res.text();
  } catch (err) {
    return { ok: false, status: 0, hint: `無法連接 ${cfg.baseUrl}（Check the Base URL and your network）。${err.message}` };
  }

  if (res.ok) {
    let sample = '';
    try { sample = JSON.parse(text)?.choices?.[0]?.message?.content?.trim() || ''; } catch { /* ignore */ }
    return { ok: true, model: cfg.model, baseUrl: cfg.baseUrl, sample: sample.slice(0, 40) };
  }
  return { ok: false, status: res.status, hint: friendlyAIError(res.status, text) };
}
