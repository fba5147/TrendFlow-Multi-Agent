import { useState } from "react";
import styles from "./settings.module.css";

export interface AgentSettings {
  selectedSources: string[];
  outputType: string;
  llmProvider: string;
  llmModel: string;
}

interface SourceOption {
  id: string;
  name: string;
  description: string;
  free: boolean;
  envVar?: string;
}

interface OutputOption {
  id: string;
  label: string;
  description: string;
}

interface LLMOption {
  id: string;
  label: string;
  defaultModel: string;
  envVar: string;
}

const SOURCES: SourceOption[] = [
  { id: "brave-search", name: "Brave Search", description: "Web search via MCP server", free: false, envVar: "BRAVE_API_KEY" },
  { id: "hacker-news", name: "Hacker News", description: "Top stories on HN", free: true },
  { id: "github-trends", name: "GitHub Trends", description: "Trending repos & topics", free: true },
  { id: "reddit", name: "Reddit", description: "Hot posts across subreddits", free: true },
  { id: "arxiv", name: "ArXiv", description: "Latest research papers", free: true },
  { id: "rss-feed", name: "RSS Feeds", description: "Custom feeds via RSS_FEEDS env", free: true, envVar: "RSS_FEEDS" },
  { id: "news-api", name: "News API", description: "75k+ news sources", free: false, envVar: "NEWS_API_KEY" },
];

const OUTPUT_TYPES: OutputOption[] = [
  { id: "content-ideas", label: "Content Ideas", description: "Platform-specific post ideas (default)" },
  { id: "blog-post", label: "Blog Post", description: "Full long-form article (800–1500 words)" },
  { id: "linkedin-post", label: "LinkedIn Post", description: "Single professional post with hook" },
  { id: "x-thread", label: "X Thread", description: "Viral thread (6–10 tweets)" },
  { id: "newsletter", label: "Newsletter", description: "Weekly email digest" },
];

const LLM_PROVIDERS: LLMOption[] = [
  { id: "groq", label: "Groq (default)", defaultModel: "llama-3.3-70b-versatile", envVar: "GROQ_API_KEY" },
  { id: "openai", label: "OpenAI", defaultModel: "gpt-4o", envVar: "OPENAI_API_KEY" },
  { id: "anthropic", label: "Anthropic", defaultModel: "claude-sonnet-4-6", envVar: "ANTHROPIC_API_KEY" },
  { id: "gemini", label: "Google Gemini", defaultModel: "gemini-2.0-flash", envVar: "GOOGLE_API_KEY" },
  { id: "deepseek", label: "DeepSeek", defaultModel: "deepseek-chat", envVar: "DEEPSEEK_API_KEY" },
  { id: "ollama", label: "Ollama (local)", defaultModel: "llama3.2", envVar: "OLLAMA_BASE_URL" },
];

interface SettingsPanelProps {
  settings: AgentSettings;
  onChange: (settings: AgentSettings) => void;
  disabled?: boolean;
}

export default function SettingsPanel({ settings, onChange, disabled }: SettingsPanelProps) {
  const [open, setOpen] = useState(false);

  const toggleSource = (id: string) => {
    const next = settings.selectedSources.includes(id)
      ? settings.selectedSources.filter((s) => s !== id)
      : [...settings.selectedSources, id];
    onChange({ ...settings, selectedSources: next.length ? next : [id] });
  };

  const selectedProvider = LLM_PROVIDERS.find((p) => p.id === settings.llmProvider) || LLM_PROVIDERS[0];

  return (
    <div className={styles.wrapper}>
      <button
        type="button"
        className={styles.toggle}
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        aria-expanded={open}
      >
        <span className={styles.toggleIcon}>{open ? "▲" : "▼"}</span>
        Settings
        <span className={styles.badge}>
          {settings.selectedSources.length} source{settings.selectedSources.length !== 1 ? "s" : ""} ·{" "}
          {OUTPUT_TYPES.find((o) => o.id === settings.outputType)?.label || "Content Ideas"} ·{" "}
          {selectedProvider.label}
        </span>
      </button>

      {open && (
        <div className={styles.panel}>
          {/* Sources */}
          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>Data Sources</h4>
            <div className={styles.sourceGrid}>
              {SOURCES.map((src) => (
                <label key={src.id} className={`${styles.sourceCard} ${settings.selectedSources.includes(src.id) ? styles.checked : ""}`}>
                  <input
                    type="checkbox"
                    checked={settings.selectedSources.includes(src.id)}
                    onChange={() => toggleSource(src.id)}
                    disabled={disabled}
                  />
                  <span className={styles.sourceInfo}>
                    <span className={styles.sourceName}>{src.name}</span>
                    <span className={styles.sourceDesc}>{src.description}</span>
                    {!src.free && <span className={styles.apiKeyBadge}>API key: {src.envVar}</span>}
                  </span>
                </label>
              ))}
            </div>
          </section>

          {/* Output type */}
          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>Generate</h4>
            <div className={styles.outputGrid}>
              {OUTPUT_TYPES.map((opt) => (
                <label key={opt.id} className={`${styles.outputCard} ${settings.outputType === opt.id ? styles.checked : ""}`}>
                  <input
                    type="radio"
                    name="outputType"
                    value={opt.id}
                    checked={settings.outputType === opt.id}
                    onChange={() => onChange({ ...settings, outputType: opt.id })}
                    disabled={disabled}
                  />
                  <span className={styles.outputInfo}>
                    <span className={styles.outputLabel}>{opt.label}</span>
                    <span className={styles.outputDesc}>{opt.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </section>

          {/* LLM model */}
          <section className={styles.section}>
            <h4 className={styles.sectionTitle}>Model</h4>
            <div className={styles.modelRow}>
              <select
                className={styles.modelSelect}
                value={settings.llmProvider}
                onChange={(e) => {
                  const provider = LLM_PROVIDERS.find((p) => p.id === e.target.value)!;
                  onChange({ ...settings, llmProvider: provider.id, llmModel: provider.defaultModel });
                }}
                disabled={disabled}
              >
                {LLM_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <input
                type="text"
                className={styles.modelInput}
                value={settings.llmModel}
                placeholder={selectedProvider.defaultModel}
                onChange={(e) => onChange({ ...settings, llmModel: e.target.value })}
                disabled={disabled}
              />
            </div>
            <p className={styles.modelHint}>Requires <code>{selectedProvider.envVar}</code> in .env</p>
          </section>
        </div>
      )}
    </div>
  );
}

export const DEFAULT_SETTINGS: AgentSettings = {
  selectedSources: ["brave-search"],
  outputType: "content-ideas",
  llmProvider: "groq",
  llmModel: "llama-3.3-70b-versatile",
};
