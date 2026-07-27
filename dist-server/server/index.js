"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const agent_1 = require("./routes/agent");
const app = (0, express_1.default)();
const PORT = process.env.PORT || 3001;
app.use((0, cors_1.default)());
app.use(express_1.default.json());
// API routes
app.use("/api/agent", agent_1.agentRouter);
// Serve Vite production build
const distPath = path_1.default.join(__dirname, "../dist");
app.use(express_1.default.static(distPath));
app.get("*", (_req, res) => {
    res.sendFile(path_1.default.join(distPath, "index.html"));
});
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
