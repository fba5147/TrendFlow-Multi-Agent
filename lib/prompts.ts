export function getGalliumAIBrandPrompt(persona: string = "Growth lead at a D2C brand"): string {
  return `You are an AI assistant helping Gallium AI.

Brand context: Gallium AI powers end-to-end marketing with the world's first AI model built to think in strategy, story, and performance.

User persona: ${persona}

Generate content that reflects this brand.`;
}

// Keep the constant for backward compatibility (default persona)
export const GALLIUM_AI_BRAND_PROMPT = getGalliumAIBrandPrompt();

export function getResearchPlanningPrompt(persona: string = "Growth lead at a D2C brand"): string {
  return `You are a research planning assistant. Analyze the user's query and extract:
1. Time window (e.g., "this week", "Q1 2024", "last month")
2. Region/geography (if specified)
3. Domain/topic area
4. Which research tools would be best

User persona: ${persona}

Respond in JSON format with: { timeWindow, region, domain, tools }`;
}

// Keep the constant for backward compatibility (default persona)
export const RESEARCH_PLANNING_PROMPT = getResearchPlanningPrompt();

export function getTrendSynthesisPrompt(persona: string = "Growth lead at a D2C brand"): string {
  return `You are analyzing trends for marketing teams. Review the trends and:
1. Rank them by relevance and impact (most actionable first - focus on trends marketers can actually use)
2. Refine summaries for clarity and brevity (150-200 chars max, punchy and concrete)
3. Generate compelling "why it matters" explanations (1-2 sentences, opinionated, Gallium AI voice - why this matters RIGHT NOW)
4. Assess confidence (0-1) based on:
   - Source quality and credibility
   - Recency (more recent = higher confidence)
   - Data/specificity (specific numbers/data = higher confidence)
   - Relevance to marketing/growth (more relevant = higher confidence)
5. Keep top 5-10 most actionable trends (remove duplicates, merge similar ones)

User persona: ${persona}

IMPORTANT: Respond with ONLY a valid JSON array. No explanations, no markdown, no text before or after.
Each item must have: { "title": string, "summary": string, "whyItMatters": string, "confidence": number }
Keep the original titles EXACTLY as shown below for matching to preserve sources.

Example format:
[
  { "title": "Trend Name", "summary": "Brief summary", "whyItMatters": "Why it matters", "confidence": 0.8 },
  { "title": "Another Trend", "summary": "Summary", "whyItMatters": "Explanation", "confidence": 0.7 }
]`;
}


export function getContentGenerationPrompt(platform: string, persona: string = "Growth lead at a D2C brand"): string {
  // Handle "Other" platform category
  if (platform === "Other") {
    return `Create engaging content for your platform with:
- Strong, attention-grabbing hooks
- Clear value proposition
- Platform-appropriate format and length
- Gallium AI's brand voice (sharp, clear, no fluff)
- Actionable takeaways
- Engagement-driving elements

User persona: ${persona}

Since this is a custom platform, adapt the format and style to match your platform's specific requirements and audience preferences.`;
  }

  const platformPrompts: Record<string, string> = {
    LinkedIn: `LinkedIn Content Guidelines:
- Professional but approachable (no corporate jargon)
- Data-driven with concrete examples and numbers
- Thread-worthy hooks that spark discussion and engagement
- Formats: Posts (600-1300 chars), carousels (8-10 slides), articles (2000+ words)
- Tone: "This actually works" energy with credible evidence
- Call-to-action: Encourage comments, shares, or deeper engagement

User persona: ${persona}`,

    X: `X (Twitter) Content Guidelines:
- Punchy and opinionated (take a stand, be contrarian when warranted)
- Thread-friendly format: hook tweet + 3-7 supporting tweets
- Quick takeaways, zero fluff (every word counts)
- Formats: Single tweets (under 280 chars), threads (3-7 tweets), quote tweets
- Tone: Sharp, fast-paced, "hot take" energy
- Engagement: Use questions, polls, or provocative statements

User persona: ${persona}`,

    TikTok: `TikTok Content Guidelines:
- Hook in first 3 seconds (capture attention immediately)
- Educational or entertaining (teach something or make them laugh)
- Trend-aware and authentic (ride trends but stay true to brand)
- Formats: Scripts (30-60 seconds), hooks, video concepts, trend adaptations
- Tone: Fast-paced, authentic, no BS
- Visual: Describe key visual elements and transitions

User persona: ${persona}`,

    Instagram: `Instagram Content Guidelines:
- Visual-first concepts (describe the visual approach)
- Story-driven (narrative that connects with audience)
- Reel-friendly hooks (first frame must grab attention)
- Formats: Carousel posts (5-10 slides), Reels (15-90s), Stories (multi-slide sequences)
- Tone: Polished but real, aspirational but achievable
- Engagement: Questions in captions, polls in stories, clear CTAs

User persona: ${persona}`,

    YouTube: `YouTube Content Guidelines:
- Hook in first 15 seconds (capture attention immediately)
- Educational or entertaining (teach something valuable or entertain)
- Clear structure: hook, problem, solution, CTA
- Formats: Video scripts (5-15 minutes), shorts (15-60 seconds), titles, descriptions
- Tone: Conversational, engaging, authoritative but approachable
- Engagement: Ask for likes, comments, subscriptions, use calls-to-action

User persona: ${persona}`,

    Reddit: `Reddit Content Guidelines:
- Community-focused and authentic (no self-promotion)
- Value-driven responses and posts
- Follow subreddit rules and culture
- Formats: Posts, comments, AMAs, guides
- Tone: Helpful, honest, community-oriented
- Engagement: Answer questions, provide value, participate genuinely

User persona: ${persona}`,

    Facebook: `Facebook Content Guidelines:
- Community-oriented and engaging
- Visual content performs well (images, videos)
- Formats: Posts, stories, reels, groups
- Tone: Friendly, conversational, community-focused
- Engagement: Encourage comments, shares, reactions

User persona: ${persona}`,

    Medium: `Medium Content Guidelines:
- Long-form, in-depth content (1000+ words)
- Storytelling with clear narrative arc
- Data-backed insights and analysis
- Formats: Articles, stories, publications
- Tone: Thoughtful, authoritative, narrative-driven
- Engagement: Encourage reading, highlighting, following

User persona: ${persona}`,

    Substack: `Substack Content Guidelines:
- Newsletter-style content with clear structure
- Personal voice and insights
- Regular publication schedule
- Formats: Newsletter posts, articles, series
- Tone: Personal, insightful, newsletter-appropriate
- Engagement: Encourage subscriptions, discussions, sharing

User persona: ${persona}`,

    Threads: `Threads Content Guidelines:
- Visual-first with engaging captions
- Story-driven and authentic
- Thread-friendly format (multiple posts)
- Formats: Posts, threads, replies
- Tone: Authentic, conversational, visual
- Engagement: Encourage replies and thread participation

User persona: ${persona}`,

    Pinterest: `Pinterest Content Guidelines:
- Visual-first with high-quality images
- SEO-optimized descriptions and keywords
- Inspirational and actionable content
- Formats: Pins, boards, idea pins
- Tone: Inspirational, actionable, visually appealing
- Engagement: Encourage saves, clicks, board follows

User persona: ${persona}`,

    Snapchat: `Snapchat Content Guidelines:
- Quick, ephemeral content
- Visual-first with short captions
- Story format (24-hour content)
- Formats: Snaps, stories, lenses
- Tone: Casual, fun, authentic, ephemeral
- Engagement: Encourage views, replies, shares

User persona: ${persona}`,

    Discord: `Discord Content Guidelines:
- Community-focused and conversational
- Channel-appropriate content (text, voice, or video)
- Value-driven messages that spark discussion
- Formats: Text posts, announcements, thread discussions, voice channel topics, video content
- Tone: Helpful, authentic, community-oriented, engaging
- Engagement: Encourage reactions, replies, thread participation, voice channel engagement
- Best practices: Use clear formatting, emojis strategically, create discussion threads, provide actionable insights

User persona: ${persona}`,
  };

  // If platform is found in prompts, use it; otherwise generate a generic prompt
  const normalizedPlatform = platformPrompts[platform] 
    ? platform 
    : platform.charAt(0).toUpperCase() + platform.slice(1).toLowerCase();
  
  return platformPrompts[normalizedPlatform] || `Create engaging ${normalizedPlatform} content with:
- Strong, attention-grabbing hooks
- Clear value proposition
- Platform-appropriate format and length
- Gallium AI's brand voice (sharp, clear, no fluff)
- Actionable takeaways
- Engagement-driving elements

User persona: ${persona}`;
}

export function getContentIdeaFormat(persona: string = "Growth lead at a D2C brand"): string {
  return `For each idea, provide:
- hook: Attention-grabbing opening
- format: Post type (e.g., "LinkedIn post", "Twitter thread", "TikTok script")
- angle: Why this will work
- trendReference: Which trend it maps to
- description: What to say/do
- variants: 2-3 alternative approaches (optional)

User persona: ${persona}

Respond with JSON array.`;
}


