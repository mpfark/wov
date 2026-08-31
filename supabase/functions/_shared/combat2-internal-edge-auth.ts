export function bearerToken(header: string | null): string | null {
  if (!header?.toLowerCase().startsWith('bearer ')) return null;
  const token = header.slice(7).trim();
  return token || null;
}

export async function constantTimeSecretEqual(supplied: string, expected: string): Promise<boolean> {
  try {
    const encode = new TextEncoder();
    const [suppliedHash, expectedHash] = await Promise.all([
      crypto.subtle.digest('SHA-256', encode.encode(supplied)),
      crypto.subtle.digest('SHA-256', encode.encode(expected)),
    ]);
    const suppliedBytes = new Uint8Array(suppliedHash);
    const expectedBytes = new Uint8Array(expectedHash);
    let difference = 0;
    for (let index = 0; index < suppliedBytes.length; index += 1) difference |= suppliedBytes[index] ^ expectedBytes[index];
    return difference === 0;
  } catch {
    return false;
  }
}

export function redact(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') {
    return secrets.reduce((text, secret) => secret ? text.replaceAll(secret, '[REDACTED]') : text, value);
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item, secrets)]));
  }
  return value;
}
