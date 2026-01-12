# Trend-to-Idea Agent

An AI-native agentic system that researches trends and generates platform-specific content ideas using LangGraph, MCP servers, and human-in-the-loop checkpoints.

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Set up Convex

```bash
npx convex dev
```

This will:
- Create a Convex project (if needed)
- Generate TypeScript types
- Start the Convex dev server

Copy the `NEXT_PUBLIC_CONVEX_URL` from the output and add it to `.env`.

### 3. Configure Environment Variables

Copy the example file:

```bash
cp .env.example .env
```

Fill in the required values:
- `NEXT_PUBLIC_CONVEX_URL` - From Convex setup (required)
- `GROQ_API_KEY` - Your Groq API key (free at https://console.groq.com) (required)
- `MCP_SERVER_COMMAND` - MCP server command (required)
- `MCP_SERVER_ARGS` - MCP server arguments (required)
- `BRAVE_API_KEY` - If using Brave Search MCP (optional but recommended)

See `.env.example` for detailed configuration options.

### 4. Run Development Server

```bash
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000)

## 📁 Project Structure

```
/
├── app/                    # Next.js App Router
│   ├── api/agent/         # API routes (LangGraph execution)
│   ├── chat/              # Chat interface page
│   ├── globals.css        # Global styles
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Home page
├── components/            # React components
│   ├── chat/              # Chat UI components
│   │   ├── *.tsx          # Component files
│   │   ├── *.module.css   # Component styles
│   │   └── index.ts       # Component exports
│   ├── sidebar/           # Content ideas sidebar
│   │   ├── *.tsx          # Component files
│   │   ├── *.module.css   # Component styles
│   │   └── index.ts       # Component exports
│   ├── providers/         # React providers
│   │   └── ConvexProvider.tsx
│   └── index.ts           # Centralized exports
├── convex/                # Convex backend
│   ├── _generated/        # Auto-generated types
│   ├── schema.ts          # Database schema
│   ├── mutations.ts       # State mutations
│   └── queries.ts         # Data queries
├── lib/                   # Business logic & utilities
│   ├── langgraph/         # LangGraph orchestration
│   │   ├── state.ts       # State definitions & schemas
│   │   ├── nodes.ts       # Agent nodes
│   │   └── graph.ts       # LangGraph workflow
│   ├── mcp/               # MCP client integration
│   │   └── client.ts      # MCP server client
│   ├── prompts.ts         # System prompts & brand context
│   └── index.ts           # Centralized exports
├── types/                 # TypeScript type definitions
│   └── index.ts           # Centralized types
├── utils/                 # Utility functions
│   └── index.ts           # Utility exports
└── package.json
```

## ✨ Features

- ✅ **LangGraph State Machine** - 5-node workflow (planning → retrieval → synthesis → checkpoint → generation)
- ✅ **MCP Integration** - Real-time web research via MCP servers (Brave Search, etc.)
- ✅ **Convex Backend** - Real-time subscriptions and state persistence
- ✅ **HITL Checkpoints** - Human-in-the-loop approval with refine/restart options
- ✅ **Streaming UX** - Real-time updates throughout the workflow
- ✅ **Content Generation** - Platform-specific ideas (LinkedIn, X/Twitter, TikTok, Instagram)
- ✅ **Brand Context** - Gallium brand voice integrated into all prompts
- ✅ **Error Handling** - Robust JSON parsing and error recovery
- ✅ **TypeScript** - Full type safety throughout
- ✅ **Tailwind CSS** - Modern, responsive UI

## 🔄 Workflow

1. **Planning** - Extract scope (time window, region, domain) from user query
2. **Research** - Fetch trends using MCP servers with citations
3. **Synthesis** - Rank trends, enhance summaries, calculate confidence
4. **Checkpoint** - Pause for user approval/refinement/restart
5. **Generation** - Create platform-specific content ideas based on approved trends

## 🧪 Testing

Quick test:
```bash
npm run dev
# Navigate to http://localhost:3000
# Enter a query like: "What's trending this week in AI marketing?"
```

The system will:
1. Plan the research based on your query
2. Fetch trends using MCP servers
3. Display research results with citations
4. Pause for your approval at the checkpoint
5. Generate platform-specific content ideas after approval

## 🛠️ Tech Stack

- **Frontend**: Next.js 14 (App Router), React 18, Tailwind CSS
- **Backend**: Convex (real-time database & functions)
- **Orchestration**: LangGraph (@langchain/langgraph)
- **LLM**: Groq (free tier, fast inference)
- **Research**: MCP (Model Context Protocol) servers
- **Language**: TypeScript

## 🔐 Environment Variables

See `.env.example` for all available configuration options.

Required:
- `NEXT_PUBLIC_CONVEX_URL` - Convex project URL
- `GROQ_API_KEY` - Groq API key
- `MCP_SERVER_COMMAND` - MCP server command
- `MCP_SERVER_ARGS` - MCP server arguments
