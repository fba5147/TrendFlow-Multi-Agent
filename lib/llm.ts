import { ChatGroq } from "@langchain/groq";
import { recordCost, calculateCost } from "./observability/cost";
import { logger } from "./observability/logger";

export type LLMProvider = "groq" | "openai" | "anthropic" | "gemini" | "deepseek" | "ollama";

export interface LLMConfig {
  provider?: LLMProvider;
  model?: string;
  temperature?: number;
}

export const DEFAULT_MODELS: Record<LLMProvider, string> = {
  groq: "llama-3.3-70b-versatile",
  openai: "gpt-4o",
  anthropic: "claude-sonnet-4-6",
  gemini: "gemini-2.0-flash",
  deepseek: "deepseek-chat",
  ollama: "llama3.2",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createLLM(provider?: string, model?: string, temperature = 0.7): any {
  const p = (provider || process.env.LLM_PROVIDER || "groq") as LLMProvider;
  const m = model || process.env.LLM_MODEL || DEFAULT_MODELS[p];
  const t = temperature;

  switch (p) {
    case "groq": {
      const key = process.env.GROQ_API_KEY;
      if (!key) console.warn("[LLM] GROQ_API_KEY not set — set it in .env before making API calls.");
      return new ChatGroq({ modelName: m, apiKey: key || "GROQ_API_KEY_NOT_SET", temperature: t, streaming: true });
    }

    case "openai": {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { ChatOpenAI } = require("@langchain/openai");
        return new ChatOpenAI({ modelName: m, apiKey: process.env.OPENAI_API_KEY, temperature: t });
      } catch {
        throw new Error("OpenAI provider not installed. Run: npm install @langchain/openai");
      }
    }

    case "anthropic": {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { ChatAnthropic } = require("@langchain/anthropic");
        return new ChatAnthropic({ modelName: m, apiKey: process.env.ANTHROPIC_API_KEY, temperature: t });
      } catch {
        throw new Error("Anthropic provider not installed. Run: npm install @langchain/anthropic");
      }
    }

    case "gemini": {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { ChatGoogleGenerativeAI } = require("@langchain/google-genai");
        return new ChatGoogleGenerativeAI({ modelName: m, apiKey: process.env.GOOGLE_API_KEY, temperature: t });
      } catch {
        throw new Error("Gemini provider not installed. Run: npm install @langchain/google-genai");
      }
    }

    case "deepseek": {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { ChatOpenAI } = require("@langchain/openai");
        return new ChatOpenAI({
          modelName: m,
          apiKey: process.env.DEEPSEEK_API_KEY,
          temperature: t,
          configuration: { baseURL: "https://api.deepseek.com/v1" },
        });
      } catch {
        throw new Error("DeepSeek provider requires @langchain/openai. Run: npm install @langchain/openai");
      }
    }

    case "ollama": {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { ChatOllama } = require("@langchain/ollama");
        return new ChatOllama({
          model: m,
          baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
          temperature: t,
        });
      } catch {
        throw new Error("Ollama provider not installed. Run: npm install @langchain/ollama");
      }
    }

    default:
      return new ChatGroq({ modelName: m, apiKey: process.env.GROQ_API_KEY, temperature: t, streaming: true });
  }
}

export const llm = createLLM();

interface CostTrackingContext {
  conversationId?: string;
  userId?: string;
  nodeType?: string;
}

/**
 * Wraps createLLM() and intercepts invoke() to record token usage as cost events.
 * Falls back silently if usage_metadata is absent (not all providers report tokens).
 */
export function createTrackedLLM(
  provider?: string,
  model?: string,
  temperature = 0.7,
  context: CostTrackingContext = {}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const p = (provider || process.env.LLM_PROVIDER || "groq") as LLMProvider;
  const m = model || process.env.LLM_MODEL || DEFAULT_MODELS[p];
  const instance = createLLM(provider, model, temperature);
  const originalInvoke = instance.invoke.bind(instance);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  instance.invoke = async (...args: any[]) => {
    const start = Date.now();
    const response = await originalInvoke(...args);
    const durationMs = Date.now() - start;

    try {
      const usage =
        response?.usage_metadata ??
        response?.response_metadata?.tokenUsage ??
        response?.response_metadata?.usage;
      if (usage) {
        const inputTokens = usage.input_tokens ?? usage.promptTokens ?? 0;
        const outputTokens = usage.output_tokens ?? usage.completionTokens ?? 0;
        if (inputTokens > 0 || outputTokens > 0) {
          recordCost({
            provider: p,
            model: m,
            inputTokens,
            outputTokens,
            costUsd: calculateCost(m, inputTokens, outputTokens),
            durationMs,
            ...context,
          });
        }
      }
    } catch (err) {
      logger.warn({ err }, "[cost] Failed to record LLM cost event");
    }

    return response;
  };

  return instance;
}
