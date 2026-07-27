import { query } from "./_generated/server";
import { v } from "convex/values";

export const getConversation = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.conversationId);
  },
});

export const getResearchResults = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("researchResults")
      .withIndex("conversationId", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .first();
  },
});

export const getHITLCheckpoint = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("hitlCheckpoints")
      .withIndex("conversationId", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .first();
  },
});

export const getContentIdeas = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("contentIdeas")
      .withIndex("conversationId", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .collect();
  },
});

export const getExecutionState = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("executionStates")
      .withIndex("conversationId", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .first();
  },
});

export const getCachedResearch = query({
  args: { 
    queryHash: v.optional(v.string()),
    query: v.optional(v.string()),
    timeWindow: v.optional(v.string()),
    domain: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    
    // First, try exact hash match (fastest)
    if (args.queryHash) {
      const hashMatch = await ctx.db
        .query("researchCache")
        .withIndex("queryHash", (q) =>
          q.eq("queryHash", args.queryHash || "")
        )
        .first();
      
      if (hashMatch && hashMatch.expiresAt > now) {
        return {
          trends: hashMatch.trends,
          cached: true,
          age: now - hashMatch.createdAt,
          expiresAt: hashMatch.expiresAt,
          matchType: "exact_hash",
        };
      }
    }
    
    // If no hash match, search by domain and timeWindow for similar queries
    if (args.domain && args.timeWindow) {
      const domainMatches = await ctx.db
        .query("researchCache")
        .withIndex("domain", (q) =>
          q.eq("domain", args.domain || "")
        )
        .collect();
      
      // Filter by timeWindow and not expired
      const validMatches = domainMatches.filter(
        (entry) => entry.timeWindow === args.timeWindow && entry.expiresAt > now
      );
      
      // If we have a query, try to find similar queries
      if (args.query && validMatches.length > 0) {
        const normalizedQuery = args.query.toLowerCase().trim();
        
        // Find best match by query similarity
        let bestMatch = null;
        let bestScore = 0;
        
        for (const entry of validMatches) {
          const normalizedEntryQuery = entry.query.toLowerCase().trim();
          
          // Calculate similarity score
          let score = 0;
          
          // Exact match
          if (normalizedQuery === normalizedEntryQuery) {
            score = 100;
          } 
          // Contains match (one contains the other)
          else if (normalizedQuery.includes(normalizedEntryQuery) || normalizedEntryQuery.includes(normalizedQuery)) {
            const shorter = Math.min(normalizedQuery.length, normalizedEntryQuery.length);
            const longer = Math.max(normalizedQuery.length, normalizedEntryQuery.length);
            score = (shorter / longer) * 80; // Up to 80% for contains match
          }
          // Word overlap
          else {
            const queryWords = new Set(normalizedQuery.split(/\s+/));
            const entryWords = new Set(normalizedEntryQuery.split(/\s+/));
            const intersection = new Set([...queryWords].filter(x => entryWords.has(x)));
            const union = new Set([...queryWords, ...entryWords]);
            score = (intersection.size / union.size) * 60; // Up to 60% for word overlap
          }
          
          if (score > bestScore && score >= 50) { // Minimum 50% similarity
            bestScore = score;
            bestMatch = entry;
          }
        }
        
        if (bestMatch) {
          return {
            trends: bestMatch.trends,
            cached: true,
            age: now - bestMatch.createdAt,
            expiresAt: bestMatch.expiresAt,
            matchType: "similar_query",
            similarity: bestScore,
          };
        }
      }
      
      // If no similar query match, but we have valid domain/timeWindow matches, return the most recent one
      if (validMatches.length > 0) {
        const mostRecent = validMatches.reduce((latest, current) => 
          current.createdAt > latest.createdAt ? current : latest
        );
        
        return {
          trends: mostRecent.trends,
          cached: true,
          age: now - mostRecent.createdAt,
          expiresAt: mostRecent.expiresAt,
          matchType: "domain_timewindow",
        };
      }
    }
    
    // Cache expired or not found
    return null;
  },
});

// ---- Auth queries ----

export const getUserByOAuth = query({
  args: { oauthProvider: v.string(), oauthId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_oauth", (q) =>
        q.eq("oauthProvider", args.oauthProvider).eq("oauthId", args.oauthId)
      )
      .first();
  },
});

export const getUserByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", args.email)).first();
  },
});

export const listUsers = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const q = ctx.db.query("users").order("desc");
    return args.limit ? await q.take(args.limit) : await q.collect();
  },
});

// ---- Audit log queries ----

export const getAuditLogs = query({
  args: {
    limit: v.optional(v.number()),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 50, 500);
    if (args.userId) {
      return await ctx.db
        .query("audit_logs")
        .withIndex("by_user", (q) => q.eq("userId", args.userId!))
        .order("desc")
        .take(limit);
    }
    return await ctx.db.query("audit_logs").withIndex("by_timestamp").order("desc").take(limit);
  },
});

// ---- Cost queries ----

export const getCostEvents = query({
  args: {
    limit: v.optional(v.number()),
    userId: v.optional(v.string()),
    conversationId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 100, 1000);
    if (args.conversationId) {
      return await ctx.db
        .query("cost_events")
        .withIndex("by_conversation", (q) => q.eq("conversationId", args.conversationId!))
        .order("desc")
        .take(limit);
    }
    if (args.userId) {
      return await ctx.db
        .query("cost_events")
        .withIndex("by_user", (q) => q.eq("userId", args.userId!))
        .order("desc")
        .take(limit);
    }
    return await ctx.db.query("cost_events").withIndex("by_timestamp").order("desc").take(limit);
  },
});

