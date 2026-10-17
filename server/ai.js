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
