"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import styles from "./chat.module.css";
import type { ChatInputProps, Step } from "@/types";

const DEFAULT_PERSONAS = [
  "Growth lead at a D2C brand",
  "Founder building in public",
  "Small marketing team lead",
  "Content creator / Influencer",
  "B2B marketing director",
  "SaaS growth marketer",
] as const;

export default function ChatInput({ onNewConversation, onStepChange }: ChatInputProps) {
  const [query, setQuery] = useState("");
  const [persona, setPersona] = useState<string>(DEFAULT_PERSONAS[0]);
  const [isLoading, setIsLoading] = useState(false);
  const createConversation = useMutation(api.mutations.createConversation);

  const handlePersonaChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setPersona(e.target.value);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isLoading) return;

    setIsLoading(true);
    onStepChange("planning");

    try {
      // Create conversation in Convex
      const conversationId = await createConversation({
        userId: "user-1", // TODO: Get from auth
        userQuery: query,
        userPersona: persona || undefined,
      });

      onNewConversation(conversationId);

      // Trigger LangGraph execution via API route
      const response = await fetch("/api/agent/execute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userQuery: query,
          userPersona: persona || undefined,
          conversationId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(errorData.error || "Failed to start agent execution");
      }
      
      const result = await response.json();
      console.log("Agent execution started:", result);
      
      setQuery("");
    } catch (error) {
      console.error("Error creating conversation:", error);
      alert(error instanceof Error ? error.message : "Failed to start research. Please check your environment variables and try again.");
      onStepChange("idle");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.chatInputContainer}>
      <div className={styles.personaSelector}>
        <label htmlFor="persona-select" className={styles.personaLabel}>
          Persona:
        </label>
        <select
          id="persona-select"
          value={persona}
          onChange={handlePersonaChange}
          className={styles.personaSelect}
          disabled={isLoading}
        >
          {DEFAULT_PERSONAS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      <form onSubmit={handleSubmit} className={styles.chatForm}>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="What's trending this week in creator monetization, and give me 10 content ideas for LinkedIn + X."
          className={styles.chatInput}
          disabled={isLoading}
        />
        <button
          type="submit"
          disabled={isLoading || !query.trim()}
          className={styles.submitButton}
        >
          {isLoading ? "Researching..." : "Start Research"}
        </button>
      </form>
    </div>
  );
}

