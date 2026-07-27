import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { GeneratorPlugin, GeneratedContent, GenerationConfig } from "../../core/types";
import { Trend } from "../../../lib/langgraph/state";
import { createLLM } from "../../../lib/llm";

const xThreadGenerator: GeneratorPlugin = {
  id: "x-thread",
  name: "X Thread",
  description: "Viral X/Twitter thread (6–10 tweets) with hook tweet, insights, and conclusion",
  outputType: "x-thread",

  async generate(trends: Trend[], config: GenerationConfig, llmProvider?: string, llmModel?: string): Promise<GeneratedContent> {
    const llm = createLLM(llmProvider, llmModel);
    const persona = config.persona || "Growth marketer";

    const trendsText = trends
      .slice(0, 5)
      .map((t, i) => `${i + 1}. ${t.title}: ${t.summary} (${t.whyItMatters})`)
      .join("\n");

    const system = `You are a viral X/Twitter content writer for ${persona}.
Style: punchy, provocative, data-driven. Takes strong positions. Each tweet stands alone but flows in a thread.`;

    const userMsg = `Write an X thread based on these trends:

${trendsText}

Requirements:
- Tweet 1: Irresistible hook (under 280 chars) that makes people want to read the thread
- Tweets 2–8: One key insight per tweet, each under 280 characters
- Each tweet numbered: "1/" "2/" etc.
- Use data and specifics — no vague claims
- Final tweet: Bold conclusion + call to action (retweet/follow/reply)
- Total: 6–10 tweets

Return ONLY valid JSON:
{
  "title": "Hook tweet text",
  "sections": [
    {"heading": "1/", "content": "tweet text"},
    {"heading": "2/", "content": "tweet text"}
  ],
  "metadata": {"tweetCount": "7"}
}`;

    const response = await llm.invoke([new SystemMessage(system), new HumanMessage(userMsg)]);
    const content = response.content as string;

    try {
      const firstBrace = content.indexOf("{");
      const lastBrace = content.lastIndexOf("}");
      const json = JSON.parse(content.substring(firstBrace, lastBrace + 1));
      return {
        type: "x-thread",
        title: json.title,
        sections: json.sections,
        body: json.sections?.map((s: { heading: string; content: string }) => `${s.heading}\n${s.content}`).join("\n\n"),
        metadata: json.metadata,
        citations: trends.slice(0, 3).flatMap((t) => t.sources.map((s) => ({ title: t.title, url: s.url }))),
      };
    } catch {
      return {
        type: "x-thread",
        title: `Thread: ${trends[0]?.title || "Trends"}`,
        body: content,
        citations: trends.slice(0, 3).flatMap((t) => t.sources.map((s) => ({ title: t.title, url: s.url }))),
      };
    }
  },
};

export { xThreadGenerator };
