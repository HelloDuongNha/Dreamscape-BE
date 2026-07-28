import { evaluateGenreEvidence } from './documentGenreClassifier.service';
import { classifyDocumentSections } from './documentSectionClassifier.service';
import type {
  DocumentProfileInput,
  DocumentResearchProfile
} from './documentResearchProfile.types';

export function profileDocument(input: DocumentProfileInput): DocumentResearchProfile {
  const sectionProfiles = classifyDocumentSections(input.sections);
  const genre = evaluateGenreEvidence(input, sectionProfiles);

  return {
    documentId: input.documentId,
    documentType: genre.type,
    typeConfidence: genre.confidence,
    typeReasonCodes: genre.reasons,
    sourceLanguage: input.source?.detectedLanguage ?? 'unknown',
    sectionProfiles,
    typeEvidenceChannels: genre.typeEvidenceChannels
  };
}
