export function normalizeObjectPunctuation(value: any): any {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value
      .replace(/。/g, '.')
      .replace(/，/g, ',')
      .replace(/：/g, ':')
      .replace(/；/g, ';')
      .replace(/！/g, '!')
      .replace(/？/g, '?');
  }
  if (Array.isArray(value)) {
    return value.map(item => normalizeObjectPunctuation(item));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, normalizeObjectPunctuation(item)]),
    );
  }
  return value;
}
