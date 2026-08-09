/**
 * Browser → server AI overrides. Dev Settings values travel as x-ai-* headers
 * so the demo can be re-pointed (different endpoint, model, relay or provider
 * order) without a redeploy. Blank fields are omitted entirely, which leaves the
 * server on its own env configuration.
 */

const HEADER_BY_KEY = {
  aiOrder: 'X-AI-Order',
  aiLocalBase: 'X-AI-Local-Base',
  aiLocalModel: 'X-AI-Local-Model',
  geminiKey: 'X-AI-Gemini-Key',
  aiGeminiBase: 'X-AI-Gemini-Base',
  aiGeminiModel: 'X-AI-Gemini-Model',
  aiRelay: 'X-AI-Relay',
};

/** Headers only (no Content-Type) — for GETs such as the model list. */
export function aiHeaders(settings) {
  const h = {};
  for (const [key, header] of Object.entries(HEADER_BY_KEY)) {
    const value = (settings?.[key] ?? '').trim();
    if (value) h[header] = value;
  }
  return h;
}

/** Headers for a JSON POST. */
export function aiJsonHeaders(settings) {
  return { 'Content-Type': 'application/json', ...aiHeaders(settings) };
}
