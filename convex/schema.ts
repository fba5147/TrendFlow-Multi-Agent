import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  conversations: defineTable({
    userId: v.string(),
    userQuery: v.string(),
    userPersona: v.optional(v.string()),
    status: v.union(
      v.literal("researching"),
      v.literal("checkpoint"),
      v.literal("generating"),
      v.literal("complete"),
      v.literal("error")
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),

  researchResults: defineTable({
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
    completedAt: v.optional(v.number()),
  }).index("conversationId", ["conversationId"]),

  hitlCheckpoints: defineTable({
    conversationId: v.id("conversations"),
    status: v.union(
      v.literal("pending"),
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
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("conversationId", ["conversationId"]),

  contentIdeas: defineTable({
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
    createdAt: v.number(),
  }).index("conversationId", ["conversationId"]),

  executionStates: defineTable({
    conversationId: v.id("conversations"),
    step: v.union(
      v.literal("planning"),
      v.literal("researching"),
      v.literal("synthesizing"),
      v.literal("checkpoint"),
      v.literal("generating"),
      v.literal("complete")
    ),
    state: v.any(), // LangGraph state snapshot
    error: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("conversationId", ["conversationId"]),
});

