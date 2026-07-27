import { logger } from "./logger";

/** Pricing per 1 million tokens (USD). Source: provider pricing pages. */
export const MODEL_COSTS: Record<string, { input: number; output: number }> = {
  // Groq (free tier: varies; paid rates below)
  "llama-3.3-70b-versatile": { input: 0.59, output: 0.79 },
  "llama-3.1-70b-versatile": { input: 0.59, output: 0.79 },
  "llama-3.1-8b-instant": { input: 0.05, output: 0.08 },
  "mixtral-8x7b-32768": { input: 0.24, output: 0.24 },
  "gemma2-9b-it": { input: 0.2, output: 0.2 },
  // OpenAI
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10.0, output: 30.0 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  // Anthropic
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-opus-4-8": { input: 15.0, output: 75.0 },
  "claude-haiku-4-5-20251001": { input: 0.25, output: 1.25 },
  // Google
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-1.5-pro": { input: 1.25, output: 5.0 },
  "gemini-1.5-flash": { input: 0.075, output: 0.3 },
  // DeepSeek
  "deepseek-chat": { input: 0.27, output: 1.1 },
  "deepseek-coder": { input: 0.27, output: 1.1 },
  // Ollama (local — zero cost)
  llama3: { input: 0, output: 0 },
  "llama3.2": { input: 0, output: 0 },
  mistral: { input: 0, output: 0 },
};

export interface CostEvent {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  conversationId?: string;
  userId?: string;
  nodeType?: string;
  timestamp: number;
}

export function calculateCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_COSTS[model];
  if (!pricing) return 0;
  return Number(((inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000).toFixed(8));
}

// In-memory buffer — flushed every 5 s or on shutdown
const costBuffer: CostEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let onFlush: ((events: CostEvent[]) => void) | null = null;

export function setCostFlushHandler(handler: (events: CostEvent[]) => void) {
  onFlush = handler;
}

export function recordCost(event: Omit<CostEvent, "timestamp">) {
  const full: CostEvent = { ...event, timestamp: Date.now() };
  costBuffer.push(full);
  logger.debug(
    { provider: full.provider, model: full.model, costUsd: full.costUsd, tokens: full.inputTokens + full.outputTokens },
    "[cost] LLM call recorded"
  );
  scheduleFlush();
}

function scheduleFlush() {
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flushCosts();
    }, 5_000);
  }
}

export function flushCosts() {
  if (costBuffer.length === 0) return;
  const events = costBuffer.splice(0);
  onFlush?.(events);
  logger.info({ count: events.length, totalUsd: events.reduce((s, e) => s + e.costUsd, 0) }, "[cost] Flushed cost events");
}

export interface CostSummary {
  totalUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  callCount: number;
  byProvider: Record<string, { totalUsd: number; calls: number }>;
  byModel: Record<string, { totalUsd: number; calls: number; inputTokens: number; outputTokens: number }>;
  windowStart: number | null;
  windowEnd: number | null;
}

export function getCostSummary(): CostSummary {
  const events = [...costBuffer];
  const summary: CostSummary = {
    totalUsd: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    callCount: events.length,
    byProvider: {},
    byModel: {},
    windowStart: events.length ? events[0].timestamp : null,
    windowEnd: events.length ? events[events.length - 1].timestamp : null,
  };
  for (const e of events) {
    summary.totalUsd += e.costUsd;
    summary.totalInputTokens += e.inputTokens;
    summary.totalOutputTokens += e.outputTokens;
    if (!summary.byProvider[e.provider]) summary.byProvider[e.provider] = { totalUsd: 0, calls: 0 };
    summary.byProvider[e.provider].totalUsd += e.costUsd;
    summary.byProvider[e.provider].calls += 1;
    if (!summary.byModel[e.model]) summary.byModel[e.model] = { totalUsd: 0, calls: 0, inputTokens: 0, outputTokens: 0 };
    summary.byModel[e.model].totalUsd += e.costUsd;
    summary.byModel[e.model].calls += 1;
    summary.byModel[e.model].inputTokens += e.inputTokens;
    summary.byModel[e.model].outputTokens += e.outputTokens;
  }
  summary.totalUsd = Number(summary.totalUsd.toFixed(6));
  return summary;
}
