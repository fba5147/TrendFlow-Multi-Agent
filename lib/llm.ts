import { ChatGroq } from "@langchain/groq";

/**
 * Shared LLM instance used across the application
 * Initialized with Groq (free tier available)
 */
export const llm = new ChatGroq({
  modelName: process.env.LLM_MODEL,
  temperature: 0.7,
  streaming: true,
  apiKey: process.env.GROQ_API_KEY,
});

