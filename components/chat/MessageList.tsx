"use client";

import { useState, useEffect, useMemo, memo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import ResearchDisplay from "./ResearchDisplay";
import HITLControls from "./HITLControls";
import styles from "./chat.module.css";
import type { MessageListProps } from "@/types";

/**
 * Message item component - client-side only to avoid hydration issues with timestamps
 */
function MessageItem({ content, timestamp }: { content: string; timestamp: number }) {
  const [mounted, setMounted] = useState(false);
  const [timeDisplay, setTimeDisplay] = useState<string>('');

  useEffect(() => {
    setMounted(true);
    setTimeDisplay(new Date(timestamp).toLocaleTimeString());
  }, [timestamp]);

  return (
    <div className={styles.messageItem}>
      <p className={styles.messageContent}>{content}</p>
      {mounted && (
        <p className={styles.messageTimestamp}>{timeDisplay}</p>
      )}
    </div>
  );
}

function MessageList({ conversationId }: MessageListProps) {
  // Real-time subscriptions to Convex data
  const conversation = useQuery(
    api.queries.getConversation,
    conversationId ? { conversationId: conversationId as any } : "skip"
  );
  
  const researchResults = useQuery(
    api.queries.getResearchResults,
    conversationId ? { conversationId: conversationId as any } : "skip"
  );
  
  const checkpoint = useQuery(
    api.queries.getHITLCheckpoint,
    conversationId ? { conversationId: conversationId as any } : "skip"
  );
  
  const executionState = useQuery(
    api.queries.getExecutionState,
    conversationId ? { conversationId: conversationId as any } : "skip"
  );

  // All hooks must be called before any conditional returns
  const currentStep = useMemo(
    () => executionState?.step || conversation?.status || "idle",
    [executionState?.step, conversation?.status]
  );
  const trends = useMemo(() => researchResults?.trends || [], [researchResults?.trends]);
  const showCheckpoint = useMemo(
    () => currentStep === "checkpoint" && checkpoint && trends.length > 0,
    [currentStep, checkpoint, trends.length]
  );

  // Early returns after all hooks
  if (!conversationId) {
    return (
      <div className={styles.emptyState}>
        Start a conversation to research trends and generate content ideas.
      </div>
    );
  }

  // Show loading state
  if (!conversation && !executionState) {
    return (
      <div className={styles.loadingState}>
        Loading conversation...
      </div>
    );
  }

  return (
    <div className={styles.messageList}>
      {/* User Query */}
      {conversation && (
        <div className={styles.userQueryContainer}>
          <p className={styles.userQueryLabel}>You:</p>
          <p className={styles.userQueryText}>{conversation.userQuery}</p>
        </div>
      )}

      {/* Execution Messages */}
      {executionState?.state?.messages && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {executionState.state.messages
            .filter((msg: { role: string }) => msg.role === "assistant")
            .map((msg: { content: string; timestamp: number }, idx: number) => (
              <MessageItem key={idx} content={msg.content} timestamp={msg.timestamp} />
            ))}
        </div>
      )}

      {/* Research Results */}
      {trends.length > 0 && (
        <div>
          <ResearchDisplay trends={trends} />
        </div>
      )}

      {/* HITL Checkpoint Controls */}
      {showCheckpoint && (
        <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: "1.5rem" }}>
          <HITLControls conversationId={conversationId} />
        </div>
      )}

      {/* Error State */}
      {executionState?.error && (
        <div className={styles.errorContainer}>
          <p className={styles.errorLabel}>Error:</p>
          <p className={styles.errorText}>{executionState.error}</p>
        </div>
      )}

      {/* Completion State */}
      {currentStep === "complete" && trends.length === 0 && (
        <div className={styles.completionState}>
          Research complete. Check the sidebar for content ideas.
        </div>
      )}
    </div>
  );
}

export default memo(MessageList);
