import { SourcePlugin, SourceResult, TrendQuery } from "../../core/types";

const HN_API = "https://hacker-news.firebaseio.com/v0";

interface HNItem {
  id: number;
  title?: string;
  url?: string;
  text?: string;
  score?: number;
  time?: number;
  type?: string;
}

async function fetchHNItem(id: number): Promise<HNItem | null> {
  try {
    const res = await fetch(`${HN_API}/item/${id}.json`);
    return (await res.json()) as HNItem;
  } catch {
    return null;
  }
}

function isRelevant(item: HNItem, query: TrendQuery): boolean {
  const terms = query.domain.toLowerCase().split(/\s+/);
  const text = `${item.title || ""} ${item.text || ""}`.toLowerCase();
  return terms.some((t) => t.length > 3 && text.includes(t));
}

const hackerNewsPlugin: SourcePlugin = {
  id: "hacker-news",
  name: "Hacker News",
  description: "Top stories from Hacker News (news.ycombinator.com) — free, no API key required",
  requiresApiKey: false,
  isAvailable: () => true,

  async fetch(query: TrendQuery): Promise<SourceResult[]> {
    const [topRes, newRes] = await Promise.all([
      fetch(`${HN_API}/topstories.json`),
      fetch(`${HN_API}/newstories.json`),
    ]);

    const topIds = ((await topRes.json()) as number[]).slice(0, 40);
    const newIds = ((await newRes.json()) as number[]).slice(0, 20);
    const ids = [...new Set([...topIds, ...newIds])];

    const items = await Promise.all(ids.map(fetchHNItem));

    return items
      .filter((item): item is HNItem => !!item && !!item.title && item.type === "story")
      .filter((item) => isRelevant(item, query))
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 15)
      .map((item) => ({
        title: item.title!,
        url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
        snippet: item.text?.substring(0, 300),
        timestamp: item.time ? new Date(item.time * 1000).toISOString() : undefined,
        source: "hacker-news",
        score: Math.min(1, (item.score || 0) / 500),
      }));
  },
};

export { hackerNewsPlugin };
