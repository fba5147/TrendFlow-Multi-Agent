"use client";

import { useState, useCallback, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import MessageList from "./MessageList";
import ChatInput from "./ChatInput";
import ContentIdeasPanel from "../sidebar/ContentIdeasPanel";
import StepIndicator from "./StepIndicator";
import styles from "./chat.module.css";
import type { Step } from "@/types";

export default function ChatContainer() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  
  // Get real-time step from Convex
  const executionState = useQuery(
    api.queries.getExecutionState,
    conversationId ? { conversationId: conversationId as any } : "skip"
  );
  
  const conversation = useQuery(
    api.queries.getConversation,
    conversationId ? { conversationId: conversationId as any } : "skip"
  );

  const currentStep = useMemo(
    () => executionState?.step || conversation?.status || "idle",
    [executionState?.step, conversation?.status]
  );

  const handleNewConversation = useCallback((id: string) => {
    setConversationId(id);
  }, []);

  const executionStateForStepIndicator = useMemo(
    () => executionState ? { 
      state: executionState.state,
      conversationId: conversationId || undefined
    } : undefined,
    [executionState, conversationId]
  );

  return (
    <div className={styles.chatContainer}>
      {/* Main Chat Area */}
      <div className={styles.mainChatArea}>
        <div className={styles.chatHeader}>
          <h1 className={styles.chatTitle}>Trend-to-Idea Agent | Gallium</h1>
          <StepIndicator 
            step={currentStep as Step} 
            executionState={executionStateForStepIndicator} 
          />
        </div>
        
        <div className={styles.chatContent}>
          <MessageList conversationId={conversationId} />
        </div>
        
        <div className={styles.chatFooter}>
          <ChatInput
            onNewConversation={handleNewConversation}
            onStepChange={() => {}} // Step is now managed by Convex subscriptions
          />
        </div>
      </div>

      {/* Sidebar for Content Ideas */}
      <ContentIdeasPanel conversationId={conversationId} />
    </div>
  );
}

