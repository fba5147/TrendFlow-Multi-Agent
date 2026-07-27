import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { GeneratorPlugin, GeneratedContent, GenerationConfig } from "../../core/types";
import { Trend } from "../../../lib/langgraph/state";
import { createLLM } from "../../../lib/llm";

const newsletterGenerator: GeneratorPlugin = {
  id: "newsletter",
  name: "Newsletter",
  description: "Full email newsletter with intro, trend breakdowns, quick takes, and CTA",
  outputType: "newsletter",

  async generate(trends: Trend[], config: GenerationConfig, llmProvider?: string, llmModel?: string): Promise<GeneratedContent> {
    const llm = createLLM(llmProvider, llmModel);
    const persona = config.persona || "Growth marketer";

    const trendsText = trends
      .map(
        (t, i) =>
          `${i + 1}. ${t.title}\n   ${t.summary}\n   Why it matters: ${t.whyItMatters}\n   Sources: ${t.sources.map((s) => s.url).join(", ")}`
      )
      .join("\n\n");

    const system = `You are an expert newsletter writer. Write a weekly trend digest for ${persona}.
Style: The Hustle / Morning Brew tone — conversational, sharp, never boring. Deliver value in every paragraph.`;

    const userMsg = `Write a newsletter edition based on these trends:

${trendsText}

Structure (in markdown):
1. **Subject line** — compelling email subject (50 chars max)
2. **Opening** — 2–3 sentence hook that frames the week's themes
3. **Main stories** — one H2 per trend with:
   - 1-sentence summary
   - "The signal": what this means right now
   - "The play": one concrete action the reader can take
4. **Quick takes** — 3–5 bullet points of mini-insights
5. **Until next week** — 1–2 sentence sign-off with a thought-provoking question

Return ONLY valid JSON:
{
  "title": "Subject line here",
  "sections": [
    {"heading": "Opening", "content": "..."},
    {"heading": "Trend Name", "content": "..."},
    {"heading": "Quick Takes", "content": "..."},
    {"heading": "Until Next Week", "content": "..."}
  ],
  "metadata": {"readTime": "4 min"}
}`;

    const response = await llm.invoke([new SystemMessage(system), new HumanMessage(userMsg)]);
    const content = response.content as string;

    try {
      const firstBrace = content.indexOf("{");
      const lastBrace = content.lastIndexOf("}");
      const json = JSON.parse(content.substring(firstBrace, lastBrace + 1));
      return {
        type: "newsletter",
        title: json.title,
        sections: json.sections,
        body: json.sections
          ?.map((s: { heading: string; content: string }) => `## ${s.heading}\n\n${s.content}`)
          .join("\n\n"),
        metadata: json.metadata,
        citations: trends.flatMap((t) => t.sources.map((s) => ({ title: t.title, url: s.url }))),
      };
    } catch {
      return {
        type: "newsletter",
        title: `Weekly Trend Digest: ${trends[0]?.title || ""}`,
        body: content,
        citations: trends.flatMap((t) => t.sources.map((s) => ({ title: t.title, url: s.url }))),
      };
    }
  },
};

export { newsletterGenerator };
