import { createHash } from 'node:crypto';

export const DREAM_CITATION_CONTRACT_VERSION = 1 as const;

export type EvidenceClaimStatus = 'unresolved' | 'resolved';

export type EvidenceClaimContentPath =
  | 'core_analysis'
  | 'summary'
  | `interpretive_threads.${number}.reasoning`;

export interface EvidenceSourceIdentity {
  sourceId?: string;
  doi?: string;
}

export interface EvidenceClaimBinding {
  claimId: string;
  claimText: string;
  evidenceClaim?: string;
  evidenceClaimKey?: string;
  contentPath: EvidenceClaimContentPath;
  status: EvidenceClaimStatus;
  source?: EvidenceSourceIdentity;
  ruleId?: string;
  evidenceId?: string;
  citationIndex?: number;
  verificationKey?: string;
}

export interface EvidenceCitationRecord {
  index: number;
  source: EvidenceSourceIdentity;
}

export interface EvidenceClaimResolution {
  source: EvidenceSourceIdentity;
  ruleId: string;
  evidenceId: string;
  verificationKey: string;
}

export interface EvidenceClaimDocument {
  core_analysis?: string;
  summary?: string;
  interpretive_threads?: Array<{ reasoning?: string }>;
}

// Builds a stable identity from the exact claim and its location in the analysis.
export function createEvidenceClaimId(
  contentPath: EvidenceClaimContentPath,
  claimText: string,
): string {
  return createHash('sha256')
    .update(`${contentPath}\n${normalizeClaimText(claimText)}`)
    .digest('hex')
    .slice(0, 24);
}

// Adds or replaces only the marker belonging to this exact claim.
export function renderEvidenceClaimMarker(
  text: string,
  binding: EvidenceClaimBinding,
): string {
  const claim = splitTerminalPunctuation(binding.claimText);
  if (!claim.stem) return text;
  const marker = binding.status === 'resolved' && binding.citationIndex
    ? `[${binding.citationIndex}]`
    : '[?]';
  const storedMarker = '\\[(?:\\?|\\d+)\\]';
  const pattern = claim.punctuation
    ? new RegExp(
      `${escapeRegExp(claim.stem)}\\s*(?:${storedMarker}\\s*)?`
        + `${escapeRegExp(claim.punctuation)}`
        + `(?:\\s*${storedMarker}${escapeRegExp(claim.punctuation)}?)?`,
      'u',
    )
    : new RegExp(
      `${escapeRegExp(claim.stem)}\\s*(?:${storedMarker})?`,
      'u',
    );
  if (!pattern.test(text)) return text;
  return text.replace(pattern, `${claim.stem} ${marker}${claim.punctuation}`);
}

export function evidenceClaimContentPaths(
  document: EvidenceClaimDocument,
): EvidenceClaimContentPath[] {
  return [
    'core_analysis',
    'summary',
    ...(document.interpretive_threads || []).map(
      (_, index) => `interpretive_threads.${index}.reasoning` as const,
    ),
  ];
}

export function readEvidenceClaimContent(
  document: EvidenceClaimDocument,
  contentPath: EvidenceClaimContentPath,
): string {
  if (contentPath === 'core_analysis' || contentPath === 'summary') {
    return String(document[contentPath] || '');
  }
  const index = claimThreadIndex(contentPath);
  return index === null ? '' : String(document.interpretive_threads?.[index]?.reasoning || '');
}

export function writeEvidenceClaimMarker(
  document: EvidenceClaimDocument,
  binding: EvidenceClaimBinding,
): boolean {
  const current = readEvidenceClaimContent(document, binding.contentPath);
  const next = renderEvidenceClaimMarker(current, binding);
  if (next === current) return false;
  if (binding.contentPath === 'core_analysis' || binding.contentPath === 'summary') {
    document[binding.contentPath] = next;
    return true;
  }
  const index = claimThreadIndex(binding.contentPath);
  if (index === null || !document.interpretive_threads?.[index]) return false;
  document.interpretive_threads[index].reasoning = next;
  return true;
}

// Resolves a claim with the existing source number or the next free number.
export function resolveEvidenceClaim(
  binding: EvidenceClaimBinding,
  resolution: EvidenceClaimResolution,
  citations: EvidenceCitationRecord[],
): EvidenceClaimBinding {
  const existingCitation = citations.find((citation) =>
    sameEvidenceSource(citation.source, resolution.source));
  return {
    ...binding,
    status: 'resolved',
    source: normalizeEvidenceSource(resolution.source),
    ruleId: resolution.ruleId,
    evidenceId: resolution.evidenceId,
    verificationKey: resolution.verificationKey,
    citationIndex: existingCitation?.index || nextEvidenceCitationIndex(citations),
  };
}

// Reopens only claims backed by the removed source and clears stale feedback identity.
export function invalidateEvidenceClaims(
  bindings: EvidenceClaimBinding[],
  removedSources: EvidenceSourceIdentity[],
): EvidenceClaimBinding[] {
  return bindings.map((binding) => {
    if (!binding.source || !removedSources.some((source) =>
      sameEvidenceSource(binding.source!, source))) {
      return binding;
    }
    return {
      claimId: binding.claimId,
      claimText: binding.claimText,
      ...(binding.evidenceClaim ? { evidenceClaim: binding.evidenceClaim } : {}),
      ...(binding.evidenceClaimKey ? { evidenceClaimKey: binding.evidenceClaimKey } : {}),
      contentPath: binding.contentPath,
      status: 'unresolved',
    };
  });
}

export function nextEvidenceCitationIndex(citations: EvidenceCitationRecord[]): number {
  return Math.max(0, ...citations.map((citation) => citation.index)) + 1;
}

export function sameEvidenceSource(
  left: EvidenceSourceIdentity,
  right: EvidenceSourceIdentity,
): boolean {
  const normalizedLeft = normalizeEvidenceSource(left);
  const normalizedRight = normalizeEvidenceSource(right);
  return Boolean(
    normalizedLeft.sourceId
      && normalizedRight.sourceId
      && normalizedLeft.sourceId === normalizedRight.sourceId,
  ) || Boolean(
    normalizedLeft.doi
      && normalizedRight.doi
      && normalizedLeft.doi === normalizedRight.doi,
  );
}

export function normalizeEvidenceSource(
  source: EvidenceSourceIdentity,
): EvidenceSourceIdentity {
  const sourceId = String(source.sourceId || '').trim();
  const doi = String(source.doi || '')
    .trim()
    .toLocaleLowerCase('en')
    .replace(/^https?:\/\/(?:dx\.)?doi\.org\//u, '');
  return {
    ...(sourceId ? { sourceId } : {}),
    ...(doi ? { doi } : {}),
  };
}

function normalizeClaimText(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function splitTerminalPunctuation(value: string): { stem: string; punctuation: string } {
  const normalized = normalizeClaimText(value).replace(/\s*\[(?:\?|\d+)\]\s*$/u, '');
  const match = normalized.match(/^(.*?)([.!?])?$/u);
  return {
    stem: String(match?.[1] || '').trim(),
    punctuation: String(match?.[2] || ''),
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function claimThreadIndex(contentPath: EvidenceClaimContentPath): number | null {
  const value = Number(contentPath.match(/^interpretive_threads\.(\d+)\.reasoning$/u)?.[1]);
  return Number.isInteger(value) ? value : null;
}
