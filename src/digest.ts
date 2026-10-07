import { createHmac } from 'node:crypto';
import type { Entry } from './model-lite';

export interface FeedSpec { url: string; name: string; group: string }
export type FetchResult = { ok: true; status: number; text: string } | { ok: false; error: string };
export type FetchImpl = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const TIMEOUT_MS = 20_000;

export async function fetchFeed(url: string, fetchImpl: FetchImpl = globalThis.fetch as FetchImpl, timeoutMs = TIMEOUT_MS): Promise<FetchResult> {
  const attempt = async (headers?: Record<string, string>): Promise<{ status: number; text: string }> => {
    const timer = AbortSignal.timeout(timeoutMs);
    const response = await fetchImpl(url, { headers, signal: timer });
    return { status: response.status, text: await response.text() };
  };
  try {
    let response = await attempt();
    // Some CDNs (e.g. QbitAI) reject requests without a browser UA; retry once with one.
    if (response.status === 403) response = await attempt({ 'User-Agent': BROWSER_UA });
    if (response.status < 200 || response.status >= 300) return { ok: false, error: `HTTP ${response.status}` };
    return { ok: true, status: response.status, text: response.text };
  } catch (error) {
    const reason = error instanceof Error && error.name === 'TimeoutError' ? `超时（${timeoutMs / 1000} 秒）` : '网络错误';
    return { ok: false, error: reason };
  }
}

export interface FeedState { lastTs: number; ids: string[] }
export type BotState = Record<string, FeedState>;
const SEEN_IDS_CAP = 100;

/** Returns unseen entries (newest first, capped at limit) and the state to persist. */
export function collectNew(entries: Entry[], seen: FeedState | undefined, limit: number): { fresh: Entry[]; next: FeedState } {
  const known = new Set(seen?.ids ?? []);
  const fresh = entries.filter(entry => !known.has(entry.id)).slice(0, limit);
  const lastTs = Math.max(seen?.lastTs ?? 0, ...entries.map(entry => entry.publishedTs ?? 0));
  const ids = [...new Set([...entries.slice(0, SEEN_IDS_CAP).map(entry => entry.id), ...(seen?.ids ?? [])])].slice(0, SEEN_IDS_CAP);
  return { fresh, next: { lastTs, ids } };
}

export interface DigestItem { entry: Entry; feedName: string; group: string }
export interface FeishuCard { msg_type: 'interactive'; card: object }
const MAX_ITEMS_PER_CARD = 20;
const MAX_CARD_BYTES = 25_000;

function formatTime(entry: Entry): string {
  if (!entry.publishedTs) return '';
  const d = new Date(entry.publishedTs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function cardPayload(title: string, items: DigestItem[]): FeishuCard {
  const groups: [string, DigestItem[]][] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last[0] === item.group) last[1].push(item);
    else groups.push([item.group, [item]]);
  }
  const elements: object[] = [];
  for (const [group, values] of groups) {
    if (group) elements.push({ tag: 'div', text: { tag: 'lark_md', content: `**${group}**` } });
    for (const item of values) {
      const time = formatTime(item.entry);
      const meta = [item.feedName, time].filter(Boolean).join(' · ');
      elements.push({ tag: 'div', text: { tag: 'lark_md', content: `[${item.entry.title}](${item.entry.link})\n${meta}` } });
    }
  }
  return { msg_type: 'interactive', card: { config: { wide_screen_mode: true }, header: { title: { tag: 'plain_text', content: title }, template: 'blue' }, elements } };
}

/** Builds one or more cards, splitting on item count and serialized size limits. */
export function buildCards(title: string, items: DigestItem[]): FeishuCard[] {
  const cards: FeishuCard[] = [];
  let current: DigestItem[] = [];
  const flush = () => {
    if (!current.length) return;
    const label = cards.length ? `${title}（${cards.length + 1}）` : title;
    cards.push(cardPayload(label, current));
    current = [];
  };
  for (const item of items) {
    current.push(item);
    const tooMany = current.length >= MAX_ITEMS_PER_CARD;
    const tooBig = new TextEncoder().encode(JSON.stringify(cardPayload(title, current))).byteLength > MAX_CARD_BYTES;
    if (tooMany || tooBig) {
      if (tooBig && !tooMany && current.length > 1) { current.pop(); flush(); current.push(item); }
      else flush();
    }
  }
  flush();
  return cards;
}

/** Feishu bot signature: HMAC-SHA256 over an empty payload, keyed by `${timestamp}\n${secret}`. */
export function sign(secret: string, timestamp: string): string {
  return createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64');
}

export async function sendCard(webhook: string, card: FeishuCard, secret: string | undefined, fetchImpl: FetchImpl = globalThis.fetch as FetchImpl): Promise<{ ok: boolean; error?: string }> {
  const body: Record<string, unknown> = { ...card };
  if (secret) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    body.timestamp = timestamp;
    body.sign = sign(secret, timestamp);
  }
  try {
    const response = await fetchImpl(webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    return { ok: response.status >= 200 && response.status < 300, error: response.status >= 200 && response.status < 300 ? undefined : `HTTP ${response.status}` };
  } catch {
    return { ok: false, error: '发送失败' };
  }
}
