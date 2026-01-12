"use client";

import { memo, useMemo } from "react";
import styles from "./ideaCard.module.css";
import type { IdeaCardProps } from "@/types";
import { getDisplayPlatform } from "@/utils";

function IdeaCard({ idea, platform, displayPlatform }: IdeaCardProps) {
  // Use displayPlatform for styling and labels (normalized/grouped platform)
  const normalizedPlatform = useMemo(
    () => displayPlatform || getDisplayPlatform(platform),
    [displayPlatform, platform]
  );
  const platformForStyling = normalizedPlatform;
  
  const cardClass = useMemo(() => {
    switch (platformForStyling) {
      case "LinkedIn":
        return styles.ideaCardLinkedIn;
      case "X":
        return styles.ideaCardX;
      case "TikTok":
        return styles.ideaCardTikTok;
      case "Instagram":
        return styles.ideaCardInstagram;
      case "YouTube":
        return styles.ideaCardYouTube;
      case "Reddit":
        return styles.ideaCardReddit;
      case "Facebook":
        return styles.ideaCardFacebook;
      case "Medium":
        return styles.ideaCardMedium;
      case "Substack":
        return styles.ideaCardSubstack;
      case "Threads":
        return styles.ideaCardThreads;
      case "Pinterest":
        return styles.ideaCardPinterest;
      case "Snapchat":
        return styles.ideaCardSnapchat;
      case "Other":
        return styles.ideaCardOther || "";
      default:
        return "";
    }
  }, [platformForStyling]);

  const formatBadgeClass = useMemo(() => {
    switch (platformForStyling) {
      case "LinkedIn":
        return styles.formatBadgeLinkedIn;
      case "X":
        return styles.formatBadgeX;
      case "TikTok":
        return styles.formatBadgeTikTok;
      case "Instagram":
        return styles.formatBadgeInstagram;
      case "YouTube":
        return styles.formatBadgeYouTube;
      case "Reddit":
        return styles.formatBadgeReddit;
      case "Facebook":
        return styles.formatBadgeFacebook;
      case "Medium":
        return styles.formatBadgeMedium;
      case "Substack":
        return styles.formatBadgeSubstack;
      case "Threads":
        return styles.formatBadgeThreads;
      case "Pinterest":
        return styles.formatBadgePinterest;
      case "Snapchat":
        return styles.formatBadgeSnapchat;
      case "Other":
        return styles.formatBadgeOther || styles.formatBadgeDefault;
      default:
        return styles.formatBadgeDefault;
    }
  }, [platformForStyling]);

  // Normalize format field to match the actual platform
  // If format contains a platform name, replace it with the correct one
  const normalizedFormat = useMemo(() => {
    if (!idea.format) return `${normalizedPlatform} Post`;
    
    // List of platform names to check and replace
    const platformNames = ["LinkedIn", "X", "Twitter", "TikTok", "Instagram", "YouTube", "Reddit", 
                          "Facebook", "Medium", "Substack", "Threads", "Pinterest", "Snapchat"];
    
    let normalized = idea.format;
    for (const pName of platformNames) {
      // Replace any platform name in the format with the target platform
      const regex = new RegExp(`\\b${pName}\\b`, 'gi');
      if (regex.test(normalized) && pName.toLowerCase() !== normalizedPlatform.toLowerCase()) {
        normalized = normalized.replace(regex, normalizedPlatform);
        break; // Only replace once
      }
    }
    
    return normalized;
  }, [idea.format, normalizedPlatform]);

  return (
    <div className={`${styles.ideaCard} ${cardClass}`}>
      <div className={styles.cardHeader}>
        <span className={`${styles.formatBadge} ${formatBadgeClass}`}>
          {normalizedFormat}
        </span>
        <span className={styles.platformLabel}>{normalizedPlatform}</span>
      </div>
      
      <div className={styles.ideaContent}>
        <h4 className={styles.ideaHook}>{idea.hook}</h4>
        <p className={styles.ideaDescription}>{idea.description}</p>
      </div>
      
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Angle</p>
        <p className={styles.sectionText}>{idea.angle}</p>
      </div>
      
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Linked Trend & Citation</p>
        <p className={styles.trendReference}>{idea.trendReference}</p>
        <p className={styles.trendReferenceNote}>This idea is based on the approved research trend above</p>
      </div>
      
      {idea.variants && idea.variants.length > 0 && (
        <div className={styles.section}>
          <p className={styles.sectionLabel}>Variants</p>
          <ul className={styles.variantsList}>
            {idea.variants.map((variant, idx) => (
              <li key={idx} className={styles.variantItem}>
                <span className={styles.variantArrow}>→</span>
                <span>{variant}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      
      <div className={styles.cardActions}>
        <button className={styles.actionButton}>
          Copy Hook
        </button>
        <span className={styles.actionDivider}>|</span>
        <button className={styles.actionButton}>
          Expand
        </button>
      </div>
    </div>
  );
}

export default memo(IdeaCard);

