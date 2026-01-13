/**
 * Utility functions for the application
 */

/**
 * Main supported platforms - these will be shown with their own sections
 * All other platforms will be grouped under "Other"
 */
export const MAIN_PLATFORMS = [
  "LinkedIn",
  "X",
  "TikTok",
  "Instagram",
  "YouTube",
  "Reddit",
  "Facebook",
  "Medium",
  "Substack",
  "Threads",
  "Pinterest",
  "Snapchat",
  "Discord",
] as const;

/**
 * Check if a platform is in the main platforms list
 */
export function isMainPlatform(platform: string): boolean {
  return (MAIN_PLATFORMS as readonly string[]).includes(platform);
}

/**
 * Get the display platform name - returns "Other" for non-main platforms
 */
export function getDisplayPlatform(platform: string): string {
  const normalized = normalizePlatformName(platform);
  return isMainPlatform(normalized) ? normalized : "Other";
}

/**
 * Format relative time (e.g., "2 days ago", "1 week ago")
 */
export function getRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  
  if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  } else if (diffDays < 7) {
    return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
  } else if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7);
    return `${weeks} week${weeks !== 1 ? 's' : ''} ago`;
  } else if (diffDays < 365) {
    const months = Math.floor(diffDays / 30);
    return `${months} month${months !== 1 ? 's' : ''} ago`;
  } else {
    const years = Math.floor(diffDays / 365);
    return `${years} year${years !== 1 ? 's' : ''} ago`;
  }
}

/**
 * Check if a date is recent (within last 7 days)
 */
export function isRecentDate(date: Date): boolean {
  const now = Date.now();
  const sevenDaysInMs = 7 * 24 * 60 * 60 * 1000;
  return (now - date.getTime()) < sevenDaysInMs;
}

/**
 * Format date for display
 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric',
    hour: date.getHours() === 0 ? undefined : '2-digit',
    minute: date.getMinutes() === 0 ? undefined : '2-digit'
  });
}

/**
 * Convert content ideas to markdown format
 */
export function contentIdeasToMarkdown(contentIdeas: Array<{
  platform: string;
  ideas: Array<{
    hook: string;
    format: string;
    angle: string;
    trendReference: string;
    description: string;
    variants?: string[];
  }>;
  createdAt?: number;
}>): string {
  // Group by display platform (grouping non-main platforms under "Other")
  const byPlatform = contentIdeas.reduce((acc, item) => {
    const displayPlatform = getDisplayPlatform(item.platform);
    if (!acc[displayPlatform]) {
      acc[displayPlatform] = [];
    }
    acc[displayPlatform].push(item);
    return acc;
  }, {} as Record<string, typeof contentIdeas>);
  
  // Sort platforms: main platforms first (alphabetically), then "Other" at the end
  const sortedPlatforms = Object.keys(byPlatform).sort((a, b) => {
    if (a === "Other") return 1;
    if (b === "Other") return -1;
    return a.localeCompare(b);
  });

  let markdown = '# Content Ideas\n\n';
  markdown += `Generated: ${new Date().toLocaleString()}\n\n`;
  markdown += '---\n\n';

  sortedPlatforms.forEach((displayPlatform) => {
    const items = byPlatform[displayPlatform];
    markdown += `## ${displayPlatform}\n\n`;
    
    items.forEach((item, itemIdx) => {
      item.ideas.forEach((idea, ideaIdx) => {
        const ideaNumber = itemIdx * item.ideas.length + ideaIdx + 1;
        markdown += `### Idea ${ideaNumber}: ${idea.hook}\n\n`;
        markdown += `**Format:** ${idea.format}\n\n`;
        markdown += `**Description:**\n${idea.description}\n\n`;
        markdown += `**Angle:**\n${idea.angle}\n\n`;
        markdown += `**Trend Reference:**\n${idea.trendReference}\n\n`;
        
        if (idea.variants && idea.variants.length > 0) {
          markdown += `**Variants:**\n`;
          idea.variants.forEach((variant, idx) => {
            markdown += `${idx + 1}. ${variant}\n`;
          });
          markdown += '\n';
        }
        
        markdown += '---\n\n';
      });
    });
  });

  return markdown;
}

/**
 * Download content as markdown file
 */
export function downloadMarkdown(content: string, filename: string = 'content-ideas.md'): void {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Normalize platform name to standard format
 * Handles variations and returns the standardized name
 */
export function normalizePlatformName(platform: string): string {
  if (!platform || typeof platform !== 'string') return platform;
  
  const lower = platform.toLowerCase().trim();
  
  // Map variations to standard names
  const platformMap: Record<string, string> = {
    'linkedin': 'LinkedIn',
    'linked.in': 'LinkedIn',
    'twitter': 'X',
    'x': 'X',
    'tiktok': 'TikTok',
    'tiktok.com': 'TikTok',
    'instagram': 'Instagram',
    'insta': 'Instagram',
    'instagr.am': 'Instagram',
    'youtube': 'YouTube',
    'youtu.be': 'YouTube',
    'reddit': 'Reddit',
    'facebook': 'Facebook',
    'fb': 'Facebook',
    'fb.com': 'Facebook',
    'medium': 'Medium',
    'substack': 'Substack',
    'threads': 'Threads',
    'threads.net': 'Threads',
    'pinterest': 'Pinterest',
    'pin.it': 'Pinterest',
    'snapchat': 'Snapchat',
    'discord': 'Discord',
    'discord.com': 'Discord',
  };
  
  // Check exact match first
  if (platformMap[lower]) {
    return platformMap[lower];
  }
  
  // Check if it's already a valid/common platform name (case-insensitive)
  const normalized = MAIN_PLATFORMS.find(p => p.toLowerCase() === lower);
  if (normalized) {
    return normalized;
  }
  
  // Return capitalized version if not found (first letter uppercase, rest lowercase)
  return platform.charAt(0).toUpperCase() + platform.slice(1).toLowerCase();
}

