"use client";

import { useQuery } from "convex/react";
import { useMemo, useCallback } from "react";
import { api } from "@/convex/_generated/api";
import IdeaCard from "./IdeaCard";
import styles from "./sidebar.module.css";
import type { ContentIdeasPanelProps, ContentIdeaDocument } from "@/types";
import { contentIdeasToMarkdown, downloadMarkdown, getDisplayPlatform } from "@/utils";

export default function ContentIdeasPanel({ conversationId, currentStep = "idle" }: ContentIdeasPanelProps) {
  const contentIdeas = useQuery(
    api.queries.getContentIdeas,
    conversationId ? { conversationId: conversationId as any } : "skip"
  ) as ContentIdeaDocument[] | undefined;

  // All hooks must be called before any conditional returns
  // Group by platform - use display platform (grouping non-main platforms under "Other")
  // Memoize expensive grouping and sorting operations
  const { byPlatform, sortedPlatforms } = useMemo(() => {
    if (!contentIdeas || contentIdeas.length === 0) {
      return { byPlatform: {} as Record<string, ContentIdeaDocument[]>, sortedPlatforms: [] as string[] };
    }

    const grouped = contentIdeas.reduce((acc: Record<string, ContentIdeaDocument[]>, item: ContentIdeaDocument) => {
      const displayPlatform = getDisplayPlatform(item.platform);
      if (!acc[displayPlatform]) {
        acc[displayPlatform] = [];
      }
      acc[displayPlatform].push(item);
      return acc;
    }, {} as Record<string, ContentIdeaDocument[]>);

    const sorted = Object.keys(grouped).sort((a, b) => {
      if (a === "Other") return 1;
      if (b === "Other") return -1;
      return a.localeCompare(b);
    });

    return { byPlatform: grouped, sortedPlatforms: sorted };
  }, [contentIdeas]);

  const isComplete = currentStep === "complete";
  
  const handleExport = useCallback(() => {
    if (!contentIdeas || !isComplete) return;
    const markdown = contentIdeasToMarkdown(contentIdeas);
    const filename = `content-ideas-${new Date().toISOString().split('T')[0]}.md`;
    downloadMarkdown(markdown, filename);
  }, [contentIdeas, isComplete]);

  // Early returns after all hooks
  if (!conversationId) {
    return (
      <div className={styles.sidebar}>
        <div className={styles.emptyState}>
          <h2 className={styles.emptyStateTitle}>Content Ideas</h2>
          <p className={styles.emptyStateText}>
            Start a conversation to see content ideas here.
          </p>
        </div>
      </div>
    );
  }

  // Loading state
  if (contentIdeas === undefined) {
    return (
      <div className={styles.sidebar}>
        <div className={styles.loadingState}>
          <span className={styles.loadingDot} />
          Loading...
        </div>
      </div>
    );
  }

  // Empty state
  if (!contentIdeas || contentIdeas.length === 0) {
    return (
      <div className={styles.sidebar}>
        <div className={styles.emptyState}>
          <h2 className={styles.emptyStateTitle}>Content Ideas</h2>
          <p className={styles.emptyStateText}>
            Content ideas will appear here after you approve the research and generation completes.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.sidebar}>
      <div className={styles.sidebarHeader}>
        <div className={styles.sidebarHeaderTop}>
          <h2 className={styles.sidebarTitle}>Content Ideas</h2>
          <button 
            onClick={handleExport}
            className={styles.exportButton}
            disabled={!isComplete}
            title={isComplete ? "Export to Markdown" : "Wait for generation to complete"}
          >
            Export
          </button>
        </div>
        <p className={styles.sidebarSubtitle}>
          Generated content ideas by platform
        </p>
      </div>
      
      <div className={styles.sidebarContent}>
        {sortedPlatforms.map((displayPlatform) => {
          const items = byPlatform[displayPlatform];
          return (
            <div key={displayPlatform} className={styles.platformSection}>
              <h3 className={styles.platformTitle}>
                {displayPlatform}
              </h3>
              {items.map((item: ContentIdeaDocument, idx: number) => (
                <div key={idx} className={styles.platformIdeas}>
                  {item.ideas.map((idea, ideaIdx: number) => (
                    <IdeaCard key={ideaIdx} idea={idea} platform={item.platform} displayPlatform={displayPlatform} />
                  ))}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

