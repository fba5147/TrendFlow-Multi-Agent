import { SourcePlugin, SourceResult, TrendQuery } from "../../core/types";

interface NewsAPIArticle {
  title: string;
  url: string;
  description: string | null;
  publishedAt: string;
  source: { name: string };
}

interface NewsAPIResponse {
  status: string;
  articles: NewsAPIArticle[];
}

function getSortBy(timeWindow: string): string {
  const lower = timeWindow.toLowerCase();
  if (lower.includes("day") || lower === "today" || lower === "recent") return "publishedAt";
  return "relevancy";
}

const newsApiPlugin: SourcePlugin = {
  id: "news-api",
  name: "News API",
  description: "Real-time news articles from 75,000+ sources via newsapi.org — requires NEWS_API_KEY",
  requiresApiKey: true,
  apiKeyEnvVar: "NEWS_API_KEY",
  isAvailable: () => !!(process.env.NEWS_API_KEY),

  async fetch(query: TrendQuery): Promise<SourceResult[]> {
    const apiKey = process.env.NEWS_API_KEY;
    if (!apiKey) return [];

    const q = encodeURIComponent(query.domain);
    const sortBy = getSortBy(query.timeWindow);
    const url = `https://newsapi.org/v2/everything?q=${q}&sortBy=${sortBy}&language=en&pageSize=20&apiKey=${apiKey}`;

    const res = await fetch(url, { headers: { "User-Agent": "TrendFlow/1.0" } });
    if (!res.ok) {
      console.warn(`[news-api] API returned ${res.status}`);
      return [];
    }

    const data = (await res.json()) as NewsAPIResponse;
    if (data.status !== "ok") return [];

    return (data.articles || [])
      .filter((a) => a.title && a.url)
      .map((a) => ({
        title: a.title,
        url: a.url,
        snippet: a.description || undefined,
        timestamp: a.publishedAt,
        source: "news-api",
        score: 0.8,
      }));
  },
};

export { newsApiPlugin };
