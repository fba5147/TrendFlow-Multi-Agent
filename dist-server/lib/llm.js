"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.llm = void 0;
const groq_1 = require("@langchain/groq");
/**
 * Shared LLM instance used across the application
 * Initialized with Groq (free tier available)
 */
exports.llm = new groq_1.ChatGroq({
    modelName: process.env.LLM_MODEL,
    temperature: 0.7,
    streaming: true,
    apiKey: process.env.GROQ_API_KEY,
});
