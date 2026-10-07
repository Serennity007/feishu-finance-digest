import { readFile, writeFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import catalogJson from './data/finance-feeds.json' with { type: 'json' };
import { parseFeed } from './feeds';
import { buildCards, collectNew, fetchFeed, sendCard, type BotState, type DigestItem, type FeedSpec } from './digest';

interface Config {
  webhook: string;
  secret?: string;
  feeds: FeedSpec[] | 'catalog';
  groups?: string[];
  perFeedLimit?: number;
  title?: string;
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const configPath = args.find((a, i) => args[i - 1] === '--config') ?? 'config.json';

function fail(message: string): never { console.error(`错误：${message}`); process.exit(1); }

async function main() {
const config: Config = await readFile(configPath, 'utf8')
  .then(text => JSON.parse(text) as Config)
  .catch(() => fail(`无法读取 ${configPath}，请参照 config.example.json 创建`));
if (!dryRun && !config.webhook) fail('config.json 缺少 webhook');

const catalog = (catalogJson as unknown as { feeds: { feed_url?: string; title: string; category: string }[] }).feeds;
const feeds: FeedSpec[] = (config.feeds === 'catalog'
  ? catalog.filter(f => f.feed_url).map(f => ({ url: f.feed_url!, name: f.title, group: f.category }))
  : config.feeds)
  .filter(f => !config.groups?.length || config.groups.includes(f.group));
if (!feeds.length) fail('没有可抓取的订阅源');
const limit = config.perFeedLimit ?? 5;
const title = config.title ?? '财经资讯摘要';

const state: BotState = await readFile('state.json', 'utf8').then(text => JSON.parse(text) as BotState).catch(() => ({}));
const doc = new JSDOM('').window.document;

const items: DigestItem[] = [];
let failures = 0;
for (const feed of feeds) {
  const result = await fetchFeed(feed.url);
  if (!result.ok) { failures++; console.warn(`[失败] ${feed.name}（${feed.url}）：${result.error}`); continue; }
  try {
    const parsed = await parseFeed(result.text, feed.url, doc);
    const { fresh, next } = collectNew(parsed.entries, state[feed.url], limit);
    state[feed.url] = next;
    for (const entry of fresh) items.push({ entry, feedName: parsed.name || feed.name, group: feed.group });
    console.log(`[成功] ${feed.name}：${fresh.length} 条新文章`);
  } catch (error) {
    failures++;
    console.warn(`[失败] ${feed.name}（${feed.url}）：${error instanceof Error ? error.message : '解析错误'}`);
  }
}
items.sort((a, b) => (b.entry.publishedTs ?? 0) - (a.entry.publishedTs ?? 0));

const cards = buildCards(title, items);
if (dryRun) {
  console.log(JSON.stringify(cards, null, 2));
  console.log(`（dry-run：共 ${items.length} 条新文章、${cards.length} 张卡片、${failures} 个源失败；未发送、未写 state.json）`);
} else {
  for (const card of cards) {
    const sent = await sendCard(config.webhook, card, config.secret);
    if (!sent.ok) console.error(`[发送失败] ${sent.error}`);
  }
  await writeFile('state.json', JSON.stringify(state, null, 2));
  console.log(`完成：推送 ${items.length} 条新文章（${cards.length} 张卡片），${failures} 个源失败`);
}
}

void main();
