/**
 * Centralized type definitions for the application
 * 
 * Note: Core domain types (Trend, ResearchPlan, ContentIdea, AgentState) 
 * are defined in lib/langgraph/state.ts with Zod schemas for validation.
 * This file contains component-specific types and UI-related types.
 */

// Import core types for use in this file
import type { Trend, ContentIdea } from "@/lib/langgraph/state";
import type { Id } from "@/convex/_generated/dataModel";

// Re-export core types from lib/langgraph/state.ts
export type {
  Trend,
  ResearchPlan,
  ContentIdea,
  AgentState,
} from "@/lib/langgraph/state";

// Re-export Convex ID types
export type { Id } from "@/convex/_generated/dataModel";
export type ConversationId = Id<"conversations">;

// Content Idea Document Type (for Convex)
export interface ContentIdeaDocument {
  _id: string;
  conversationId: string;
  platform: string;
  ideas: ContentIdea[];
  createdAt: number;
}

// Component Props Types
export interface ResearchDisplayProps {
  trends: Trend[];
}

export interface IdeaCardProps {
  idea: ContentIdea;
  platform: string; // Original platform name
  displayPlatform?: string; // Display platform name (may be "Other" for non-main platforms)
}

export interface ContentIdeasPanelProps {
  conversationId: string | null;
}

export interface ChatInputProps {
  onNewConversation: (id: string) => void;
  onStepChange: (step: Step) => void;
}

export interface MessageListProps {
  conversationId: string | null;
}

export interface HITLControlsProps {
  conversationId: string;
}

export interface StepIndicatorProps {
  step: Step;
  executionState?: {
    state?: {
      platforms?: string[];
      contentIdeas?: Record<string, ContentIdea[]>;
      conversationId?: string;
    };
    conversationId?: string;
  };
}

// Step Types
export type Step = 
  | "idle" 
  | "planning" 
  | "researching" 
  | "synthesizing" 
  | "checkpoint" 
  | "generating" 
  | "complete";

export type ConversationStatus = 
  | "researching" 
  | "checkpoint" 
  | "generating" 
  | "complete" 
  | "error";

export type CheckpointStatus = 
  | "pending" 
  | "approved" 
  | "refined" 
  | "restarted";

// MCP Types
export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  timestamp?: string;
}

// Message Types
export interface Message {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

