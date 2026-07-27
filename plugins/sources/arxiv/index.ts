import { SourcePlugin, SourceResult, TrendQuery } from "../../core/types";

function extractXmlTag(xml: string, tag: string): string[] {
  const results: string[] = [];
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  let match: RegExpExecArray | null;
  while ((match = regex.exec(xml)) !== null) {
    results.push(match[1].replace(/<[^>]+>/g, "").trim());
  }
  return results;
}

const arxivPlugin: SourcePlugin = {
  id: "arxiv",
  name: "ArXiv",
  description: "Latest research papers from arXiv.org — great for AI, ML, and science trends",
  requiresApiKey: false,
  isAvailable: () => true,

  async fetch(query: TrendQuery): Promise<SourceResult[]> {
    const q = encodeURIComponent(query.domain);
    const url = `https://export.arxiv.org/api/query?search_query=all:${q}&sortBy=submittedDate&sortOrder=descending&max_results=15`;

    const res = await fetch(url, { headers: { "User-Agent": "TrendFlow/1.0" } });
    if (!res.ok) {
      console.warn(`[arxiv] API returned ${res.status}`);
      return [];
    }

    const xml = await res.text();

    const entries = xml.split("<entry>").slice(1);

    return entries
      .map((entry): SourceResult | null => {
        const idMatch = entry.match(/<id>https?:\/\/arxiv\.org\/abs\/([^<]+)<\/id>/);
        const titles = extractXmlTag(entry, "title");
        const summaries = extractXmlTag(entry, "summary");
        const published = extractXmlTag(entry, "published");

        if (!idMatch || !titles[0]) return null;

        const arxivId = idMatch[1].trim();
        return {
          title: titles[0].replace(/\s+/g, " ").trim(),
          url: `https://arxiv.org/abs/${arxivId}`,
          snippet: summaries[0]?.substring(0, 400).replace(/\s+/g, " ").trim(),
          timestamp: published[0],
          source: "arxiv",
          score: 0.75,
        };
      })
      .filter((r): r is SourceResult => r !== null)
      .slice(0, 10);
  },
};

export { arxivPlugin };
