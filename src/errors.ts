// Minimal fixed-locale replacements for stocks-rss src/i18n.ts (fail/t),
// so the vendored feed parser keeps its error surface without Obsidian.

const messages: Record<string, string> = {
  'error.feedUrlInvalid': '订阅链接无效',
  'error.xmlTooLarge': 'XML 超过大小限制',
  'error.xmlDtdUnsupported': '不支持包含 DTD 的 XML',
  'error.windowUnavailable': 'DOM 环境不可用',
  'error.xmlInvalid': 'XML 解析失败',
  'error.notFeed': '不是有效的 RSS/Atom 源',
  'untitled.article': '无标题文章',
  'reader.noFeedContent': '',
  'reader.truncatedContent': '（内容过长已截断）',
};

export function t(key: string, vars?: Record<string, string | number>): string {
  let text = messages[key] ?? key;
  for (const [name, value] of Object.entries(vars ?? {})) text = text.replace(`{${name}}`, String(value));
  return text;
}

export function fail(key: string, vars?: Record<string, string | number>): never {
  throw new Error(t(key, vars));
}
