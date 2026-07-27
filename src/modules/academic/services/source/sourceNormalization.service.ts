export function normalizeSourceUrl(url: string): string {
  let normalized = url.trim().toLowerCase();
  normalized = normalized.replace(/^(https?:\/\/)?(www\.)?/, '');
  return normalized.replace(/\/$/, '');
}
