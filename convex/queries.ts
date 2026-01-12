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

