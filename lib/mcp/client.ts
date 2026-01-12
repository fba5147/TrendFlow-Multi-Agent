import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { llm } from "../llm";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { getGalliumAIBrandPrompt } from "../prompts";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { createHash } from "crypto";

// Initialize Convex client for caching (only if URL is available)
const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
const convex = convexUrl ? new ConvexHttpClient(convexUrl) : null;

interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  timestamp?: string;
}

// Global MCP client instance
let mcpClient: Client | null = null;
let mcpClientInitialized = false;

/**
 * Initialize MCP client connection
 * 
 * Connects to MCP server specified in environment variables
 */
export async function initializeMCPClient(): Promise<void> {
  if (mcpClientInitialized && mcpClient) {
    return;
  }

  const mcpServerCommand = process.env.MCP_SERVER_COMMAND;
  const mcpServerArgs = process.env.MCP_SERVER_ARGS 
    ? process.env.MCP_SERVER_ARGS.split(",").map(arg => arg.trim())
    : [];

  if (!mcpServerCommand) {
    throw new Error("MCP_SERVER_COMMAND is required. Please set it in .env");
  }

  try {
    console.log(`[MCP] Initializing client for server: ${mcpServerCommand}`);
    
    const transport = new StdioClientTransport({
      command: mcpServerCommand,
      args: mcpServerArgs.length > 0 ? mcpServerArgs : undefined,
      env: {
        ...process.env,
        ...(process.env.BRAVE_API_KEY && { BRAVE_API_KEY: process.env.BRAVE_API_KEY })
      },
    });

    mcpClient = new Client({
      name: "trend-research-client",
      version: "1.0.0",
    }, {
      capabilities: {
        tools: {},
      },
    });

    await mcpClient.connect(transport);
    
    // List available tools
    const tools = await mcpClient.listTools();
    console.log(`[MCP] Connected. Available tools: ${tools.tools.map(t => t.name).join(", ")}`);
    
    mcpClientInitialized = true;
  } catch (error) {
    console.error("[MCP] Failed to initialize client:", error);
    mcpClientInitialized = true;
    throw new Error(`Failed to initialize MCP client: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Call an MCP tool
 */
async function callMCPTool(toolName: string, args: Record<string, any>): Promise<any> {
  if (!mcpClient) {
    throw new Error("MCP client not initialized");
  }

  try {
    const result = await mcpClient.callTool({
      name: toolName,
      arguments: args,
    });

    if (result.isError) {
      throw new Error(`MCP tool error: ${JSON.stringify(result)}`);
    }

    return result.content;
  } catch (error) {
    console.error(`[MCP] Error calling tool ${toolName}:`, error);
    throw error;
  }
}

/**
 * Convert timeWindow string to Brave API freshness parameter
 * 
 * Brave API freshness values:
 * - pd: last 24 hours
 * - pw: last 7 days
 * - pm: last 31 days
 * - py: last 365 days
 * - YYYY-MM-DDtoYYYY-MM-DD: custom date range
 */
function convertTimeWindowToFreshness(timeWindow: string): string | undefined {
  if (!timeWindow) return undefined;
  
  const timeWindowLower = timeWindow.toLowerCase().trim();
  const now = new Date();
  
  // Exact matches for common time windows
  if (timeWindowLower.includes("today") || timeWindowLower.includes("last 24 hours") || 
      timeWindowLower === "now" || timeWindowLower.includes("past day")) {
    return "pd";
  }
  
  if (timeWindowLower.includes("this week") || timeWindowLower.includes("last week") || 
      timeWindowLower.includes("past week") || timeWindowLower.includes("7 days") ||
      timeWindowLower.includes("past 7 days")) {
    return "pw";
  }
  
  if (timeWindowLower.includes("this month") || timeWindowLower.includes("last month") || 
      timeWindowLower.includes("past month") || timeWindowLower.includes("30 days") ||
      timeWindowLower.includes("31 days") || timeWindowLower.includes("past 30 days")) {
    return "pm";
  }
  
  if (timeWindowLower.includes("this year") || timeWindowLower.includes("last year") || 
      timeWindowLower.includes("past year") || timeWindowLower.includes("365 days")) {
    return "py";
  }
  
  // Try to parse specific date ranges
  // Format: "YYYY-MM-DD to YYYY-MM-DD" or "YYYY-MM-DD - YYYY-MM-DD"
  const dateRangeMatch = timeWindowLower.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|-)\s*(\d{4}-\d{2}-\d{2})/);
  if (dateRangeMatch) {
    const startDate = dateRangeMatch[1];
    const endDate = dateRangeMatch[2];
    // Brave API format: YYYY-MM-DDtoYYYY-MM-DD (no spaces, "to" in lowercase)
    return `${startDate}to${endDate}`;
  }
  
  // Try to parse quarters (Q1 2024, Q2 2024, etc.)
  const quarterMatch = timeWindowLower.match(/\bq([1-4])\s*(\d{4})/i);
  if (quarterMatch) {
    const quarter = parseInt(quarterMatch[1]);
    const year = parseInt(quarterMatch[2]);
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = quarter * 3;
    const startDate = `${year}-${String(startMonth).padStart(2, '0')}-01`;
    const endDate = `${year}-${String(endMonth).padStart(2, '0')}-${new Date(year, endMonth, 0).getDate()}`;
    return `${startDate}to${endDate}`;
  }
  
  // Try to parse specific months (January 2024, Jan 2024, etc.)
  const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 
                      'july', 'august', 'september', 'october', 'november', 'december'];
  const monthAbbr = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 
                     'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const monthMatch = timeWindowLower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{4})/i);
  if (monthMatch) {
    const monthName = monthMatch[1].toLowerCase();
    const year = parseInt(monthMatch[2]);
    let monthIndex = monthNames.indexOf(monthName);
    if (monthIndex === -1) {
      monthIndex = monthAbbr.indexOf(monthName);
    }
    if (monthIndex !== -1) {
      const startDate = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
      const endDate = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${new Date(year, monthIndex + 1, 0).getDate()}`;
      return `${startDate}to${endDate}`;
    }
  }
  
  // For "recent" or "latest" queries, default to past week
  if (timeWindowLower.includes("recent") || timeWindowLower.includes("latest")) {
    return "pw";
  }
  
  // Default: no freshness filter (return all results)
  // This allows the API to return results from any time period
  return undefined;
}

/**
 * Search using MCP tools
 * 
 * Tries common MCP search tool names:
 * - brave_search
 * - google_search
 * - web_search
 * - search
 * 
 * Yields results incrementally as they're parsed
 */
async function* searchWithMCP(query: string, maxResults: number = 10, timeWindow?: string): AsyncGenerator<SearchResult, void, unknown> {
  if (!mcpClient) {
    throw new Error("MCP client not available");
  }

  // List available tools from the MCP server
  const tools = await mcpClient.listTools();
  
  if (!tools.tools || tools.tools.length === 0) {
    throw new Error("No tools available from MCP server");
  }

  // Use the first tool that contains "search" in its name, or fallback to first tool
  let searchTool: string | null = null;
  
  // Prefer tools with "search" in the name, prioritize "web_search" or "web" over "local"
  const searchTools = tools.tools.filter(t => 
    t.name.toLowerCase().includes("search")
  );
  
  // Prefer web_search over local_search
  const webSearch = searchTools.find(t => 
    t.name.toLowerCase().includes("web") || 
    t.name.toLowerCase().includes("web_search")
  );
  searchTool = webSearch?.name || searchTools[0].name;

  console.log(`[MCP] Using tool: ${searchTool}`);

  // Convert timeWindow to Brave API freshness parameter
  const freshness = timeWindow ? convertTimeWindowToFreshness(timeWindow) : undefined;
  
  // Build search arguments
  const searchArgs: Record<string, any> = {
    query,
    count: maxResults,
    ...(process.env.BRAVE_API_KEY && { api_key: process.env.BRAVE_API_KEY }),
  };
  
  // Add freshness parameter if available (Brave API specific)
  if (freshness) {
    searchArgs.freshness = freshness;
    console.log(`[MCP] Using freshness filter: ${freshness} (from timeWindow: "${timeWindow}")`);
  }

  // Call the search tool
  const result = await callMCPTool(searchTool, searchArgs);

  // Parse results based on tool response format and yield incrementally
  let resultCount = 0;

  for (const content of result) {
    if (content.type === "text") {
      // Try to parse JSON response
      try {
        const data = JSON.parse(content.text);
        
        // Handle Brave API response structure (primary format)
        // Brave API returns: { web: { results: [...] }, news: { results: [...] }, ... }
        // NOTE: No AI needed here - this is structured data parsing. AI is used for:
        // - Research planning (extracting timeWindow, domain from user query)
        // - Trend synthesis (ranking, enhancing summaries, generating "why it matters")
        // - Content generation (creating platform-specific ideas)
        if (data.web && Array.isArray(data.web.results)) {
          // Brave API web results - use direct field access (no AI needed for structured data)
          for (const item of data.web.results) {
            if (resultCount >= maxResults) return;
            
            // Use fetched_content_timestamp (numeric) as primary source, convert to ISO string
            let timestamp: string | undefined;
            if (item.fetched_content_timestamp) {
              // Convert numeric timestamp (seconds or milliseconds) to ISO string
              const ts = typeof item.fetched_content_timestamp === 'number' 
                ? item.fetched_content_timestamp 
                : parseInt(item.fetched_content_timestamp);
              // Check if it's in seconds (10 digits) or milliseconds (13 digits)
              const date = ts < 10000000000 
                ? new Date(ts * 1000)  // seconds
                : new Date(ts);        // milliseconds
              if (!isNaN(date.getTime())) {
                timestamp = date.toISOString();
              }
            }
            // Fallback to page_fetched (string) if available
            if (!timestamp && item.page_fetched) {
              const date = new Date(item.page_fetched);
              if (!isNaN(date.getTime())) {
                timestamp = date.toISOString();
              }
            }
            // Last fallback: page_age (string like "2 days ago") - we'll parse this later if needed
            
            yield {
              url: item.url || "",
              title: item.title || "",
              snippet: item.description || "",
              timestamp: timestamp,
            };
            resultCount++;
          }
        }
        
        // Handle Brave API news results
        if (data.news && Array.isArray(data.news.results) && resultCount < maxResults) {
          for (const item of data.news.results) {
            if (resultCount >= maxResults) return;
            
            let timestamp: string | undefined;
            if (item.fetched_content_timestamp) {
              const ts = typeof item.fetched_content_timestamp === 'number' 
                ? item.fetched_content_timestamp 
                : parseInt(item.fetched_content_timestamp);
              const date = ts < 10000000000 ? new Date(ts * 1000) : new Date(ts);
              if (!isNaN(date.getTime())) {
                timestamp = date.toISOString();
              }
            }
            if (!timestamp && item.page_fetched) {
              const date = new Date(item.page_fetched);
              if (!isNaN(date.getTime())) {
                timestamp = date.toISOString();
              }
            }
            
            yield {
              url: item.url || "",
              title: item.title || "",
              snippet: item.description || "",
              timestamp: timestamp,
            };
            resultCount++;
          }
        }
        
        // Fallback: Handle generic results array (for other search APIs)
        if (data.results && Array.isArray(data.results) && resultCount < maxResults) {
          // Generic format - try multiple timestamp fields
          for (const item of data.results) {
            if (resultCount >= maxResults) return;
            // Try multiple possible timestamp field names from website
            const timestamp = item.published_date || 
                            item.publishedDate || 
                            item.date || 
                            item.timestamp ||
                            item.publish_date ||
                            item.published_time ||
                            item.fetched_content_timestamp;
            yield {
              url: item.url || item.link || "",
              title: item.title || "",
              snippet: item.description || item.snippet || "",
              timestamp: timestamp,
            };
            resultCount++;
          }
        } else if (data.items && Array.isArray(data.items)) {
          // Google Search format - try multiple timestamp sources
          for (const item of data.items) {
            if (resultCount >= maxResults) return;
            // Try multiple possible timestamp sources from website metadata
            const timestamp = item.pagemap?.metatags?.[0]?.["article:published_time"] ||
                            item.pagemap?.metatags?.[0]?.["og:published_time"] ||
                            item.pagemap?.newsarticle?.[0]?.datepublished ||
                            item.pagemap?.article?.[0]?.datepublished ||
                            item.published ||
                            item.date ||
                            item.timestamp;
            yield {
              url: item.link || item.url || "",
              title: item.title || "",
              snippet: item.snippet || item.description || "",
              timestamp: timestamp, // Website timestamp (from Google Search API)
            };
            resultCount++;
          }
        } else if (Array.isArray(data)) {
          // Direct array format - try multiple timestamp fields
          for (const item of data) {
            if (resultCount >= maxResults) return;
            // Try multiple possible timestamp field names
            const timestamp = item.timestamp ||
                            item.published_date ||
                            item.publishedDate ||
                            item.date ||
                            item.publish_date ||
                            item.published_time ||
                            item.published;
            yield {
              url: item.url || item.link || "",
              title: item.title || "",
              snippet: item.snippet || item.description || "",
              timestamp: timestamp, // Website timestamp (from direct array format)
            };
            resultCount++;
          }
        }
      } catch (e) {
        // Not JSON - parse plain text format (Title: ... Description: ... URL: ...)
        const text = content.text;
        
        // Split by double newlines to get individual results
        const resultBlocks = text.split(/\n\n+/);
        
        for (const block of resultBlocks) {
          if (resultCount >= maxResults) return;
          const titleMatch = block.match(/Title:\s*(.+?)(?:\n|$)/i);
          const descriptionMatch = block.match(/Description:\s*([\s\S]+?)(?:\n(?:Title:|URL:)|$)/i);
          const urlMatch = block.match(/URL:\s*(.+?)(?:\n|$)/i);
          
          if (titleMatch || urlMatch) {
            const description = descriptionMatch 
              ? descriptionMatch[1].trim().replace(/\n+/g, " ").replace(/\s+/g, " ")
              : "";
            
            yield {
              url: urlMatch ? urlMatch[1].trim() : "",
              title: titleMatch ? titleMatch[1].trim() : "",
              snippet: description.substring(0, 300) || "",
            };
            resultCount++;
          }
        }
        
        // If no structured blocks found with double newlines, try parsing line by line
        if (resultCount === 0) {
          const lines = text.split('\n');
          let currentResult: Partial<SearchResult> = {};
          
          for (const line of lines) {
            if (resultCount >= maxResults) return;
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
            
            if (trimmedLine.startsWith('Title:')) {
              if (currentResult.url || currentResult.title) {
                // Yield previous result
                yield {
                  url: currentResult.url || "",
                  title: currentResult.title || "",
                  snippet: (currentResult.snippet || "").trim(),
                };
                resultCount++;
              }
              currentResult = { 
                title: trimmedLine.replace(/^Title:\s*/i, '').trim(),
                snippet: ""
              };
            } else if (trimmedLine.startsWith('Description:')) {
              currentResult.snippet = trimmedLine.replace(/^Description:\s*/i, '').trim();
            } else if (trimmedLine.startsWith('URL:')) {
              currentResult.url = trimmedLine.replace(/^URL:\s*/i, '').trim();
              // Yield this result
              if (currentResult.title || currentResult.url) {
                yield {
                  url: currentResult.url || "",
                  title: currentResult.title || "",
                  snippet: (currentResult.snippet || "").trim(),
                };
                resultCount++;
              }
              currentResult = {};
            } else if (currentResult.title && trimmedLine) {
              // Continuation of description or title
              if (!currentResult.snippet && !trimmedLine.startsWith('http')) {
                currentResult.snippet = (currentResult.snippet || "") + " " + trimmedLine;
              }
            }
          }
          
          // Don't forget the last result
          if (currentResult.url || currentResult.title) {
            if (resultCount < maxResults) {
              yield {
                url: currentResult.url || "",
                title: currentResult.title || "",
                snippet: (currentResult.snippet || "").trim(),
              };
              resultCount++;
            }
          }
        }
      }
    }
  }

  if (resultCount === 0) {
    console.error(`[MCP] Failed to parse results. Raw response:`, JSON.stringify(result, null, 2));
    throw new Error("No search results returned from MCP server");
  }

  console.log(`[MCP] Parsed ${resultCount} results from MCP server`);
}


/**
 * Analyze prompt specificity to determine cache TTL
 * Vague prompts like "latest trends" can use older cached data
 * Specific prompts like "today's news" need fresh data
 */
function determineCacheTTL(query: string, timeWindow: string): number {
  const queryLower = query.toLowerCase();
  const timeWindowLower = timeWindow.toLowerCase();
  
  // Very specific time indicators - need very fresh data (5-30 minutes)
  if (
    queryLower.includes("today") ||
    queryLower.includes("right now") ||
    queryLower.includes("breaking") ||
    queryLower.includes("just now") ||
    queryLower.includes("this hour") ||
    timeWindowLower.includes("today") ||
    timeWindowLower === "now"
  ) {
    // 15 minutes for very time-sensitive queries
    return 15 * 60 * 1000; // 15 minutes
  }
  
  // Recent but not urgent - can use data from last few hours
  if (
    queryLower.includes("this week") ||
    queryLower.includes("recent") ||
    queryLower.includes("latest") ||
    timeWindowLower.includes("this week") ||
    timeWindowLower.includes("recent")
  ) {
    // 1 hour for recent queries
    return 60 * 60 * 1000; // 1 hour
  }
  
  // Vague/general queries - can use data from days/weeks ago
  if (
    queryLower.includes("trends") ||
    queryLower.includes("trending") ||
    queryLower.includes("popular") ||
    queryLower.includes("top") ||
    queryLower.includes("best") ||
    queryLower.includes("what's") ||
    timeWindowLower.includes("this month") ||
    timeWindowLower.includes("last month")
  ) {
    // 1 week for general trend queries
    return 7 * 24 * 60 * 60 * 1000; // 7 days
  }
  
  // Very vague queries - can use data from weeks/months ago
  if (
    queryLower.includes("general") ||
    queryLower.includes("overview") ||
    queryLower.includes("summary") ||
    timeWindowLower.includes("quarter") ||
    timeWindowLower.match(/\d{4}/) // Year-based queries
  ) {
    // 30 days for very general queries
    return 30 * 24 * 60 * 60 * 1000; // 30 days
  }
  
  // Default: 1 hour for unknown queries
  return 60 * 60 * 1000; // 1 hour
}

/**
 * Generate a hash for the query to use as cache key
 */
function generateQueryHash(query: string, timeWindow: string, domain?: string): string {
  // Normalize the query for consistent hashing
  const normalizedQuery = query.toLowerCase().trim();
  const normalizedTimeWindow = timeWindow.toLowerCase().trim();
  const normalizedDomain = domain ? domain.toLowerCase().trim() : "";
  
  // Create a combined string for hashing
  const combined = `${normalizedQuery}|${normalizedTimeWindow}|${normalizedDomain}`;
  
  // Generate SHA-256 hash
  return createHash('sha256').update(combined).digest('hex');
}

/**
 * Fetch trends using MCP tools (incremental version)
 * 
 * This function searches the web for trending topics and calls onTrendFound
 * for each trend as it's processed, allowing incremental streaming.
 * 
 * Includes caching based on prompt specificity.
 * 
 * Requires MCP_SERVER_COMMAND to be set in environment variables.
 */
export async function fetchTrendsIncremental(
  query: string,
  timeWindow: string,
  onTrendFound?: (trend: any, allTrendsSoFar: any[]) => void | Promise<void>,
  domain?: string,
  persona?: string
): Promise<any[]> {
  console.log(`[MCP] Fetching trends incrementally for: ${query} (${timeWindow})`);
  
  // Try to get from cache first
  if (convex) {
    try {
      const queryHash = generateQueryHash(query, timeWindow, domain);
      const cachedResult = await convex.query(api.queries.getCachedResearch, {
        queryHash,
        query,
        timeWindow,
        domain: domain || query,
      });
      
      if (cachedResult && cachedResult.trends && cachedResult.trends.length > 0) {
        const matchType = cachedResult.matchType || "exact";
        const similarity = cachedResult.similarity ? ` (${Math.round(cachedResult.similarity)}% similar)` : "";
        console.log(`[MCP] ✓ Cache hit! Using cached results (${matchType}${similarity}, age: ${Math.round(cachedResult.age / 1000 / 60)} minutes)`);
        
        // CRITICAL: Filter cached results by timestamp to ensure they're still within the timeWindow
        // This is important because time-sensitive queries (e.g., "this week") may have cached results
        // that are now outside the requested timeframe
        const filteredTrends = cachedResult.trends.filter((trend: any) => {
          // Check each source's timestamp
          if (!trend.sources || trend.sources.length === 0) {
            return false; // Skip trends without sources
          }
          
          // Use the first source's timestamp (trends typically have one source)
          const sourceTimestamp = trend.sources[0]?.timestamp;
          if (!sourceTimestamp) {
            // If no timestamp, we can't validate - exclude it to be safe
            console.log(`[MCP] ✗ Filtering cached trend without timestamp: ${trend.title?.substring(0, 60)}...`);
            return false;
          }
          
          const isWithinWindow = isTimestampInTimeWindow(sourceTimestamp, timeWindow);
          if (!isWithinWindow) {
            console.log(`[MCP] ✗ Filtering cached trend outside timeWindow "${timeWindow}": ${trend.title?.substring(0, 60)}... (timestamp: ${sourceTimestamp})`);
          }
          return isWithinWindow;
        });
        
        // FALLBACK: If no cached results within timeWindow, use most recent cached data
        if (filteredTrends.length === 0 && cachedResult.trends.length > 0) {
          console.log(`[MCP] ⚠ No cached results within timeWindow "${timeWindow}", using most recent cached data as fallback`);
          
          // Sort all cached trends by timestamp (most recent first)
          const sortedCachedTrends = cachedResult.trends.sort((a: any, b: any) => {
            const timestampA = a.sources?.[0]?.timestamp;
            const timestampB = b.sources?.[0]?.timestamp;
            if (!timestampA) return 1;
            if (!timestampB) return -1;
            return new Date(timestampB).getTime() - new Date(timestampA).getTime();
          });
          
          // Take the most recent trends (up to 10)
          const mostRecentCached = sortedCachedTrends.slice(0, 10);
          
          console.log(`[MCP] ✓ Using ${mostRecentCached.length} most recent cached trend(s) as fallback`);
          
          // Call onTrendFound for fallback cached trends
          if (onTrendFound) {
            for (let i = 0; i < mostRecentCached.length; i++) {
              await onTrendFound(mostRecentCached[i], mostRecentCached.slice(0, i + 1));
            }
          }
          
          return mostRecentCached;
        } else if (filteredTrends.length === 0) {
          console.log(`[MCP] All cached results filtered out (outside timeWindow "${timeWindow}"), fetching fresh data`);
          // Continue to fetch fresh data
        } else {
          const filteredCount = cachedResult.trends.length - filteredTrends.length;
          if (filteredCount > 0) {
            console.log(`[MCP] Filtered ${filteredCount} cached trend(s) outside timeWindow "${timeWindow}", using ${filteredTrends.length} valid trend(s)`);
          }
          
          // Call onTrendFound for each filtered cached trend to maintain streaming behavior
          if (onTrendFound) {
            for (let i = 0; i < filteredTrends.length; i++) {
              await onTrendFound(filteredTrends[i], filteredTrends.slice(0, i + 1));
            }
          }
          
          return filteredTrends;
        }
      } else {
        console.log(`[MCP] Cache miss - fetching fresh data`);
      }
    } catch (error) {
      console.warn(`[MCP] Cache lookup failed, continuing with fresh fetch:`, error);
    }
  }
  
  // Ensure MCP client is initialized
  if (!mcpClientInitialized) {
    await initializeMCPClient();
  }
  
  if (!mcpClient) {
    throw new Error("MCP client is not available. Please configure MCP_SERVER_COMMAND in .env");
  }
  
  // Use MCP to search - results come incrementally
  // Convert search results to trend format incrementally
  // Enhanced processing with better filtering and quality checks
  const trends: any[] = [];
  const allTrends: any[] = []; // Store all trends (including outside timeWindow) for fallback
  let hasResults = false;
  
  // Pass timeWindow to search function so it can filter by timeframe
  for await (const result of searchWithMCP(query, 10, timeWindow)) {
    hasResults = true;
    
    // Process and yield trend immediately as we get each result
    // Skip invalid results
    if (!result.title || result.title.trim().length === 0) {
      console.warn(`[MCP] Skipping result with empty title: ${result.url}`);
      continue;
    }
    
    if (!result.url || !result.url.startsWith('http')) {
      console.warn(`[MCP] Skipping result with invalid URL: ${result.title}`);
      continue;
    }
    
    // Clean and format the data
    const cleanTitle = result.title.trim();
    const cleanSnippet = (result.snippet || "").trim();
    
    // Only include if snippet has meaningful content
    if (cleanSnippet.length < 20) {
      console.warn(`[MCP] Skipping result with short snippet: ${cleanTitle}`);
      continue;
    }
    
    const confidence = calculateConfidence(result, timeWindow);
    const userPersona = persona || "";
    const whyItMatters = await generateWhyItMatters(cleanSnippet, query, userPersona);
    
    // Normalize timestamp: try multiple extraction methods, fallback to timeWindow-based estimate
    // Store original timestamp to check if we used it
    const originalTimestamp = result.timestamp;
    const normalizedTimestamp = await normalizeWebsiteTimestamp(
      result.timestamp, 
      timeWindow,
      result.url,
      cleanSnippet,
      cleanTitle
    );
    
    // Skip if we can't determine timestamp
    if (!normalizedTimestamp) {
      console.warn(`[MCP] ⚠ No timestamp available for result, skipping: ${cleanTitle.substring(0, 60)}...`);
      continue;
    }
    
    // Log timestamp source for transparency
    let usedWebsiteTimestamp = false;
    if (originalTimestamp && normalizedTimestamp) {
      try {
        const originalDate = new Date(originalTimestamp);
        const normalizedDate = new Date(normalizedTimestamp);
        usedWebsiteTimestamp = !isNaN(originalDate.getTime()) && 
                              Math.abs(originalDate.getTime() - normalizedDate.getTime()) < 1000;
      } catch (e) {
        usedWebsiteTimestamp = false;
      }
    }
    
    const trend = {
      title: cleanTitle,
      summary: cleanSnippet.substring(0, 200) + (cleanSnippet.length > 200 ? "..." : ""),
      whyItMatters: whyItMatters,
      sources: [
        {
          url: result.url,
          timestamp: normalizedTimestamp,
          snippet: cleanSnippet.substring(0, 150),
        },
      ],
      confidence: confidence,
    };
    
    // Store all trends (for fallback if none match timeWindow)
    allTrends.push(trend);
    
    // Check if within timeWindow
    const isWithinWindow = isTimestampInTimeWindow(normalizedTimestamp, timeWindow);
    
    if (isWithinWindow) {
      console.log(`[MCP] ✓ Result within timeWindow "${timeWindow}": ${cleanTitle.substring(0, 60)}... (timestamp: ${normalizedTimestamp})`);
      if (usedWebsiteTimestamp) {
        console.log(`[MCP] ✓ Using website timestamp: ${normalizedTimestamp} (from ${result.url})`);
      }
      
      trends.push(trend);
      
      // Call callback incrementally if provided
      if (onTrendFound) {
        await onTrendFound(trend, [...trends]);
      }
    } else {
      console.log(`[MCP] ✗ Result outside timeWindow "${timeWindow}": ${cleanTitle.substring(0, 60)}... (timestamp: ${normalizedTimestamp}) - storing for fallback`);
    }
  }
  
  if (!hasResults) {
    throw new Error("No search results returned from MCP server");
  }
  
  // FALLBACK: If no results within timeWindow, use most recent data
  let finalTrends = trends;
  if (trends.length === 0 && allTrends.length > 0) {
    console.log(`[MCP] ⚠ No results found within timeWindow "${timeWindow}", using most recent data as fallback`);
    
    // Sort all trends by timestamp (most recent first)
    const sortedTrends = allTrends.sort((a, b) => {
      const timestampA = a.sources?.[0]?.timestamp;
      const timestampB = b.sources?.[0]?.timestamp;
      if (!timestampA) return 1; // Put items without timestamp at end
      if (!timestampB) return -1;
      return new Date(timestampB).getTime() - new Date(timestampA).getTime();
    });
    
    // Take the most recent trends (up to 10)
    finalTrends = sortedTrends.slice(0, 10);
    
    console.log(`[MCP] ✓ Using ${finalTrends.length} most recent trend(s) as fallback (oldest: ${finalTrends[finalTrends.length - 1]?.sources?.[0]?.timestamp || 'unknown'})`);
    
    // Call callback for fallback trends
    if (onTrendFound) {
      for (let i = 0; i < finalTrends.length; i++) {
        await onTrendFound(finalTrends[i], finalTrends.slice(0, i + 1));
      }
    }
  } else {
    console.log(`[MCP] Converted ${trends.length} valid trend(s) from search results (all within timeWindow: "${timeWindow}")`);
  }
  
  // Store in cache for future use
  // NOTE: Cache trends within timeWindow, but also cache most recent trends for fallback
  const trendsToCache = finalTrends.length > 0 ? finalTrends : (allTrends.length > 0 ? allTrends.slice(0, 10) : []);
  
  if (convex && trendsToCache.length > 0) {
    try {
      const queryHash = generateQueryHash(query, timeWindow, domain);
      const cacheTTL = determineCacheTTL(query, timeWindow);
      
      // Filter out trends without timestamps before caching
      const validTrendsToCache = trendsToCache.filter((trend: any) => {
        const sourceTimestamp = trend.sources?.[0]?.timestamp;
        if (!sourceTimestamp) {
          console.warn(`[MCP] ⚠ Skipping caching trend without timestamp: ${trend.title?.substring(0, 60)}...`);
          return false;
        }
        return true;
      });
      
      if (validTrendsToCache.length > 0) {
        // Sort by timestamp (most recent first) before caching
        const sortedForCache = validTrendsToCache.sort((a: any, b: any) => {
          const timestampA = a.sources?.[0]?.timestamp;
          const timestampB = b.sources?.[0]?.timestamp;
          if (!timestampA) return 1;
          if (!timestampB) return -1;
          return new Date(timestampB).getTime() - new Date(timestampA).getTime();
        });
        
        await convex.mutation(api.mutations.saveResearchCache, {
          queryHash,
          query,
          timeWindow,
          domain: domain || query,
          trends: sortedForCache, // Cache trends (within timeWindow or most recent as fallback)
          cacheTTL,
        });
        
        const withinWindowCount = sortedForCache.filter((t: any) => 
          isTimestampInTimeWindow(t.sources?.[0]?.timestamp, timeWindow)
        ).length;
        
        if (withinWindowCount === sortedForCache.length) {
          console.log(`[MCP] ✓ Cached ${sortedForCache.length} trend(s) (all within timeWindow: "${timeWindow}") with TTL: ${Math.round(cacheTTL / 1000 / 60)} minutes`);
        } else {
          console.log(`[MCP] ✓ Cached ${sortedForCache.length} trend(s) (${withinWindowCount} within timeWindow, ${sortedForCache.length - withinWindowCount} as fallback) with TTL: ${Math.round(cacheTTL / 1000 / 60)} minutes`);
        }
      } else {
        console.warn(`[MCP] ⚠ No trends to cache (all were missing timestamps)`);
      }
    } catch (error) {
      console.warn(`[MCP] Failed to cache results:`, error);
      // Don't throw - caching is best effort
    }
  }
  
  return finalTrends;
}


/**
 * Extract date from URL patterns
 * Many websites include dates in URLs like /2024/01/15/article or /2024/01/article
 */
function extractDateFromUrl(url: string): string | undefined {
  try {
    // Pattern 1: /YYYY/MM/DD/ or /YYYY/MM/DD
    const ymdPattern = /\/(\d{4})\/(\d{1,2})\/(\d{1,2})/;
    const ymdMatch = url.match(ymdPattern);
    if (ymdMatch) {
      const year = parseInt(ymdMatch[1]);
      const month = parseInt(ymdMatch[2]) - 1; // JS months are 0-indexed
      const day = parseInt(ymdMatch[3]);
      const date = new Date(year, month, day);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
    
    // Pattern 2: /YYYY/MM/
    const ymPattern = /\/(\d{4})\/(\d{1,2})\//;
    const ymMatch = url.match(ymPattern);
    if (ymMatch) {
      const year = parseInt(ymMatch[1]);
      const month = parseInt(ymMatch[2]) - 1;
      const date = new Date(year, month, 1); // Use first day of month
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
    
    // Pattern 3: /YYYY-MM-DD/ or /YYYY-MM-DD
    const isoPattern = /\/(\d{4})-(\d{2})-(\d{2})/;
    const isoMatch = url.match(isoPattern);
    if (isoMatch) {
      const year = parseInt(isoMatch[1]);
      const month = parseInt(isoMatch[2]) - 1;
      const day = parseInt(isoMatch[3]);
      const date = new Date(year, month, day);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
    
    // Pattern 4: YYYYMMDD in URL
    const compactPattern = /(\d{4})(\d{2})(\d{2})/;
    const compactMatch = url.match(compactPattern);
    if (compactMatch) {
      const year = parseInt(compactMatch[1]);
      const month = parseInt(compactMatch[2]) - 1;
      const day = parseInt(compactMatch[3]);
      const date = new Date(year, month, day);
      if (!isNaN(date.getTime()) && date.getFullYear() >= 2000 && date.getFullYear() <= new Date().getFullYear() + 1) {
        return date.toISOString();
      }
    }
  } catch (e) {
    // Silently fail - URL parsing is best effort
  }
  return undefined;
}

/**
 * Extract date from text (snippet, title, etc.)
 * Looks for common date patterns like "January 15, 2024", "Jan 15, 2024", "2024-01-15", etc.
 */
function extractDateFromText(text: string): string | undefined {
  if (!text) return undefined;
  
  try {
    // Pattern 1: "Published on January 15, 2024" or "Posted on Jan 15, 2024"
    const publishedPattern = /(?:published|posted|updated|created|released)\s+(?:on\s+)?([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i;
    const publishedMatch = text.match(publishedPattern);
    if (publishedMatch) {
      const date = new Date(publishedMatch[1]);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
    
    // Pattern 2: ISO date format "2024-01-15" or "2024/01/15"
    const isoPattern = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})/;
    const isoMatch = text.match(isoPattern);
    if (isoMatch) {
      const year = parseInt(isoMatch[1]);
      const month = parseInt(isoMatch[2]) - 1;
      const day = parseInt(isoMatch[3]);
      const date = new Date(year, month, day);
      if (!isNaN(date.getTime()) && date.getFullYear() >= 2000 && date.getFullYear() <= new Date().getFullYear() + 1) {
        return date.toISOString();
      }
    }
    
    // Pattern 3: "January 15, 2024" or "Jan 15, 2024" (standalone)
    const monthDayYearPattern = /([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/;
    const monthDayYearMatch = text.match(monthDayYearPattern);
    if (monthDayYearMatch) {
      const date = new Date(monthDayYearMatch[0]);
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
    
    // Pattern 4: Relative dates like "2 days ago", "last week", "yesterday"
    const relativePattern = /(\d+)\s+(day|week|month|year)s?\s+ago/i;
    const relativeMatch = text.match(relativePattern);
    if (relativeMatch) {
      const amount = parseInt(relativeMatch[1]);
      const unit = relativeMatch[2].toLowerCase();
      const now = new Date();
      let date: Date;
      
      if (unit === 'day') {
        date = new Date(now.getTime() - amount * 24 * 60 * 60 * 1000);
      } else if (unit === 'week') {
        date = new Date(now.getTime() - amount * 7 * 24 * 60 * 60 * 1000);
      } else if (unit === 'month') {
        date = new Date(now.getTime() - amount * 30 * 24 * 60 * 60 * 1000);
      } else if (unit === 'year') {
        date = new Date(now.getTime() - amount * 365 * 24 * 60 * 60 * 1000);
      } else {
        return undefined;
      }
      
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
    
    // Pattern 5: "yesterday", "today", "last week", etc.
    const now = new Date();
    if (text.toLowerCase().includes('yesterday')) {
      return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    } else if (text.toLowerCase().includes('today')) {
      return now.toISOString();
    } else if (text.toLowerCase().includes('last week')) {
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (text.toLowerCase().includes('last month')) {
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    }
  } catch (e) {
    // Silently fail - text parsing is best effort
  }
  return undefined;
}

/**
 * Extract publication date from URL using API services
 * Uses Microlink.io API (free tier) or direct HTML metadata parsing
 */
async function extractDateFromURLAPI(url: string): Promise<string | undefined> {
  try {
    // Method 1: Try Microlink.io API (free tier, no API key required for basic use)
    try {
      const microlinkUrl = `https://api.microlink.io?url=${encodeURIComponent(url)}&fields=date,published`;
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const response = await fetch(microlinkUrl, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const data = await response.json();
        
        // Try multiple date fields from Microlink response
        const dateValue = data.data?.date || 
                         data.data?.published || 
                         data.data?.publishedTime ||
                         data.data?.article?.publishedTime ||
                         data.date ||
                         data.published;
        
        if (dateValue) {
          const date = new Date(dateValue);
          if (!isNaN(date.getTime())) {
            console.log(`[MCP] ✓ Extracted date from Microlink API: ${date.toISOString()}`);
            return date.toISOString();
          }
        }
      } else {
        console.warn(`[MCP] Microlink API returned status ${response.status}, trying direct fetch`);
      }
    } catch (microlinkError) {
      // Continue to next method if Microlink fails
      if (microlinkError instanceof Error && microlinkError.name !== 'AbortError') {
        console.warn(`[MCP] Microlink API failed, trying direct fetch:`, microlinkError.message);
      }
    }
    
    // Method 2: Direct fetch and parse HTML metadata (fallback)
    try {
      // Create AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; TrendResearchBot/1.0)',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.ok) {
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
          // Skip if not HTML
          return undefined;
        }
        
        const html = await response.text();
        
        // Extract date from common meta tags
        const metaPatterns = [
          /<meta\s+property=["']article:published_time["']\s+content=["']([^"']+)["']/i,
          /<meta\s+property=["']og:published_time["']\s+content=["']([^"']+)["']/i,
          /<meta\s+name=["']published["']\s+content=["']([^"']+)["']/i,
          /<meta\s+name=["']date["']\s+content=["']([^"']+)["']/i,
          /<meta\s+name=["']pubdate["']\s+content=["']([^"']+)["']/i,
          /<time\s+datetime=["']([^"']+)["']/i,
          /<time\s+pubdate\s+datetime=["']([^"']+)["']/i,
        ];
        
        for (const pattern of metaPatterns) {
          const match = html.match(pattern);
          if (match && match[1]) {
            const date = new Date(match[1]);
            if (!isNaN(date.getTime())) {
              console.log(`[MCP] ✓ Extracted date from HTML metadata: ${date.toISOString()}`);
              return date.toISOString();
            }
          }
        }
        
        // Try JSON-LD structured data
        const jsonLdPattern = /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
        let jsonLdMatch;
        while ((jsonLdMatch = jsonLdPattern.exec(html)) !== null) {
          try {
            const jsonLd = JSON.parse(jsonLdMatch[1]);
            const dateValue = jsonLd.datePublished || 
                            jsonLd.published || 
                            jsonLd.datePublishedTime ||
                            (jsonLd['@type'] === 'NewsArticle' && jsonLd.datePublished);
            
            if (dateValue) {
              const date = new Date(dateValue);
              if (!isNaN(date.getTime())) {
                console.log(`[MCP] ✓ Extracted date from JSON-LD: ${date.toISOString()}`);
                return date.toISOString();
              }
            }
          } catch (e) {
            // Continue to next JSON-LD block
            continue;
          }
        }
      }
    } catch (fetchError) {
      // Silently fail - direct fetch is best effort
      console.warn(`[MCP] Direct fetch failed:`, fetchError);
    }
  } catch (error) {
    // Silently fail - API extraction is best effort
    console.warn(`[MCP] URL API date extraction failed:`, error);
  }
  return undefined;
}

/**
 * Try to fetch page metadata using MCP tools if available
 */
async function fetchTimestampFromMCP(url: string): Promise<string | undefined> {
  if (!mcpClient) {
    return undefined;
  }
  
  try {
    // List available tools
    const tools = await mcpClient.listTools();
    
    // Try tools that might fetch page metadata
    const metadataTools = tools.tools.filter(t => 
      t.name.toLowerCase().includes('fetch') ||
      t.name.toLowerCase().includes('scrape') ||
      t.name.toLowerCase().includes('metadata') ||
      t.name.toLowerCase().includes('page')
    );
    
    for (const tool of metadataTools) {
      try {
        const result = await callMCPTool(tool.name, { url });
        
        // Try to extract timestamp from various response formats
        if (result && typeof result === 'object') {
          const timestamp = result.published_date ||
                          result.publishedDate ||
                          result.date ||
                          result.timestamp ||
                          result.published_time ||
                          result.published ||
                          result.publish_date ||
                          result['article:published_time'] ||
                          result['og:published_time'];
          
          if (timestamp) {
            const date = new Date(timestamp);
            if (!isNaN(date.getTime())) {
              return date.toISOString();
            }
          }
        }
      } catch (e) {
        // Try next tool
        continue;
      }
    }
  } catch (error) {
    // Silently fail - MCP metadata fetching is best effort
  }
  
  return undefined;
}

/**
 * Check if a timestamp falls within the specified timeWindow
 * Returns true if the timestamp is within the timeframe, false otherwise
 */
function isTimestampInTimeWindow(timestamp: string | undefined, timeWindow: string): boolean {
  if (!timestamp) return false;
  
  try {
    const resultDate = new Date(timestamp);
    if (isNaN(resultDate.getTime())) return false;
    
    const now = new Date();
    const timeWindowLower = timeWindow.toLowerCase().trim();
    
    // Calculate time difference in milliseconds
    const timeDiff = now.getTime() - resultDate.getTime();
    const daysDiff = timeDiff / (1000 * 60 * 60 * 24);
    
    // Check based on timeWindow
    if (timeWindowLower.includes("today") || timeWindowLower === "now" || timeWindowLower.includes("last 24 hours")) {
      return daysDiff <= 1; // Within last 24 hours
    }
    
    if (timeWindowLower.includes("this week") || timeWindowLower.includes("last week") || 
        timeWindowLower.includes("past week") || timeWindowLower.includes("7 days")) {
      return daysDiff <= 7; // Within last 7 days
    }
    
    if (timeWindowLower.includes("this month") || timeWindowLower.includes("last month") || 
        timeWindowLower.includes("past month") || timeWindowLower.includes("30 days") ||
        timeWindowLower.includes("31 days")) {
      return daysDiff <= 31; // Within last 31 days
    }
    
    if (timeWindowLower.includes("this year") || timeWindowLower.includes("last year") || 
        timeWindowLower.includes("past year") || timeWindowLower.includes("365 days")) {
      return daysDiff <= 365; // Within last 365 days
    }
    
    if (timeWindowLower.includes("recent") || timeWindowLower.includes("latest")) {
      return daysDiff <= 30; // Recent = within last 30 days
    }
    
    // Handle specific date ranges (YYYY-MM-DD to YYYY-MM-DD)
    const dateRangeMatch = timeWindowLower.match(/(\d{4}-\d{2}-\d{2})\s*(?:to|-)\s*(\d{4}-\d{2}-\d{2})/);
    if (dateRangeMatch) {
      const startDate = new Date(dateRangeMatch[1]);
      const endDate = new Date(dateRangeMatch[2]);
      return resultDate >= startDate && resultDate <= endDate;
    }
    
    // Handle quarters (Q1 2024, Q2 2024, etc.)
    const quarterMatch = timeWindowLower.match(/\bq([1-4])\s*(\d{4})/i);
    if (quarterMatch) {
      const quarter = parseInt(quarterMatch[1]);
      const year = parseInt(quarterMatch[2]);
      const startMonth = (quarter - 1) * 3;
      const endMonth = quarter * 3;
      const startDate = new Date(year, startMonth, 1);
      const endDate = new Date(year, endMonth, 0, 23, 59, 59, 999); // Last day of quarter
      return resultDate >= startDate && resultDate <= endDate;
    }
    
    // Handle specific months (January 2024, Jan 2024, etc.)
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 
                        'july', 'august', 'september', 'october', 'november', 'december'];
    const monthAbbr = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 
                       'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const monthMatch = timeWindowLower.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+(\d{4})/i);
    if (monthMatch) {
      const monthName = monthMatch[1].toLowerCase();
      const year = parseInt(monthMatch[2]);
      let monthIndex = monthNames.indexOf(monthName);
      if (monthIndex === -1) {
        monthIndex = monthAbbr.indexOf(monthName);
      }
      if (monthIndex !== -1) {
        const startDate = new Date(year, monthIndex, 1);
        const endDate = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999); // Last day of month
        return resultDate >= startDate && resultDate <= endDate;
      }
    }
    
    // Handle year-only (2024)
    const yearMatch = timeWindowLower.match(/\b(\d{4})\b/);
    if (yearMatch && !quarterMatch && !monthMatch) {
      const year = parseInt(yearMatch[1]);
      const startDate = new Date(year, 0, 1);
      const endDate = new Date(year, 11, 31, 23, 59, 59, 999);
      return resultDate >= startDate && resultDate <= endDate;
    }
    
    // Default: if we can't determine, allow it (better to include than exclude)
    return true;
  } catch (e) {
    console.warn(`[MCP] Error checking timestamp against timeWindow: ${e}`);
    return true; // If we can't validate, include it
  }
}

/**
 * Normalize and validate timestamp from website
 * Uses multiple extraction methods to find the actual publication date
 * Falls back to timeWindow-based estimate if website timestamp is unavailable
 */
async function normalizeWebsiteTimestamp(
  timestamp: string | undefined, 
  timeWindow: string,
  url?: string,
  snippet?: string,
  title?: string
): Promise<string | undefined> {
  // Method 1: Use the actual website timestamp from search results if provided
  if (timestamp) {
    try {
      const date = new Date(timestamp);
      if (!isNaN(date.getTime())) {
        console.log(`[MCP] ✓ Found timestamp from search results: ${date.toISOString()}`);
        return date.toISOString();
      }
    } catch (e) {
      console.warn(`[MCP] Invalid timestamp format from search results: ${timestamp}`);
    }
  }
  
  // Method 2: Extract date from URL patterns
  if (url) {
    const urlDate = extractDateFromUrl(url);
    if (urlDate) {
      console.log(`[MCP] ✓ Extracted date from URL: ${urlDate}`);
      return urlDate;
    }
  }
  
  // Method 3: Extract date from snippet/title text
  if (snippet || title) {
    const textDate = extractDateFromText((snippet || "") + " " + (title || ""));
    if (textDate) {
      console.log(`[MCP] ✓ Extracted date from text: ${textDate}`);
      return textDate;
    }
  }
  
  // Method 4: Try to fetch metadata using MCP tools (async, but we'll wait for it)
  if (url) {
    const mcpDate = await fetchTimestampFromMCP(url);
    if (mcpDate) {
      console.log(`[MCP] ✓ Extracted date from MCP metadata: ${mcpDate}`);
      return mcpDate;
    }
  }
  
  // Method 5: Use API to extract date from URL (async, but we'll wait for it)
  if (url) {
    const apiDate = await extractDateFromURLAPI(url);
    if (apiDate) {
      console.log(`[MCP] ✓ Extracted date using URL API: ${apiDate}`);
      return apiDate;
    }
  }
  
  // If no valid timestamp from website, use timeWindow to estimate
  // This is a fallback - we prefer actual website timestamps
  const now = new Date();
  let estimatedDate: Date;
  
  const timeWindowLower = timeWindow.toLowerCase();
  if (timeWindowLower.includes("today") || timeWindowLower.includes("this week")) {
    // For "this week", use a date within the last 7 days
    const daysAgo = Math.floor(Math.random() * 7); // Random day within the week
    estimatedDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  } else if (timeWindowLower.includes("last week")) {
    estimatedDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else if (timeWindowLower.includes("this month")) {
    const daysAgo = Math.floor(Math.random() * 30);
    estimatedDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  } else if (timeWindowLower.includes("last month")) {
    estimatedDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  } else if (timeWindowLower.includes("recent")) {
    // "Recent" means within last 30 days
    const daysAgo = Math.floor(Math.random() * 30);
    estimatedDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  } else if (timeWindowLower.match(/q[1-4]/i)) {
    // Quarter-based: estimate based on current quarter
    const quarter = parseInt(timeWindowLower.match(/q([1-4])/i)?.[1] || "1");
    const currentYear = now.getFullYear();
    const month = (quarter - 1) * 3;
    estimatedDate = new Date(currentYear, month, 1);
  } else if (timeWindowLower.match(/\d{4}/)) {
    // Year-based: use the year specified
    const year = parseInt(timeWindowLower.match(/(\d{4})/)?.[1] || String(now.getFullYear()));
    estimatedDate = new Date(year, 0, 1);
  } else {
    // Default: use a date within the last 7 days (most common case)
    const daysAgo = Math.floor(Math.random() * 7);
    estimatedDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);
  }
  
  // Log that we're using an estimated date (not from website)
  console.log(`[MCP] No website timestamp available for ${timeWindow}, using estimated date: ${estimatedDate.toISOString()}`);
  return estimatedDate.toISOString();
}

/**
 * Generate "why it matters" explanation using the main agent LLM
 */
async function generateWhyItMatters(snippet: string, query: string, persona: string = ""): Promise<string> {
  try {
    const systemPrompt = `${getGalliumAIBrandPrompt(persona)}

You are analyzing a trend snippet and generating a concise "why it matters" explanation.

Requirements:
- 1-2 sentences maximum
- Sharp, opinionated, no corporate fluff (Gallium AI voice)
- Focus on why this matters RIGHT NOW for marketers/growth teams
- Be concrete and actionable`;

    const userMessage = `Based on this trend snippet about "${query}", generate a compelling "why it matters" explanation:

Snippet: "${snippet}"

Generate a concise explanation (1-2 sentences) in Gallium AI's voice: sharp, opinionated, no fluff.`;

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(userMessage),
    ];

    const response = await llm.invoke(messages);
    const content = response.content as string;
    
    // Clean up the response (remove quotes if wrapped, trim whitespace)
    const cleaned = content.trim().replace(/^["']|["']$/g, '').trim();
    
    // Fallback if response is too short or empty
    if (cleaned.length < 20) {
      return `This trend reflects current developments in ${query} that merit attention from growth teams.`;
    }
    
    return cleaned;
  } catch (error) {
    console.warn(`[MCP] Failed to generate "why it matters" with LLM, using fallback:`, error);
    // Fallback to simple rule-based generation if LLM fails
    if (snippet.toLowerCase().includes("growth") || snippet.toLowerCase().includes("increase")) {
      return `This trend shows significant growth potential in ${query}, indicating a shift in market dynamics.`;
    } else if (snippet.toLowerCase().includes("new") || snippet.toLowerCase().includes("emerging")) {
      return `This represents an emerging development in ${query} that could reshape the industry landscape.`;
    } else if (snippet.toLowerCase().includes("change") || snippet.toLowerCase().includes("shift")) {
      return `This trend signals an important shift in how ${query} is evolving, with implications for stakeholders.`;
    }
    return `This trend is significant because it reflects current developments in ${query} that merit attention.`;
  }
}

/**
 * Calculate confidence score based on result quality
 */
function calculateConfidence(result: SearchResult, timeWindow: string): number {
  let confidence = 0.5; // Base confidence
  
  // Recency scoring (more recent = higher confidence)
  if (result.timestamp) {
    try {
      const resultDate = new Date(result.timestamp);
      const now = new Date();
      const daysAgo = (now.getTime() - resultDate.getTime()) / (1000 * 60 * 60 * 24);
      
      if (daysAgo < 1) confidence += 0.25; // Very recent (today)
      else if (daysAgo < 7) confidence += 0.2; // This week
      else if (daysAgo < 30) confidence += 0.15; // This month
      else if (daysAgo < 90) confidence += 0.1; // This quarter
      else if (daysAgo < 365) confidence += 0.05; // This year
      // Older than a year gets no bonus
    } catch (e) {
      console.warn(`[MCP] Invalid timestamp format: ${result.timestamp}`);
    }
  }
  
  // Content quality scoring
  const snippet = result.snippet || "";
  if (snippet.length > 150) confidence += 0.1; // Detailed content
  else if (snippet.length > 100) confidence += 0.05;
  
  // Check for indicators of quality content
  const hasNumbers = /\d+/.test(snippet); // Has specific data/numbers
  const hasActionWords = /\b(growth|increase|decrease|change|trend|rise|fall|new|emerging|latest)\b/i.test(snippet);
  
  if (hasNumbers) confidence += 0.05; // Data-driven
  if (hasActionWords) confidence += 0.05; // Action-oriented
  
  // URL quality (basic heuristics)
  if (result.url) {
    const url = result.url.toLowerCase();
    // Higher confidence for known reputable domains
    if (url.includes('techcrunch.com') || url.includes('forbes.com') || 
        url.includes('bloomberg.com') || url.includes('wsj.com') ||
        url.includes('theverge.com') || url.includes('wired.com')) {
      confidence += 0.05;
    }
    // Lower confidence for social media or user-generated content (unless specifically needed)
    if (url.includes('reddit.com') || url.includes('twitter.com') || url.includes('x.com')) {
      confidence -= 0.05;
    }
  }
  
  // Clamp between 0.3 and 0.95
  return Math.max(0.3, Math.min(0.95, confidence));
}

