type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const envLevel = process.env.LOG_LEVEL;
const currentLevel: LogLevel =
  envLevel && envLevel in LOG_LEVELS ? (envLevel as LogLevel) : "info";

// Evaluated at module load time. Tests that need to control format output
// should mock formatMessage or assert on console method calls, not output strings.
const isDev = process.env.NODE_ENV === "development";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(
  level: LogLevel,
  data: Record<string, unknown>,
  msg: string
): string {
  if (isDev) {
    const { traceId, ...rest } = data;
    const prefix = traceId ? `[${traceId}] ` : "";
    const extras =
      Object.keys(rest).length > 0 ? ` ${JSON.stringify(rest)}` : "";
    return `${level.toUpperCase()} ${prefix}${msg}${extras}`;
  }
  return JSON.stringify({
    level,
    msg,
    timestamp: new Date().toISOString(),
    ...data,
  });
}

export const logger = {
  debug(data: Record<string, unknown>, msg: string) {
    if (shouldLog("debug")) console.debug(formatMessage("debug", data, msg));
  },
  info(data: Record<string, unknown>, msg: string) {
    if (shouldLog("info")) console.info(formatMessage("info", data, msg));
  },
  warn(data: Record<string, unknown>, msg: string) {
    if (shouldLog("warn")) console.warn(formatMessage("warn", data, msg));
  },
  error(data: Record<string, unknown>, msg: string) {
    if (shouldLog("error")) console.error(formatMessage("error", data, msg));
  },
};
