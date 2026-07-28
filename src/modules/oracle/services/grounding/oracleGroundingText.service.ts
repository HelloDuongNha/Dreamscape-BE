export function compactGroundingText(value: unknown, max: number): string {
  const clean = String(value ?? '').replace(/\s+/gu, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export function escapeGroundingXml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;');
}
