import { SourcePlugin, SourceResult, TrendQuery } from "../../core/types";

interface RSSItem {
  title?: string;
  link?: string;
  description?: string;
  pubDate?: string;
}

function parseRSSItems(xml: string): RSSItem[] {
  const items: RSSItem[] = [];
  const itemBlocks = xml.split(/<item[\s>]/i).slice(1);

  for (const block of itemBlocks) {
    const end = block.indexOf("</item>");
    const content = end >= 0 ? block.substring(0, end) : block;

    const titleMatch = content.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const linkMatch = content.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
    const descMatch = content.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
    const dateMatch = content.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);

    if (titleMatch) {
      items.push({
        title: titleMatch[1].replace(/<[^>]+>/g, "").trim(),
        link: linkMatch?.[1].replace(/<[^>]+>/g, "").trim(),
        description: descMatch?.[1].replace(/<[^>]+>/g, "").trim().substring(0, 400),
        pubDate: dateMatch?.[1].trim(),
      });
    }
  }

  return items;
}

function isRelevant(item: RSSItem, query: TrendQuery): boolean {
  const terms = query.domain.toLowerCase().split(/\s+/).filter((t) => t.length > 3);
  const text = `${item.title || ""} ${item.description || ""}`.toLowerCase();
  return terms.some((t) => text.includes(t));
}

const rssFeedPlugin: SourcePlugin = {
  id: "rss-feed",
  name: "RSS Feeds",
  description: "Custom RSS feeds — configure URLs via RSS_FEEDS env var (comma-separated)",
  requiresApiKey: false,
  apiKeyEnvVar: "RSS_FEEDS",
  isAvailable: () => !!(process.env.RSS_FEEDS?.trim()),

  async fetch(query: TrendQuery): Promise<SourceResult[]> {
    const feedUrls = (process.env.RSS_FEEDS || "")
      .split(",")
      .map((u) => u.trim())
      .filter(Boolean);

    if (feedUrls.length === 0) return [];

    const results = await Promise.allSettled(
      feedUrls.map(async (feedUrl): Promise<SourceResult[]> => {
        const res = await fetch(feedUrl, { headers: { "User-Agent": "TrendFlow/1.0" } });
        if (!res.ok) return [];
        const xml = await res.text();
        return parseRSSItems(xml)
          .filter((item) => isRelevant(item, query))
          .map((item) => ({
            title: item.title || "Untitled",
            url: item.link || feedUrl,
            snippet: item.description,
            timestamp: item.pubDate ? new Date(item.pubDate).toISOString() : undefined,
            source: "rss-feed",
            score: 0.7,
          }));
      })
    );

    return results
      .filter((r): r is PromiseFulfilledResult<SourceResult[]> => r.status === "fulfilled")
      .flatMap((r) => r.value)
      .slice(0, 20);
  },
};

export { rssFeedPlugin };
