import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { llm } from "../llm";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { GALLIUM_BRAND_PROMPT } from "../prompts";
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

    console.log(`[MCP] Result: ${JSON.stringify(result)}`);

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
async function* searchWithMCP(query: string, maxResults: number = 10): AsyncGenerator<SearchResult, void, unknown> {
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

  // Call the search tool
  const result = await callMCPTool(searchTool, {
    query,
    count: maxResults,
    ...(process.env.BRAVE_API_KEY && { api_key: process.env.BRAVE_API_KEY }),
  });

  // Parse results based on tool response format and yield incrementally
  let resultCount = 0;

  for (const content of result) {
    if (content.type === "text") {
      // Try to parse JSON response
      try {
        const data = JSON.parse(content.text);
        
        // Handle different response formats
        if (data.results && Array.isArray(data.results)) {
          // Brave Search format - try multiple timestamp fields
          for (const item of data.results) {
            if (resultCount >= maxResults) return;
            // Try multiple possible timestamp field names from website
            const timestamp = item.published_date || 
                            item.publishedDate || 
                            item.date || 
                            item.timestamp ||
                            item.publish_date ||
                            item.published_time;
            yield {
              url: item.url || item.link || "",
              title: item.title || "",
              snippet: item.description || item.snippet || "",
              timestamp: timestamp, // Website timestamp (from Brave Search API)
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
  domain?: string
): Promise<any[]> {
  console.log(`[MCP] Fetching trends incrementally for: ${query} (${timeWindow})`);
  
  // Try to get from cache first
  if (convex) {
    try {
      const queryHash = generateQueryHash(query, timeWindow, domain);
      const cachedResult = await convex.query(api.queries.getCachedResearch, {
        queryHash,
      });
      
      if (cachedResult && cachedResult.trends && cachedResult.trends.length > 0) {
        console.log(`[MCP] ✓ Cache hit! Using cached results (age: ${Math.round(cachedResult.age / 1000 / 60)} minutes)`);
        
        // Call onTrendFound for each cached trend to maintain streaming behavior
        if (onTrendFound) {
          for (let i = 0; i < cachedResult.trends.length; i++) {
            await onTrendFound(cachedResult.trends[i], cachedResult.trends.slice(0, i + 1));
          }
        }
        
        return cachedResult.trends;
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
  let hasResults = false;
  
  for await (const result of searchWithMCP(query, 10)) {
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
    const whyItMatters = await generateWhyItMatters(cleanSnippet, query);
    
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
    
    // Log timestamp source for transparency
    // Check if we actually used the website timestamp (it was valid) vs. fallback
    let usedWebsiteTimestamp = false;
    if (originalTimestamp && normalizedTimestamp) {
      try {
        const originalDate = new Date(originalTimestamp);
        const normalizedDate = new Date(normalizedTimestamp);
        // If dates are the same (within 1 second tolerance), we used the website timestamp
        usedWebsiteTimestamp = !isNaN(originalDate.getTime()) && 
                              Math.abs(originalDate.getTime() - normalizedDate.getTime()) < 1000;
      } catch (e) {
        // Invalid timestamp, so we used fallback
        usedWebsiteTimestamp = false;
      }
    }
    
    if (usedWebsiteTimestamp) {
      console.log(`[MCP] ✓ Using website timestamp: ${normalizedTimestamp} (from ${result.url})`);
    } else {
      console.log(`[MCP] ⚠ No valid website timestamp available, using timeWindow-based estimate: ${normalizedTimestamp} (for ${result.url}, timeWindow: ${timeWindow})`);
    }
    
    const trend = {
      title: cleanTitle,
      summary: cleanSnippet.substring(0, 200) + (cleanSnippet.length > 200 ? "..." : ""),
      whyItMatters: whyItMatters,
      sources: [
        {
          url: result.url,
          timestamp: normalizedTimestamp, // Use normalized timestamp (from website or timeWindow)
          snippet: cleanSnippet.substring(0, 150),
        },
      ],
      confidence: confidence,
    };
    
    // Print confidence score for each source
    console.log(`[MCP] Source confidence: ${(confidence * 100).toFixed(1)}% | Title: "${cleanTitle.substring(0, 60)}${cleanTitle.length > 60 ? '...' : ''}" | URL: ${result.url}`);
    
    trends.push(trend);
    
    // Call callback incrementally if provided
    if (onTrendFound) {
      await onTrendFound(trend, [...trends]);
    }
  }
  
  if (!hasResults) {
    throw new Error("No search results returned from MCP server");
  }
  
  console.log(`[MCP] Converted ${trends.length} valid trend(s) from search results`);
  
  // Store in cache for future use
  if (convex && trends.length > 0) {
    try {
      const queryHash = generateQueryHash(query, timeWindow, domain);
      const cacheTTL = determineCacheTTL(query, timeWindow);
      
      await convex.mutation(api.mutations.saveResearchCache, {
        queryHash,
        query,
        timeWindow,
        domain: domain || query,
        trends,
        cacheTTL,
      });
      
      console.log(`[MCP] ✓ Cached ${trends.length} trend(s) with TTL: ${Math.round(cacheTTL / 1000 / 60)} minutes`);
    } catch (error) {
      console.warn(`[MCP] Failed to cache results:`, error);
      // Don't throw - caching is best effort
    }
  }
  
  return trends;
}

/**
 * Fetch trends using MCP tools
 * 
 * This function searches the web for trending topics related to the query
 * and returns structured trend data with citations.
 * 
 * Requires MCP_SERVER_COMMAND to be set in environment variables.
 */
export async function fetchTrends(
  query: string,
  timeWindow: string,
  domain?: string
): Promise<any[]> {
  return fetchTrendsIncremental(query, timeWindow, undefined, domain);
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
 * Use LLM to extract publication date from snippet/title if it contains date information
 */
async function extractDateWithLLM(snippet: string, title: string, url: string): Promise<string | undefined> {
  try {
    // Only try LLM if snippet/title seems to contain date information
    const hasDateIndicators = /(?:published|posted|updated|created|released|date|time|ago|yesterday|today|week|month|year|\d{4}|\d{1,2}\/\d{1,2}\/\d{4})/i.test(snippet + " " + title);
    if (!hasDateIndicators) {
      return undefined; // Skip LLM call if no date indicators
    }
    
    const systemPrompt = `Extract the publication date from the given text. Return ONLY a valid ISO 8601 date string (YYYY-MM-DD) or ISO timestamp (YYYY-MM-DDTHH:mm:ssZ). If no date can be determined, return null.`;
    
    const userMessage = `Extract the publication date from this text:

Title: ${title}
Snippet: ${snippet}
URL: ${url}

Return ONLY the date in ISO format (YYYY-MM-DD or ISO timestamp), or null if no date found.`;
    
    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(userMessage),
    ];
    
    const response = await llm.invoke(messages);
    const content = (response.content as string).trim().toLowerCase();
    
    // Check if response is "null" or indicates no date
    if (content === 'null' || content === 'none' || content === 'n/a' || content.includes('no date')) {
      return undefined;
    }
    
    // Try to parse the response as a date
    const date = new Date(content);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
  } catch (error) {
    // Silently fail - LLM extraction is best effort
    console.warn(`[MCP] LLM date extraction failed:`, error);
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
  
  // Method 5: Use LLM to extract date from snippet/title (async, but we'll wait for it)
  if (snippet && title && url) {
    const llmDate = await extractDateWithLLM(snippet, title, url);
    if (llmDate) {
      console.log(`[MCP] ✓ Extracted date using LLM: ${llmDate}`);
      return llmDate;
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
async function generateWhyItMatters(snippet: string, query: string): Promise<string> {
  try {
    const systemPrompt = `${GALLIUM_BRAND_PROMPT}

You are analyzing a trend snippet and generating a concise "why it matters" explanation.

Requirements:
- 1-2 sentences maximum
- Sharp, opinionated, no corporate fluff (Gallium voice)
- Focus on why this matters RIGHT NOW for marketers/growth teams
- Be concrete and actionable`;

    const userMessage = `Based on this trend snippet about "${query}", generate a compelling "why it matters" explanation:

Snippet: "${snippet}"

Generate a concise explanation (1-2 sentences) in Gallium's voice: sharp, opinionated, no fluff.`;

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

