import { StateGraph, END, START, Annotation } from "@langchain/langgraph";
import { AgentState, ResearchPlan, Trend, ContentIdea, GeneratedContent, ContentOutputType } from "./state";
import {
  researchPlanningNode,
  trendRetrievalNode,
  synthesisNode,
  hitlCheckpointNode,
  contentGenerationNode,
} from "./nodes";
import { normalizePlatformName } from "../../utils";

/**
 * Extended state type for internal callbacks (not part of AgentState)
 */
interface AgentStateWithCallbacks extends AgentState {
  __onTrendFound?: (trend: Trend, allTrendsSoFar: Trend[]) => void | Promise<void>;
  __onPlatformComplete?: (platform: string, ideas: ContentIdea[]) => void;
}

/**
 * Define state schema using Annotation
 */
const graphState = Annotation.Root({
  userQuery: Annotation<string>(),
  userPersona: Annotation<string | undefined>(),
  conversationId: Annotation<string | undefined>(),
  selectedSources: Annotation<string[] | undefined>(),
  outputType: Annotation<ContentOutputType | undefined>(),
  llmProvider: Annotation<string | undefined>(),
  llmModel: Annotation<string | undefined>(),
  researchPlan: Annotation<ResearchPlan | undefined>(),
  trends: Annotation<Trend[] | undefined>(),
  researchComplete: Annotation<boolean>(),
  checkpointStatus: Annotation<"pending" | "approved" | "refined" | "restarted">(),
  refinementRequest: Annotation<string | undefined>(),
  approvedTrends: Annotation<Trend[] | undefined>(),
  platforms: Annotation<string[] | undefined>(),
  contentIdeas: Annotation<Record<string, ContentIdea[]> | undefined>(),
  generatedContent: Annotation<GeneratedContent | undefined>(),
  generationComplete: Annotation<boolean>(),
  step: Annotation<"planning" | "researching" | "synthesizing" | "checkpoint" | "generating" | "complete">(),
  error: Annotation<string | undefined>(),
  messages: Annotation<Array<{
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: number;
  }>>(),
});

/**
 * Create the LangGraph state machine
 * 
 * Flow:
 * START → planning → retrieval → synthesis → checkpoint → [conditional] → generation → END
 */
export function createAgentGraph() {
  // LangGraph.js state machine with proper state schema
  const workflow = new StateGraph(graphState)
    .addNode("planning", researchPlanningNode)
    .addNode("retrieval", (state: AgentState) => {
      // Wrapper to handle incremental updates - callback is passed via state
      return trendRetrievalNode(state);
    })
    .addNode("synthesis", synthesisNode)
    .addNode("checkpoint", hitlCheckpointNode)
    .addNode("generation", (state: AgentState) => {
      // Wrapper to handle incremental updates when called through graph
      // Note: We can't pass callbacks directly to nodes, so we handle updates
      // in the graph streaming loop instead
      return contentGenerationNode(state);
    })
    .addEdge(START, "planning")
    .addEdge("planning", "retrieval")
    .addEdge("retrieval", "synthesis")
    .addEdge("synthesis", "checkpoint")
    .addConditionalEdges(
      "checkpoint",
      (state: AgentState) => {
        // Check checkpoint status to determine next step
        if (state.checkpointStatus === "approved") {
          return "approved";
        } else if (state.checkpointStatus === "refined") {
          return "refined";
        } else if (state.checkpointStatus === "restarted") {
          return "restarted";
        }
        return "waiting";
      },
      {
        approved: "generation",
        refined: "planning", // Loop back to planning with refinement
        restarted: "planning", // Restart from beginning
        waiting: END, // Wait for user action (external trigger needed)
      }
    )
    .addEdge("generation", END);

  return workflow.compile();
}

/**
 * Execute the graph with streaming support
 */
export async function executeAgent(
  initialState: AgentState,
  callbacks?: {
    onStateUpdate?: (state: AgentState) => void;
    onTrendUpdate?: (trends: Trend[]) => void;
    onContentUpdate?: (platform: string, ideas: ContentIdea[]) => void;
  }
): Promise<AgentState> {
  const graph = createAgentGraph();
  let finalState = initialState;
  const seenPlatforms = new Set<string>(); // Track platforms we've already sent callbacks for
  
  try {
    // Inject callback for trend updates into initial state (for retrieval node)
    const onTrendUpdateCallback = callbacks?.onTrendUpdate;
    const initialStateWithCallback: AgentStateWithCallbacks = {
      ...initialState,
      __onTrendFound: onTrendUpdateCallback ? async (trend: Trend, allTrendsSoFar: Trend[]) => {
        // Call the callback with all trends found so far (incremental update)
        await onTrendUpdateCallback(allTrendsSoFar);
      } : undefined,
    };
    
    // Stream execution events
    // Note: LangGraph's stream accepts the state type, but we need to cast to work with internal callbacks
    const stream = await graph.stream(initialStateWithCallback as unknown as AgentState, {
      streamMode: "updates", // Stream state updates after each node
    });
    
    for await (const update of stream) {
      // Update is a record of node names to their output state updates
      // Example: { synthesis: { trends: [...] }, checkpoint: { step: "checkpoint", checkpointStatus: "pending" } }
      const nodeUpdates = update as Record<string, Partial<AgentState>>;
      
      // Merge all node updates into finalState
      for (const nodeName in nodeUpdates) {
        const updateObj = nodeUpdates[nodeName];
        finalState = { ...finalState, ...updateObj };
        
        console.log(`[Graph] Node "${nodeName}" updated state: step=${updateObj.step}, checkpointStatus=${updateObj.checkpointStatus}, trends=${updateObj.trends?.length || 0}`);
      }
      
      // Call callbacks with merged state after all node updates
      if (callbacks?.onStateUpdate) {
        callbacks.onStateUpdate(finalState);
      }
      
      // Handle trend updates (when trends are added/updated)
      // Filter to only high-confidence trends (>= 65%) before sending to frontend
      const allTrends = finalState.trends;
      if (allTrends && allTrends.length > 0) {
        const highConfidenceTrends = allTrends.filter(
          t => (t.confidence || 0) >= 0.65
        );
        if (highConfidenceTrends.length > 0 && callbacks?.onTrendUpdate) {
          callbacks.onTrendUpdate(highConfidenceTrends);
        }
      }
      
      // Handle content updates (when content ideas are generated)
      // Only send callbacks for newly added platforms (incremental updates)
      if (finalState.contentIdeas && callbacks?.onContentUpdate) {
        for (const [platform, ideas] of Object.entries(finalState.contentIdeas)) {
          // Send callback only if we haven't seen this platform yet (incremental update)
          if (!seenPlatforms.has(platform) && ideas && Array.isArray(ideas) && ideas.length > 0) {
            seenPlatforms.add(platform);
            callbacks.onContentUpdate(platform, ideas);
          }
        }
      }
      
      // Stop at checkpoint if waiting for approval
      if (finalState.step === "checkpoint" && finalState.checkpointStatus === "pending") {
        console.log(`[Graph] Reached checkpoint, stopping and waiting for approval`);
        break; // Wait for external approval
      }
    }
  } catch (error) {
    console.error("Graph execution error:", error);
    finalState = {
      ...initialState,
      error: error instanceof Error ? error.message : "Unknown error",
      step: "complete",
    };
  }

  return finalState;
}

/**
 * Resume graph execution after HITL checkpoint
 */
export async function resumeAgent(
  currentState: AgentState,
  callbacks?: {
    onStateUpdate?: (state: AgentState) => void;
    onContentUpdate?: (platform: string, ideas: ContentIdea[]) => void;
  }
): Promise<AgentState> {
  const graph = createAgentGraph();
  let finalState = currentState;
  
  try {
    // Handle refinement or restart - update state appropriately
    if (currentState.checkpointStatus === "refined" && currentState.refinementRequest) {
      // Incorporate refinement into research plan
      finalState = {
        ...currentState,
        userQuery: `${currentState.userQuery}. Refinement: ${currentState.refinementRequest}`,
        step: "planning",
        checkpointStatus: "pending",
        refinementRequest: currentState.refinementRequest, // Keep for planning node
        trends: undefined, // Clear previous trends
        researchComplete: false,
      };
    } else if (currentState.checkpointStatus === "restarted") {
      // Reset to planning
      finalState = {
        ...currentState,
        step: "planning",
        checkpointStatus: "pending",
        trends: undefined,
        researchPlan: undefined,
        researchComplete: false,
        generationComplete: false,
        approvedTrends: undefined,
      };
    } else if (currentState.checkpointStatus === "approved") {
      // Continue to generation with approved trends
      // Use platforms from research plan (determined from user query)
      const approvedTrends = currentState.approvedTrends || currentState.trends || [];
      
      // Get platforms from research plan (extracted from user query during planning)
      let platformsArray: string[] = [];
      
      if (currentState.researchPlan?.platforms && Array.isArray(currentState.researchPlan.platforms) && currentState.researchPlan.platforms.length > 0) {
        // Use platforms from research plan (determined from user query)
        platformsArray = currentState.researchPlan.platforms.map(p => normalizePlatformName(p));
      } else if (Array.isArray(currentState.platforms) && currentState.platforms.length > 0) {
        // Fallback to platforms in state
        platformsArray = currentState.platforms.map(p => normalizePlatformName(p));
      } else {
        // Last resort: default platforms
        platformsArray = ["LinkedIn", "X"];
        console.warn("[Graph Resume] No platforms found in research plan or state, using default:", platformsArray);
      }
      
      // Remove duplicates and sort
      platformsArray = [...new Set(platformsArray)].sort();
      
      console.log(`[Graph Resume] Using platforms from user query: ${platformsArray.join(", ")}`);
      
      finalState = {
        ...currentState,
        step: "generating",
        approvedTrends: approvedTrends,
        platforms: platformsArray,
      };
      
      if (!finalState.approvedTrends || finalState.approvedTrends.length === 0) {
        throw new Error("No approved trends available for content generation");
      }
      
      // When approved, directly invoke the generation node (sub-agent) instead of starting from START
      // (The graph always starts from START, which would restart the whole process)
      console.log(`[Graph Resume] Approved - invoking content generation sub-agent with ${finalState.approvedTrends.length} approved trends`);
      console.log(`[Graph Resume] Platforms extracted from sources: ${platformsArray.join(", ")}`);
      
      // Store callback in state temporarily for incremental updates
      const stateWithCallback: AgentStateWithCallbacks = {
        ...finalState,
        __onPlatformComplete: callbacks?.onContentUpdate,
      };

      // Invoke content generation sub-agent directly with incremental callback
      // This sub-agent generates platform-specific ideas with all required fields:
      // - Hook, Format, Angle, Trend Reference (with citation), Description, Variants
      // The node will call __onPlatformComplete after each platform completes
      const generationUpdate = await contentGenerationNode(stateWithCallback);
      
      // Merge generation update into final state (callback is not returned, only used internally)
      finalState = { ...finalState, ...generationUpdate };
      
      // Check if all platforms have been processed
      const expectedPlatforms = (finalState.platforms || []).map(p => normalizePlatformName(p));
      const generatedPlatforms = Object.keys(finalState.contentIdeas || {}).map(p => normalizePlatformName(p));
      
      // Normalize for comparison
      const normalizedGenerated = new Set(generatedPlatforms);
      const allPlatformsProcessed = expectedPlatforms.length > 0 && 
        expectedPlatforms.every(p => normalizedGenerated.has(p) || (finalState.contentIdeas?.[p]?.length === 0));
      
      console.log(`[Graph Resume] Sub-agent completed. Generated ideas for platforms: ${Object.keys(finalState.contentIdeas || {}).join(", ")}`);
      console.log(`[Graph Resume] Expected platforms: ${expectedPlatforms.join(", ")}`);
      console.log(`[Graph Resume] Normalized generated platforms: ${Array.from(normalizedGenerated).join(", ")}`);
      console.log(`[Graph Resume] All platforms processed: ${allPlatformsProcessed}`);
      console.log(`[Graph Resume] Generation node step: ${generationUpdate.step}`);
      
      // Mark as complete if all platforms are done (or if generation node returned complete)
      // The generation node already checks and sets step: "complete", so we should respect that
      if (generationUpdate.step === "complete" || allPlatformsProcessed) {
        finalState = {
          ...finalState,
          step: "complete",
          generationComplete: true,
        };
        
        console.log(`[Graph Resume] Marking as complete. Final step: ${finalState.step}`);
        
        // Update state callback with complete status - this saves to Convex
        if (callbacks?.onStateUpdate) {
          callbacks.onStateUpdate(finalState);
        }
      } else {
        // Still processing, but update state with current progress
        console.log(`[Graph Resume] Not yet complete. Still processing platforms...`);
        if (callbacks?.onStateUpdate) {
          callbacks.onStateUpdate(finalState);
        }
      }
      
      return finalState;
    }
    
    // For refined/restarted, continue from updated state (will start from planning)
    const seenPlatforms = new Set<string>(); // Track platforms we've already sent callbacks for
    
    const stream = await graph.stream(finalState, {
      streamMode: "updates",
    });
    
    for await (const update of stream) {
      // Update is a record of node names to their output state updates
      const nodeUpdates = update as Record<string, Partial<AgentState>>;
      
      // Merge all node updates into finalState
      for (const nodeName in nodeUpdates) {
        const updateObj = nodeUpdates[nodeName];
        finalState = { ...finalState, ...updateObj };
        console.log(`[Graph Resume] Node "${nodeName}" updated state: step=${updateObj.step}`);
      }
      
      if (callbacks?.onStateUpdate) {
        callbacks.onStateUpdate(finalState);
      }
      
      // Handle content updates incrementally (only for newly added platforms)
      if (finalState.contentIdeas && callbacks?.onContentUpdate) {
        for (const [platform, ideas] of Object.entries(finalState.contentIdeas)) {
          // Send callback only if we haven't seen this platform yet (incremental update)
          if (!seenPlatforms.has(platform) && ideas && Array.isArray(ideas) && ideas.length > 0) {
            seenPlatforms.add(platform);
            callbacks.onContentUpdate(platform, ideas);
          }
        }
      }
      
      // Stop at checkpoint if we hit another one
      if (finalState.step === "checkpoint" && finalState.checkpointStatus === "pending") {
        break;
      }
    }
  } catch (error) {
    console.error("Graph resume error:", error);
    finalState = {
      ...currentState,
      error: error instanceof Error ? error.message : "Unknown error",
      step: "complete",
    };
  }

  return finalState;
}

