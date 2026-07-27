"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContentIdeaSchema = exports.ResearchPlanSchema = exports.TrendSchema = void 0;
exports.createInitialState = createInitialState;
const zod_1 = require("zod");
// Trend data structure
exports.TrendSchema = zod_1.z.object({
    title: zod_1.z.string(),
    summary: zod_1.z.string(),
    whyItMatters: zod_1.z.string(),
    sources: zod_1.z.array(zod_1.z.object({
        url: zod_1.z.string(),
        timestamp: zod_1.z.string().optional(),
        snippet: zod_1.z.string().optional(),
    })),
    confidence: zod_1.z.number().min(0).max(1),
});
// Research plan structure
exports.ResearchPlanSchema = zod_1.z.object({
    scope: zod_1.z.object({
        timeWindow: zod_1.z.string(),
        region: zod_1.z.string().optional(),
        domain: zod_1.z.string(),
    }),
    tools: zod_1.z.array(zod_1.z.string()),
    platforms: zod_1.z.array(zod_1.z.string()).optional(), // Platforms for content generation
});
// Content idea structure
exports.ContentIdeaSchema = zod_1.z.object({
    hook: zod_1.z.string(),
    format: zod_1.z.string(),
    angle: zod_1.z.string(),
    trendReference: zod_1.z.string(),
    description: zod_1.z.string(),
    variants: zod_1.z.array(zod_1.z.string()).optional(),
});
// Helper function to create initial state
function createInitialState(userQuery, userPersona, conversationId) {
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
