# Trend-to-Idea Agent

An AI-native agentic system that researches trends and generates platform-specific content ideas using LangGraph, MCP servers, and human-in-the-loop checkpoints.

## 🚀 Quick Start

```bash
npm install
npx convex dev
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

## 🎨 Frontend

### Setup

1. Install dependencies:
```bash
npm install
```

2. Configure environment variables:
- `NEXT_PUBLIC_CONVEX_URL` - Convex project URL (from `npx convex dev`)

3. Run development server:
```bash
npm run dev
```

### Structure

```
app/                    # Next.js App Router
├── api/agent/         # API routes
├── chat/              # Chat interface
└── page.tsx           # Home page

components/            # React components
├── chat/              # Chat UI components
├── sidebar/           # Content ideas sidebar
└── providers/         # React providers
```

### Tech Stack

- Next.js 14 (App Router)
- React 18
- Tailwind CSS
- TypeScript

## ⚙️ Backend

### Setup

1. Set up Convex:
```bash
npx convex dev
```

2. Configure environment variables:
- `CONVEX_DEPLOYMENT` - Convex deployment URL
- `GROQ_API_KEY` - Groq API key (https://console.groq.com)
- `MCP_SERVER_COMMAND` - MCP server command
- `MCP_SERVER_ARGS` - MCP server arguments
- `BRAVE_API_KEY` - Brave Search API key (https://brave.com/search/api/)
- `LLM_MODEL` - Groq model name (e.g., "llama-3.1-70b-versatile")

### Structure

```
convex/                # Convex backend
├── schema.ts          # Database schema
├── mutations.ts       # State mutations
└── queries.ts         # Data queries

lib/                   # Business logic
├── langgraph/         # LangGraph orchestration
│   ├── state.ts       # State definitions
│   ├── nodes.ts       # Agent nodes
│   └── graph.ts       # Workflow
├── mcp/               # MCP client
└── prompts.ts         # System prompts
```

### Tech Stack

- Convex (real-time database)
- LangGraph (orchestration)
- Groq (LLM)
- MCP servers (research)

## 🔄 Workflow

1. **Planning** - Extract scope from user query
2. **Research** - Fetch trends using MCP servers
3. **Synthesis** - Rank trends and calculate confidence
4. **Checkpoint** - Human-in-the-loop approval
5. **Generation** - Create platform-specific content ideas

## ✨ Features

- LangGraph state machine (5-node workflow)
- MCP integration for web research
- Real-time Convex subscriptions
- Human-in-the-loop checkpoints
- Platform-specific content generation (LinkedIn, X, TikTok, Instagram)
