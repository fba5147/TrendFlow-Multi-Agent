import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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
 * Search using MCP tools
 * 
 * Tries common MCP search tool names:
 * - brave_search
 * - google_search
 * - web_search
 * - search
 */
async function searchWithMCP(query: string, maxResults: number = 10): Promise<SearchResult[]> {
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

  // Parse results based on tool response format
  const results: SearchResult[] = [];

  for (const content of result) {
    if (content.type === "text") {
      // Try to parse JSON response
      try {
        const data = JSON.parse(content.text);
        
        // Handle different response formats
        if (data.results && Array.isArray(data.results)) {
          // Brave Search format
          for (const item of data.results) {
            results.push({
              url: item.url || item.link || "",
              title: item.title || "",
              snippet: item.description || item.snippet || "",
              timestamp: item.published_date,
            });
          }
        } else if (data.items && Array.isArray(data.items)) {
          // Google Search format
          for (const item of data.items) {
            results.push({
              url: item.link || item.url || "",
              title: item.title || "",
              snippet: item.snippet || item.description || "",
              timestamp: item.pagemap?.metatags?.[0]?.["article:published_time"],
            });
          }
        } else if (Array.isArray(data)) {
          // Direct array format
          for (const item of data) {
            results.push({
              url: item.url || item.link || "",
              title: item.title || "",
              snippet: item.snippet || item.description || "",
              timestamp: item.timestamp,
            });
          }
        }
      } catch (e) {
        // Not JSON - parse plain text format (Title: ... Description: ... URL: ...)
        const text = content.text;
        
        // Split by double newlines to get individual results
        const resultBlocks = text.split(/\n\n+/);
        
        for (const block of resultBlocks) {
          const titleMatch = block.match(/Title:\s*(.+?)(?:\n|$)/i);
          const descriptionMatch = block.match(/Description:\s*([\s\S]+?)(?:\n(?:Title:|URL:)|$)/i);
          const urlMatch = block.match(/URL:\s*(.+?)(?:\n|$)/i);
          
          if (titleMatch || urlMatch) {
            const description = descriptionMatch 
              ? descriptionMatch[1].trim().replace(/\n+/g, " ").replace(/\s+/g, " ")
              : "";
            
            results.push({
              url: urlMatch ? urlMatch[1].trim() : "",
              title: titleMatch ? titleMatch[1].trim() : "",
              snippet: description.substring(0, 300) || "",
            });
          }
        }
        
        // If no structured blocks found with double newlines, try parsing line by line
        if (results.length === 0) {
          const lines = text.split('\n');
          let currentResult: Partial<SearchResult> = {};
          
          for (const line of lines) {
            const trimmedLine = line.trim();
            if (!trimmedLine) continue;
            
            if (trimmedLine.startsWith('Title:')) {
              if (currentResult.url || currentResult.title) {
                // Save previous result
                results.push({
                  url: currentResult.url || "",
                  title: currentResult.title || "",
                  snippet: (currentResult.snippet || "").trim(),
                });
              }
              currentResult = { 
                title: trimmedLine.replace(/^Title:\s*/i, '').trim(),
                snippet: ""
              };
            } else if (trimmedLine.startsWith('Description:')) {
              currentResult.snippet = trimmedLine.replace(/^Description:\s*/i, '').trim();
            } else if (trimmedLine.startsWith('URL:')) {
              currentResult.url = trimmedLine.replace(/^URL:\s*/i, '').trim();
              // Save this result
              if (currentResult.title || currentResult.url) {
                results.push({
                  url: currentResult.url || "",
                  title: currentResult.title || "",
                  snippet: (currentResult.snippet || "").trim(),
                });
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
            results.push({
              url: currentResult.url || "",
              title: currentResult.title || "",
              snippet: (currentResult.snippet || "").trim(),
            });
          }
        }
      }
    }
  }

  if (results.length === 0) {
    console.error(`[MCP] Failed to parse results. Raw response:`, JSON.stringify(result, null, 2));
    throw new Error("No search results returned from MCP server");
  }

  console.log(`[MCP] Parsed ${results.length} results from MCP server`);
  return results.slice(0, maxResults);
}


/**
 * Fetch trends using MCP tools (incremental version)
 * 
 * This function searches the web for trending topics and calls onTrendFound
 * for each trend as it's processed, allowing incremental streaming.
 * 
 * Requires MCP_SERVER_COMMAND to be set in environment variables.
 */
export async function fetchTrendsIncremental(
  query: string,
  timeWindow: string,
  onTrendFound?: (trend: any, allTrendsSoFar: any[]) => void | Promise<void>
): Promise<any[]> {
  console.log(`[MCP] Fetching trends incrementally for: ${query} (${timeWindow})`);
  
  // Ensure MCP client is initialized
  if (!mcpClientInitialized) {
    await initializeMCPClient();
  }
  
  if (!mcpClient) {
    throw new Error("MCP client is not available. Please configure MCP_SERVER_COMMAND in .env");
  }
  
  // Use MCP to search
  const searchResults = await searchWithMCP(query, 10);
  console.log(`[MCP] Got ${searchResults.length} results from MCP`);
  
  if (searchResults.length === 0) {
    throw new Error("No search results returned from MCP server");
  }
  
  // Convert search results to trend format incrementally
  // Enhanced processing with better filtering and quality checks
  const trends: any[] = [];
  
  for (const result of searchResults) {
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
    
    const trend = {
      title: cleanTitle,
      summary: cleanSnippet.substring(0, 200) + (cleanSnippet.length > 200 ? "..." : ""),
      whyItMatters: generateWhyItMatters(cleanSnippet, query),
      sources: [
        {
          url: result.url,
          timestamp: result.timestamp,
          snippet: cleanSnippet.substring(0, 150),
        },
      ],
      confidence: calculateConfidence(result, timeWindow),
    };
    
    trends.push(trend);
    
    // Call callback incrementally if provided
    if (onTrendFound) {
      await onTrendFound(trend, [...trends]);
    }
  }
  
  console.log(`[MCP] Converted ${trends.length} valid trend(s) from ${searchResults.length} search result(s)`);
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
  timeWindow: string
): Promise<any[]> {
  return fetchTrendsIncremental(query, timeWindow);
}

/**
 * Generate "why it matters" explanation
 */
function generateWhyItMatters(snippet: string, query: string): string {
  if (snippet.toLowerCase().includes("growth") || snippet.toLowerCase().includes("increase")) {
    return `This trend shows significant growth potential in ${query}, indicating a shift in market dynamics.`;
  } else if (snippet.toLowerCase().includes("new") || snippet.toLowerCase().includes("emerging")) {
    return `This represents an emerging development in ${query} that could reshape the industry landscape.`;
  } else if (snippet.toLowerCase().includes("change") || snippet.toLowerCase().includes("shift")) {
    return `This trend signals an important shift in how ${query} is evolving, with implications for stakeholders.`;
  }
  return `This trend is significant because it reflects current developments in ${query} that merit attention.`;
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

