import { getEnv } from "./env.js";

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  const configuredLevel = getEnv().LOG_LEVEL;
  return LOG_LEVELS[level] >= LOG_LEVELS[configuredLevel];
}

function formatMessage(level: LogLevel, message: string, data?: Record<string, unknown>): string {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ` ${JSON.stringify(data)}` : "";
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}`;
}

export const logger = {
  debug(message: string, data?: Record<string, unknown>) {
    if (shouldLog("debug")) {
      console.log(formatMessage("debug", message, data));
    }
  },

  info(message: string, data?: Record<string, unknown>) {
    if (shouldLog("info")) {
      console.log(formatMessage("info", message, data));
    }
  },

  warn(message: string, data?: Record<string, unknown>) {
    if (shouldLog("warn")) {
      console.warn(formatMessage("warn", message, data));
    }
  },

  error(message: string, data?: Record<string, unknown>) {
    if (shouldLog("error")) {
      console.error(formatMessage("error", message, data));
    }
  },
};
