import { SourcePlugin, SourceResult, TrendQuery } from "../../core/types";

interface GithubRepo {
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  forks_count: number;
  topics: string[];
  created_at: string;
  pushed_at: string;
  language: string | null;
}

interface GithubSearchResponse {
  items: GithubRepo[];
  total_count: number;
}

function getDateThreshold(timeWindow: string): string {
  const now = new Date();
  const lower = timeWindow.toLowerCase();
  if (lower.includes("day") || lower === "today" || lower === "yesterday") {
    now.setDate(now.getDate() - 2);
  } else if (lower.includes("week") || lower === "recent") {
    now.setDate(now.getDate() - 7);
  } else if (lower.includes("month")) {
    now.setMonth(now.getMonth() - 1);
  } else {
    now.setDate(now.getDate() - 14);
  }
  return now.toISOString().split("T")[0];
}

const githubTrendsPlugin: SourcePlugin = {
  id: "github-trends",
  name: "GitHub Trends",
  description: "Trending repositories and topics on GitHub — free, optional token for higher rate limits",
  requiresApiKey: false,
  apiKeyEnvVar: "GITHUB_TOKEN",
  isAvailable: () => true,

  async fetch(query: TrendQuery): Promise<SourceResult[]> {
    const since = getDateThreshold(query.timeWindow);
    const q = encodeURIComponent(`${query.domain} pushed:>${since}`);
    const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=20`;

    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "TrendFlow/1.0",
    };
    if (process.env.GITHUB_TOKEN) {
      headers["Authorization"] = `token ${process.env.GITHUB_TOKEN}`;
    }

    const res = await fetch(url, { headers });
    if (!res.ok) {
      console.warn(`[github-trends] API returned ${res.status}`);
      return [];
    }

    const data = (await res.json()) as GithubSearchResponse;

    return (data.items || []).map((repo) => ({
      title: `${repo.full_name}${repo.description ? ` — ${repo.description}` : ""}`,
      url: repo.html_url,
      snippet: [
        repo.description,
        repo.language ? `Language: ${repo.language}` : null,
        repo.topics?.length ? `Topics: ${repo.topics.slice(0, 5).join(", ")}` : null,
        `${repo.stargazers_count.toLocaleString()} stars`,
      ]
        .filter(Boolean)
        .join(" | "),
      timestamp: repo.pushed_at,
      source: "github-trends",
      score: Math.min(1, repo.stargazers_count / 5000),
    }));
  },
};

export { githubTrendsPlugin };
