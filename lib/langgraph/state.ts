import { z } from "zod";

// Trend data structure
export const TrendSchema = z.object({
  title: z.string(),
  summary: z.string(),
  whyItMatters: z.string(),
  sources: z.array(
    z.object({
      url: z.string(),
      timestamp: z.string().optional(),
      snippet: z.string().optional(),
    })
  ),
  confidence: z.number().min(0).max(1),
});

export type Trend = z.infer<typeof TrendSchema>;

// Research plan structure
export const ResearchPlanSchema = z.object({
  scope: z.object({
    timeWindow: z.string(),
    region: z.string().optional(),
    domain: z.string(),
  }),
  tools: z.array(z.string()),
  platforms: z.array(z.string()).optional(), // Platforms for content generation
});

export type ResearchPlan = z.infer<typeof ResearchPlanSchema>;

// Content idea structure
export const ContentIdeaSchema = z.object({
  hook: z.string(),
  format: z.string(),
  angle: z.string(),
  trendReference: z.string(),
  description: z.string(),
  variants: z.array(z.string()).optional(),
});

export type ContentIdea = z.infer<typeof ContentIdeaSchema>;

// Main agent state
export interface AgentState {
  // User input
  userQuery: string;
  userPersona?: string;
  conversationId?: string;

  // Research phase
  researchPlan?: ResearchPlan;
  trends?: Trend[];
  researchComplete: boolean;

  // HITL checkpoint
  checkpointStatus: "pending" | "approved" | "refined" | "restarted";
  refinementRequest?: string;
  approvedTrends?: Trend[];

  // Content generation
  platforms?: string[];
  contentIdeas?: Record<string, ContentIdea[]>; // platform -> ideas
  generationComplete: boolean;

  // Metadata
  step: "planning" | "researching" | "synthesizing" | "checkpoint" | "generating" | "complete";
  error?: string;
  messages: Array<{
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: number;
  }>;
}

// Helper function to create initial state
export function createInitialState(userQuery: string, userPersona?: string, conversationId?: string): AgentState {
  return {
    userQuery,
    userPersona,
    conversationId,
    researchComplete: false,
    checkpointStatus: "pending",
    generationComplete: false,
    step: "planning",
    messages: [
      {
        role: "user",
        content: userQuery,
        timestamp: Date.now(),
      },
    ],
  };
}

