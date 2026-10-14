import { createHash } from 'node:crypto';

/** Stable hash of a job description: lowercased, whitespace collapsed. */
export function descriptionHash(text: string | null | undefined): string | null {
  if (!text) return null;
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalized).digest('hex');
}
