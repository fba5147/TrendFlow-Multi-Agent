import { NextRequest, NextResponse } from "next/server";
import { createInitialState } from "@/lib/langgraph/state";
import { executeAgent, resumeAgent } from "@/lib/langgraph/graph";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { AgentState, Trend, ContentIdea } from "@/lib/langgraph/state";
import { MAIN_PLATFORMS, normalizePlatformName } from "@/utils";
import type { Id } from "@/convex/_generated/dataModel";

const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
  console.error("⚠️ NEXT_PUBLIC_CONVEX_URL is not set!");
}

const convex = convexUrl ? new ConvexHttpClient(convexUrl) : null;

/**
 * POST /api/agent/execute
 * 
 * Execute the LangGraph agent for a new conversation
 */
export async function POST(request: NextRequest) {
  try {
    if (!convex) {
      return NextResponse.json(
        { error: "Convex not configured. Please set NEXT_PUBLIC_CONVEX_URL in .env" },
        { status: 500 }
      );
    }

    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { error: "Groq API key not configured. Please set GROQ_API_KEY in .env. Get a free key at https://console.groq.com" },
        { status: 500 }
      );
    }

    const { userQuery, userPersona, conversationId } = await request.json();

    if (!userQuery || typeof userQuery !== 'string' || userQuery.trim().length === 0) {
      return NextResponse.json(
        { error: "Missing or invalid userQuery. Please provide a non-empty search query." },
        { status: 400 }
      );
    }

    if (!conversationId || typeof conversationId !== 'string') {
      return NextResponse.json(
        { error: "Missing or invalid conversationId" },
        { status: 400 }
      );
    }

    // Validate query length (not too short, not too long)
    if (userQuery.trim().length < 3) {
      return NextResponse.json(
        { error: "Query is too short. Please provide at least 3 characters." },
        { status: 400 }
      );
    }

    if (userQuery.length > 500) {
      return NextResponse.json(
        { error: "Query is too long. Please keep it under 500 characters." },
        { status: 400 }
      );
    }

    console.log(`[Agent] Starting execution for conversation: ${conversationId}`);

    // Create initial state
    const initialState = createInitialState(userQuery, userPersona, conversationId);

    // Cast conversationId to proper Convex ID type (runtime strings are compatible)
    const conversationIdTyped = conversationId as Id<"conversations">;

    // Set up callbacks to stream to Convex
    const callbacks = {
      onStateUpdate: async (state: AgentState) => {
        // Save execution state to Convex
        await convex.mutation(api.mutations.saveExecutionState, {
          conversationId: conversationIdTyped,
          step: state.step,
          state: state,
          error: state.error,
        });

        // Update conversation status
              if (state.step === "checkpoint") {
                await convex.mutation(api.mutations.updateConversationStatus, {
                  conversationId: conversationId as any,
                  status: "checkpoint",
                });
                
                // Create or update checkpoint with approved trends
                const existingCheckpoint = await convex.query(api.queries.getHITLCheckpoint, {
                  conversationId: conversationId as any,
                });
                
                if (!existingCheckpoint) {
                  await convex.mutation(api.mutations.createHITLCheckpoint, {
                    conversationId: conversationId as any,
                  });
                }
                
                // If trends exist, save them as research results (only high-confidence >= 70%)
                if (state.trends && state.trends.length > 0) {
                  // Filter to only high-confidence trends before saving
                  const highConfidenceTrends = state.trends.filter(
                    t => (t.confidence || 0) >= 0.7
                  );
                  if (highConfidenceTrends.length > 0) {
                    // Sort by confidence (descending - highest first) before saving
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
        // Save research results incrementally (trends are already filtered to >= 70% in graph.ts)
        if (trends.length > 0) {
          // Double-check: ensure only high-confidence trends are saved
          const highConfidenceTrends = trends.filter(
            t => (t.confidence || 0) >= 0.7
          );
          if (highConfidenceTrends.length > 0) {
            // Sort by confidence (descending - highest first) before saving
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
        // Normalize platform name before saving to ensure consistent grouping
        const normalizedPlatform = normalizePlatformName(platform);
        
        // Save content ideas as they're generated
        await convex.mutation(api.mutations.saveContentIdeas, {
          conversationId: conversationId as any,
          platform: normalizedPlatform,
          ideas: ideas,
        });
      },
    };

    // Execute agent (non-blocking)
    executeAgent(initialState, callbacks).catch((error) => {
      console.error("Agent execution error:", error);
      convex.mutation(api.mutations.updateConversationStatus, {
        conversationId: conversationId as any,
        status: "error",
      });
    });

    return NextResponse.json({ success: true, conversationId });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/agent/execute
 * 
 * Resume agent execution after HITL checkpoint
 */
export async function PUT(request: NextRequest) {
  try {
    if (!convex) {
      return NextResponse.json(
        { error: "Convex not configured. Please set NEXT_PUBLIC_CONVEX_URL in .env" },
        { status: 500 }
      );
    }

    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { error: "Groq API key not configured. Please set GROQ_API_KEY in .env. Get a free key at https://console.groq.com" },
        { status: 500 }
      );
    }

    const { conversationId, checkpointStatus, approvedTrends, refinementRequest, platforms } =
      await request.json();

    if (!conversationId) {
      return NextResponse.json({ error: "Missing conversationId" }, { status: 400 });
    }

    console.log(`[Agent] Resuming execution for conversation: ${conversationId}, status: ${checkpointStatus}`);

    // Cast conversationId to proper Convex ID type
    const conversationIdTyped = conversationId as Id<"conversations">;

    // Get current execution state from Convex
    const executionState = await convex.query(api.queries.getExecutionState, {
      conversationId: conversationIdTyped,
    });

    if (!executionState) {
      return NextResponse.json({ error: "Execution state not found" }, { status: 404 });
    }

    // Update state with checkpoint decision
    const currentState = executionState.state as any;
    // Ensure platforms is always an array
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

    // Update HITL checkpoint in Convex
    await convex.mutation(api.mutations.updateHITLCheckpoint, {
      conversationId: conversationIdTyped,
      status: checkpointStatus,
      approvedTrends: approvedTrends,
      refinementRequest: refinementRequest,
    });

    // Set up callbacks
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
        // Normalize platform name before saving to ensure consistent grouping
        const normalizedPlatform = normalizePlatformName(platform);
        
        await convex.mutation(api.mutations.saveContentIdeas, {
          conversationId: conversationIdTyped,
          platform: normalizedPlatform,
          ideas: ideas,
        });
      },
    };

    // Resume agent execution
    resumeAgent(updatedState, callbacks).catch((error) => {
      console.error("Agent resume error:", error);
      convex.mutation(api.mutations.updateConversationStatus, {
        conversationId: conversationIdTyped,
        status: "error",
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("API error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

