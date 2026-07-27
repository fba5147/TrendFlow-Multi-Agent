import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import path from "path";
import { agentRouter } from "./routes/agent";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// API routes
app.use("/api/agent", agentRouter);

// 404 for unmatched API routes
app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "API route not found" });
});

// Serve Vite production build
const distPath = path.join(__dirname, "../dist");
app.use(express.static(distPath));
app.get("*", (_req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

// Global error handler
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[Server] Unhandled error:", err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
