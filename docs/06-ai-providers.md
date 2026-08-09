# AI providers

The assistant is provider-agnostic. `config.ai.order` lists providers to try in
turn; the first one that answers wins, and if every one fails the routes fall
back to the rule engine in `lib/analysis.js`. A dead endpoint degrades the
dashboard — it never breaks it.

Default order: **`local` → `gemini`**.

| Provider | Transport | Where |
|---|---|---|
| `local` | OpenAI-compatible `POST /v1/chat/completions` | `lib/ai/providers/openai-compat.js` |
| `gemini` | Google AI Studio REST `generateContent` (v1beta) | `lib/ai/providers/gemini.js` |

Orchestration lives in `lib/ai/index.js`; endpoint/model resolution in
`lib/ai/discovery.js`; the relay in `lib/ai/relay.js`.

## Nothing is hardcoded

`AI_LOCAL_MODEL` defaults to empty, which means **ask the endpoint**. Model
resolution per request:

```
Dev-Settings header → env var → auto-discovered → error (chain falls through)
```

Auto-discovery uses each provider's own list endpoint:

- **local** — `GET /v1/models`. llama-swap adds a `status.value` of
  `loaded`/`unloaded`; we prefer a model that is already loaded, because asking
  for an unloaded one makes the server evict and cold-start, turning a chat reply
  into a minute-long wait.
- **gemini** — `GET /models?pageSize=1000`, keeping only entries whose
  `supportedGenerationMethods` include `generateContent`, following
  `nextPageToken`.

`GET /api/ai/models?provider=local|gemini` exposes that list to the browser (the
browser can reach neither a plain-HTTP endpoint nor Gemini without leaking the
key), so the Dev Settings picker shows live models. **A new model on the endpoint,
or a new Gemini release, appears with no code change.**

## The reasoning-model trap

The default local endpoint runs llama-swap with `--reasoning auto`, so responses
split `message.reasoning_content` from `message.content`. Measured on the same
Thai analyze prompt:

| request | completion tokens | reasoning | content | finish_reason |
|---|---|---|---|---|
| `max_tokens: 400`, thinking on | 400 | 1 340 chars | **empty** | `length` |
| uncapped, thinking on | 744 | 1 901 chars | 469 chars | `stop` |
| `enable_thinking: false` | **208** | none | 469 chars | `stop` |

So the provider sends `chat_template_kwargs: { enable_thinking: false }` by
default (`AI_LOCAL_THINKING=true` re-enables it), and treats an empty `content`
as a failure so the chain moves on rather than rendering a blank bubble. If you
turn thinking on, raise `AI_LOCAL_MAX_TOKENS` well past the reasoning length.

`response_format: {type:'json_object'}` is used for the analyze prompt and works;
`parseJsonLoose` still strips markdown fences, which local models add anyway.

## The relay

Two things make direct calls impossible in the field:

1. The local endpoint is plain **HTTP**, so any HTTPS-hosted page is blocked from
   calling it by mixed-content rules.
2. A demo box on a raw IP behind venue Wi-Fi may have no route to Google at all.

Setting `AI_RELAY_URL` on that box makes its `/api/chat` and
`/api/gemini-analyze` forward to another deployment of this same app — one with
known-good outbound access — instead of calling providers directly. There is no
new public endpoint: the relay target is the app's own AI routes.

Loop safety: a relayed request carries `x-ai-hop: 1`, and a request carrying that
header is never relayed onward. If the relay fails, the box serves the request
itself. Responses report `via: 'relay' | 'direct'`.

```
[demo box, raw IP]  --AI_RELAY_URL-->  [enviroment-monitor.vercel.app]  -->  [local endpoint / Gemini]
```

## Demo runbook (raw IP, e.g. DEPA)

1. Serve the dashboard from the box; note its LAN address, e.g. `192.168.1.50:3000`.
2. On any other device, open Settings → **API server URL** → `http://192.168.1.50:3000`.
   The field accepts a raw IP; blank means "same origin".
3. If the venue network can't reach the model endpoints, set
   `AI_RELAY_URL=https://enviroment-monitor.vercel.app` on the box (or fill
   **AI relay** in Settings, which sends `x-ai-relay` per request).
4. Check the assistant's source tag — it names the model that actually answered
   and marks `via relay` when the hop was used.

## Dev Settings overrides

Every AI field in the Settings dialog is sent as an `x-ai-*` header, so the demo
can be re-pointed from the browser with no redeploy. Blank fields are omitted
entirely, leaving the server on its env configuration.

| Header | Overrides |
|---|---|
| `x-ai-order` | provider priority, e.g. `local,gemini` |
| `x-ai-local-base` / `x-ai-local-model` | local endpoint + model |
| `x-ai-gemini-key` (alias `x-gemini-key`) | AI Studio key |
| `x-ai-gemini-base` / `x-ai-gemini-model` | Gemini endpoint + model |
| `x-ai-relay` | relay base URL |

Only `http:`/`https:` URLs are accepted. Because a caller-supplied base URL is a
URL this server will then fetch, set `AI_ALLOW_CLIENT_OVERRIDES=false` on any
deployment that isn't a controlled demo — the headers are then ignored entirely.

## Routes

| Route | Purpose |
|---|---|
| `POST /api/chat` | Q&A with the latest reading attached |
| `POST /api/gemini-analyze` | analyze a reading → `{summary, recommendations[]}` |
| `GET /api/ai/models?provider=` | live model list for the settings picker |
| `GET /api/config` | `ai.{order, available, localBaseUrl, …}` — endpoints and model preferences only, never keys |
| `GET /api/health` | `ai_enabled`, `ai_providers` |

`/api/gemini-analyze` keeps its original path so existing clients and the relay
hop stay compatible; it is no longer Gemini-specific. Both AI routes report
`provider` and `model` alongside the answer.
