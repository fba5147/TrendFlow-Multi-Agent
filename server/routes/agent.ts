import { Router, Request, Response } from "express";
import { createInitialState } from "../../lib/langgraph/state";
import { executeAgent, resumeAgent } from "../../lib/langgraph/graph";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { AgentState, ContentIdea } from "../../lib/langgraph/state";
import { MAIN_PLATFORMS, normalizePlatformName } from "../../utils";
import type { Id } from "../../convex/_generated/dataModel";

export const agentRouter = Router();

const convexUrl = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  console.error("⚠️ CONVEX_URL is not set!");
}

const convex = convexUrl ? new ConvexHttpClient(convexUrl) : null;

/**
 * POST /api/agent/execute
 * Execute the LangGraph agent for a new conversation
 */
agentRouter.post("/execute", async (req: Request, res: Response) => {
  try {
    if (!convex) {
      return res.status(500).json({ error: "Convex not configured. Please set CONVEX_URL in .env" });
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        error: "Groq API key not configured. Please set GROQ_API_KEY in .env. Get a free key at https://console.groq.com",
      });
    }

    const { userQuery, userPersona, conversationId, selectedSources, outputType, llmProvider, llmModel } = req.body;

    if (!userQuery || typeof userQuery !== "string" || userQuery.trim().length === 0) {
      return res.status(400).json({ error: "Missing or invalid userQuery. Please provide a non-empty search query." });
    }

    if (!conversationId || typeof conversationId !== "string") {
      return res.status(400).json({ error: "Missing or invalid conversationId" });
    }

    if (userQuery.trim().length < 3) {
      return res.status(400).json({ error: "Query is too short. Please provide at least 3 characters." });
    }

    if (userQuery.length > 500) {
      return res.status(400).json({ error: "Query is too long. Please keep it under 500 characters." });
    }

    console.log(`[Agent] Starting execution for conversation: ${conversationId}`);

    const initialState = {
      ...createInitialState(userQuery, userPersona, conversationId),
      ...(selectedSources && { selectedSources }),
      ...(outputType && { outputType }),
      ...(llmProvider && { llmProvider }),
      ...(llmModel && { llmModel }),
    };
    const conversationIdTyped = conversationId as Id<"conversations">;

    const callbacks = {
      onStateUpdate: async (state: AgentState) => {
        await convex.mutation(api.mutations.saveExecutionState, {
          conversationId: conversationIdTyped,
          step: state.step,
          state: state,
          error: state.error,
        });

        if (state.step === "checkpoint") {
          await convex.mutation(api.mutations.updateConversationStatus, {
            conversationId: conversationId as any,
            status: "checkpoint",
          });

          const existingCheckpoint = await convex.query(api.queries.getHITLCheckpoint, {
            conversationId: conversationId as any,
          });

          if (!existingCheckpoint) {
            await convex.mutation(api.mutations.createHITLCheckpoint, {
              conversationId: conversationId as any,
            });
          }

          if (state.trends && state.trends.length > 0) {
            const highConfidenceTrends = state.trends.filter((t) => (t.confidence || 0) >= 0.65);
            if (highConfidenceTrends.length > 0) {
              const sortedTrends = [...highConfidenceTrends].sort(
                (a, b) => (b.confidence || 0) - (a.confidence || 0)
              );
              await convex.mutation(api.mutations.saveResearchResults, {
                conversationId: conversationId as any,
                trends: sortedTrends,
                researchPlan: state.researchPlan,
              });
            }
          }
        } else if (state.step === "generating") {
          await convex.mutation(api.mutations.updateConversationStatus, {
            conversationId: conversationId as any,
            status: "generating",
          });
        }
      },
      onTrendUpdate: async (trends: any[]) => {
        if (trends.length > 0) {
          const highConfidenceTrends = trends.filter((t) => (t.confidence || 0) >= 0.65);
          if (highConfidenceTrends.length > 0) {
            const sortedTrends = [...highConfidenceTrends].sort(
              (a, b) => (b.confidence || 0) - (a.confidence || 0)
            );
            await convex.mutation(api.mutations.saveResearchResults, {
              conversationId: conversationId as any,
              trends: sortedTrends,
              researchPlan: initialState.researchPlan,
            });
          }
        }
      },
      onContentUpdate: async (platform: string, ideas: any[]) => {
        const normalizedPlatform = normalizePlatformName(platform);
        await convex.mutation(api.mutations.saveContentIdeas, {
          conversationId: conversationId as any,
          platform: normalizedPlatform,
          ideas: ideas,
        });
      },
    };

    executeAgent(initialState, callbacks).catch((error) => {
      console.error("Agent execution error:", error);
      convex.mutation(api.mutations.updateConversationStatus, {
        conversationId: conversationId as any,
        status: "error",
      });
    });

    return res.json({ success: true, conversationId });
  } catch (error) {
    console.error("API error:", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});

/**
 * PUT /api/agent/execute
 * Resume agent execution after HITL checkpoint
 */
agentRouter.put("/execute", async (req: Request, res: Response) => {
  try {
    if (!convex) {
      return res.status(500).json({ error: "Convex not configured. Please set CONVEX_URL in .env" });
    }

    if (!process.env.GROQ_API_KEY) {
      return res.status(500).json({
        error: "Groq API key not configured. Please set GROQ_API_KEY in .env.",
      });
    }

    const { conversationId, checkpointStatus, approvedTrends, refinementRequest, platforms } = req.body;

    if (!conversationId) {
      return res.status(400).json({ error: "Missing conversationId" });
    }

    console.log(`[Agent] Resuming execution for conversation: ${conversationId}, status: ${checkpointStatus}`);

    const conversationIdTyped = conversationId as Id<"conversations">;

    const executionState = await convex.query(api.queries.getExecutionState, {
      conversationId: conversationIdTyped,
    });

    if (!executionState) {
      return res.status(404).json({ error: "Execution state not found" });
    }

    const currentState = executionState.state as any;
    const platformsArray = Array.isArray(platforms)
      ? platforms
      : Array.isArray(currentState.platforms)
      ? currentState.platforms
      : MAIN_PLATFORMS;

    const updatedState = {
      ...currentState,
      checkpointStatus,
      approvedTrends: approvedTrends || currentState.approvedTrends,
      refinementRequest,
      platforms: platformsArray,
    };

    await convex.mutation(api.mutations.updateHITLCheckpoint, {
      conversationId: conversationIdTyped,
      status: checkpointStatus,
      approvedTrends: approvedTrends,
      refinementRequest: refinementRequest,
    });

    const callbacks = {
      onStateUpdate: async (state: AgentState) => {
        await convex.mutation(api.mutations.saveExecutionState, {
          conversationId: conversationIdTyped,
          step: state.step,
          state: state,
          error: state.error,
        });

        if (state.step === "complete") {
          await convex.mutation(api.mutations.updateConversationStatus, {
            conversationId: conversationIdTyped,
            status: "complete",
          });
        }
      },
      onContentUpdate: async (platform: string, ideas: ContentIdea[]) => {
        const normalizedPlatform = normalizePlatformName(platform);
        await convex.mutation(api.mutations.saveContentIdeas, {
          conversationId: conversationIdTyped,
          platform: normalizedPlatform,
          ideas: ideas,
        });
      },
    };

    resumeAgent(updatedState, callbacks).catch((error) => {
      console.error("Agent resume error:", error);
      convex.mutation(api.mutations.updateConversationStatus, {
        conversationId: conversationIdTyped,
        status: "error",
      });
    });

    return res.json({ success: true });
  } catch (error) {
    console.error("API error:", error);
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
});
