import { ConvexProvider as ConvexProviderBase } from "convex/react";
import { ConvexReactClient } from "convex/react";
import { ReactNode } from "react";

const convexUrl = import.meta.env.VITE_CONVEX_URL || "";

if (!convexUrl && typeof window !== "undefined") {
  console.warn("⚠️ NEXT_PUBLIC_CONVEX_URL is not set. Please add it to your .env file.");
}

const convex = new ConvexReactClient(convexUrl);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <ConvexProviderBase client={convex}>{children}</ConvexProviderBase>;
}

