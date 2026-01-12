"use client";

import { useState, useEffect } from "react";
import styles from "./research.module.css";
import type { ResearchDisplayProps, Trend } from "@/types";
import { getRelativeTime, formatDate, isRecentDate } from "@/utils";


/**
 * Source item component - client-side only to avoid hydration issues
 */
function SourceItem({ source, index }: { source: Trend['sources'][0]; index: number }) {
  const [mounted, setMounted] = useState(false);
  const [dateDisplay, setDateDisplay] = useState<string>('');
  const [relativeTime, setRelativeTime] = useState<string>('');
  const [isRecent, setIsRecent] = useState(false);

  useEffect(() => {
    setMounted(true);
    if (source.timestamp) {
      const sourceDate = new Date(source.timestamp);
      setIsRecent(isRecentDate(sourceDate));
      setDateDisplay(formatDate(sourceDate));
      setRelativeTime(getRelativeTime(sourceDate));
    } else {
      setDateDisplay('Recent');
    }
  }, [source.timestamp]);

  return (
    <li className={styles.sourceItem}>
      <div className={styles.sourceContent}>
        <div className={styles.sourceNumber}>
          <span className={styles.sourceNumberBadge}>
            {index + 1}
          </span>
        </div>
        <div className={styles.sourceDetails}>
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.sourceLink}
          >
            {source.url}
            <span className={styles.sourceLinkIcon}>↗</span>
          </a>
          {source.snippet && (
            <p className={styles.sourceSnippet}>
              &quot;{source.snippet}&quot;
            </p>
          )}
          {mounted && (
            <div className={styles.sourceMetadata}>
              <span className={`${styles.sourceDate} ${isRecent ? styles.sourceDateRecent : styles.sourceDateOld}`}>
                📅 {dateDisplay}
              </span>
              {relativeTime && (
                <span className={styles.sourceRelativeTime}>
                  {relativeTime}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

export default function ResearchDisplay({ trends }: ResearchDisplayProps) {
  if (!trends || trends.length === 0) {
    return (
      <div className={styles.emptyResearch}>
        <p>No research results yet. Research is in progress...</p>
      </div>
    );
  }

  // Sort trends by confidence (descending - highest first) to ensure proper ordering
  const sortedTrends = [...trends].sort(
    (a, b) => (b.confidence || 0) - (a.confidence || 0)
  );

  return (
    <div className={styles.researchContainer}>
      <div className={styles.researchHeader}>
        <h2 className={styles.researchTitle}>Research Results</h2>
        <span className={styles.trendCount}>{sortedTrends.length} trend{sortedTrends.length !== 1 ? 's' : ''} found</span>
      </div>
      
      {sortedTrends.map((trend, index) => (
        <div key={index} className={styles.trendCard}>
          <div className={styles.trendHeader}>
            <h3 className={styles.trendTitle}>{trend.title}</h3>
            <div className={styles.confidenceContainer}>
              <span className={styles.confidenceLabel}>Confidence</span>
              <span className={`${styles.confidenceBadge} ${
                trend.confidence >= 0.8 ? styles.confidenceHigh :
                trend.confidence >= 0.6 ? styles.confidenceMedium :
                styles.confidenceLow
              }`}>
                {Math.round(trend.confidence * 100)}%
              </span>
            </div>
          </div>
          
          <p className={styles.trendSummary}>{trend.summary}</p>
          
          <div className={styles.whyItMatters}>
            <p className={styles.whyItMattersLabel}>Why it matters:</p>
            <p className={styles.whyItMattersText}>{trend.whyItMatters}</p>
          </div>
          
          <div className={styles.sourcesSection}>
            <div className={styles.sourcesHeader}>
              <p className={styles.sourcesLabel}>Citations ({trend.sources.length})</p>
              <span className={styles.sourcesHint}>Click to view source</span>
            </div>
            <ul className={styles.sourcesList}>
              {trend.sources.map((source, idx) => {
                return <SourceItem key={idx} source={source} index={idx} />;
              })}
            </ul>
          </div>
        </div>
      ))}
    </div>
  );
}

