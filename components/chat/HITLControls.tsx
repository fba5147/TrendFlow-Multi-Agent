"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import styles from "./hitl.module.css";
import type { HITLControlsProps } from "@/types";
import { MAIN_PLATFORMS } from "@/utils";

export default function HITLControls({ conversationId }: HITLControlsProps) {
  const [refinementText, setRefinementText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const updateCheckpoint = useMutation(api.mutations.updateHITLCheckpoint);
  const updateStatus = useMutation(api.mutations.updateConversationStatus);
  const saveExecutionState = useMutation(api.mutations.saveExecutionState);
  const executionState = useQuery(api.queries.getExecutionState, {
    conversationId: conversationId as any,
  });
  const researchResults = useQuery(api.queries.getResearchResults, {
    conversationId: conversationId as any,
  });

  const handleApprove = async () => {
    if (!researchResults || !researchResults.trends || researchResults.trends.length === 0) {
      alert("No trends available to approve. Please wait for research to complete.");
      return;
    }

    setIsHidden(true);
    setIsProcessing(true);
    try {
      // Get approved trends (all trends for now, can add selection UI later)
      const approvedTrends = researchResults.trends;

      await updateCheckpoint({
        conversationId: conversationId as any,
        status: "approved",
        approvedTrends: approvedTrends,
      });
      
      // Update status to generating
      await updateStatus({
        conversationId: conversationId as any,
        status: "generating",
      });

      // Immediately update execution state step to "generating" for instant UI feedback
      await saveExecutionState({
        conversationId: conversationId as any,
        step: "generating",
        state: executionState?.state || {},
        error: undefined,
      });

      // Resume agent execution via API
      const response = await fetch("/api/agent/execute", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          checkpointStatus: "approved",
          approvedTrends: approvedTrends,
          platforms: MAIN_PLATFORMS
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || "Failed to resume agent");
      }

      
    } catch (error) {
      console.error("Error approving:", error);
      alert(error instanceof Error ? error.message : "Failed to approve. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRefine = async () => {
    if (!refinementText.trim()) return;
    
    setIsHidden(true);
    setIsProcessing(true);
    try {
      await updateCheckpoint({
        conversationId: conversationId as any,
        status: "refined",
        refinementRequest: refinementText,
      });

      // Update status back to researching
      await updateStatus({
        conversationId: conversationId as any,
        status: "researching",
      });

      // Immediately update execution state step to "researching" for instant UI feedback
      await saveExecutionState({
        conversationId: conversationId as any,
        step: "researching",
        state: executionState?.state || {},
        error: undefined,
      });

      // Resume agent with refinement
      const response = await fetch("/api/agent/execute", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          checkpointStatus: "refined",
          refinementRequest: refinementText,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || "Failed to refine research");
      }

      // Clear refinement text
      setRefinementText("");
    } catch (error) {
      console.error("Error refining:", error);
      alert(error instanceof Error ? error.message : "Failed to refine research. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleRestart = async () => {
    setIsHidden(true);
    setIsProcessing(true);
    try {
      await updateCheckpoint({
        conversationId: conversationId as any,
        status: "restarted",
      });

      // Update status back to researching immediately for instant UI feedback
      await updateStatus({
        conversationId: conversationId as any,
        status: "researching",
      });

      // Immediately update execution state step to "planning" for instant UI feedback (restart goes back to planning)
      await saveExecutionState({
        conversationId: conversationId as any,
        step: "planning",
        state: executionState?.state || {},
        error: undefined,
      });

      // Resume agent with restart
      const response = await fetch("/api/agent/execute", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId,
          checkpointStatus: "restarted",
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || "Failed to restart research");
      }
    } catch (error) {
      console.error("Error restarting:", error);
      alert(error instanceof Error ? error.message : "Failed to restart research. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  if (!researchResults || !researchResults.trends || researchResults.trends.length === 0) {
    return (
      <div className={styles.waitingContainer}>
        <h3 className={styles.waitingTitle}>Waiting for Research Results</h3>
        <p className={styles.waitingText}>
          Research is still in progress. Results will appear here shortly.
        </p>
      </div>
    );
  }

  return (
    <div>
    {!isHidden && (
    <div className={styles.checkpointContainer}>
      <div className={styles.checkpointHeader}>
        <div className={styles.checkpointTitleSection}>
          <div className={styles.checkpointIcon}>
            ⏸
          </div>
          <div>
            <h3 className={styles.checkpointTitle}>Human-in-the-Loop Checkpoint</h3>
            <p className={styles.checkpointSubtitle}>
              Review the research results above before proceeding
            </p>
          </div>
        </div>
        <div className={styles.checkpointInfo}>
          <p className={styles.checkpointInfoText}>
            <strong>{researchResults.trends.length}</strong> trend{researchResults.trends.length !== 1 ? 's' : ''} found with citations and timestamps. 
            Review each trend&apos;s sources, confidence scores, and &quot;why it matters&quot; explanations.
          </p>
        </div>
      </div>
      
      
        <div className={styles.buttonGroup}>
          <button
            onClick={handleApprove}
            disabled={isProcessing || !researchResults.trends || researchResults.trends.length === 0}
            className={`${styles.button} ${styles.approveButton}`}
          >
            {isProcessing ? "Processing..." : "✓ Approve & Generate Ideas"}
          </button>
          
          <button
            onClick={handleRestart}
            disabled={isProcessing}
            className={`${styles.button} ${styles.restartButton}`}
          >
            {isProcessing ? "Processing..." : "↻ Restart Research"}
          </button>
        </div>
      
      
      <div className={styles.refineSection}>
        <label className={styles.refineLabel}>
          Or request refinements:
        </label>
        <textarea
          value={refinementText}
          onChange={(e) => setRefinementText(e.target.value)}
          placeholder="E.g., Narrow to US market only, exclude NFT topics, focus on Q1 2024..."
          className={styles.refineTextarea}
          rows={3}
        />
        <button
          onClick={handleRefine}
          disabled={isProcessing || !refinementText.trim()}
          className={`${styles.button} ${styles.refineButton}`}
        >
          {isProcessing ? "Processing..." : "🔍 Refine Research"}
        </button>
      </div>
      </div>
    )}
    </div>
  );
}

