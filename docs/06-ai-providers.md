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

## Running the local model, and reaching it from a hosted deployment

`scripts/start-local-ai.ps1` starts the whole chain and verifies it:

```powershell
.\scripts\start-local-ai.ps1            # Ollama + a Cloudflare tunnel
.\scripts\start-local-ai.ps1 -NoTunnel  # Ollama only (dashboard on this machine)
```

It prints the URL to paste into Settings → **ที่อยู่ AI ในเครื่อง** and copies it
to the clipboard, then checks `/v1/models` **through** the tunnel before saying it
worked — a tunnel that resolves is not the same as a tunnel the model answers on.

### Why the tunnel needs `--http-host-header`

Ollama refuses any request whose `Host` is not local (its guard against a web
page you happen to have open driving your model). cloudflared forwards the public
hostname as `Host` by default, so the model answers **403 with an empty body**,
which Cloudflare relays verbatim — it looks like Cloudflare blocked you.

Reproduce the whole thing without a tunnel:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:11434/v1/models        # 200
curl -s -o /dev/null -w '%{http_code}\n' \
  -H 'Host: something.trycloudflare.com' http://127.0.0.1:11434/v1/models        # 403
```

So the tunnel must rewrite the header, which is what the script does:

```
cloudflared tunnel --url http://localhost:11434 --http-host-header localhost:11434
```

Widening Ollama instead (`OLLAMA_HOST=0.0.0.0`, `OLLAMA_ORIGINS=*`) also works but
exposes the model to everything on the LAN; the rewrite keeps it on loopback.

> The tunnel is **only** for letting a hosted deployment reach this machine. When
> the dashboard runs locally, the model is called server-side from the same
> machine, so `http://127.0.0.1:11434` needs no tunnel at all.
>
> ⚠️ The tunnel URL belongs in the **local AI endpoint** field, never in **API
> server URL** — that field is where the dashboard's own API lives, and pointing
> it at the model server breaks every request the page makes.

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
| `x-ai-order` | engine chain, e.g. `local,gemini` |
| `x-ai-local-base` / `x-ai-local-model` | local endpoint + model |
| `x-ai-gemini-key` (alias `x-gemini-key`) | AI Studio key |
| `x-ai-gemini-base` / `x-ai-gemini-model` | Gemini endpoint + model |
| `x-ai-relay` | relay base URL |

Only `http:`/`https:` URLs are accepted. Because a caller-supplied base URL is a
URL this server will then fetch, set `AI_ALLOW_CLIENT_OVERRIDES=false` on any
deployment that isn't a controlled demo — the headers are then ignored entirely.

## The engine chain

Settings → Assistant offers three engines — **Cloud AI** (Gemini), **Local** (the
endpoint we run ourselves), and **In this browser** (WebGPU) — as three buttons
for the simple choice, and as a lane of boxes underneath for arranging a
fallback. Left to right is the order they are tried; an engine dragged out of the
lane is not used at all, and the lane can hold one box or all three but never
zero. The arrows beside each box do the same job as dragging, because HTML5
drag-and-drop does not fire on touch.

One string holds all of it — the same comma-separated value `x-ai-order` has
always carried, now allowed to name `browser` too. The server drops ids it does
not know (`providerOrder` filters against `PROVIDERS`), so the header stays valid
while the client reads the whole chain. `aiChainRuns` in `config/client.js` splits
it into attempts: consecutive server providers travel as one request, since the
server chain already walks them itself, so `gemini,browser,local` is three tries
in that order rather than "both server providers, then the browser".

A browser run whose weights are not on this machine **asks before downloading**.
The turn pauses on a promise, the message shows the model and its size, and the
answer either downloads and continues there or hands the question to the next
engine. Several gigabytes is not something to start on someone's behalf.

## Tools, and the focus boundary

The assistant is no longer handed a pre-rendered sentence of the latest reading.
It is given tools and asks for what a question needs — `get_sensor_latest`,
`get_sensor_history`, `get_government_water`, `get_flood_points`,
`get_health_risks`, `get_focus_activity`, `web_search` (see `lib/ai/tools.js`).

The old shape could only answer questions about the sentence it was given. Asked
about last night's humidity or the rainfall upstream, it had to guess or decline
— the data was one call away and nothing could ask for it.

**Camera data is the exception, and it is enforced three times.** Only providers
in `AI_FOCUS_PROVIDERS` (default `local`) may read it:

1. `toolsFor(provider)` never offers `get_focus_activity` to anyone else, so the
   model cannot call what it cannot see.
2. That model's system instruction says outright that it has no camera access —
   so it says so instead of reaching for the sensor data and answering as though
   it had looked.
3. `runTool()` re-checks the provider before touching the database, so a
   hallucinated call to a tool that was never offered is refused.

(3) is what makes the guarantee real; (1) and (2) shape what the model is likely
to do, and only (3) decides what happens. Adding a cloud provider to
`AI_FOCUS_PROVIDERS` sends camera-derived data off the network.

Bounds: `AI_TOOLS_MAX_ROUNDS` caps the model→tool→model loop (a model that
misreads a result will otherwise ask forever) and `AI_TOOLS_MAX_CALLS` caps calls
per turn, since one round can contain many.

## Streaming, thinking and search

`POST /api/chat/stream` writes Server-Sent Events: `start`, `thinking`, `delta`,
`tool-start`, `tool`, `error`, then `[DONE]`. Deltas are text fragments, not
lines — the client concatenates. The assistant shows a chip per tool call as it
runs: fetching that nobody can see is indistinguishable from invention, and it
also answers "why is this taking eight seconds".

Two buttons in the composer:

- **Globe** — lets the model call `web_search`. Off by default and disabled
  entirely without `TAVILY_API_KEY`: a question about this room's own sensors has
  no business leaving the building, and on a metered key a surprise search costs
  money. The server checks the key too, so the toggle cannot promise a tool that
  will not run.
- **Brain** — asks for the model's reasoning (`thinkingConfig` on Gemini,
  `reasoning_content` on OpenAI-compatible endpoints) and shows it while it
  works. The block collapses the moment real text arrives.

On Gemini, `includeThoughts: true` alone is not enough: it asks for a summary of
whatever thinking happened, and Flash-Lite models — the default
`gemini-3.5-flash-lite` among them — think at `minimal` unless told otherwise, so
the request succeeded and simply carried no thoughts back. The level is a
separate dial whose name changed with the model family: 3.x takes
`thinkingLevel: 'medium'` (`GEMINI_THINKING_LEVEL`), 2.5 takes a token count
(`thinkingBudget: -1`, dynamic), and sending both in one request is a 400. The
provider picks by the version in the model id and falls back through the other
shapes — then to no thinking at all — if Google refuses one, since an answer
without thoughts beats no answer.

Thoughts are billed and counted as output, so a thinking turn gets its own
ceiling (`GEMINI_THINKING_MAX_OUTPUT_TOKENS`, 4096): on the plain 1024 the model
can spend the whole budget reasoning and finish on `MAX_TOKENS` having said
nothing.

`/api/chat` stays as the non-streaming fallback; the browser falls back to it
automatically if the stream cannot be started, but not once text has arrived —
restarting mid-answer would rewrite what someone is already reading.

## The browser engine (WebGPU)

The chip button in the composer moves the assistant off the server entirely: the
model downloads to the browser once and runs there on the GPU, through
[@mlc-ai/web-llm](https://github.com/mlc-ai/web-llm). Ported from StreeFlood's
on-device mode — its GPU path only, since the CPU (wllama/WASM) path needs
cross-origin isolation and a second engine to maintain.

Two Qwen3 builds are recommended up front (`lib/ai/browser/models.js`), and the
rest of the catalogue is a search: **Settings → In this browser → search Hugging
Face**. `lib/ai/browser/catalog.js` lists the MLC conversions from the `mlc-ai`
account with their download counts, and joins each one against the installed
web-llm's `prebuiltAppConfig`.

That join is the point. Weights alone do not run in a browser — a model also
needs a WebGPU shader library compiled for its architecture and quantisation and
pinned to this exact web-llm version, which is what `prebuiltAppConfig` lists (163
builds in 0.2.84). A repo without one is shown and marked rather than hidden,
since "why is Gemma 3 greyed out" deserves an answer on screen. Picking a model
costs one more request to the repo's file tree: web-llm's config states VRAM,
which is not the download size, and the size is the number someone about to spend
their data needs. The VRAM and context figures still come from web-llm itself
rather than being estimated, because a wrong figure surfaces as a multi-gigabyte
download that completes and then refuses to start.

Details that are not decoration:

- **q4f16 → q4f32 fallback.** A GPU without the WebGPU feature `shader-f16` fails
  to compile the f16 shaders — *after* the whole model has downloaded. So the
  adapter is asked first, and every id, size and cache check follows the answer.
  For a model picked from the search there is no curated twin, so `resolveModelId`
  swaps the quantisation in the id and takes the result only if web-llm actually
  ships a library for it.
- **Main thread, not a worker.** A worker that fetches its script needs that
  script's response to carry COEP, and on a cross-origin-isolated page it
  otherwise fails to construct — at which point web-llm waits forever for a
  message that never arrives: no error, a bar frozen at 0%. The trade is a less
  smooth page while generating.
- **Prefill progress is an estimate.** web-llm reports nothing between "prompt
  accepted" and "first token", which on a long prompt is tens of seconds of
  apparent hang. `lib/ai/browser/prefill.js` predicts it from prompt length and
  the token rate this machine measured on its last run (kept in localStorage), and
  eases toward 99% rather than arriving early and stopping.
- **A snapshot prompt, not tools.** `POST /api/ai/context` runs the same tool
  handlers server-side and returns one prompt (`lib/ai/context.js`). Given real
  tools, a 4-bit model of this size announces a call it never makes. The prompt is
  reused for two minutes so the model's KV cache survives between turns —
  changing one character of it forces a full re-prefill.
- **Fallback is arranged, never assumed.** The browser engine only hands a failed
  turn to the server when the chain says so — a lane holding it alone reports the
  failure instead, because someone who moved the conversation onto their own
  machine did not ask for it to be quietly sent to a provider. In the other
  direction, reaching it as a fallback asks before downloading anything.

Camera data: `browser` is in the default `AI_FOCUS_PROVIDERS` because the rule is
about data leaving the device, and this engine sends nothing anywhere — the focus
rows are already in that browser, fetched by the Focus tab. Drop it from the list
if the policy you want is "camera data stays on the Pi and the server".

## Routes

| Route | Purpose |
|---|---|
| `POST /api/chat` | Q&A, non-streaming fallback |
| `POST /api/chat/stream` | streamed Q&A with tools (SSE) |
| `POST /api/ai/context` | snapshot prompt for the browser (WebGPU) engine |
| `POST /api/gemini-analyze` | analyze a reading → `{summary, recommendations[]}` |
| `GET /api/ai/models?provider=` | live model list for the settings picker |
| `GET /api/config` | `ai.{order, available, localBaseUrl, …}` — endpoints and model preferences only, never keys |
| `GET /api/health` | `ai_enabled`, `ai_providers` |

`/api/gemini-analyze` keeps its original path so existing clients and the relay
hop stay compatible; it is no longer Gemini-specific. Both AI routes report
`provider` and `model` alongside the answer.
