const SENSITIVE_KEYS = [
  'token',
  'id_token',
  'idToken',
  'access_token',
  'accessToken',
  'refresh_token',
  'refreshToken',
  'authorization',
  'Authorization',
  'codeVerifier',
  'code_verifier',
  'code',
];

function looksSensitiveString(value: string) {
  if (value.length > 120) return true;
  if (value.split('.').length === 3 && value.length > 80) return true;
  if (value.startsWith('ya29.')) return true;
  if (value.startsWith('1//')) return true;
  return false;
}

function redactValue(value: unknown): unknown {
  if (typeof value === 'string') {
    if (looksSensitiveString(value)) {
      return `${value.slice(0, 6)}...[redacted]`;
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map(redactValue);
  }

  if (value && typeof value === 'object') {
    const clean: Record<string, unknown> = {};

    Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
      const keyLower = key.toLowerCase();

      if (SENSITIVE_KEYS.some((sensitive) => keyLower.includes(sensitive.toLowerCase()))) {
        clean[key] = '[redacted]';
      } else {
        clean[key] = redactValue(item);
      }
    });

    return clean;
  }

  return value;
}

export const logger = {
  debug: (...args: unknown[]) => {
    if (!__DEV__) return;
    console.log(...args.map(redactValue));
  },

  info: (...args: unknown[]) => {
    if (!__DEV__) return;
    console.log(...args.map(redactValue));
  },

  warn: (...args: unknown[]) => {
    if (!__DEV__) return;
    console.warn(...args.map(redactValue));
  },

  error: (...args: unknown[]) => {
    if (!__DEV__) return;
    console.error(...args.map(redactValue));
  },
};
