import { AgentState, Trend, ResearchPlan, ContentIdea } from "./state";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { fetchTrendsIncremental } from "../mcp/client";
import { getGalliumAIBrandPrompt, getTrendSynthesisPrompt, getContentGenerationPrompt } from "../prompts";
import { MAIN_PLATFORMS, normalizePlatformName } from "@/utils";
import { llm } from "../llm";

/**
 * Node 1: Research Planning
 * Parses user query, extracts scope, selects tools
 */
export async function researchPlanningNode(state: AgentState): Promise<Partial<AgentState>> {
  const persona = state.userPersona || "";
  const brandPrompt = getGalliumAIBrandPrompt(persona);
  
  const systemPrompt = `${brandPrompt}

You are a research planning assistant for Gallium AI. Analyze the user's query and extract:
1. Time window (e.g., "this week", "Q1 2024", "last month", "recent") - REQUIRED, must be a string, never null
2. Region/geography (if specified, e.g., "US", "global", "Europe") - Can be null if not mentioned
3. Domain/topic area (the core subject) - REQUIRED, must be a string extracted from the query, never null
4. Which research tools would be best (e.g., ["web_search"]) - REQUIRED, must be an array with at least one tool
5. Platforms for content generation (e.g., ["LinkedIn", "X", "TikTok"]) - REQUIRED, must be an array of platform names

Platforms should be extracted from the user's query. Look for mentions of social media platforms like:
- LinkedIn, X (or Twitter), TikTok, Instagram, YouTube, Reddit, Facebook, Medium, Substack, Threads, Pinterest, Snapchat

If platforms are not explicitly mentioned, infer them from context (e.g., "professional network" → LinkedIn, "short videos" → TikTok).
If no platforms are mentioned or can be inferred, default to ["LinkedIn", "X"] (the most common platforms).

If refinement request exists, incorporate it into the research scope.

CRITICAL: 
- timeWindow MUST be a non-null string (default to "this week" if unclear)
- domain MUST be a non-null string extracted from the user query
- tools MUST be a non-empty array (default to ["web_search"])
- platforms MUST be a non-empty array (default to ["LinkedIn", "X"] if not mentioned)
- region can be null if not specified

Respond with ONLY a valid JSON object. No explanations, no markdown, no text before or after.
Format: { "timeWindow": string, "region": string | null, "domain": string, "tools": string[], "platforms": string[] }

Examples:
Query: "What's trending in AI this week? Give me ideas for LinkedIn and X"
Response: { "timeWindow": "this week", "region": null, "domain": "AI trends", "tools": ["web_search"], "platforms": ["LinkedIn", "X"] }

Query: "Recent marketing trends in the US for TikTok and Instagram"
Response: { "timeWindow": "recent", "region": "US", "domain": "marketing trends", "tools": ["web_search"], "platforms": ["TikTok", "Instagram"] }

Query: "What's trending in creator economy?"
Response: { "timeWindow": "this week", "region": null, "domain": "creator economy trends", "tools": ["web_search"], "platforms": ["LinkedIn", "X"] }`;

  const queryText = state.refinementRequest 
    ? `${state.userQuery}\n\nRefinement request: ${state.refinementRequest}`
    : state.userQuery;

  const messages = [
    new SystemMessage(systemPrompt),
    new HumanMessage(`Analyze this query and extract research parameters:\n\n"${queryText}"`),
  ];

  const response = await llm.invoke(messages);
  const content = response.content as string;

  // Parse JSON response - robust extraction
  // Type for parsed plan data from LLM (before validation/transformation)
  interface ParsedPlanData {
    timeWindow?: string | null;
    region?: string | null;
    domain?: string | null;
    tools?: string[];
    platforms?: string[];
  }
  let planData: ParsedPlanData;
  try {
    let jsonStr = content.trim();
    
    // Strategy 1: Try to extract JSON from markdown code blocks
    const jsonBlockMatch = content.match(/```json\n([\s\S]*?)\n```/i) || content.match(/```\n([\s\S]*?)\n```/i);
    if (jsonBlockMatch) {
      jsonStr = jsonBlockMatch[1].trim();
    } else {
      // Strategy 2: Find the first { and last } that contain valid JSON
      const firstBrace = content.indexOf('{');
      const lastBrace = content.lastIndexOf('}');
      
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        jsonStr = content.substring(firstBrace, lastBrace + 1).trim();
      } else {
        // Strategy 3: Try regex to find JSON object
        const objectMatch = content.match(/\{[\s\S]*\}/);
        if (objectMatch) {
          jsonStr = objectMatch[0];
        } else {
          throw new Error("No JSON object found in response");
        }
      }
    }
    
    planData = JSON.parse(jsonStr) as ParsedPlanData;
    
    // Validate and fix null/invalid values
    if (!planData.timeWindow || planData.timeWindow === null || planData.timeWindow === "null") {
      // Extract time window from query or use default
      const timeMatch = queryText.match(/\b(this week|last week|this month|last month|recent|today|yesterday|Q1|Q2|Q3|Q4|\d{4})\b/i);
      planData.timeWindow = timeMatch ? timeMatch[1].toLowerCase() : "this week";
      console.warn("[Planning] Fixed null timeWindow, using:", planData.timeWindow);
    }
    
    if (!planData.domain || planData.domain === null || planData.domain === "null") {
      // Extract domain from user query - remove common time/region words
      const domainText = queryText
        .replace(/\b(this week|last week|this month|recent|today|yesterday|US|USA|United States|Europe|global)\b/gi, "")
        .replace(/\b(what|are|is|the|trends|trending|in|for|give|me|show)\b/gi, "")
        .trim()
        .substring(0, 100);
      planData.domain = domainText || "trending topics";
      console.warn("[Planning] Fixed null domain, using:", planData.domain);
    }
    
    if (!planData.tools || !Array.isArray(planData.tools) || planData.tools.length === 0) {
      planData.tools = ["web_search"];
      console.warn("[Planning] Fixed empty tools array, using default");
    }
    
    // Validate and extract platforms
    if (!planData.platforms || !Array.isArray(planData.platforms) || planData.platforms.length === 0) {
      // Try to extract platforms from user query
      const platformNames = ["LinkedIn", "X", "Twitter", "TikTok", "Instagram", "YouTube", "Reddit", 
                            "Facebook", "Medium", "Substack", "Threads", "Pinterest", "Snapchat"];
      const extractedPlatforms: string[] = [];
      
      const lowerQuery = queryText.toLowerCase();
      for (const platform of platformNames) {
        const lowerPlatform = platform.toLowerCase();
        // Check for platform mentions in query
        if (lowerQuery.includes(lowerPlatform) || 
            (platform === "X" && (lowerQuery.includes("twitter") || lowerQuery.includes(" x "))) ||
            (platform === "LinkedIn" && (lowerQuery.includes("linkedin") || lowerQuery.includes("linked in"))) ||
            (platform === "TikTok" && lowerQuery.includes("tiktok")) ||
            (platform === "Instagram" && (lowerQuery.includes("instagram") || lowerQuery.includes("insta"))) ||
            (platform === "YouTube" && (lowerQuery.includes("youtube") || lowerQuery.includes("youtube"))) ||
            (platform === "Reddit" && lowerQuery.includes("reddit")) ||
            (platform === "Facebook" && (lowerQuery.includes("facebook") || lowerQuery.includes("fb"))) ||
            (platform === "Medium" && lowerQuery.includes("medium")) ||
            (platform === "Substack" && lowerQuery.includes("substack")) ||
            (platform === "Threads" && lowerQuery.includes("threads")) ||
            (platform === "Pinterest" && lowerQuery.includes("pinterest")) ||
            (platform === "Snapchat" && lowerQuery.includes("snapchat"))) {
          // Normalize platform name
          const normalized = platform === "Twitter" ? "X" : platform;
          if (!extractedPlatforms.includes(normalized)) {
            extractedPlatforms.push(normalized);
          }
        }
      }
      
      planData.platforms = extractedPlatforms.length > 0 ? extractedPlatforms : ["LinkedIn", "X"];
      console.warn("[Planning] Fixed empty platforms array, extracted:", planData.platforms);
    } else {
      // Normalize platform names
      planData.platforms = planData.platforms.map((p: string) => {
        const normalized = normalizePlatformName(p);
        return normalized;
      }).filter((p: string, index: number, arr: string[]) => arr.indexOf(p) === index); // Remove duplicates
    }
    
    // Region can be null, that's fine
    if (planData.region === "null" || planData.region === "") {
      planData.region = null;
    }
    
    console.log(`[Planning] Successfully parsed research plan:`, planData);
  } catch (e) {
    console.warn("[Planning] Failed to parse LLM response, using intelligent fallback:", e);
    console.warn("[Planning] Raw response (first 300 chars):", content.substring(0, 300));
    
    // Intelligent fallback - extract from user query
    const timeMatch = queryText.match(/\b(this week|last week|this month|last month|recent|today|Q1|Q2|Q3|Q4|\d{4})\b/i);
    const regionMatch = queryText.match(/\b(US|USA|United States|Europe|UK|Canada|Australia|Asia|global)\b/i);
    
    // Extract domain by removing time/region/common words
    let domainText = queryText
      .replace(/\b(this week|last week|this month|recent|today|yesterday|US|USA|United States|Europe|global)\b/gi, "")
      .replace(/\b(what|are|is|the|trends|trending|in|for|give|me|show|content ideas)\b/gi, "")
      .replace(/[""]/g, "")
      .trim();
    
    // If still too long or unclear, take first meaningful phrase
    if (domainText.length > 50 || !domainText) {
      const phrases = queryText.split(/[,\n]/);
      domainText = phrases.find(p => 
        p.trim().length > 5 && 
        !p.match(/\b(this week|last week|recent|US|USA|give|me|show)\b/i)
      )?.trim() || "trending topics";
      domainText = domainText.substring(0, 50);
    }
    
    // Extract platforms from query in fallback
    const platformNames = ["LinkedIn", "X", "Twitter", "TikTok", "Instagram", "YouTube", "Reddit", 
                          "Facebook", "Medium", "Substack", "Threads", "Pinterest", "Snapchat"];
    const extractedPlatforms: string[] = [];
    const lowerQuery = queryText.toLowerCase();
    
    for (const platform of platformNames) {
      const lowerPlatform = platform.toLowerCase();
      if (lowerQuery.includes(lowerPlatform) || 
          (platform === "X" && (lowerQuery.includes("twitter") || lowerQuery.includes(" x "))) ||
          (platform === "LinkedIn" && (lowerQuery.includes("linkedin") || lowerQuery.includes("linked in")))) {
        const normalized = platform === "Twitter" ? "X" : platform;
        if (!extractedPlatforms.includes(normalized)) {
          extractedPlatforms.push(normalized);
        }
      }
    }
    
    planData = {
      timeWindow: timeMatch ? timeMatch[1].toLowerCase() : "this week",
      region: regionMatch ? regionMatch[1] : null,
      domain: domainText || state.userQuery.substring(0, 50),
      tools: ["web_search"],
      platforms: extractedPlatforms.length > 0 ? extractedPlatforms : ["LinkedIn", "X"],
    };
    
    console.log(`[Planning] Using fallback plan:`, planData);
  }

  // Ensure all required fields are present and valid
  const researchPlan: ResearchPlan = {
    scope: {
      timeWindow: (planData.timeWindow && planData.timeWindow !== "null") ? planData.timeWindow : "this week",
      region: (planData.region && planData.region !== "null" && planData.region !== "") ? planData.region : undefined,
      domain: (planData.domain && planData.domain !== "null") ? planData.domain : state.userQuery.substring(0, 100),
    },
    tools: (planData.tools && Array.isArray(planData.tools) && planData.tools.length > 0) ? planData.tools : ["web_search"],
    platforms: (planData.platforms && Array.isArray(planData.platforms) && planData.platforms.length > 0) 
      ? planData.platforms.map((p: string) => normalizePlatformName(p))
      : ["LinkedIn", "X"],
  };

  // Final validation
  if (!researchPlan.scope.domain || researchPlan.scope.domain.trim().length === 0) {
    researchPlan.scope.domain = state.userQuery.substring(0, 100) || "trending topics";
    console.warn("[Planning] Domain was empty, using user query");
  }

  if (!researchPlan.scope.timeWindow || researchPlan.scope.timeWindow.trim().length === 0) {
    researchPlan.scope.timeWindow = "this week";
    console.warn("[Planning] TimeWindow was empty, using default");
  }

  console.log(`[Planning] Final research plan:`, {
    domain: researchPlan.scope.domain,
    timeWindow: researchPlan.scope.timeWindow,
    region: researchPlan.scope.region || "none",
    tools: researchPlan.tools,
    platforms: researchPlan.platforms,
  });

  return {
    researchPlan,
    platforms: researchPlan.platforms, // Set platforms in state from research plan
    step: "researching",
    messages: [
      ...state.messages,
      {
        role: "assistant",
        content: `Planning research for: ${researchPlan.scope.domain} (${researchPlan.scope.timeWindow}${researchPlan.scope.region ? `, ${researchPlan.scope.region}` : ''}) - Platforms: ${researchPlan.platforms?.join(", ") || "LinkedIn, X"}`,
        timestamp: Date.now(),
      },
    ],
  };
}

/**
 * Node 2: Trend Retrieval
 * Fetches trends using MCP tools, streams partial results incrementally
 */
export async function trendRetrievalNode(state: AgentState): Promise<Partial<AgentState>> {
  if (!state.researchPlan) {
    throw new Error("Research plan not found");
  }

  const { scope } = state.researchPlan;
  
  // Validate scope has required fields
  if (!scope.domain || !scope.timeWindow) {
    throw new Error(`Invalid research plan: missing domain (${scope.domain}) or timeWindow (${scope.timeWindow})`);
  }

  // Build search query
  const queryParts = [scope.domain, scope.timeWindow];
  if (scope.region) {
    queryParts.push(scope.region);
  }
  const query = queryParts.join(" ").trim();

  if (!query || query.length < 3) {
    throw new Error(`Invalid search query: "${query}" is too short or empty`);
  }

  console.log(`[Trend Retrieval] Searching for: "${query}" (timeWindow: ${scope.timeWindow})`);

  // Check if callback is stored in state (set by executeAgent wrapper)
  // Note: This is a temporary property not in AgentState, so we need to access it carefully
  interface StateWithCallbacks extends AgentState {
    __onTrendFound?: (trend: Trend, allTrendsSoFar: Trend[]) => void | Promise<void>;
  }
  const onTrendFound = (state as unknown as StateWithCallbacks).__onTrendFound;

  try {
    // Target: 5-10 trends with confidence >= 0.65 (65%)
    const MIN_HIGH_CONFIDENCE_TRENDS = 5;
    const MAX_HIGH_CONFIDENCE_TRENDS = 10;
    const CONFIDENCE_THRESHOLD = 0.65;
    
    // Generate base query variations
    const baseQueryVariations = [
      query, // Original query
      `${scope.domain} trends ${scope.timeWindow}`, // Simplified format
      scope.region ? `${scope.domain} ${scope.region} ${scope.timeWindow}` : null, // With region emphasis
      `latest ${scope.domain} ${scope.timeWindow}`, // Latest emphasis
      `${scope.domain} news ${scope.timeWindow}`, // News emphasis
      `top ${scope.domain} ${scope.timeWindow}`, // Top emphasis
    ].filter((q): q is string => q !== null && q.length > 3);
    
    // Additional query variations for extended search
    const extendedQueryVariations = [
      `${scope.domain} developments ${scope.timeWindow}`,
      `${scope.domain} updates ${scope.timeWindow}`,
      `${scope.domain} insights ${scope.timeWindow}`,
      `emerging ${scope.domain} ${scope.timeWindow}`,
      `${scope.domain} analysis ${scope.timeWindow}`,
      scope.region ? `latest ${scope.domain} ${scope.region} ${scope.timeWindow}` : null,
      scope.region ? `top ${scope.domain} ${scope.region} ${scope.timeWindow}` : null,
    ].filter((q): q is string => q !== null && q.length > 3);
    
    // Combine all query variations
    const allQueryVariations = [...baseQueryVariations, ...extendedQueryVariations];
    
    console.log(`[Trend Retrieval] Will search until we have ${MIN_HIGH_CONFIDENCE_TRENDS}-${MAX_HIGH_CONFIDENCE_TRENDS} trends with confidence >= ${CONFIDENCE_THRESHOLD * 100}% OR reach 50 searches`);
    
    // Fetch trends using MCP incrementally, keep searching until we have enough high-confidence trends or reach 50 searches
    let allTrends: Trend[] = [];
    let queryIndex = 0;
    const maxSearchAttempts = 50; // Maximum searches before reaching checkpoint
    let searchAttempts = 0;
    
    while (searchAttempts < maxSearchAttempts) {
      // Deduplicate trends first, then count high-confidence trends (don't count duplicates)
      const uniqueTrendsSoFar = deduplicateTrends(allTrends);
      const highConfidenceTrends = uniqueTrendsSoFar.filter(
        t => (t.confidence || 0) >= CONFIDENCE_THRESHOLD
      );
      
      // Stop if we have 5-10 unique high-confidence trends
      if (highConfidenceTrends.length >= MIN_HIGH_CONFIDENCE_TRENDS && 
          highConfidenceTrends.length <= MAX_HIGH_CONFIDENCE_TRENDS) {
        console.log(`[Trend Retrieval] Found ${highConfidenceTrends.length} unique high-confidence trends (target reached), stopping search and proceeding to checkpoint`);
        break;
      }
      
      // Stop if we exceed max (shouldn't happen, but safety check)
      if (highConfidenceTrends.length > MAX_HIGH_CONFIDENCE_TRENDS) {
        console.log(`[Trend Retrieval] Found ${highConfidenceTrends.length} unique high-confidence trends (exceeds max), stopping search and proceeding to checkpoint`);
        break;
      }
      
      // Cycle through query variations (reuse queries if we need more searches)
      const currentQuery = allQueryVariations[queryIndex % allQueryVariations.length];
      console.log(`[Trend Retrieval] Search attempt ${searchAttempts + 1}/${maxSearchAttempts}: "${currentQuery}" (${highConfidenceTrends.length} unique high-confidence/${MIN_HIGH_CONFIDENCE_TRENDS}-${MAX_HIGH_CONFIDENCE_TRENDS} target)`);
      
      try {
        const persona = state.userPersona || "";
        const trends = await fetchTrendsIncremental(
          currentQuery,
          scope.timeWindow,
          onTrendFound,
          scope.domain,
          persona
        );
        
        if (trends && trends.length > 0) {
          // Print confidence scores for each trend found
          console.log(`[Trend Retrieval] Confidence scores for trends from query "${currentQuery}":`);
          trends.forEach((trend, index) => {
            const conf = (trend.confidence || 0) * 100;
            const status = conf >= CONFIDENCE_THRESHOLD * 100 ? '✓' : '✗';
            console.log(`  ${status} [${index + 1}] ${conf.toFixed(1)}% - "${trend.title.substring(0, 50)}${trend.title.length > 50 ? '...' : ''}"`);
          });
          
          // Add new trends to collection
          allTrends.push(...trends);
          
          // Deduplicate all trends, then filter to high-confidence (don't count duplicates)
          const uniqueAllTrends = deduplicateTrends(allTrends);
          const allHighConfTrends = uniqueAllTrends.filter(
            t => (t.confidence || 0) >= CONFIDENCE_THRESHOLD
          );
          
          // Send all unique high-confidence trends found so far to frontend after each search
          if (allHighConfTrends.length > 0 && onTrendFound) {
            // Send the latest high-confidence trend to trigger callback, but pass all high-confidence trends
            const latestHighConfTrend = allHighConfTrends[allHighConfTrends.length - 1];
            await onTrendFound(latestHighConfTrend, allHighConfTrends);
          }
          
          // Count unique trends from this search (deduplicate against all trends)
          const uniqueTrendsFromThisSearch = deduplicateTrends(trends);
          const highConfFromThisSearch = uniqueTrendsFromThisSearch.filter(
            t => (t.confidence || 0) >= CONFIDENCE_THRESHOLD
          );
          
          // Calculate how many are actually new (not duplicates)
          const existingUrls = new Set(uniqueAllTrends.slice(0, -highConfFromThisSearch.length).flatMap(t => t.sources.map(s => s.url.toLowerCase())));
          const newTrendsCount = highConfFromThisSearch.filter(t => 
            !t.sources.some(s => existingUrls.has(s.url.toLowerCase()))
          ).length;
          
          console.log(`[Trend Retrieval] Found ${trends.length} trend(s) from query "${currentQuery}" (${highConfFromThisSearch.length} unique high-confidence, ${newTrendsCount} new, ${allHighConfTrends.length} total unique high-confidence)`);
        }
      } catch (error) {
        console.warn(`[Trend Retrieval] Query "${currentQuery}" failed:`, error instanceof Error ? error.message : String(error));
        // Continue to next query variation
      }
      
      // Cycle through query variations and increment search counter
      queryIndex++;
      searchAttempts++;
      
      // Small delay between searches to avoid rate limiting
      if (searchAttempts < maxSearchAttempts) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
    
    // Log final status
    const finalHighConfidenceTrends = allTrends.filter(
      t => (t.confidence || 0) >= CONFIDENCE_THRESHOLD
    );
    
    if (searchAttempts >= maxSearchAttempts) {
      console.log(`[Trend Retrieval] Reached ${maxSearchAttempts} search attempts. Found ${finalHighConfidenceTrends.length} high-confidence trends. Proceeding to checkpoint.`);
    }

    // Deduplicate trends by URL and title similarity
    const uniqueTrends = deduplicateTrends(allTrends);
    
    // Filter to ONLY high-confidence trends (>= 0.65) - remove anything below 65%
    // Note: uniqueTrends is already deduplicated, so counts don't include duplicates
    const highConfidenceTrends = uniqueTrends.filter(
      t => (t.confidence || 0) >= CONFIDENCE_THRESHOLD
    );

    if (highConfidenceTrends.length === 0) {
      console.warn(`[Trend Retrieval] No unique high-confidence trends found for any query variation`);
      return {
        trends: [],
        step: "synthesizing",
        error: `No high-confidence trends (≥65%) found for "${scope.domain}". Try broadening your search terms, adjusting the time window, or refining your query.`,
        messages: [
          ...state.messages,
          {
            role: "assistant",
            content: `No high-confidence trends found for "${scope.domain}". Try refining your search query or adjusting the time window.`,
            timestamp: Date.now(),
          },
        ],
      };
    }
    
    // If we don't have enough high-confidence trends, log a warning but continue with what we have
    if (highConfidenceTrends.length < MIN_HIGH_CONFIDENCE_TRENDS) {
      console.warn(`[Trend Retrieval] Only found ${highConfidenceTrends.length} unique high-confidence trends (target: ${MIN_HIGH_CONFIDENCE_TRENDS}-${MAX_HIGH_CONFIDENCE_TRENDS}). Using available high-confidence trends.`);
    }

    const duplicatesRemoved = allTrends.length - uniqueTrends.length;
    console.log(`[Trend Retrieval] Found ${uniqueTrends.length} unique trend(s) from ${allTrends.length} total result(s) (removed ${duplicatesRemoved} duplicate${duplicatesRemoved !== 1 ? 's' : ''})`);
    console.log(`[Trend Retrieval] Unique high-confidence trends (>= ${CONFIDENCE_THRESHOLD * 100}%): ${highConfidenceTrends.length}`);
    console.log(`[Trend Retrieval] Removed ${uniqueTrends.length - highConfidenceTrends.length} trend(s) below ${CONFIDENCE_THRESHOLD * 100}% confidence`);
    
    // Print final confidence scores for all high-confidence trends
    console.log(`[Trend Retrieval] Final high-confidence trends with confidence scores:`);
    highConfidenceTrends.forEach((trend, index) => {
      const conf = (trend.confidence || 0) * 100;
      console.log(`  [${index + 1}] ${conf.toFixed(1)}% - "${trend.title}"`);
    });

    // Use only high-confidence trends, limit to MAX_HIGH_CONFIDENCE_TRENDS
    const trendsToUse = highConfidenceTrends.slice(0, MAX_HIGH_CONFIDENCE_TRENDS);

    // Sort by confidence before passing to synthesis
    const sortedTrends = trendsToUse.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));

    const highConfCount = sortedTrends.length; // All trends are high-confidence now
    const searchStatus = searchAttempts >= maxSearchAttempts 
      ? `Completed ${maxSearchAttempts} searches`
      : `Found target range (${highConfCount} trends)`;
    
    return {
      trends: sortedTrends,
      step: "synthesizing",
      messages: [
        ...state.messages,
        {
          role: "assistant",
          content: `${searchStatus}. Found ${sortedTrends.length} unique high-confidence trend${sortedTrends.length !== 1 ? 's' : ''} (≥65%) related to ${scope.domain}. Analyzing and ranking...`,
          timestamp: Date.now(),
        },
      ],
    };
  } catch (error) {
    console.error("[Trend Retrieval] Error fetching trends:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error occurred while fetching trends";
    
    return {
      trends: [],
      step: "complete",
      error: `Failed to fetch trends: ${errorMessage}. Please check your MCP server configuration and try again.`,
      messages: [
        ...state.messages,
        {
          role: "assistant",
          content: `Error: ${errorMessage}. Please check your MCP server setup and ensure MCP_SERVER_COMMAND is configured correctly.`,
          timestamp: Date.now(),
        },
      ],
    };
  }
}

/**
 * Calculate similarity between two titles (0-1)
 */
function calculateTitleSimilarity(title1: string, title2: string): number {
  const t1 = title1.toLowerCase().trim();
  const t2 = title2.toLowerCase().trim();
  
  if (t1 === t2) return 1.0;
  
  // Word overlap
  const words1 = new Set(t1.split(/\s+/).filter(w => w.length > 3));
  const words2 = new Set(t2.split(/\s+/).filter(w => w.length > 3));
  const intersection = new Set([...words1].filter(w => words2.has(w)));
  const union = new Set([...words1, ...words2]);
  
  if (union.size === 0) return 0;
  
  const wordOverlap = intersection.size / union.size;
  
  // Substring match
  const minLen = Math.min(t1.length, t2.length);
  const maxLen = Math.max(t1.length, t2.length);
  let substringMatch = 0;
  
  if (minLen >= 10) {
    const shorter = t1.length < t2.length ? t1 : t2;
    const longer = t1.length >= t2.length ? t1 : t2;
    if (longer.includes(shorter.substring(0, Math.min(20, shorter.length)))) {
      substringMatch = 0.3;
    }
  }
  
  return Math.min(1.0, wordOverlap * 0.7 + substringMatch);
}

/**
 * Merge sources from similar trends to provide multiple citations
 */
function mergeSourcesFromSimilarTrends(trends: Trend[]): Trend[] {
  const merged: Trend[] = [];
  const processed = new Set<number>();
  
  for (let i = 0; i < trends.length; i++) {
    if (processed.has(i)) continue;
    
    const trend = trends[i];
    const similarTrends: Trend[] = [trend];
    const allSources = new Map<string, typeof trend.sources[0]>();
    
    // Add sources from current trend
    trend.sources.forEach(source => {
      allSources.set(source.url.toLowerCase(), source);
    });
    
    // Find similar trends and merge their sources
    for (let j = i + 1; j < trends.length; j++) {
      if (processed.has(j)) continue;
      
      const otherTrend = trends[j];
      const similarity = calculateTitleSimilarity(trend.title, otherTrend.title);
      
      // If titles are similar (>= 60% similarity), merge sources
      if (similarity >= 0.6) {
        similarTrends.push(otherTrend);
        processed.add(j);
        
        // Merge sources from similar trend
        otherTrend.sources.forEach(source => {
          const urlKey = source.url.toLowerCase();
          if (!allSources.has(urlKey)) {
            allSources.set(urlKey, source);
          }
        });
      }
    }
    
    // Use the trend with highest confidence, but with all merged sources
    const bestTrend = similarTrends.reduce((best, current) => 
      (current.confidence || 0) > (best.confidence || 0) ? current : best
    );
    
    merged.push({
      ...bestTrend,
      sources: Array.from(allSources.values()),
    });
    
    processed.add(i);
  }
  
  return merged;
}

/**
 * Deduplicate trends by URL and title similarity, merging sources from similar trends
 */
function deduplicateTrends(trends: Trend[]): Trend[] {
  const seen = new Set<string>();
  const unique: Trend[] = [];
  
  for (const trend of trends) {
    // Create a unique key from URL (most reliable) and title
    const url = trend.sources?.[0]?.url || "";
    const title = trend.title || "";
    const key = url.toLowerCase() || title.toLowerCase().substring(0, 50);
    
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(trend);
    } else {
      // If duplicate found, merge sources and keep the one with higher confidence
      const existing = unique.find(t => {
        const tUrl = t.sources?.[0]?.url || "";
        const tTitle = t.title || "";
        return (tUrl.toLowerCase() === url.toLowerCase() && url) || 
               (tTitle.toLowerCase() === title.toLowerCase() && !url);
      });
      
      if (existing) {
        // Merge sources from both trends (avoid duplicates)
        const existingUrls = new Set(existing.sources.map(s => s.url.toLowerCase()));
        const newSources = trend.sources.filter(s => !existingUrls.has(s.url.toLowerCase()));
        
        // Merge sources, keeping existing ones first, then adding new unique ones
        const mergedSources = [...existing.sources, ...newSources];
        
        // Keep the trend with higher confidence, but use merged sources
        if ((trend.confidence || 0) > (existing.confidence || 0)) {
          const index = unique.indexOf(existing);
          unique[index] = {
            ...trend,
            sources: mergedSources, // Use merged sources
          };
        } else {
          // Update existing with merged sources
          const index = unique.indexOf(existing);
          unique[index] = {
            ...existing,
            sources: mergedSources, // Use merged sources
          };
        }
      }
    }
  }
  
  // After deduplication, merge sources from similar trends
  return mergeSourcesFromSimilarTrends(unique);
}

/**
 * Node 3: Synthesis
 * Ranks and formats trends, enhances "why it matters" with LLM, calculates confidence
 */
export async function synthesisNode(state: AgentState): Promise<Partial<AgentState>> {
  if (!state.trends || state.trends.length === 0) {
    return {
      error: "No trends found",
      step: "complete",
    };
  }

  const persona = state.userPersona || "";
  const systemPrompt = `${getGalliumAIBrandPrompt(persona)}
  
  ${getTrendSynthesisPrompt(persona)}`;

  // Build comprehensive trend context for LLM
  const trendsText = state.trends
    .map(
      (t, i) =>
        `${i + 1}. TITLE: ${t.title}\n   SUMMARY: ${t.summary}\n   SOURCES: ${t.sources.map((s) => s.url).join(", ")}\n   CURRENT CONFIDENCE: ${t.confidence}\n   WHY IT MATTERS (current): ${t.whyItMatters || "Not set"}`
    )
    .join("\n\n");

  // Determine max trends to return (don't ask for more than we have)
  const maxTrends = Math.min(state.trends.length, 10);
  const minTrends = Math.min(state.trends.length, 5);
  
  const messages = [
    new SystemMessage(systemPrompt),
    new HumanMessage(`Analyze and rank these ${state.trends.length} trend${state.trends.length !== 1 ? 's' : ''} for marketing teams:\n\n${trendsText}\n\nFocus on:
- Which trends are most actionable for content creators and marketers?
- Which have the strongest evidence and recency?
- Which are most relevant to growth and engagement?

Return ${state.trends.length <= 5 ? `all ${state.trends.length}` : `top ${minTrends}-${maxTrends}`} trend${state.trends.length !== 1 ? 's' : ''} ranked by relevance and impact. ${state.trends.length > 10 ? 'Limit to the top 10 most actionable trends.' : 'Include all trends if they are relevant.'} Prioritize trends with concrete data, recent sources, and clear marketing applications.

IMPORTANT: Only return trends that match the titles provided above. Do not create new trends. Return exactly ${state.trends.length <= 10 ? state.trends.length : maxTrends} trend${(state.trends.length <= 10 ? state.trends.length : maxTrends) !== 1 ? 's' : ''} or fewer.`),
  ];

  try {
    const response = await llm.invoke(messages);
    const content = response.content as string;

    // Parse LLM response - be more robust with JSON extraction
    // Type for ranked trend from LLM (before mapping to Trend)
    interface RankedTrendFromLLM {
      title?: string;
      summary?: string;
      whyItMatters?: string;
      confidence?: number;
    }
    let rankedTrends: RankedTrendFromLLM[];
    try {
      let jsonStr = content.trim();
      
      // Strategy 1: Try to extract JSON array from markdown code blocks
      const jsonBlockMatch = content.match(/```json\n([\s\S]*?)\n```/i) || content.match(/```\n([\s\S]*?)\n```/i);
      if (jsonBlockMatch) {
        jsonStr = jsonBlockMatch[1].trim();
      } else {
        // Strategy 2: Find the first [ and last ] that contain valid JSON
        // This handles cases where LLM adds explanatory text before/after
        const firstBracket = content.indexOf('[');
        const lastBracket = content.lastIndexOf(']');
        
        if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
          // Extract everything between first [ and last ]
          jsonStr = content.substring(firstBracket, lastBracket + 1).trim();
        } else {
          // Strategy 3: Try regex to find JSON array
          const arrayMatch = content.match(/\[[\s\S]*\]/);
          if (arrayMatch) {
            jsonStr = arrayMatch[0];
          } else {
            throw new Error("No JSON array found in response");
          }
        }
      }
      
      // Try to parse the extracted JSON
      rankedTrends = JSON.parse(jsonStr) as RankedTrendFromLLM[];
      
      if (!Array.isArray(rankedTrends)) {
        throw new Error("Response is not an array");
      }
      
      // Validate that we have at least one trend with required fields
      if (rankedTrends.length === 0) {
        throw new Error("Empty array returned");
      }
      
      if (!rankedTrends[0] || typeof rankedTrends[0] !== 'object' || !rankedTrends[0].title) {
        throw new Error("Invalid trend structure - missing title field");
      }
      
      console.log(`[Synthesis] Successfully parsed ${rankedTrends.length} trends from LLM`);
    } catch (e) {
      console.warn("[Synthesis] Failed to parse LLM response, using original trends:", e);
      console.warn("[Synthesis] Raw response (first 500 chars):", content.substring(0, 500));
      // Fallback: use original trends but still rank by confidence
      rankedTrends = state.trends
        .map((t) => ({
          title: t.title,
          summary: t.summary,
          whyItMatters: t.whyItMatters,
          confidence: t.confidence,
        }))
        .sort((a, b) => b.confidence - a.confidence);
    }

    // Merge LLM-enhanced data with original sources (match by title similarity)
    // Limit to the number of original trends (don't create more than we started with)
    const maxTrendsToReturn = Math.min(state.trends.length, 10);
    const synthesizedTrends: Trend[] = rankedTrends
      .slice(0, maxTrendsToReturn) // Limit to original count or 10, whichever is smaller
      .map((ranked: RankedTrendFromLLM, index: number): Trend | undefined => {
        // Try to match by exact title first
        let original = state.trends!.find((t) => 
          t.title.toLowerCase().trim() === ranked.title?.toLowerCase()?.trim()
        );
        
        // If no exact match, try fuzzy matching (similarity)
        if (!original && ranked.title) {
          const rankedTitleLower = ranked.title.toLowerCase().trim();
          
          // Try substring matches
          original = state.trends!.find((t) => {
            const tTitleLower = t.title.toLowerCase().trim();
            // Check if either title contains the other (min 15 chars overlap)
            const minLength = Math.min(rankedTitleLower.length, tTitleLower.length);
            if (minLength >= 15) {
              return tTitleLower.includes(rankedTitleLower.substring(0, Math.min(30, rankedTitleLower.length))) ||
                     rankedTitleLower.includes(tTitleLower.substring(0, Math.min(30, tTitleLower.length)));
            }
            return false;
          });
        }
        
        // If still no match, use index-based matching (LLM should maintain order)
        if (!original && index < state.trends!.length) {
          original = state.trends![index];
        }
        
        // Last resort: find by best match score
        if (!original && ranked.title) {
          original = findBestTrendMatch(ranked.title, state.trends!);
        }
        
        // Ensure we have an original trend - if not, skip this trend
        if (!original) {
          console.warn(`[Synthesis] Could not match ranked trend "${ranked.title}" to any original trend, skipping`);
          return undefined;
        }
        
        // Try to find additional sources from other similar trends
        let mergedSources = original.sources || [];
        if (mergedSources.length < 3) {
          // Look for similar trends to merge sources
          const similarTrends = state.trends!.filter(t => {
            if (t.title === original.title) return false; // Skip self
            const similarity = calculateTitleSimilarity(original.title, t.title);
            return similarity >= 0.5; // 50% similarity threshold
          });
          
          // Merge sources from similar trends (up to 3-4 total sources)
          const sourceUrls = new Set(mergedSources.map(s => s.url.toLowerCase()));
          for (const similarTrend of similarTrends) {
            if (mergedSources.length >= 4) break; // Limit to 4 sources max
            for (const source of similarTrend.sources || []) {
              if (!sourceUrls.has(source.url.toLowerCase())) {
                mergedSources.push(source);
                sourceUrls.add(source.url.toLowerCase());
                if (mergedSources.length >= 4) break;
              }
            }
          }
        }
        
        return {
          title: ranked.title || original.title,
          summary: (ranked.summary || original.summary).substring(0, 250).trim(), // Limit summary length
          whyItMatters: (ranked.whyItMatters || original.whyItMatters || "This trend is significant for marketing teams.").substring(0, 300).trim(), // Limit length
          sources: mergedSources, // Use merged sources (multiple when available)
          confidence: typeof ranked.confidence === 'number' && ranked.confidence >= 0 && ranked.confidence <= 1 
            ? ranked.confidence 
            : Math.max(0, Math.min(1, original.confidence || 0.5)), // Clamp confidence to 0-1
        };
      })
      .filter((t): t is Trend => t !== null && t !== undefined && !!t?.title && !!t?.summary);

    // Final deduplication pass to ensure no duplicates in synthesized results
    const finalSynthesizedTrends = deduplicateTrends(synthesizedTrends);
    
    if (finalSynthesizedTrends.length < synthesizedTrends.length) {
      console.log(`[Synthesis] Removed ${synthesizedTrends.length - finalSynthesizedTrends.length} duplicate trend(s) from synthesis results`);
    }

    console.log(`[Synthesis] Processed ${finalSynthesizedTrends.length} unique trend${finalSynthesizedTrends.length !== 1 ? 's' : ''} from ${state.trends.length} original trend${state.trends.length !== 1 ? 's' : ''}`);
    console.log(`[Synthesis] Returning ${finalSynthesizedTrends.length} unique trend${finalSynthesizedTrends.length !== 1 ? 's' : ''} and moving to checkpoint`);

    // Return synthesis results - checkpoint node will set checkpointStatus
    return {
      trends: finalSynthesizedTrends,
      researchComplete: true,
      approvedTrends: finalSynthesizedTrends, // Pre-populate for checkpoint
      messages: [
        ...state.messages,
        {
          role: "assistant",
          content: `Synthesized ${finalSynthesizedTrends.length} unique top trend${finalSynthesizedTrends.length !== 1 ? 's' : ''}. Ready for review.`,
          timestamp: Date.now(),
        },
      ],
    };
  } catch (error) {
    console.error("[Synthesis] Error:", error);
    // Fallback: use original trends sorted by confidence, but deduplicate first
    const uniqueTrends = deduplicateTrends(state.trends);
    const sortedTrends = uniqueTrends.sort((a, b) => b.confidence - a.confidence);
    const trendsToReturn = sortedTrends.slice(0, Math.min(uniqueTrends.length, 10));
    return {
      trends: trendsToReturn,
      researchComplete: true,
      approvedTrends: trendsToReturn,
      error: error instanceof Error ? error.message : "Synthesis failed",
      messages: [
        ...state.messages,
        {
          role: "assistant",
          content: `Processed ${trendsToReturn.length} unique trend${trendsToReturn.length !== 1 ? 's' : ''}. Ready for review.`,
          timestamp: Date.now(),
        },
      ],
    };
  }
}

/**
 * Find best matching trend by title similarity
 */
function findBestTrendMatch(targetTitle: string, trends: Trend[]): Trend | undefined {
  if (!targetTitle || trends.length === 0) return undefined;
  
  const targetLower = targetTitle.toLowerCase().trim();
  let bestMatch: Trend | undefined = undefined;
  let bestScore = 0;
  
  for (const trend of trends) {
    const trendLower = trend.title.toLowerCase().trim();
    
    // Exact match
    if (trendLower === targetLower) {
      return trend;
    }
    
    // Calculate similarity score
    let score = 0;
    
    // Check for shared words (weighted)
    const targetWords = targetLower.split(/\s+/);
    const trendWords = trendLower.split(/\s+/);
    const sharedWords = targetWords.filter(w => w.length > 3 && trendWords.includes(w));
    score += sharedWords.length * 0.3;
    
    // Check for substring matches
    const minLength = Math.min(targetLower.length, trendLower.length);
    if (minLength >= 10) {
      if (targetLower.includes(trendLower.substring(0, Math.min(20, trendLower.length)))) score += 0.5;
      if (trendLower.includes(targetLower.substring(0, Math.min(20, targetLower.length)))) score += 0.5;
    }
    
    // Prefer longer matches
    const overlap = Math.min(targetLower.length, trendLower.length);
    score += overlap / 100;
    
    if (score > bestScore) {
      bestScore = score;
      bestMatch = trend;
    }
  }
  
  // Only return if score is reasonable (at least some similarity)
  return bestScore > 0.3 ? bestMatch : undefined;
}

/**
 * Node 4: HITL Checkpoint
 * Waits for user approval (handled externally via Convex)
 */
export function hitlCheckpointNode(state: AgentState): Partial<AgentState> {
  // This node marks that we're at checkpoint
  // Actual approval is handled via Convex mutations from frontend
  console.log(`[Checkpoint] Setting checkpoint status to pending with ${state.trends?.length || 0} trends`);
  
  return {
    step: "checkpoint",
    checkpointStatus: "pending",
    approvedTrends: state.approvedTrends || state.trends || [], // Use approvedTrends from synthesis if available
  };
}

/**
 * Node 5: Content Generation Sub-Agent
 * Generates platform-specific content ideas
 */
export async function contentGenerationNode(state: AgentState): Promise<Partial<AgentState>> {
  // Check if callback is stored in state (set by wrapper function)
  // Note: This is a temporary property not in AgentState, so we need to access it carefully
  interface StateWithCallbacks extends AgentState {
    __onPlatformComplete?: (platform: string, ideas: ContentIdea[]) => void;
  }
  const onPlatformComplete = (state as unknown as StateWithCallbacks).__onPlatformComplete;
  
  if (!state.approvedTrends || state.approvedTrends.length === 0) {
    throw new Error("No approved trends for content generation");
  }

  const platforms = (state.platforms || MAIN_PLATFORMS as unknown as string[]).map(p => normalizePlatformName(p));
  const contentIdeas: Record<string, ContentIdea[]> = {};

  const persona = state.userPersona || "";
  const brandPrompt = getGalliumAIBrandPrompt(persona);

  console.log(`[Content Generation] Starting generation for ${platforms.length} platform(s): ${platforms.join(", ")}`);

  for (const platform of platforms) {
    try {
      const platformPrompt = getContentGenerationPrompt(platform, persona);
      
      const trendsText = state.approvedTrends
        .map(
          (t, i) =>
            `${i + 1}. TITLE: ${t.title}\n   SUMMARY: ${t.summary}\n   WHY IT MATTERS: ${t.whyItMatters}\n   SOURCES (citations):\n${t.sources.map((s, idx) => `      ${idx + 1}. ${s.url}${s.timestamp ? ` (${new Date(s.timestamp).toLocaleDateString()})` : ''}${s.snippet ? `\n         "${s.snippet}"` : ''}`).join('\n')}`
        )
        .join("\n\n");

      // Build comprehensive system message with brand context and persona
      const systemMessage = `${brandPrompt}

${platformPrompt}

Context:
- User persona: ${persona}
- Brand: Gallium AI (AI-native operating system for marketing)
- Goal: Generate actionable, platform-optimized content ideas that drive engagement

Requirements:
- Each idea must be directly tied to one of the approved trends
- Hooks must be attention-grabbing and align with Gallium AI's voice (sharp, opinionated, no fluff)
- Ideas must be immediately actionable for the specified persona
- Reference specific data or insights from the trends when possible`;

      const userMessage = `Generate 5-10 platform-specific content ideas for ${platform} based on these ${state.approvedTrends.length} approved trends.

APPROVED TRENDS WITH CITATIONS:
${trendsText}

For EACH content idea, you MUST provide ALL of the following fields:

1. hook: Attention-grabbing opening line (Gallium AI voice: sharp, opinionated, no corporate fluff)
   - Must capture attention in first 3-5 words
   - Should be provocative or data-driven
   - Example: "Most marketers are doing this wrong. Here's the data."

2. format: Specific post type for ${platform}
   - LinkedIn: "LinkedIn post (600-1300 chars)", "LinkedIn carousel (8-10 slides)", "LinkedIn article"
   - X: "X thread (5-7 tweets)", "Single tweet (under 280 chars)", "Quote tweet"
   - TikTok: "TikTok script (30-60s)", "TikTok hook + concept"
   - Instagram: "Instagram Reel (15-90s)", "Carousel post (5-10 slides)", "Instagram Story sequence"

3. angle: Why this will work for ${persona}
   - Reference specific data, insights, or patterns from the trend
   - Explain the psychological/engagement hook
   - Be concrete: "This works because [specific reason]"

4. trendReference: Exact trend TITLE this idea maps to
   - Must match one of the trend titles above EXACTLY (case-sensitive)
   - This links the idea to the research trend

5. description: What to say/do (concrete, actionable, 2-3 sentences)
   - Specific talking points
   - Key data points to include
   - Call-to-action or engagement strategy
   - Example: "Start with the hook, then share [specific stat]. Include a personal anecdote about [topic]. End with a question that sparks discussion."

6. variants: 2-3 alternative approaches or angles (HIGHLY RECOMMENDED)
   - Different hooks for the same trend
   - Alternative formats or angles
   - A/B test options

CITATION REFERENCE:
- Each idea must reference the trend it maps to (via trendReference field)
- The trend includes source URLs and timestamps for citation
- When describing the idea, you can reference specific sources from the trend's source list

CRITICAL FORMATTING: 
- Respond with ONLY a valid JSON array
- No explanations, no markdown code blocks, no text before or after
- Start with [ and end with ]
- Each idea must be a complete object with ALL required fields
- Example structure:
[
  {
    "hook": "Most creators are leaving money on the table. Here's why.",
    "format": "LinkedIn post (600-1300 chars)",
    "angle": "This works because it addresses a pain point with concrete data from recent research showing 73% of creators under-monetize",
    "trendReference": "Creator Monetization Trends Q4 2024",
    "description": "Start with the hook, then share the 73% statistic. Include a breakdown of top monetization methods. End with a question asking readers what's worked for them.",
    "variants": [
      "Alternative hook: 'I analyzed 500 creators. Here's what the top 10% do differently.'",
      "Format variant: LinkedIn carousel with one stat per slide",
      "Angle variant: Focus on the psychological barrier (fear of selling) rather than the data"
    ]
  }
]`;

      const messages = [
        new SystemMessage(systemMessage),
        new HumanMessage(userMessage),
      ];

      console.log(`[Content Generation] Generating ideas for ${platform}...`);
      const response = await llm.invoke(messages);
      const content = response.content as string;

      // Parse ideas - robust JSON extraction
      // Type for idea from LLM (before mapping to ContentIdea)
      interface IdeaFromLLM {
        hook?: string;
        format?: string;
        angle?: string;
        trendReference?: string;
        description?: string;
        variants?: string[];
      }
      let ideas: IdeaFromLLM[];
      try {
        let jsonStr = content.trim();
        
        // Remove markdown code blocks if present
        const jsonBlockMatch = content.match(/```json\n([\s\S]*?)\n```/i) || content.match(/```\n([\s\S]*?)\n```/i);
        if (jsonBlockMatch) {
          jsonStr = jsonBlockMatch[1].trim();
        } else {
          // Find JSON array in text - look for first [ and last ]
          const firstBracket = content.indexOf('[');
          const lastBracket = content.lastIndexOf(']');
          if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
            jsonStr = content.substring(firstBracket, lastBracket + 1);
          } else {
            // Try regex match as fallback
            const arrayMatch = content.match(/\[[\s\S]*\]/);
            if (arrayMatch) {
              jsonStr = arrayMatch[0];
            }
          }
        }
        
        ideas = JSON.parse(jsonStr) as IdeaFromLLM[];
        
        if (!Array.isArray(ideas)) {
          console.warn(`[Content Generation] Response is not an array, got:`, typeof ideas);
          ideas = [];
        }
      } catch (e) {
        console.error(`[Content Generation] Failed to parse content ideas for ${platform}:`, e);
        console.error(`[Content Generation] Raw response (first 500 chars):`, content.substring(0, 500));
        
        // If parsing failed, set empty array and continue with next platform
        console.warn(`[Content Generation] Skipping ${platform} due to parse error, continuing with other platforms...`);
        contentIdeas[platform] = [];
        continue; // Skip to next platform
      }

      // Validate and map trend references with citation info
      const trendTitles = state.approvedTrends.map(t => t.title);
      const trendMap = new Map(state.approvedTrends.map(t => [t.title, t]));
      
      const mappedIdeas: ContentIdea[] = ideas
        .filter(idea => idea.hook && idea.description && idea.format && idea.angle) // Validate all required fields
        .map((idea): ContentIdea => {
          // Match trend reference to actual trend title
          let trendRef = idea.trendReference || state.approvedTrends![0].title;
          let matchedTrend = trendMap.get(trendRef);
          
          if (!matchedTrend) {
            // Find closest match
            const match = trendTitles.find(title => 
              title.toLowerCase().includes(trendRef.toLowerCase().substring(0, 20)) ||
              trendRef.toLowerCase().includes(title.toLowerCase().substring(0, 20))
            );
            trendRef = match || state.approvedTrends![0].title;
            matchedTrend = trendMap.get(trendRef) || state.approvedTrends![0];
          }
          
          // Ensure all required fields are present with proper defaults
          return {
            hook: (idea.hook || "").trim() || "Missing hook",
            format: (idea.format || "").trim() || `${platform} post`,
            angle: (idea.angle || "").trim() || "High engagement potential based on trend data",
            trendReference: trendRef, // Exact trend title for citation
            description: (idea.description || "").trim() || "Content idea based on approved trend",
            variants: Array.isArray(idea.variants) ? idea.variants.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).slice(0, 3) : [], // Limit to 3 variants, filter empty
          };
        })
        .filter(idea => idea.hook !== "Missing hook" && idea.description !== "Content idea based on approved trend"); // Remove invalid ideas

      contentIdeas[platform] = mappedIdeas;
      console.log(`[Content Generation] Generated ${mappedIdeas.length} ideas for ${platform}`);
      
      // Call callback immediately after generating ideas for this platform (incremental updates)
      if (onPlatformComplete && mappedIdeas.length > 0) {
        onPlatformComplete(platform, mappedIdeas);
      }
    } catch (error) {
      console.error(`[Content Generation] Error generating ideas for ${platform}:`, error);
      contentIdeas[platform] = []; // Empty array on error, continue with other platforms
    }
  }

  const totalIdeas = Object.values(contentIdeas).reduce((sum, ideas) => sum + ideas.length, 0);
  const completedPlatforms = Object.keys(contentIdeas);
  
  console.log(`[Content Generation] Completed generation for ${completedPlatforms.length}/${platforms.length} platforms`);
  console.log(`[Content Generation] Platforms completed: ${completedPlatforms.join(", ")}`);
  console.log(`[Content Generation] Total ideas generated: ${totalIdeas}`);
  
  // Normalize platform names for comparison
  const normalizedExpected = new Set(platforms.map(p => normalizePlatformName(p)));
  const normalizedCompleted = new Set(completedPlatforms.map(p => normalizePlatformName(p)));
  
  // Check if all expected platforms have been processed (even if they returned empty arrays)
  const allPlatformsProcessed = platforms.length > 0 && 
    Array.from(normalizedExpected).every(p => {
      // Check if platform exists in completed (normalized)
      const found = Array.from(normalizedCompleted).some(completed => normalizePlatformName(completed) === p);
      // Or check if it exists in contentIdeas (by original key)
      const hasInContentIdeas = Object.keys(contentIdeas).some(key => normalizePlatformName(key) === p);
      return found || hasInContentIdeas || (contentIdeas[p]?.length === 0);
    });
  
  console.log(`[Content Generation] All platforms processed check: ${allPlatformsProcessed}`);
  console.log(`[Content Generation] Expected (normalized): ${Array.from(normalizedExpected).join(", ")}`);
  console.log(`[Content Generation] Completed (normalized): ${Array.from(normalizedCompleted).join(", ")}`);
  
  if (totalIdeas === 0 && !allPlatformsProcessed) {
    // Some platforms failed, but we might have partial results
    console.warn(`[Content Generation] No ideas generated, but ${completedPlatforms.length} platforms attempted`);
  }
  
  // Mark as complete if all platforms processed (even if some had errors or returned empty arrays)
  // We consider it complete when we've attempted all platforms
  const shouldComplete = allPlatformsProcessed;
  
  if (!shouldComplete && totalIdeas === 0) {
    console.error(`[Content Generation] Not all platforms processed. Expected: ${platforms.length}, Completed: ${completedPlatforms.length}`);
    return {
      error: "Failed to generate content ideas for all platforms. Please try again.",
      step: "complete", // Still mark as complete to not block the UI
      contentIdeas: contentIdeas, // Return what we have
      generationComplete: false,
      platforms: platforms,
      messages: [
        ...state.messages,
        {
          role: "assistant",
          content: "Unable to generate content ideas for all platforms. Please check logs for errors.",
          timestamp: Date.now(),
        },
      ],
    };
  }

  console.log(`[Content Generation] Marking generation as complete. Total ideas: ${totalIdeas}, Platforms: ${completedPlatforms.length}`);

  return {
    contentIdeas,
    generationComplete: true,
    step: "complete",
    platforms: platforms, // Ensure platforms are in returned state
    messages: [
      ...state.messages,
      {
        role: "assistant",
        content: `Generated ${totalIdeas} content ideas across ${completedPlatforms.length} platform(s). Check the sidebar to view them.`,
        timestamp: Date.now(),
      },
    ],
  };
}


