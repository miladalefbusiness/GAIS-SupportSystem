const SENSITIVE_KEY_PATTERN =
  /password|secret|token|apikey|api_key|authorization|cookie|nationalid|national_id|code_melli|credential/i;

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.length > 1000) return `${value.slice(0, 1000)}…[TRUNCATED]`;
    return value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  }
  const output: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(k)) {
      output[k] = '[REDACTED]';
    } else {
      output[k] = sanitizeValue(v, depth + 1);
    }
  }
  return output;
}

export type LogLevel = 'info' | 'warn' | 'error';

function writeLog(level: LogLevel, event: string, context?: Record<string, unknown>) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(context ? { context: sanitizeValue(context) } : {}),
  };
  const serialized = JSON.stringify(entry);
  if (level === 'error') {
    console.error(serialized);
  } else if (level === 'warn') {
    console.warn(serialized);
  } else {
    console.info(serialized);
  }
}

export const logger = {
  info: (event: string, context?: Record<string, unknown>) => writeLog('info', event, context),
  warn: (event: string, context?: Record<string, unknown>) => writeLog('warn', event, context),
  error: (event: string, context?: Record<string, unknown>) => writeLog('error', event, context),
  sanitize: sanitizeValue,
};
