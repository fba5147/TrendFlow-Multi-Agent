import { SourcePlugin, SourceResult, TrendQuery } from "../../core/types";

interface RedditPost {
  data: {
    title: string;
    permalink: string;
    selftext: string;
    score: number;
    created_utc: number;
    url: string;
    subreddit: string;
    num_comments: number;
  };
}

interface RedditResponse {
  data: {
    children: RedditPost[];
  };
}

function getTimeFilter(timeWindow: string): string {
  const lower = timeWindow.toLowerCase();
  if (lower.includes("day") || lower === "today") return "day";
  if (lower.includes("week") || lower === "recent") return "week";
  if (lower.includes("month")) return "month";
  return "week";
}

const redditPlugin: SourcePlugin = {
  id: "reddit",
  name: "Reddit",
  description: "Hot posts from Reddit — free, no API key required",
  requiresApiKey: false,
  isAvailable: () => true,

  async fetch(query: TrendQuery): Promise<SourceResult[]> {
    const t = getTimeFilter(query.timeWindow);
    const q = encodeURIComponent(query.domain);
    const url = `https://www.reddit.com/search.json?q=${q}&sort=top&t=${t}&limit=25`;

    const res = await fetch(url, {
      headers: { "User-Agent": "TrendFlow/1.0 (open-source marketing intelligence)" },
    });

    if (!res.ok) {
      console.warn(`[reddit] API returned ${res.status}`);
      return [];
    }

    const data = (await res.json()) as RedditResponse;

    return (data.data?.children || [])
      .filter((p) => p.data.score > 10)
      .map((p) => ({
        title: p.data.title,
        url: `https://reddit.com${p.data.permalink}`,
        snippet: p.data.selftext?.substring(0, 300) || undefined,
        timestamp: new Date(p.data.created_utc * 1000).toISOString(),
        source: "reddit",
        score: Math.min(1, p.data.score / 1000),
      }))
      .slice(0, 15);
  },
};

export { redditPlugin };
