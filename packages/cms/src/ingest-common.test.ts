import { describe, expect, it } from 'vitest';
import { fetchText } from './ingest-common';

describe('fetchText', () => {
  const url = new URL('https://example.test/data?api_key=secret');

  it('keeps retrying a URL that times out for a while, then succeeds', async () => {
    let calls = 0;
    const waits: number[] = [];
    const body = await fetchText(url, {
      fetch: (async () => {
        calls++;
        if (calls < 6) throw new Error('The operation was aborted due to timeout');
        return new Response('ok');
      }) as typeof fetch,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(body).toBe('ok');
    expect(waits).toEqual([2000, 4000, 8000, 16000, 32000]);
  });

  it('gives up after six tries, without the key in the error', async () => {
    const fail = (async () => {
      throw new Error('timeout');
    }) as typeof fetch;
    await expect(fetchText(url, { fetch: fail, sleep: async () => {} })).rejects.toThrow(
      'Could not fetch https://example.test/data: timeout',
    );
  });

  it('does not retry a request the server refuses', async () => {
    let calls = 0;
    const notFound = (async () => {
      calls++;
      return new Response('no', { status: 404 });
    }) as typeof fetch;
    await expect(fetchText(url, { fetch: notFound, sleep: async () => {} })).rejects.toThrow(
      /HTTP 404/,
    );
    expect(calls).toBe(1);
  });
});
