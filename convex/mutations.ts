import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const createConversation = mutation({
  args: {
    userId: v.string(),
    userQuery: v.string(),
    userPersona: v.optional(v.string()),
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

export const updateConversationStatus = mutation({
  args: {
    conversationId: v.id("conversations"),
    status: v.union(
      v.literal("researching"),
      v.literal("checkpoint"),
      v.literal("generating"),
      v.literal("complete"),
      v.literal("error")
    ),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.conversationId, {
      status: args.status,
      updatedAt: Date.now(),
    });
  },
});

export const saveResearchResults = mutation({
  args: {
    conversationId: v.id("conversations"),
    trends: v.array(
      v.object({
        title: v.string(),
        summary: v.string(),
        whyItMatters: v.string(),
        sources: v.array(
          v.object({
            url: v.string(),
            timestamp: v.optional(v.string()),
            snippet: v.optional(v.string()),
          })
        ),
        confidence: v.number(),
      })
    ),
    researchPlan: v.optional(
      v.object({
        scope: v.object({
          timeWindow: v.string(),
          region: v.optional(v.string()),
          domain: v.string(),
        }),
        tools: v.array(v.string()),
        platforms: v.optional(v.array(v.string())),
      })
    ),
  },
  handler: async (ctx, args) => {
    // Check if research results already exist
    const existing = await ctx.db
      .query("researchResults")
      .withIndex("conversationId", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        trends: args.trends,
        researchPlan: args.researchPlan,
        completedAt: Date.now(),
      });
    } else {
      await ctx.db.insert("researchResults", {
        conversationId: args.conversationId,
        trends: args.trends,
        researchPlan: args.researchPlan,
        completedAt: Date.now(),
      });
    }
  },
});

export const createHITLCheckpoint = mutation({
  args: {
    conversationId: v.id("conversations"),
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

export const updateHITLCheckpoint = mutation({
  args: {
    conversationId: v.id("conversations"),
    status: v.union(
      v.literal("approved"),
      v.literal("refined"),
      v.literal("restarted")
    ),
    refinementRequest: v.optional(v.string()),
    approvedTrends: v.optional(
      v.array(
        v.object({
          title: v.string(),
          summary: v.string(),
          whyItMatters: v.string(),
          sources: v.array(
            v.object({
              url: v.string(),
              timestamp: v.optional(v.string()),
              snippet: v.optional(v.string()),
            })
          ),
          confidence: v.number(),
        })
      )
    ),
  },
  handler: async (ctx, args) => {
    const checkpoint = await ctx.db
      .query("hitlCheckpoints")
      .withIndex("conversationId", (q) =>
        q.eq("conversationId", args.conversationId)
      )
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
function normalizePlatformName(platform: string): string {
  if (!platform || typeof platform !== 'string') return platform;
  
  const lower = platform.toLowerCase().trim();
  
  const MAIN_PLATFORMS = [
    "LinkedIn", "X", "TikTok", "Instagram", "YouTube", "Reddit", "Facebook",
    "Medium", "Substack", "Threads", "Pinterest", "Snapchat"
  ];
  
  // Map variations to standard names
  const platformMap: Record<string, string> = {
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

export const saveContentIdeas = mutation({
  args: {
    conversationId: v.id("conversations"),
    platform: v.string(),
    ideas: v.array(
      v.object({
        hook: v.string(),
        format: v.string(),
        angle: v.string(),
        trendReference: v.string(),
        description: v.string(),
        variants: v.optional(v.array(v.string())),
      })
    ),
  },
  handler: async (ctx, args) => {
    // Normalize platform name to ensure consistent grouping
    const normalizedPlatform = normalizePlatformName(args.platform);
    
    // Get all content ideas for this conversation to check for existing normalized platform
    const allIdeas = await ctx.db
      .query("contentIdeas")
      .withIndex("conversationId", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .collect();
    
    // Find existing entry with normalized platform name (handles variations)
    const existing = allIdeas.find((item) => 
      normalizePlatformName(item.platform) === normalizedPlatform
    );

    if (existing) {
      // Update existing ideas for this platform (also normalize the stored platform name)
      await ctx.db.patch(existing._id, {
        platform: normalizedPlatform, // Update to normalized name
        ideas: args.ideas,
        createdAt: Date.now(),
      });
    } else {
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

export const saveExecutionState = mutation({
  args: {
    conversationId: v.id("conversations"),
    step: v.union(
      v.literal("planning"),
      v.literal("researching"),
      v.literal("synthesizing"),
      v.literal("checkpoint"),
      v.literal("generating"),
      v.literal("complete")
    ),
    state: v.any(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("executionStates")
      .withIndex("conversationId", (q) =>
        q.eq("conversationId", args.conversationId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        step: args.step,
        state: args.state,
        error: args.error,
        updatedAt: Date.now(),
      });
    } else {
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

export const saveResearchCache = mutation({
  args: {
    queryHash: v.string(),
    query: v.string(),
    timeWindow: v.string(),
    domain: v.string(),
    trends: v.array(
      v.object({
        title: v.string(),
        summary: v.string(),
        whyItMatters: v.string(),
        sources: v.array(
          v.object({
            url: v.string(),
            timestamp: v.optional(v.string()),
            snippet: v.optional(v.string()),
          })
        ),
        confidence: v.number(),
      })
    ),
    cacheTTL: v.number(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const expiresAt = now + args.cacheTTL;
    
    // First, check for exact hash match
    let existing = await ctx.db
      .query("researchCache")
      .withIndex("queryHash", (q) =>
        q.eq("queryHash", args.queryHash)
      )
      .first();
    
    // If no exact match, look for similar entries by domain and timeWindow
    if (!existing && args.domain && args.timeWindow) {
      const domainMatches = await ctx.db
        .query("researchCache")
        .withIndex("domain", (q) =>
          q.eq("domain", args.domain)
        )
        .collect();
      
      // Filter by timeWindow
      const timeWindowMatches = domainMatches.filter(
        (entry) => entry.timeWindow === args.timeWindow
      );
      
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
          } else if (normalizedQuery.includes(normalizedEntryQuery) || normalizedEntryQuery.includes(normalizedQuery)) {
            const shorter = Math.min(normalizedQuery.length, normalizedEntryQuery.length);
            const longer = Math.max(normalizedQuery.length, normalizedEntryQuery.length);
            score = (shorter / longer) * 90; // High score for contains match
          } else {
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
    } else {
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

// ---- Auth: User upsert ----

export const upsertUser = mutation({
  args: {
    oauthProvider: v.string(),
    oauthId: v.string(),
    email: v.string(),
    name: v.string(),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("users")
      .withIndex("by_oauth", (q) =>
        q.eq("oauthProvider", args.oauthProvider).eq("oauthId", args.oauthId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        email: args.email,
        name: args.name,
        avatarUrl: args.avatarUrl,
        lastLoginAt: now,
      });
      return { id: existing._id, email: args.email, name: args.name, role: existing.role };
    }

    // Check if this is the very first user → assign admin role
    const userCount = await ctx.db.query("users").collect();
    const role = userCount.length === 0 ? ("admin" as const) : ("editor" as const);

    const id = await ctx.db.insert("users", {
      oauthProvider: args.oauthProvider,
      oauthId: args.oauthId,
      email: args.email,
      name: args.name,
      avatarUrl: args.avatarUrl,
      role,
      createdAt: now,
      lastLoginAt: now,
    });
    return { id, email: args.email, name: args.name, role };
  },
});

export const updateUserRole = mutation({
  args: {
    userId: v.id("users"),
    role: v.union(v.literal("admin"), v.literal("editor"), v.literal("viewer")),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, { role: args.role });
  },
});

// ---- Audit log ----

export const writeAuditLog = mutation({
  args: {
    userId: v.string(),
    userEmail: v.string(),
    action: v.string(),
    resource: v.string(),
    resourceId: v.optional(v.string()),
    metadata: v.optional(v.any()),
    ip: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    result: v.union(v.literal("success"), v.literal("failure")),
    statusCode: v.number(),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("audit_logs", { ...args, timestamp: Date.now() });
  },
});

// ---- Cost events ----

export const writeCostEvents = mutation({
  args: {
    events: v.array(
      v.object({
        userId: v.optional(v.string()),
        conversationId: v.optional(v.string()),
        provider: v.string(),
        model: v.string(),
        inputTokens: v.number(),
        outputTokens: v.number(),
        costUsd: v.number(),
        durationMs: v.number(),
        nodeType: v.optional(v.string()),
        timestamp: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    for (const event of args.events) {
      await ctx.db.insert("cost_events", event);
    }
  },
});

