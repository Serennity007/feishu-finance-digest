import { describe, expect, it, vi } from 'vitest';
import { buildCards, collectNew, fetchFeed, sign, sendCard, type DigestItem, type FetchImpl } from '../src/digest';
import type { Entry } from '../src/model-lite';

const entry = (id: string, ts: number | null, title = `Article ${id}`): Entry => ({ id, sourceId: 'local:x', title, link: `https://example.org/${id}`, publishedTs: ts });

describe('collectNew', () => {
  it('returns latest entries capped by limit on first run, then only unseen ones', () => {
    const entries = [entry('a', 300), entry('b', 200), entry('c', 100)];
    const first = collectNew(entries, undefined, 2);
    expect(first.fresh.map(e => e.id)).toEqual(['a', 'b']);
    expect(first.next.lastTs).toBe(300);
    expect(first.next.ids).toContain('c');

    const second = collectNew(entries, first.next, 5);
    expect(second.fresh).toEqual([]);

    const updated = [entry('d', 400), ...entries];
    const third = collectNew(updated, first.next, 5);
    expect(third.fresh.map(e => e.id)).toEqual(['d']);
    expect(third.next.lastTs).toBe(400);
  });
  it('dedupes entries without timestamps by id', () => {
    const entries = [entry('a', null), entry('b', null)];
    const first = collectNew(entries, undefined, 10);
    expect(collectNew(entries, first.next, 10).fresh).toEqual([]);
  });
  it('caps the remembered id set', () => {
    const entries = Array.from({ length: 150 }, (_, i) => entry(`id${i}`, i));
    const { next } = collectNew(entries, undefined, 0);
    expect(next.ids.length).toBeLessThanOrEqual(100);
  });
});

describe('buildCards', () => {
  const item = (id: string, group: string): DigestItem => ({ entry: entry(id, 1700000000000, `标题 ${id}`), feedName: 'Feed', group });
  it('groups consecutive items into sections and builds a single card', () => {
    const cards = buildCards('财经摘要', [item('1', '美股市场'), item('2', '美股市场'), item('3', '宏观经济')]);
    expect(cards).toHaveLength(1);
    const elements = (cards[0].card as { elements: { text: { content: string } }[] }).elements;
    expect(elements[0].text.content).toBe('**美股市场**');
    expect(elements[1].text.content).toContain('[标题 1](https://example.org/1)');
    expect(elements[1].text.content).toContain('Feed');
    expect(elements.some(e => e.text.content === '**宏观经济**')).toBe(true);
  });
  it('splits cards at the item limit', () => {
    const cards = buildCards('T', Array.from({ length: 45 }, (_, i) => item(`${i}`, 'G')));
    expect(cards.length).toBe(3);
    expect(cards[1].card).toMatchObject({ header: { title: { content: 'T（2）' } } });
  });
  it('splits cards before exceeding the size budget', () => {
    const big = Array.from({ length: 20 }, (_, i) => ({ entry: entry(`${i}`, 1700000000000, '长'.repeat(1500)), feedName: 'Feed', group: 'G' }));
    const cards = buildCards('T', big);
    expect(cards.length).toBeGreaterThan(1);
    for (const card of cards) expect(new TextEncoder().encode(JSON.stringify(card)).byteLength).toBeLessThanOrEqual(25_100);
  });
});

describe('sign', () => {
  it('matches the Feishu HMAC-SHA256 scheme (key = timestamp\\nsecret, empty payload)', async () => {
    const { createHmac } = await import('node:crypto');
    const expected = createHmac('sha256', '1700000000\nmy-secret').update('').digest('base64');
    expect(sign('my-secret', '1700000000')).toBe(expected);
  });
});

describe('fetchFeed', () => {
  const ok = (text: string) => ({ status: 200, text: async () => text });
  it('returns body on 200 without retrying', async () => {
    const fetchImpl = vi.fn<FetchImpl>().mockResolvedValue(ok('<rss/>'));
    const result = await fetchFeed('https://a.example/feed', fetchImpl);
    expect(result).toEqual({ ok: true, status: 200, text: '<rss/>' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it('retries a 403 once with a browser User-Agent', async () => {
    const fetchImpl = vi.fn<FetchImpl>()
      .mockResolvedValueOnce({ status: 403, text: async () => '' })
      .mockResolvedValueOnce(ok('<rss/>'));
    const result = await fetchFeed('https://www.qbitai.com/feed', fetchImpl);
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[1][1]?.headers?.['User-Agent']).toContain('Mozilla/5.0');
  });
  it('reports a persistent 403 and does not retry other statuses', async () => {
    const fetchImpl = vi.fn<FetchImpl>().mockResolvedValue({ status: 403, text: async () => '' });
    expect(await fetchFeed('https://a.example/feed', fetchImpl)).toEqual({ ok: false, error: 'HTTP 403' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const missing = vi.fn<FetchImpl>().mockResolvedValue({ status: 404, text: async () => '' });
    expect(await fetchFeed('https://a.example/none', missing)).toEqual({ ok: false, error: 'HTTP 404' });
    expect(missing).toHaveBeenCalledTimes(1);
  });
  it('maps timeouts and network errors to friendly failures', async () => {
    const timeout = vi.fn<FetchImpl>().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'TimeoutError' }));
    expect(await fetchFeed('https://a.example/slow', timeout)).toEqual({ ok: false, error: '超时（20 秒）' });
    const down = vi.fn<FetchImpl>().mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await fetchFeed('https://a.example/down', down)).toEqual({ ok: false, error: '网络错误' });
  });
});

describe('sendCard', () => {
  const card = { msg_type: 'interactive' as const, card: { header: {}, elements: [] } };
  it('posts the card with signature fields when a secret is set', async () => {
    const fetchImpl = vi.fn<FetchImpl>().mockResolvedValue({ status: 200, text: async () => '{}' });
    expect(await sendCard('https://hook.example/x', card, 'sec', fetchImpl)).toEqual({ ok: true });
    const init = fetchImpl.mock.calls[0][1];
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body ?? '{}');
    expect(body.msg_type).toBe('interactive');
    expect(body.sign).toBe(sign('sec', body.timestamp));
  });
  it('omits signature fields without a secret and reports HTTP failures', async () => {
    const fetchImpl = vi.fn<FetchImpl>().mockResolvedValue({ status: 400, text: async () => '' });
    expect(await sendCard('https://hook.example/x', card, undefined, fetchImpl)).toEqual({ ok: false, error: 'HTTP 400' });
    expect(JSON.parse(fetchImpl.mock.calls[0][1]?.body ?? '{}').sign).toBeUndefined();
  });
});

describe('state round-trip', () => {
  it('serializes and restores bot state', () => {
    const state = { 'https://a.example/feed': { lastTs: 123, ids: ['a', 'b'] } };
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);
  });
});
