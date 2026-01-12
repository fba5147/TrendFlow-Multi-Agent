"use client";

import { useQuery } from "convex/react";
import { useMemo } from "react";
import { api } from "@/convex/_generated/api";
import styles from "./stepIndicator.module.css";
import type { StepIndicatorProps } from "@/types";
import { normalizePlatformName } from "@/utils";

const stepLabels: Record<string, string> = {
  idle: "Ready",
  planning: "Planning Research",
  researching: "Researching Trends",
  synthesizing: "Synthesizing Results",
  checkpoint: "Awaiting Approval",
  generating: "Generating Ideas",
  complete: "Complete",
};

export default function StepIndicator({ step, executionState }: StepIndicatorProps) {
  const steps = ["planning", "researching", "synthesizing", "checkpoint", "generating", "complete"];
  
  // Get conversationId from executionState if available (passed via props)
  const conversationId = (executionState as any)?.conversationId || (executionState?.state as any)?.conversationId;
  
  // Query content ideas directly from Convex to get real-time updates when sidebar content is updated
  const contentIdeasFromDB = useQuery(
    api.queries.getContentIdeas,
    conversationId ? { conversationId: conversationId as any } : "skip"
  ) as Array<{ platform: string; ideas: any[] }> | undefined;
  
  // Build contentIdeas object from database query (real-time updates)
  const contentIdeasFromQuery = useMemo(() => {
    const result: Record<string, any[]> = {};
    if (contentIdeasFromDB) {
      contentIdeasFromDB.forEach((item) => {
        const normalizedPlatform = normalizePlatformName(item.platform);
        if (!result[normalizedPlatform]) {
          result[normalizedPlatform] = [];
        }
        result[normalizedPlatform].push(...item.ideas);
      });
    }
    return result;
  }, [contentIdeasFromDB]);
  
  // Use contentIdeas from DB query if available, otherwise fallback to executionState
  const state = executionState?.state;
  const platforms = useMemo(() => (state?.platforms || []) as string[], [state?.platforms]);
  const contentIdeas = useMemo(
    () => Object.keys(contentIdeasFromQuery).length > 0 
      ? contentIdeasFromQuery 
      : (state?.contentIdeas || {}),
    [contentIdeasFromQuery, state?.contentIdeas]
  );
  const completedPlatforms = useMemo(() => Object.keys(contentIdeas), [contentIdeas]);
  
  // Normalize and check if all platforms are done
  const { normalizedExpected, normalizedCompleted, allPlatformsDone } = useMemo(() => {
    const expected = new Set(platforms.map((p: string) => normalizePlatformName(p)));
    const completed = new Set(completedPlatforms.map((p: string) => normalizePlatformName(p)));
    const allDone = platforms.length > 0 && 
      Array.from(expected).every((p: string) => completed.has(p));
    return { normalizedExpected: expected, normalizedCompleted: completed, allPlatformsDone: allDone };
  }, [platforms, completedPlatforms]);
  
  // If all platforms are done but step is still "generating", treat as complete
  const effectiveStep = useMemo(
    () => (step === "generating" && allPlatformsDone) ? "complete" : step,
    [step, allPlatformsDone]
  );
  
  // Handle "idle" state - treat it as before the first step
  // Handle "complete" state - treat it as all steps completed (no active step)
  const currentIndex = useMemo(
    () => effectiveStep === "idle" ? -1 : effectiveStep === "complete" ? steps.length : steps.indexOf(effectiveStep),
    [effectiveStep]
  );
  
  const isActive = useMemo(() => (index: number) => index === currentIndex && effectiveStep !== "complete", [currentIndex, effectiveStep]);
  const isCompleted = useMemo(() => (index: number) => index < currentIndex, [currentIndex]);

  // Get progress text based on step and platform
  const progressText = useMemo(() => {
    switch (effectiveStep) {
      case "planning":
        return "Planning research strategy...";
      case "researching":
        return "Searching for trends...";
      case "synthesizing":
        return "Analyzing and ranking trends...";
      case "checkpoint":
        return "Waiting for approval...";
      case "generating":
        // Determine which platform is currently being generated
        // Normalize platform names for comparison (handles "LinkedIn" vs "linkedin", etc.)
        const normalizedCompletedForProgress = new Set(completedPlatforms.map((p: string) => normalizePlatformName(p)));
        
        // Find remaining platforms (normalized comparison)
        const remainingPlatforms = platforms.filter((p: string) => {
          const normalized = normalizePlatformName(p);
          return !normalizedCompletedForProgress.has(normalized);
        });
        
        if (allPlatformsDone) {
          // All platforms are done, but step might not be updated yet
          return "Finalizing ideas...";
        } else if (remainingPlatforms.length > 0) {
          const currentPlatform = remainingPlatforms[0];
          const totalPlatforms = platforms.length;
          const completedCount = normalizedCompletedForProgress.size;
          return `Generating ideas for ${currentPlatform}... (${completedCount + 1}/${totalPlatforms})`;
        } else if (completedPlatforms.length > 0) {
          return `Finalizing ideas...`;
        } else {
          return "Generating content ideas...";
        }
      case "complete":
        return "";
      default:
        return "In progress...";
    }
  }, [effectiveStep, platforms, completedPlatforms, allPlatformsDone, normalizedCompleted]);
  
  // Connector should be green if the step before it is completed OR if it connects to the active step
  const isConnectorCompleted = useMemo(() => (index: number) => {
    // If the step before the connector is completed, connector is green
    if (isCompleted(index)) return true;
    // If the connector connects TO the active step (index is currentIndex - 1), connector is green
    if (index === currentIndex - 1) return true;
    return false;
  }, [currentIndex, isCompleted]);

  return (
    <div className={styles.stepIndicator}>
      <div className={styles.stepsContainer}>
        {steps.map((s, index) => (
          <div key={s} className={styles.stepGroup}>
            <div className={styles.stepItem}>
              <div
                className={`${styles.stepDot} ${
                  isActive(index)
                    ? styles.stepDotActive
                    : isCompleted(index)
                    ? styles.stepDotCompleted
                    : styles.stepDotInactive
                }`}
              />
              <span
                className={`${styles.stepLabel} ${
                  isActive(index)
                    ? styles.stepLabelActive
                    : isCompleted(index)
                    ? styles.stepLabelCompleted
                    : styles.stepLabelInactive
                }`}
              >
                {stepLabels[s].split(" ")[0]}
              </span>
            </div>
            {index < steps.length - 1 && (
              <div
                className={`${styles.stepConnector} ${
                  isConnectorCompleted(index) ? styles.stepConnectorCompleted : styles.stepConnectorInactive
                }`}
              />
            )}
          </div>
        ))}
      </div>
      <div className={styles.currentStepInfo}>
        <span className={styles.currentStepLabel}>{stepLabels[effectiveStep]}</span>
        {effectiveStep !== "complete" && currentIndex >= 0 && isActive(currentIndex) && (
          <span className={styles.progressIndicator}>
            <span className={styles.progressDot} />
            {progressText}
          </span>
        )}
        {effectiveStep === "complete" && (
          <span className={styles.completeIndicator}>
            <span className={styles.completeIcon}>✓</span>
            Complete
          </span>
        )}
      </div>
    </div>
  );
}

