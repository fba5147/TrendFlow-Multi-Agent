import { Trend } from "../../lib/langgraph/state";

export type LLMProvider = "groq" | "openai" | "anthropic" | "gemini" | "deepseek" | "ollama";

export type ContentOutputType =
  | "content-ideas"
  | "blog-post"
  | "linkedin-post"
  | "x-thread"
  | "newsletter";

export interface TrendQuery {
  domain: string;
  timeWindow: string;
  region?: string;
}

export interface SourceResult {
  title: string;
  url: string;
  snippet?: string;
  timestamp?: string;
  source: string;
  score?: number;
}

export interface SourcePlugin {
  id: string;
  name: string;
  description: string;
  requiresApiKey: boolean;
  apiKeyEnvVar?: string;
  isAvailable(): boolean;
  fetch(query: TrendQuery): Promise<SourceResult[]>;
}

export interface GeneratedSection {
  heading: string;
  content: string;
}

export interface GeneratedContent {
  type: ContentOutputType;
  title?: string;
  body?: string;
  sections?: GeneratedSection[];
  citations?: Array<{ title: string; url: string; snippet?: string }>;
  metadata?: Record<string, string>;
}

export interface GenerationConfig {
  platforms?: string[];
  persona?: string;
  outputType: ContentOutputType;
}

export interface GeneratorPlugin {
  id: string;
  name: string;
  description: string;
  outputType: ContentOutputType;
  generate(trends: Trend[], config: GenerationConfig, llmProvider?: string, llmModel?: string): Promise<GeneratedContent>;
}
