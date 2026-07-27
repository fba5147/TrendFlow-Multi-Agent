import { SourcePlugin, GeneratorPlugin } from "./types";

class PluginRegistry {
  private sources = new Map<string, SourcePlugin>();
  private generators = new Map<string, GeneratorPlugin>();

  registerSource(plugin: SourcePlugin) {
    this.sources.set(plugin.id, plugin);
    console.log(`[Registry] Registered source plugin: ${plugin.id}`);
  }

  registerGenerator(plugin: GeneratorPlugin) {
    this.generators.set(plugin.id, plugin);
    console.log(`[Registry] Registered generator plugin: ${plugin.id}`);
  }

  getSource(id: string): SourcePlugin | undefined {
    return this.sources.get(id);
  }

  getGenerator(id: string): GeneratorPlugin | undefined {
    return this.generators.get(id);
  }

  getAvailableSources(): SourcePlugin[] {
    return Array.from(this.sources.values()).filter((p) => p.isAvailable());
  }

  getAllSources(): SourcePlugin[] {
    return Array.from(this.sources.values());
  }

  getAllGenerators(): GeneratorPlugin[] {
    return Array.from(this.generators.values());
  }
}

export const registry = new PluginRegistry();

export function initializeRegistry() {
  const { hackerNewsPlugin } = require("../sources/hacker-news");
  const { githubTrendsPlugin } = require("../sources/github-trends");
  const { redditPlugin } = require("../sources/reddit");
  const { arxivPlugin } = require("../sources/arxiv");
  const { rssFeedPlugin } = require("../sources/rss-feed");
  const { newsApiPlugin } = require("../sources/news-api");
  const { blogPostGenerator } = require("../generators/blog-post");
  const { linkedinPostGenerator } = require("../generators/linkedin-post");
  const { xThreadGenerator } = require("../generators/x-thread");
  const { newsletterGenerator } = require("../generators/newsletter");

  registry.registerSource(hackerNewsPlugin);
  registry.registerSource(githubTrendsPlugin);
  registry.registerSource(redditPlugin);
  registry.registerSource(arxivPlugin);
  registry.registerSource(rssFeedPlugin);
  registry.registerSource(newsApiPlugin);

  registry.registerGenerator(blogPostGenerator);
  registry.registerGenerator(linkedinPostGenerator);
  registry.registerGenerator(xThreadGenerator);
  registry.registerGenerator(newsletterGenerator);
}
