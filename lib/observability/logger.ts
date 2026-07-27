import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  ...(process.env.NODE_ENV !== "production" && {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" },
    },
  }),
  base: {
    service: "trendflow",
    version: process.env.npm_package_version || "0.2.0",
    env: process.env.NODE_ENV || "development",
  },
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "body.password",
    "body.token",
    "body.apiKey",
    "*.GROQ_API_KEY",
    "*.OPENAI_API_KEY",
    "*.ANTHROPIC_API_KEY",
  ],
  serializers: {
    req: pino.stdSerializers.req,
    res: pino.stdSerializers.res,
    err: pino.stdSerializers.err,
  },
});

export function createChildLogger(context: Record<string, unknown>) {
  return logger.child(context);
}
