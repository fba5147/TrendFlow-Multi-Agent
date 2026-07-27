"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = require("convex/server");
const values_1 = require("convex/values");
exports.default = (0, server_1.defineSchema)({
    conversations: (0, server_1.defineTable)({
        userId: values_1.v.string(),
        userQuery: values_1.v.string(),
        userPersona: values_1.v.optional(values_1.v.string()),
        status: values_1.v.union(values_1.v.literal("researching"), values_1.v.literal("checkpoint"), values_1.v.literal("generating"), values_1.v.literal("complete"), values_1.v.literal("error")),
        createdAt: values_1.v.number(),
        updatedAt: values_1.v.number(),
    }),
    researchResults: (0, server_1.defineTable)({
        conversationId: values_1.v.id("conversations"),
        trends: values_1.v.array(values_1.v.object({
            title: values_1.v.string(),
            summary: values_1.v.string(),
            whyItMatters: values_1.v.string(),
            sources: values_1.v.array(values_1.v.object({
                url: values_1.v.string(),
                timestamp: values_1.v.optional(values_1.v.string()),
                snippet: values_1.v.optional(values_1.v.string()),
            })),
            confidence: values_1.v.number(),
        })),
        researchPlan: values_1.v.optional(values_1.v.object({
            scope: values_1.v.object({
                timeWindow: values_1.v.string(),
                region: values_1.v.optional(values_1.v.string()),
                domain: values_1.v.string(),
            }),
            tools: values_1.v.array(values_1.v.string()),
            platforms: values_1.v.optional(values_1.v.array(values_1.v.string())),
        })),
        completedAt: values_1.v.optional(values_1.v.number()),
    }).index("conversationId", ["conversationId"]),
    hitlCheckpoints: (0, server_1.defineTable)({
        conversationId: values_1.v.id("conversations"),
        status: values_1.v.union(values_1.v.literal("pending"), values_1.v.literal("approved"), values_1.v.literal("refined"), values_1.v.literal("restarted")),
        refinementRequest: values_1.v.optional(values_1.v.string()),
        approvedTrends: values_1.v.optional(values_1.v.array(values_1.v.object({
            title: values_1.v.string(),
            summary: values_1.v.string(),
            whyItMatters: values_1.v.string(),
            sources: values_1.v.array(values_1.v.object({
                url: values_1.v.string(),
                timestamp: values_1.v.optional(values_1.v.string()),
                snippet: values_1.v.optional(values_1.v.string()),
            })),
            confidence: values_1.v.number(),
        }))),
        createdAt: values_1.v.number(),
        updatedAt: values_1.v.number(),
    }).index("conversationId", ["conversationId"]),
    contentIdeas: (0, server_1.defineTable)({
        conversationId: values_1.v.id("conversations"),
        platform: values_1.v.string(),
        ideas: values_1.v.array(values_1.v.object({
            hook: values_1.v.string(),
            format: values_1.v.string(),
            angle: values_1.v.string(),
            trendReference: values_1.v.string(),
            description: values_1.v.string(),
            variants: values_1.v.optional(values_1.v.array(values_1.v.string())),
        })),
        createdAt: values_1.v.number(),
    }).index("conversationId", ["conversationId"]),
    executionStates: (0, server_1.defineTable)({
        conversationId: values_1.v.id("conversations"),
        step: values_1.v.union(values_1.v.literal("planning"), values_1.v.literal("researching"), values_1.v.literal("synthesizing"), values_1.v.literal("checkpoint"), values_1.v.literal("generating"), values_1.v.literal("complete")),
        state: values_1.v.any(), // LangGraph state snapshot
        error: values_1.v.optional(values_1.v.string()),
        updatedAt: values_1.v.number(),
    }).index("conversationId", ["conversationId"]),
    // Research cache for prompt-based caching
    researchCache: (0, server_1.defineTable)({
        queryHash: values_1.v.string(), // Hash of normalized query + timeWindow + domain
        query: values_1.v.string(), // Original query
        timeWindow: values_1.v.string(),
        domain: values_1.v.string(),
        trends: values_1.v.array(values_1.v.object({
            title: values_1.v.string(),
            summary: values_1.v.string(),
            whyItMatters: values_1.v.string(),
            sources: values_1.v.array(values_1.v.object({
                url: values_1.v.string(),
                timestamp: values_1.v.optional(values_1.v.string()),
                snippet: values_1.v.optional(values_1.v.string()),
            })),
            confidence: values_1.v.number(),
        })),
        cacheTTL: values_1.v.number(), // Cache TTL in milliseconds
        createdAt: values_1.v.number(),
        expiresAt: values_1.v.number(), // createdAt + cacheTTL
    })
        .index("queryHash", ["queryHash"])
        .index("domain", ["domain"])
        .index("timeWindow", ["timeWindow"])
        .index("expiresAt", ["expiresAt"]),
});
