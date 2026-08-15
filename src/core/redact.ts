/** Credential-safe report redaction utilities. */

const SENSITIVE_KEY = /(token|api[_-]?key|authorization|secret|password|cookie)/i;
const ASSIGNMENT = /\b([\w.-]*(?:token|api[_-]?key|authorization|secret|password|cookie)[\w.-]*)\s*([:=])\s*([^\s,;]+)/gi;
const AUTHORIZATION_HEADER = /\bauthorization\s*:\s*(?:bearer\s+)?[^\s,;]+/gi;
const BEARER = /\bBearer\s+[^\s,;]+/gi;

/** Redacts common credential assignments while preserving enough audit context to diagnose output. */
export function redactText(value: string): string {
  return value.replace(AUTHORIZATION_HEADER, 'Authorization: [REDACTED]').replace(ASSIGNMENT, (_match, key: string, separator: string) => `${key}${separator}[REDACTED]`).replace(BEARER, 'Bearer [REDACTED]');
}

/** Recursively redacts sensitive object fields without mutating the caller's evidence object. */
export function redactValue(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, child]) => [key, isSensitiveField(key, child) ? '[REDACTED]' : redactValue(child)]));
  }
  return value;
}

/** Keeps the numeric token-count metric while still redacting credential fields named token. */
function isSensitiveField(key: string, value: unknown): boolean {
  return !(key.toLowerCase() === 'tokens' && typeof value === 'number') && SENSITIVE_KEY.test(key);
}
