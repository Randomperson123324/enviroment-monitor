'use client';

/**
 * One chat turn on the browser engine, emitting the same events as the server's
 * SSE route so ChatPane renders both the same way.
 *
 * Ported from StreeFlood's `streamLocalReply`. The shape differs in one place:
 * WebLLM reports progress through callbacks (`initProgressCallback`, and a
 * setInterval for the prefill estimate), which cannot yield from inside a
 * generator — so the work runs in the background and pushes into a queue that
 * the generator drains.
 */

import { BROWSER_AI } from '@/config/client';
import { MSG } from '@/config/messages.th';
import { enqueue, getEngine, resolveModelId } from '@/lib/ai/browser/engine';
import { recordPrefillCalibration, splitThinking, trackPrefillProgress } from '@/lib/ai/browser/prefill';

/** Bridges callback-driven progress into an async iterator. */
function eventQueue() {
  const items = [];
  let wake = null;
  let done = false;
  let failure = null;

  return {
    push(ev) {
      items.push(ev);
      wake?.();
      wake = null;
    },
    finish(err) {
      done = true;
      failure = err ?? null;
      wake?.();
      wake = null;
    },
    async *drain() {
      for (;;) {
        while (items.length) yield items.shift();
        if (done) {
          if (failure) throw failure;
          return;
        }
        await new Promise((resolve) => {
          wake = resolve;
        });
      }
    },
  };
}

let promptCache = null;

/** The snapshot prompt, reused while it is fresh — see BROWSER_AI.contextTtlMs. */
async function fetchContextPrompt({ apiBase, deviceId, lang, signal }) {
  const now = Date.now();
  if (promptCache && promptCache.deviceId === deviceId && now - promptCache.at < BROWSER_AI.contextTtlMs) {
    return promptCache.prompt;
  }
  const res = await fetch(`${apiBase}/api/ai/context`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: deviceId, lang }),
    signal,
  });
  if (!res.ok) throw new Error(`context ${res.status}`);
  const data = await res.json();
  if (!data.systemPrompt) throw new Error('context returned no prompt');
  promptCache = { deviceId, prompt: data.systemPrompt, at: now };
  return data.systemPrompt;
}

/** Drop the cached prompt — used when the user switches device. */
export function clearContextCache() {
  promptCache = null;
}

/**
 * Yields `start`, `status`, `thinking`, `delta`.
 *
 * `status` is what this engine has instead of tool chips: loading the model,
 * fetching the snapshot, chewing through the prompt. Without it the first
 * question on a cold cache looks like a hang for two minutes.
 */
export async function* browserChatEvents({
  messages,
  apiBase = '',
  deviceId,
  lang = 'th',
  modelId,
  thinking = false,
  sendContext = true,
  labels,
  signal,
}) {
  const queue = eventQueue();

  const run = async () => {
    const model = await resolveModelId(modelId);
    queue.push({ type: 'start', provider: 'browser', model });

    let systemPrompt;
    if (!sendContext) {
      systemPrompt = MSG.browser.bare;
    } else {
      queue.push({ type: 'status', text: labels.fetchingContext });
      try {
        systemPrompt = await fetchContextPrompt({ apiBase, deviceId, lang, signal });
      } catch {
        // Offline, or the route is down. Still answerable — but the model has to
        // be told it has no data, or it will fill the gap with plausible numbers.
        systemPrompt = MSG.browser.offline;
      }
    }

    const engine = await getEngine(modelId, (progress) => {
      const pct = Math.round(progress * 100);
      // 100% means the files are read, not that the model is ready: uploading
      // weights to the GPU and compiling shaders happens after, with no progress
      // of its own, and it is the slowest part on a first run.
      queue.push({ type: 'status', text: pct >= 100 ? labels.preparingModel : `${labels.loadingModel} ${pct}%` });
    });

    await enqueue(async () => {
      const promptChars = systemPrompt.length + messages.reduce((n, m) => n + m.content.length, 0);
      const prefill = trackPrefillProgress({
        promptChars,
        onTick: (pct) => queue.push({ type: 'status', text: `${labels.analyzingPrompt} ${pct}%` }),
      });

      try {
        const chunks = await engine.chat.completions.create({
          messages: [{ role: 'system', content: systemPrompt }, ...messages],
          stream: true,
          stream_options: { include_usage: true },
          temperature: BROWSER_AI.temperature,
          max_tokens: thinking ? BROWSER_AI.thinkingMaxTokens : BROWSER_AI.maxTokens,
          /**
           * The hybrid-thinking switch (web-llm >= 0.2.80), and only for models
           * that have one. `enable_thinking: false` is not a no-op elsewhere:
           * web-llm implements it by writing a literal `<think></think>` block
           * into the reply header, which on a model with no thinking mode is two
           * stray tags at the top of every answer. Any model can be chosen from
           * the search now, so the switch has to be sent only where it means
           * something.
           */
          ...(/qwen3/i.test(model) ? { extra_body: { enable_thinking: Boolean(thinking) } } : {}),
        });

        let fullText = '';
        // WebLLM hands back the whole text so far; the UI appends fragments.
        let sentThinking = 0;
        let sentAnswer = 0;

        for await (const chunk of chunks) {
          if (signal?.aborted) break;

          // The final chunk carries what the engine actually measured — the only
          // honest input for the next run's prefill estimate.
          if (chunk.usage) {
            const extra = chunk.usage.extra ?? {};
            recordPrefillCalibration({
              rate: extra.prefill_tokens_per_s > 0 ? extra.prefill_tokens_per_s : undefined,
              decodeRate: extra.decode_tokens_per_s > 0 ? extra.decode_tokens_per_s : undefined,
              // WebLLM counts only the *new* prompt tokens once a conversation is
              // running, so chars-per-token is measurable on the first turn only.
              charsPerToken:
                messages.length === 1 && chunk.usage.prompt_tokens > 0
                  ? promptChars / chunk.usage.prompt_tokens
                  : undefined,
            });
          }

          const delta = chunk.choices[0]?.delta?.content ?? '';
          if (!delta) continue;
          if (!fullText) prefill.done();
          fullText += delta;

          const split = splitThinking(fullText);
          if (split.thinking.length > sentThinking) {
            queue.push({ type: 'thinking', text: split.thinking.slice(sentThinking) });
            sentThinking = split.thinking.length;
          }
          if (split.answer.length > sentAnswer) {
            queue.push({ type: 'delta', text: split.answer.slice(sentAnswer) });
            sentAnswer = split.answer.length;
          } else if (!split.answer) {
            queue.push({ type: 'status', text: split.inThink ? labels.thinkingStatus : labels.thinking });
          }
        }
      } finally {
        // Reached here without a token (error, abort) — stop the ticker, and
        // record nothing: a cancelled run measures the user, not the machine.
        prefill.cancel();
      }
    });
  };

  run().then(
    () => queue.finish(),
    (err) => queue.finish(err)
  );

  yield* queue.drain();
}
