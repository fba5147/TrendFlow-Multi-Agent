# TrendFlow

**Open-source multi-agent framework for trend discovery, research, and AI-powered content generation using MCP and LangGraph.**

Built for AI engineers, growth engineers, marketing automation developers, and founders who want full control over their trend intelligence pipeline.

---

## Why TrendFlow?

Most content tools are black boxes. TrendFlow is the opposite — a composable, extensible agent framework you can fork, run locally, and connect to any data source or LLM you already use. Add a plugin, swap a model, and deploy. No vendor lock-in.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│   Vite + React (port 3000)                  │
│   Settings: sources · output type · model   │
└────────────────────┬────────────────────────┘
                     │ HTTP
┌────────────────────▼────────────────────────┐
│   Express server (port 3001)                │
│   POST/PUT /api/agent/execute               │
└────────────────────┬────────────────────────┘
                     │
      ┌──────────────┴──────────────┐
      │                             │
┌─────▼──────┐             ┌────────▼───────┐
│  LangGraph │             │    Convex      │
│  (5-node   │◄────────────│  (real-time DB │
│  workflow) │  mutations  │   + queries)   │
└─────┬──────┘             └────────────────┘
      │
┌─────▼──────────────────────────────────────┐
│  Plugin Registry                           │
│  Sources: Brave · HN · GitHub · Reddit     │
│           ArXiv · RSS · NewsAPI            │
│  Generators: Blog · LinkedIn · X · Letter  │
└────────────────────────────────────────────┘
```

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill in environment variables
cp .env.example .env

# 3. Start Convex (in a separate terminal)
npx convex dev

# 4. Start the full stack
npm run dev
```

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001

---

## Data Sources (Plugins)

TrendFlow fetches from multiple sources in parallel. Enable any combination from the UI or by passing `selectedSources` to the API.

| Plugin | ID | Free | Requires |
|--------|----|------|---------|
| Brave Search | `brave-search` | No | `BRAVE_API_KEY` + MCP server |
| Hacker News | `hacker-news` | Yes | Nothing |
| GitHub Trends | `github-trends` | Yes | Optional `GITHUB_TOKEN` |
| Reddit | `reddit` | Yes | Nothing |
| ArXiv | `arxiv` | Yes | Nothing (great for AI/ML) |
| RSS Feeds | `rss-feed` | Yes | `RSS_FEEDS` (comma-separated URLs) |
| News API | `news-api` | No | `NEWS_API_KEY` |

---

## Content Generators (Plugins)

After the HITL checkpoint, TrendFlow generates the output type you select:

| Generator | ID | Description |
|-----------|----|-------------|
| Content Ideas | `content-ideas` | Platform-specific post ideas (default) |
| Blog Post | `blog-post` | Full long-form article (800–1500 words) |
| LinkedIn Post | `linkedin-post` | Single post with hook, insight, CTA |
| X Thread | `x-thread` | Viral thread (6–10 tweets) |
| Newsletter | `newsletter` | Weekly email digest |

---

## Supported LLM Providers

TrendFlow uses Groq by default (free tier). Swap to any provider via `LLM_PROVIDER` in `.env` or per-request via the UI settings panel.

| Provider | `LLM_PROVIDER` | Install | Env var |
|----------|---------------|---------|---------|
| Groq (default) | `groq` | included | `GROQ_API_KEY` |
| OpenAI | `openai` | `npm i @langchain/openai` | `OPENAI_API_KEY` |
| Anthropic | `anthropic` | `npm i @langchain/anthropic` | `ANTHROPIC_API_KEY` |
| Google Gemini | `gemini` | `npm i @langchain/google-genai` | `GOOGLE_API_KEY` |
| DeepSeek | `deepseek` | `npm i @langchain/openai` | `DEEPSEEK_API_KEY` |
| Ollama (local) | `ollama` | `npm i @langchain/ollama` | `OLLAMA_BASE_URL` |

---

## Plugin Architecture

TrendFlow uses a registry-based plugin system. Each plugin implements a simple interface:

```typescript
// Source plugin
interface SourcePlugin {
  id: string;
  name: string;
  isAvailable(): boolean;
  fetch(query: TrendQuery): Promise<SourceResult[]>;
}

// Generator plugin
interface GeneratorPlugin {
  id: string;
  outputType: ContentOutputType;
  generate(trends: Trend[], config: GenerationConfig): Promise<GeneratedContent>;
}
```

### Adding a plugin

```
plugins/
  sources/
    your-source/
      index.ts    ← implements SourcePlugin
  generators/
    your-generator/
      index.ts    ← implements GeneratorPlugin
```

Register in `plugins/core/registry.ts`:
```typescript
registry.registerSource(yourSourcePlugin);
registry.registerGenerator(yourGeneratorPlugin);
```

That's it. No core changes needed.

---

## Environment Variables

```env
# Convex (required)
VITE_CONVEX_URL=https://your-deployment.convex.cloud
CONVEX_URL=https://your-deployment.convex.cloud

# LLM
LLM_PROVIDER=groq          # groq | openai | anthropic | gemini | deepseek | ollama
LLM_MODEL=llama-3.3-70b-versatile
GROQ_API_KEY=...

# Source plugins
BRAVE_API_KEY=...           # brave-search plugin
GITHUB_TOKEN=...            # github-trends (optional, improves rate limits)
NEWS_API_KEY=...            # news-api plugin
RSS_FEEDS=url1,url2         # rss-feed plugin

# Server
PORT=3001
```

---

## Project Structure

```
├── plugins/                  # Plugin system
│   ├── core/
│   │   ├── types.ts          # SourcePlugin + GeneratorPlugin interfaces
│   │   └── registry.ts       # Plugin registry + initialization
│   ├── sources/              # Data source plugins
│   │   ├── brave-search/     # MCP-based Brave Search
│   │   ├── hacker-news/      # HN top stories
│   │   ├── github-trends/    # GitHub Search API
│   │   ├── reddit/           # Reddit public API
│   │   ├── arxiv/            # ArXiv papers
│   │   ├── rss-feed/         # Custom RSS feeds
│   │   └── news-api/         # NewsAPI.org
│   └── generators/           # Content generator plugins
│       ├── blog-post/
│       ├── linkedin-post/
│       ├── x-thread/
│       └── newsletter/
│
├── server/                   # Express backend
│   ├── index.ts
│   └── routes/agent.ts       # POST/PUT /api/agent/execute
│
├── src/                      # Vite + React frontend
│   ├── main.tsx
│   ├── App.tsx
│   └── pages/Chat.tsx
│
├── components/               # UI components
│   ├── chat/                 # Chat interface
│   ├── sidebar/              # Content output panel
│   ├── settings/             # SettingsPanel (sources · output · model)
│   └── providers/
│
├── lib/                      # Core agent logic
│   ├── langgraph/
│   │   ├── state.ts          # AgentState
│   │   ├── nodes.ts          # 5 workflow nodes
│   │   └── graph.ts          # LangGraph state machine
│   ├── mcp/client.ts         # MCP + Brave Search client
│   ├── llm.ts                # Multi-LLM factory
│   └── prompts.ts
│
├── convex/                   # Real-time database
├── types/
├── utils/
├── index.html
├── vite.config.ts
├── tsconfig.json             # Client TS config
└── tsconfig.server.json      # Server TS config (includes plugins/)
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start frontend (port 3000) + backend (port 3001) concurrently |
| `npm run dev:client` | Vite dev server only |
| `npm run dev:server` | Express server with hot reload only |
| `npm run build` | Build frontend (`dist/`) + backend (`dist-server/`) |
| `npm start` | Production: serve API + static frontend |
| `npx convex dev` | Start Convex in development mode |
| `npx convex deploy` | Deploy Convex schema and functions |

---

## Agent Workflow

```
START
  │
  ▼
Planning  → parses query, extracts domain/timeWindow/platforms, selects tools
  │
  ▼
Retrieval → fetches from selected source plugins in parallel (MCP + HN + GitHub + ...)
  │         runs up to 50 queries until 5–10 high-confidence (≥65%) trends found
  ▼
Synthesis → LLM ranks, deduplicates, enhances "why it matters", caps at 10
  │
  ▼
Checkpoint ◄─── HITL: user reviews trends, then Approves / Refines / Restarts
  │
  ├── Approved ──► Generation
  │                 runs selected generator plugin (content-ideas / blog / thread / ...)
  │                 ▼
  │                END
  │
  ├── Refined ───► Planning (loop with refinement request)
  │
  └── Restarted ─► Planning (full restart)
```

---

## API

### `POST /api/agent/execute`

Start a new research run.

```json
{
  "userQuery": "AI agents trends this week",
  "userPersona": "Growth lead at a D2C brand",
  "conversationId": "conv_abc123",
  "selectedSources": ["brave-search", "hacker-news", "github-trends"],
  "outputType": "blog-post",
  "llmProvider": "openai",
  "llmModel": "gpt-4o"
}
```

### `PUT /api/agent/execute`

Resume after HITL checkpoint.

```json
{
  "conversationId": "conv_abc123",
  "checkpointStatus": "approved",
  "approvedTrends": [...]
}
```

---

## Tech Stack

**Frontend** — Vite + React 18, React Router v6, Tailwind CSS, Convex React  
**Backend** — Express, LangGraph, LangChain (multi-provider), MCP SDK, Convex, Zod  
**Default LLM** — Groq (llama-3.3-70b-versatile, free tier)

---

## Production Deployment

```bash
npm run build
npm start
```

The Express server at `dist-server/server/index.js` serves both the API and the compiled React app. Set `PORT` to configure the port (default: 3001).

---

## Contributing

Plugins are the primary extension point. To contribute a new data source or generator:

1. Create `plugins/sources/your-source/index.ts` or `plugins/generators/your-generator/index.ts`
2. Implement the `SourcePlugin` or `GeneratorPlugin` interface
3. Register in `plugins/core/registry.ts`
4. Open a PR

---

Created as part of a hiring evaluation. Not licensed for commercial use.
