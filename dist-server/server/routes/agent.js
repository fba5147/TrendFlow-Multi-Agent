"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.agentRouter = void 0;
const express_1 = require("express");
const state_1 = require("../../lib/langgraph/state");
const graph_1 = require("../../lib/langgraph/graph");
const browser_1 = require("convex/browser");
const api_1 = require("../../convex/_generated/api");
const utils_1 = require("../../utils");
exports.agentRouter = (0, express_1.Router)();
const convexUrl = process.env.CONVEX_URL || process.env.NEXT_PUBLIC_CONVEX_URL;
if (!convexUrl) {
    console.error("⚠️ CONVEX_URL is not set!");
}
const convex = convexUrl ? new browser_1.ConvexHttpClient(convexUrl) : null;
/**
 * POST /api/agent/execute
 * Execute the LangGraph agent for a new conversation
 */
exports.agentRouter.post("/execute", async (req, res) => {
    try {
        if (!convex) {
            return res.status(500).json({ error: "Convex not configured. Please set CONVEX_URL in .env" });
        }
        if (!process.env.GROQ_API_KEY) {
            return res.status(500).json({
                error: "Groq API key not configured. Please set GROQ_API_KEY in .env. Get a free key at https://console.groq.com",
            });
        }
        const { userQuery, userPersona, conversationId } = req.body;
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
        const initialState = (0, state_1.createInitialState)(userQuery, userPersona, conversationId);
        const conversationIdTyped = conversationId;
        const callbacks = {
            onStateUpdate: async (state) => {
                await convex.mutation(api_1.api.mutations.saveExecutionState, {
                    conversationId: conversationIdTyped,
                    step: state.step,
                    state: state,
                    error: state.error,
                });
                if (state.step === "checkpoint") {
                    await convex.mutation(api_1.api.mutations.updateConversationStatus, {
                        conversationId: conversationId,
                        status: "checkpoint",
                    });
                    const existingCheckpoint = await convex.query(api_1.api.queries.getHITLCheckpoint, {
                        conversationId: conversationId,
                    });
                    if (!existingCheckpoint) {
                        await convex.mutation(api_1.api.mutations.createHITLCheckpoint, {
                            conversationId: conversationId,
                        });
                    }
                    if (state.trends && state.trends.length > 0) {
                        const highConfidenceTrends = state.trends.filter((t) => (t.confidence || 0) >= 0.65);
                        if (highConfidenceTrends.length > 0) {
                            const sortedTrends = [...highConfidenceTrends].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
                            await convex.mutation(api_1.api.mutations.saveResearchResults, {
                                conversationId: conversationId,
                                trends: sortedTrends,
                                researchPlan: state.researchPlan,
                            });
                        }
                    }
                }
                else if (state.step === "generating") {
                    await convex.mutation(api_1.api.mutations.updateConversationStatus, {
                        conversationId: conversationId,
                        status: "generating",
                    });
                }
            },
            onTrendUpdate: async (trends) => {
                if (trends.length > 0) {
                    const highConfidenceTrends = trends.filter((t) => (t.confidence || 0) >= 0.65);
                    if (highConfidenceTrends.length > 0) {
                        const sortedTrends = [...highConfidenceTrends].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
                        await convex.mutation(api_1.api.mutations.saveResearchResults, {
                            conversationId: conversationId,
                            trends: sortedTrends,
                            researchPlan: initialState.researchPlan,
                        });
                    }
                }
            },
            onContentUpdate: async (platform, ideas) => {
                const normalizedPlatform = (0, utils_1.normalizePlatformName)(platform);
                await convex.mutation(api_1.api.mutations.saveContentIdeas, {
                    conversationId: conversationId,
                    platform: normalizedPlatform,
                    ideas: ideas,
                });
            },
        };
        (0, graph_1.executeAgent)(initialState, callbacks).catch((error) => {
            console.error("Agent execution error:", error);
            convex.mutation(api_1.api.mutations.updateConversationStatus, {
                conversationId: conversationId,
                status: "error",
            });
        });
        return res.json({ success: true, conversationId });
    }
    catch (error) {
        console.error("API error:", error);
        return res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
});
/**
 * PUT /api/agent/execute
 * Resume agent execution after HITL checkpoint
 */
exports.agentRouter.put("/execute", async (req, res) => {
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
        const conversationIdTyped = conversationId;
        const executionState = await convex.query(api_1.api.queries.getExecutionState, {
            conversationId: conversationIdTyped,
        });
        if (!executionState) {
            return res.status(404).json({ error: "Execution state not found" });
        }
        const currentState = executionState.state;
        const platformsArray = Array.isArray(platforms)
            ? platforms
            : Array.isArray(currentState.platforms)
                ? currentState.platforms
                : utils_1.MAIN_PLATFORMS;
        const updatedState = {
            ...currentState,
            checkpointStatus,
            approvedTrends: approvedTrends || currentState.approvedTrends,
            refinementRequest,
            platforms: platformsArray,
        };
        await convex.mutation(api_1.api.mutations.updateHITLCheckpoint, {
            conversationId: conversationIdTyped,
            status: checkpointStatus,
            approvedTrends: approvedTrends,
            refinementRequest: refinementRequest,
        });
        const callbacks = {
            onStateUpdate: async (state) => {
                await convex.mutation(api_1.api.mutations.saveExecutionState, {
                    conversationId: conversationIdTyped,
                    step: state.step,
                    state: state,
                    error: state.error,
                });
                if (state.step === "complete") {
                    await convex.mutation(api_1.api.mutations.updateConversationStatus, {
                        conversationId: conversationIdTyped,
                        status: "complete",
                    });
                }
            },
            onContentUpdate: async (platform, ideas) => {
                const normalizedPlatform = (0, utils_1.normalizePlatformName)(platform);
                await convex.mutation(api_1.api.mutations.saveContentIdeas, {
                    conversationId: conversationIdTyped,
                    platform: normalizedPlatform,
                    ideas: ideas,
                });
            },
        };
        (0, graph_1.resumeAgent)(updatedState, callbacks).catch((error) => {
            console.error("Agent resume error:", error);
            convex.mutation(api_1.api.mutations.updateConversationStatus, {
                conversationId: conversationIdTyped,
                status: "error",
            });
        });
        return res.json({ success: true });
    }
    catch (error) {
        console.error("API error:", error);
        return res.status(500).json({ error: error instanceof Error ? error.message : "Unknown error" });
    }
});
