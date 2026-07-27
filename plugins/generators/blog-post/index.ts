import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { GeneratorPlugin, GeneratedContent, GenerationConfig } from "../../core/types";
import { Trend } from "../../../lib/langgraph/state";
import { createLLM } from "../../../lib/llm";

const blogPostGenerator: GeneratorPlugin = {
  id: "blog-post",
  name: "Blog Post",
  description: "Full long-form blog post (800–1500 words) with introduction, sections per trend, and conclusion",
  outputType: "blog-post",

  async generate(trends: Trend[], config: GenerationConfig, llmProvider?: string, llmModel?: string): Promise<GeneratedContent> {
    const llm = createLLM(llmProvider, llmModel);
    const persona = config.persona || "Growth marketer";

    const trendsText = trends
      .map(
        (t, i) =>
          `${i + 1}. **${t.title}**\n   ${t.summary}\n   Why it matters: ${t.whyItMatters}\n   Sources: ${t.sources.map((s) => s.url).join(", ")}`
      )
      .join("\n\n");

    const system = `You are an expert content writer. Write a professional, engaging blog post for ${persona}.
Use markdown formatting. Be opinionated, cite sources inline, and end with a strong conclusion.
Write in a direct, no-fluff style. Aim for 800–1500 words.`;

    const userMsg = `Write a blog post based on these trends:

${trendsText}

Requirements:
- Compelling title that includes the main theme
- Brief introduction (2–3 sentences) framing why these trends matter
- One H2 section per major trend with analysis and "what to do about it"
- Specific data points from the trend summaries
- A conclusion with 3 key takeaways
- Inline citation links where relevant

Return ONLY valid JSON:
{
  "title": "...",
  "body": "full markdown body here",
  "citations": [{"title": "Source Name", "url": "https://...", "snippet": "optional excerpt"}]
}`;

    const response = await llm.invoke([new SystemMessage(system), new HumanMessage(userMsg)]);
    const content = response.content as string;

    try {
      const firstBrace = content.indexOf("{");
      const lastBrace = content.lastIndexOf("}");
      const json = JSON.parse(content.substring(firstBrace, lastBrace + 1));
      return {
        type: "blog-post",
        title: json.title,
        body: json.body,
        citations: json.citations || [],
      };
    } catch {
      const titleMatch = content.match(/^#\s+(.+)/m);
      return {
        type: "blog-post",
        title: titleMatch?.[1] || "Trend Report",
        body: content,
        citations: trends.flatMap((t) => t.sources.map((s) => ({ title: t.title, url: s.url }))),
      };
    }
  },
};

export { blogPostGenerator };
