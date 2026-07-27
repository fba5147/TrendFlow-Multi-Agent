"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveResearchCache = exports.saveExecutionState = exports.saveContentIdeas = exports.updateHITLCheckpoint = exports.createHITLCheckpoint = exports.saveResearchResults = exports.updateConversationStatus = exports.createConversation = void 0;
const server_1 = require("./_generated/server");
const values_1 = require("convex/values");
exports.createConversation = (0, server_1.mutation)({
    args: {
        userId: values_1.v.string(),
        userQuery: values_1.v.string(),
        userPersona: values_1.v.optional(values_1.v.string()),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const conversationId = await ctx.db.insert("conversations", {
            userId: args.userId,
            userQuery: args.userQuery,
            userPersona: args.userPersona,
            status: "researching",
            createdAt: now,
            updatedAt: now,
        });
        return conversationId;
    },
});
exports.updateConversationStatus = (0, server_1.mutation)({
    args: {
        conversationId: values_1.v.id("conversations"),
        status: values_1.v.union(values_1.v.literal("researching"), values_1.v.literal("checkpoint"), values_1.v.literal("generating"), values_1.v.literal("complete"), values_1.v.literal("error")),
    },
    handler: async (ctx, args) => {
        await ctx.db.patch(args.conversationId, {
            status: args.status,
            updatedAt: Date.now(),
        });
    },
});
exports.saveResearchResults = (0, server_1.mutation)({
    args: {
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
    },
    handler: async (ctx, args) => {
        // Check if research results already exist
        const existing = await ctx.db
            .query("researchResults")
            .withIndex("conversationId", (q) => q.eq("conversationId", args.conversationId))
            .first();
        if (existing) {
            await ctx.db.patch(existing._id, {
                trends: args.trends,
                researchPlan: args.researchPlan,
                completedAt: Date.now(),
            });
        }
        else {
            await ctx.db.insert("researchResults", {
                conversationId: args.conversationId,
                trends: args.trends,
                researchPlan: args.researchPlan,
                completedAt: Date.now(),
            });
        }
    },
});
exports.createHITLCheckpoint = (0, server_1.mutation)({
    args: {
        conversationId: values_1.v.id("conversations"),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        await ctx.db.insert("hitlCheckpoints", {
            conversationId: args.conversationId,
            status: "pending",
            createdAt: now,
            updatedAt: now,
        });
    },
});
exports.updateHITLCheckpoint = (0, server_1.mutation)({
    args: {
        conversationId: values_1.v.id("conversations"),
        status: values_1.v.union(values_1.v.literal("approved"), values_1.v.literal("refined"), values_1.v.literal("restarted")),
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
    },
    handler: async (ctx, args) => {
        const checkpoint = await ctx.db
            .query("hitlCheckpoints")
            .withIndex("conversationId", (q) => q.eq("conversationId", args.conversationId))
            .first();
        if (checkpoint) {
            await ctx.db.patch(checkpoint._id, {
                status: args.status,
                refinementRequest: args.refinementRequest,
                approvedTrends: args.approvedTrends,
                updatedAt: Date.now(),
            });
        }
    },
});
// Normalize platform name - simplified version for Convex
function normalizePlatformName(platform) {
    if (!platform || typeof platform !== 'string')
        return platform;
    const lower = platform.toLowerCase().trim();
    const MAIN_PLATFORMS = [
        "LinkedIn", "X", "TikTok", "Instagram", "YouTube", "Reddit", "Facebook",
        "Medium", "Substack", "Threads", "Pinterest", "Snapchat"
    ];
    // Map variations to standard names
    const platformMap = {
        'linkedin': 'LinkedIn',
        'linked.in': 'LinkedIn',
        'twitter': 'X',
        'x': 'X',
        'tiktok': 'TikTok',
        'instagram': 'Instagram',
        'youtube': 'YouTube',
        'reddit': 'Reddit',
        'facebook': 'Facebook',
        'fb': 'Facebook',
        'medium': 'Medium',
        'substack': 'Substack',
        'threads': 'Threads',
        'pinterest': 'Pinterest',
        'snapchat': 'Snapchat',
    };
    // Check exact match first
    if (platformMap[lower]) {
        return platformMap[lower];
    }
    // Check if it's already a valid/main platform name (case-insensitive)
    const normalized = MAIN_PLATFORMS.find(p => p.toLowerCase() === lower);
    if (normalized) {
        return normalized;
    }
    // Return capitalized version if not found
    return platform.charAt(0).toUpperCase() + platform.slice(1).toLowerCase();
}
exports.saveContentIdeas = (0, server_1.mutation)({
    args: {
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
    },
    handler: async (ctx, args) => {
        // Normalize platform name to ensure consistent grouping
        const normalizedPlatform = normalizePlatformName(args.platform);
        // Get all content ideas for this conversation to check for existing normalized platform
        const allIdeas = await ctx.db
            .query("contentIdeas")
            .withIndex("conversationId", (q) => q.eq("conversationId", args.conversationId))
            .collect();
        // Find existing entry with normalized platform name (handles variations)
        const existing = allIdeas.find((item) => normalizePlatformName(item.platform) === normalizedPlatform);
        if (existing) {
            // Update existing ideas for this platform (also normalize the stored platform name)
            await ctx.db.patch(existing._id, {
                platform: normalizedPlatform, // Update to normalized name
                ideas: args.ideas,
                createdAt: Date.now(),
            });
        }
        else {
            // Insert new ideas with normalized platform name
            await ctx.db.insert("contentIdeas", {
                conversationId: args.conversationId,
                platform: normalizedPlatform,
                ideas: args.ideas,
                createdAt: Date.now(),
            });
        }
    },
});
exports.saveExecutionState = (0, server_1.mutation)({
    args: {
        conversationId: values_1.v.id("conversations"),
        step: values_1.v.union(values_1.v.literal("planning"), values_1.v.literal("researching"), values_1.v.literal("synthesizing"), values_1.v.literal("checkpoint"), values_1.v.literal("generating"), values_1.v.literal("complete")),
        state: values_1.v.any(),
        error: values_1.v.optional(values_1.v.string()),
    },
    handler: async (ctx, args) => {
        const existing = await ctx.db
            .query("executionStates")
            .withIndex("conversationId", (q) => q.eq("conversationId", args.conversationId))
            .first();
        if (existing) {
            await ctx.db.patch(existing._id, {
                step: args.step,
                state: args.state,
                error: args.error,
                updatedAt: Date.now(),
            });
        }
        else {
            await ctx.db.insert("executionStates", {
                conversationId: args.conversationId,
                step: args.step,
                state: args.state,
                error: args.error,
                updatedAt: Date.now(),
            });
        }
    },
});
exports.saveResearchCache = (0, server_1.mutation)({
    args: {
        queryHash: values_1.v.string(),
        query: values_1.v.string(),
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
        cacheTTL: values_1.v.number(),
    },
    handler: async (ctx, args) => {
        const now = Date.now();
        const expiresAt = now + args.cacheTTL;
        // First, check for exact hash match
        let existing = await ctx.db
            .query("researchCache")
            .withIndex("queryHash", (q) => q.eq("queryHash", args.queryHash))
            .first();
        // If no exact match, look for similar entries by domain and timeWindow
        if (!existing && args.domain && args.timeWindow) {
            const domainMatches = await ctx.db
                .query("researchCache")
                .withIndex("domain", (q) => q.eq("domain", args.domain))
                .collect();
            // Filter by timeWindow
            const timeWindowMatches = domainMatches.filter((entry) => entry.timeWindow === args.timeWindow);
            // Check for similar queries
            if (timeWindowMatches.length > 0) {
                const normalizedQuery = args.query.toLowerCase().trim();
                // Find best matching entry
                let bestMatch = null;
                let bestScore = 0;
                for (const entry of timeWindowMatches) {
                    const normalizedEntryQuery = entry.query.toLowerCase().trim();
                    // Calculate similarity
                    let score = 0;
                    if (normalizedQuery === normalizedEntryQuery) {
                        score = 100; // Exact match
                    }
                    else if (normalizedQuery.includes(normalizedEntryQuery) || normalizedEntryQuery.includes(normalizedQuery)) {
                        const shorter = Math.min(normalizedQuery.length, normalizedEntryQuery.length);
                        const longer = Math.max(normalizedQuery.length, normalizedEntryQuery.length);
                        score = (shorter / longer) * 90; // High score for contains match
                    }
                    else {
                        // Word overlap
                        const queryWords = new Set(normalizedQuery.split(/\s+/));
                        const entryWords = new Set(normalizedEntryQuery.split(/\s+/));
                        const intersection = new Set([...queryWords].filter(x => entryWords.has(x)));
                        const union = new Set([...queryWords, ...entryWords]);
                        score = (intersection.size / union.size) * 70;
                    }
                    // Also check trend similarity (same URLs indicate same research)
                    const newTrendUrls = new Set(args.trends.flatMap(t => t.sources.map(s => s.url)));
                    const existingTrendUrls = new Set(entry.trends.flatMap(t => t.sources.map(s => s.url)));
                    const urlIntersection = new Set([...newTrendUrls].filter(x => existingTrendUrls.has(x)));
                    const urlUnion = new Set([...newTrendUrls, ...existingTrendUrls]);
                    const trendSimilarity = urlUnion.size > 0 ? (urlIntersection.size / urlUnion.size) * 30 : 0;
                    const totalScore = score + trendSimilarity;
                    if (totalScore > bestScore && totalScore >= 60) { // Minimum 60% similarity to update
                        bestScore = totalScore;
                        bestMatch = entry;
                    }
                }
                if (bestMatch) {
                    existing = bestMatch;
                }
            }
        }
        if (existing) {
            // Update existing cache entry (rewrite with new data)
            await ctx.db.patch(existing._id, {
                queryHash: args.queryHash, // Update hash in case query changed slightly
                query: args.query, // Update query text
                trends: args.trends, // Update trends
                cacheTTL: args.cacheTTL,
                createdAt: now, // Reset creation time
                expiresAt: expiresAt,
            });
        }
        else {
            // Insert new cache entry
            await ctx.db.insert("researchCache", {
                queryHash: args.queryHash,
                query: args.query,
                timeWindow: args.timeWindow,
                domain: args.domain,
                trends: args.trends,
                cacheTTL: args.cacheTTL,
                createdAt: now,
                expiresAt: expiresAt,
            });
        }
        // Clean up expired cache entries (optional, can be done periodically)
        // This is a simple cleanup - in production, you might want a scheduled function
        const expiredEntries = await ctx.db
            .query("researchCache")
            .withIndex("expiresAt", (q) => q.lt("expiresAt", now))
            .collect();
        for (const entry of expiredEntries) {
            await ctx.db.delete(entry._id);
        }
    },
});
