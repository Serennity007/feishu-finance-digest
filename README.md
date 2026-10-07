# 飞书财经摘要机器人（Feishu Finance Digest）

把 31 个人工核验过的财经 RSS 源的新文章，定时以消息卡片推送到飞书群。

源目录与 RSS/Atom 解析移植自 [Stocks AI RSS](https://github.com/Serennity007/serenity-stock-rss)（commit `e04a6f3`，其本身是 [Qiaomu AI RSS](https://github.com/joeseesun/qiaomu-ai-rss) 的财经分叉）。本仓库是独立工具：上游解析层的后续修复需手工同步。

## 工作原理

- 抓取所选订阅源（20 秒超时；被 CDN 以 403 拒绝时用浏览器 UA 重试一次，量子位即属此类）。
- 用本地 `state.json` 记录每个源已见的文章 ID，只推送新文章，不重复轰炸。
- 按订阅分组组织成飞书 interactive 消息卡片；条数或体积超限自动分批。
- 单源失败只记日志，不影响其他源。

## 快速开始

要求 Node.js ≥ 18。构建产物 `dist/digest-bot.cjs` 运行时需要 `node_modules` 中的 jsdom（esbuild 将其保持为外部依赖以保留其资源文件路径），因此请在本仓库目录内运行。

```bash
npm install
cp config.example.json config.json   # 然后编辑 config.json
npm start                            # 构建并运行一次
```

`config.json`（已 gitignore，不会提交）：

| 字段 | 说明 |
|---|---|
| `webhook` | 飞书群自定义机器人地址（群设置 → 机器人 → 添加机器人 → 自定义机器人） |
| `secret` | 可选。机器人开启"签名校验"时填入签名密钥 |
| `feeds` | `"catalog"` 用内置 31 源；或填数组 `[{ "url", "name", "group" }]` 自定义 |
| `groups` | 可选。只推送这些分组，如 `["中文财经", "宏观经济"]`；空数组 = 全部 |
| `perFeedLimit` | 每源每次最多推送条数，默认 5 |
| `title` | 卡片标题，默认"财经资讯摘要" |

试跑不发送（也不写 state）：

```bash
npm start -- --dry-run
```

## 定时运行（Windows 任务计划）

```powershell
schtasks /create /tn "FeishuFinanceDigest" /sc minute /mo 30 /tr "cmd /c cd /d C:\Users\ztl\.zcode\workspace\default\feishu-finance-digest && node dist\digest-bot.cjs >> bot.log 2>&1"
```

每 30 分钟运行一次，日志追加到 `bot.log`。电脑关机/睡眠期间不推送，唤醒后的下一轮会补推未见过的新文章。

## 限制

- 飞书群自定义机器人只能发到所在群，不能发个人私聊；私聊需升级企业自建应用。
- 内置目录个别源（如黄金类）可用性较弱，失败时会在日志标记。

## 开发

```bash
npm run check   # tsc + vitest + 构建
```

许可证：GPL-3.0-only（派生自 Stocks AI RSS / Qiaomu AI RSS）。内置源目录 `src/data/finance-feeds.json` 为 CC0。
