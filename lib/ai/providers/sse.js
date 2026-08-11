/**
 * Server-Sent Events reader shared by both streaming providers.
 *
 * Written by hand rather than pulled in as a dependency because the parsing rule
 * that matters is small and easy to get wrong: a chunk from `fetch` is a slice of
 * bytes, not a slice of events. An event can straddle two chunks, so anything
 * that treats each chunk as a whole message drops text at random — a bug that
 * shows up as words missing from the middle of a reply, only under load.
 *
 * So: accumulate, split on the blank line that terminates an event, and keep the
 * tail for the next chunk.
 */

/**
 * Yields the payload string of each `data:` event, `[DONE]` excluded.
 * Both providers send single-line JSON payloads; multi-line data fields are
 * joined with newlines as the spec requires.
 */
export async function* sseEvents(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('response has no readable body');
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // \r\n\r\n as well as \n\n: some gateways rewrite line endings.
    let boundary;
    while ((boundary = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const raw = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary).replace(/^\r?\n\r?\n/, '');

      const data = raw
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');

      if (!data || data === '[DONE]') continue;
      yield data;
    }
  }

  // A final event with no trailing blank line still counts.
  const tail = buffer
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (tail && tail !== '[DONE]') yield tail;
}
