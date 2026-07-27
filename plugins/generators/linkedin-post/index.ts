import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { GeneratorPlugin, GeneratedContent, GenerationConfig } from "../../core/types";
import { Trend } from "../../../lib/langgraph/state";
import { createLLM } from "../../../lib/llm";

const linkedinPostGenerator: GeneratorPlugin = {
  id: "linkedin-post",
  name: "LinkedIn Post",
  description: "Professional LinkedIn post (600–1300 characters) with hook, insight, and CTA",
  outputType: "linkedin-post",

  async generate(trends: Trend[], config: GenerationConfig, llmProvider?: string, llmModel?: string): Promise<GeneratedContent> {
    const llm = createLLM(llmProvider, llmModel);
    const persona = config.persona || "Growth marketer";

    const topTrend = trends[0];
    const trendsText = trends
      .slice(0, 3)
      .map((t, i) => `${i + 1}. ${t.title}: ${t.summary}`)
      .join("\n");

    const system = `You are a LinkedIn content expert. Write a high-performing LinkedIn post for ${persona}.
Voice: direct, opinionated, data-driven — no corporate fluff. Every sentence earns its place.`;

    const userMsg = `Write a LinkedIn post based on these trends:

${trendsText}

Requirements:
- Opening hook in first line (stops the scroll)
- 600–1300 characters total
- Key insight backed by data from the trends
- 3–5 line breaks for readability (LinkedIn style)
- End with a question or CTA that drives comments
- Include 3–5 relevant hashtags

Top trend for focus: ${topTrend.title}

Return ONLY valid JSON:
{
  "title": "Post hook (first line)",
  "body": "full post text here",
  "metadata": {"hashtags": "#tag1 #tag2 #tag3", "estimatedChars": "900"}
}`;

    const response = await llm.invoke([new SystemMessage(system), new HumanMessage(userMsg)]);
    const content = response.content as string;

    try {
      const firstBrace = content.indexOf("{");
      const lastBrace = content.lastIndexOf("}");
      const json = JSON.parse(content.substring(firstBrace, lastBrace + 1));
      return {
        type: "linkedin-post",
        title: json.title,
        body: json.body,
        metadata: json.metadata,
        citations: trends.slice(0, 3).flatMap((t) => t.sources.map((s) => ({ title: t.title, url: s.url }))),
      };
    } catch {
      return {
        type: "linkedin-post",
        title: `LinkedIn Post: ${topTrend.title}`,
        body: content,
        citations: [{ title: topTrend.title, url: topTrend.sources[0]?.url || "" }],
      };
    }
  },
};

export { linkedinPostGenerator };
