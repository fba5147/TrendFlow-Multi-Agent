"use client";

import { useState, useCallback, useMemo, useRef, useEffect } from "react";
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
  const chatContentRef = useRef<HTMLDivElement>(null);
  
  // Get real-time step from Convex
  const executionState = useQuery(
    api.queries.getExecutionState,
    conversationId ? { conversationId: conversationId as any } : "skip"
  );
  
  const conversation = useQuery(
    api.queries.getConversation,
    conversationId ? { conversationId: conversationId as any } : "skip"
  );

  const researchResults = useQuery(
    api.queries.getResearchResults,
    conversationId ? { conversationId: conversationId as any } : "skip"
  );

  const currentStep = useMemo(
    () => executionState?.step || conversation?.status || "idle",
    [executionState?.step, conversation?.status]
  );

  // Auto-scroll to bottom when content updates
  useEffect(() => {
    if (chatContentRef.current) {
      const scrollContainer = chatContentRef.current;
      scrollContainer.scrollTo({
        top: scrollContainer.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [
    executionState?.state?.messages,
    conversation?.userQuery,
    executionState?.step,
    researchResults?.trends,
  ]);

  const handleNewConversation = useCallback((id: string) => {
    setConversationId(id);
    // Scroll to top when starting a new conversation
    if (chatContentRef.current) {
      chatContentRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
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
          <h1 className={styles.chatTitle}>Trend-to-Idea Agent | Gallium AI</h1>
          <StepIndicator 
            step={currentStep as Step} 
            executionState={executionStateForStepIndicator} 
          />
        </div>
        
        <div className={styles.chatContent} ref={chatContentRef}>
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
      <ContentIdeasPanel conversationId={conversationId} currentStep={currentStep as Step} />
    </div>
  );
}

