// Minimal Entry model and URL helper, vendored from stocks-rss src/model.ts
// (https://github.com/Serennity007/serenity-stock-rss, GPL-3.0-only) with the
// zod schemas replaced by plain TypeScript types for standalone Node use.

export interface Entry {
  id: string;
  sourceId: string;
  origin?: 'local' | 'qiaomu' | 'vault';
  sourceName?: string;
  title: string;
  link?: string;
  author?: string;
  published?: string;
  publishedTs?: number | null;
  summary?: string;
  content?: string;
  image?: string;
  audio?: { url: string; type?: string | null } | null;
}

export interface Subscription {
  id: string;
  url: string;
  name: string;
  group: string;
}

export function safeUrl(value: string, base?: string): string | null {
  try {
    const url = new URL(value, base);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
