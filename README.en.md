# Feishu Finance Digest

Push new articles from 31 hand-verified finance RSS feeds to a Feishu (Lark) group as message cards, on a schedule.

The feed catalog and the RSS/Atom parser are vendored from [Stocks AI RSS](https://github.com/Serennity007/serenity-stock-rss) (commit `e04a6f3`, itself a finance fork of [Qiaomu AI RSS](https://github.com/joeseesun/qiaomu-ai-rss)). This is a standalone tool: upstream parser fixes must be ported by hand.

## How it works

- Fetches the configured feeds (20s timeout; retries once with a browser User-Agent on a 403 — QbitAI's CDN requires this).
- Tracks seen article IDs per feed in a local `state.json`; only new articles are pushed, never duplicates.
- Groups articles into Feishu interactive message cards; batches automatically when item count or size limits are hit.
- A failing feed is logged and skipped without affecting the others.

## Quick start

Requires Node.js ≥ 18. The built `dist/digest-bot.cjs` needs jsdom from `node_modules` at runtime (kept external so its resource paths stay intact), so run it from the repository directory.

```bash
npm install
cp config.example.json config.json   # then edit config.json
npm start                            # build and run once
```

`config.json` (gitignored, never committed):

| Field | Description |
|---|---|
| `webhook` | Feishu group custom bot URL (group settings → Bots → Add bot → Custom bot) |
| `secret` | Optional. Signature secret when the bot has signature verification enabled |
| `feeds` | `"catalog"` for the bundled 31 feeds, or an array of `[{ "url", "name", "group" }]` |
| `groups` | Optional. Only push these groups, e.g. `["中文财经", "宏观经济"]`; empty = all |
| `perFeedLimit` | Max articles per feed per run, default 5 |
| `title` | Card title, default "财经资讯摘要" |

Trial run without sending (and without writing state):

```bash
npm start -- --dry-run
```

## Scheduled runs (Windows Task Scheduler)

```powershell
schtasks /create /tn "FeishuFinanceDigest" /sc minute /mo 30 /tr "cmd /c cd /d C:\path\to\feishu-finance-digest && node dist\digest-bot.cjs >> bot.log 2>&1"
```

Runs every 30 minutes, appending to `bot.log`. While the machine is off or asleep nothing is pushed; the next run catches up on unseen articles.

## Limitations

- Feishu group custom bots can only post to their own group, not to private chats; DMs require a custom enterprise app.
- A few bundled feeds (e.g. some gold sources) are less reliable; failures are flagged in the log.

## Development

```bash
npm run check   # tsc + vitest + build
```

License: GPL-3.0-only (derived from Stocks AI RSS / Qiaomu AI RSS). The bundled catalog `src/data/finance-feeds.json` is CC0.
