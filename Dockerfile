# ---- Stage 1: Install all dependencies ----
FROM node:23-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=optional

# ---- Stage 2: Build frontend + server ----
FROM node:23-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build Vite frontend → dist/ and TypeScript server → dist-server/
RUN npm run build

# ---- Stage 3: Production runtime ----
FROM node:23-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Install only production deps
COPY package*.json ./
RUN npm ci --omit=dev --include=optional && \
    # Remove dev tooling left in optional deps
    rm -rf /root/.npm /tmp/*

# Copy build outputs + Convex generated types
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/convex/_generated ./convex/_generated

# Non-root user for security
RUN addgroup -S trendflow && adduser -S trendflow -G trendflow
USER trendflow

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=45s --retries=3 \
    CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "dist-server/server/index.js"]
