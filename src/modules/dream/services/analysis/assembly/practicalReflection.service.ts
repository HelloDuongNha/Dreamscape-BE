export interface PracticalReflection {
  suggestion: string;
  rationale: string;
}

function normalize(value: unknown): string {
  return String(value || '').replace(/\s+/gu, ' ').trim();
}

// Validates model-authored reflections without inventing advice in backend code.
export function sanitizePracticalReflections(value: unknown): PracticalReflection[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, PracticalReflection>();

  for (const candidate of value) {
    const suggestion = normalize(candidate?.suggestion);
    const rationale = normalize(candidate?.rationale);
    if (suggestion.length < 12 || suggestion.length > 500) continue;
    if (rationale.length < 20 || rationale.length > 900) continue;
    const key = suggestion.normalize('NFKC').toLocaleLowerCase();
    if (!unique.has(key)) unique.set(key, { suggestion, rationale });
    if (unique.size >= 3) break;
  }

  return [...unique.values()];
}
