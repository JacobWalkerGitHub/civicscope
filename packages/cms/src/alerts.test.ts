import { describe, expect, it, vi } from 'vitest';
import { alertOnFailure, sendAlert } from './alerts';

describe('sendAlert', () => {
  it('always logs one JSON line a log-based alarm can match', async () => {
    const lines: string[] = [];
    await sendAlert(
      { title: 'FEC import failed', runId: 7 },
      { webhookUrl: null, log: (l) => lines.push(l) },
    );
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      level: 'error',
      event: 'civicscope_alert',
      title: 'FEC import failed',
      runId: 7,
    });
  });

  it('posts to an https webhook as {text}', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok'));
    await sendAlert(
      { title: 'Broke', detail: 'HTTP 500' },
      { webhookUrl: 'https://hooks.example.com/x', fetchImpl, log: () => {} },
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://hooks.example.com/x');
    expect(JSON.parse(String(init.body))).toEqual({ text: 'CivicScope: Broke\nHTTP 500' });
  });

  it('refuses a plain-http webhook and never throws when the webhook fails', async () => {
    const lines: string[] = [];
    const fetchImpl = vi.fn(async () => {
      throw new Error('ECONNRESET');
    });
    await sendAlert(
      { title: 'x' },
      { webhookUrl: 'http://hooks.example.com', fetchImpl, log: (l) => lines.push(l) },
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(
      sendAlert(
        { title: 'x' },
        { webhookUrl: 'https://hooks.example.com', fetchImpl, log: (l) => lines.push(l) },
      ),
    ).resolves.toBeUndefined();
    expect(lines.some((l) => l.includes('alert_webhook_failed'))).toBe(true);
  });
});

describe('alertOnFailure', () => {
  it('alerts and rethrows the original error', async () => {
    const lines: string[] = [];
    await expect(
      alertOnFailure(
        'Congress import failed',
        async () => {
          throw new Error('HTTP 503');
        },
        { webhookUrl: null, log: (l) => lines.push(l) },
      ),
    ).rejects.toThrow('HTTP 503');
    expect(JSON.parse(lines[0]!)).toMatchObject({
      title: 'Congress import failed',
      detail: 'HTTP 503',
    });
  });

  it('stays quiet when the command succeeds', async () => {
    const log = vi.fn();
    expect(await alertOnFailure('x', async () => 42, { webhookUrl: null, log })).toBe(42);
    expect(log).not.toHaveBeenCalled();
  });
});
