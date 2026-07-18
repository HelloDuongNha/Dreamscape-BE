/**
 * documentResearchProfile.types.ts
 *
 * Pure TypeScript contracts for document research profile and extraction strategy routing.
 * No Mongoose objects, no DB connections, no LLM calls, no network operations.
 * All types must be JSON-serializable.
 */

// ─── Section usage type ──────────────────────────────────────────────────────

export type SectionUsage = 'target' | 'context' | 'skip';

// ─── Input shapes ────────────────────────────────────────────────────────────

/** Minimal serializable projection of AcademicSource fields needed for profiling. */
export interface SourceProfileInput {
  /** IAcademicSource.sourceQuality */
  sourceQuality?: 'peer_reviewed' | 'preprint' | 'informal';
  /** IAcademicSource.extractionMethod */
  extractionMethod?: 'jats' | 'html' | 'pdf_text' | 'ocr' | 'mixed';
  /** IAcademicSource.extractionQuality */
  extractionQuality?: 'good' | 'partial' | 'poor';
  /** IAcademicSource.detectedLanguage — BCP-47 code or free text, preserved as-is */
  detectedLanguage?: string;
  /** IAcademicSource.abstract — used only for presence/keyword detection, NOT translated */
  abstract?: string;
  /** IAcademicSource.title */
  title?: string;
  /** IAcademicSource.journal */
  journal?: string;
  /** IAcademicSource.metadata — arbitrary metadata blob from DOI/CrossRef/PubMed */
  metadata?: Record<string, unknown>;
}

/** Minimal serializable projection of AcademicSection fields needed for profiling. */
export interface SectionProfileInput {
  /** AcademicSection._id as string */
  sectionId: string;
  /** IAcademicSection.heading */
  heading: string;
  /** IAcademicSection.sectionType — raw value from the parser */
  sectionType: string;
  /** IAcademicSection.sectionOrder */
  sectionOrder: number;
  /** Number of chunks in this section (length of chunkIds) */
  chunkCount: number;
  /** Sample of chunk text — only first few chunks, used for evidence detection */
  chunkTextSample?: string[];
}

/** Top-level profiling input for a full document. */
export interface DocumentProfileInput {
  /** AcademicDocument._id as string */
  documentId: string;
  /** Optional source metadata */
  source?: SourceProfileInput;
  /** All sections in document order */
  sections: SectionProfileInput[];
  /** IAcademicDocument.parserEngine */
  parserEngine?: string;
}

// ─── Document and section classification types ───────────────────────────────

export type DocumentResearchType =
  | 'quantitative_empirical'
  | 'qualitative_empirical'
  | 'systematic_review'
  | 'meta_analysis'
  | 'narrative_review'
  | 'theoretical_or_conceptual'
  | 'case_report'
  | 'mixed'
  | 'non_research'
  | 'unknown';

export type SectionRole =
  | 'abstract'
  | 'introduction'
  | 'methods'
  | 'results'
  | 'discussion'
  | 'conclusion'
  | 'limitations'
  | 'qualitative_findings'
  | 'body'
  | 'references'
  | 'metadata'
  | 'supplementary'
  | 'unknown';

// ─── Reason codes ─────────────────────────────────────────────────────────────

export type DocumentProfileReasonCode =
  | 'jats_section_structure'       // Standard IMRaD sections found in JATS/XML
  | 'methods_section_found'        // A "Methods" heading was detected
  | 'results_section_found'        // A "Results" heading was detected
  | 'qualitative_markers_found'    // Themes/codes/saturation keywords found in section headings
  | 'systematic_review_markers'    // PRISMA/GRADE/systematic search keywords found
  | 'meta_analysis_markers'        // Forest plot/pooled effect/heterogeneity keywords found
  | 'theoretical_markers_found'    // Theory/conceptual framework/model-building keywords
  | 'case_report_markers'          // Case presentation/case discussion section pattern
  | 'review_only_structure'        // Only review sections, no methods/results
  | 'non_research_structure'       // Editorial/commentary/letter/news pattern
  | 'mixed_method_evidence'        // Both quantitative and qualitative markers present
  | 'no_sections'                  // Document has no sections
  | 'low_section_count'            // Fewer than 3 sections total
  | 'conflicting_evidence'         // Evidence points to multiple types
  | 'source_quality_peer_reviewed' // Peer-reviewed quality flag from source metadata (informational only)
  | 'source_quality_informal'      // Informal quality flag from source metadata (informational only)
  | 'title_keyword_evidence'       // Title contains discriminating keywords
  | 'journal_keyword_evidence'     // Journal name contains discriminating keywords (informational only)
  | 'abstract_keyword_evidence';   // Abstract contains discriminating keywords

export type SectionRoleReasonCode =
  | 'heading_exact_match'          // Heading matched exactly to a canonical role
  | 'heading_keyword_match'        // Heading contains a strong keyword for a role
  | 'section_type_field'           // sectionType field used directly
  | 'position_first'               // First section in the document (low confidence reason only)
  | 'position_last'                // Last section in the document (low confidence reason only)
  | 'chunk_text_evidence'          // Chunk text sample contained discriminating content
  | 'qualitative_heading_pattern'  // Heading matches a qualitative findings pattern
  | 'references_heading'           // Heading is "References" or similar
  | 'metadata_heading'             // Heading is metadata-like
  | 'supplementary_heading'        // Heading contains "supplement" or "appendix"
  | 'non_furniture_body_fallback'  // Fallback for unrecognized non-furniture body sections
  | 'inherited_structural_role'    // Mapped via structural role inheritance
  | 'metadata_container_pattern'   // Matched Statements container as metadata
  | 'fallback_unknown';            // No reliable evidence for classification

// ─── Output shapes ───────────────────────────────────────────────────────────

/** Per-section resolved role and confidence. */
export interface SectionResearchProfile {
  sectionId: string;
  heading: string;
  sectionOrder: number;
  resolvedRole: SectionRole;
  roleConfidence: 'high' | 'medium' | 'low';
  roleReasonCodes: SectionRoleReasonCode[];
}

/** Full document research profile — pure, serializable, no Mongoose objects. */
export interface DocumentResearchProfile {
  documentId: string;
  documentType: DocumentResearchType;
  /** Confidence in documentType classification */
  typeConfidence: 'high' | 'medium' | 'low';
  /** Reason codes supporting the documentType decision (multi-signal, min 2 expected at high confidence) */
  typeReasonCodes: DocumentProfileReasonCode[];
  /** Source language, preserved as-is from detectedLanguage or 'unknown' */
  sourceLanguage: string;
  sectionProfiles: SectionResearchProfile[];
  /** Expose the active evidence channels contributing to the profile type */
  typeEvidenceChannels: ('title' | 'abstract' | 'section_structure' | 'chunk_sample')[];
}

// ─── Extraction strategy ──────────────────────────────────────────────────────

export type ExtractionStrategy =
  | 'quantitative_results'    // For quantitative_empirical results/discussion sections
  | 'qualitative_themes'      // For qualitative_empirical findings sections
  | 'review_synthesis'        // For systematic_review or meta_analysis
  | 'theoretical_framework'   // For theoretical_or_conceptual documents
  | 'case_scoped'             // For case_report documents
  | 'mixed_section_routing'   // For mixed documents, re-routes per section role
  | 'skip';                   // References, metadata, supplementary, non_research

export interface ExtractionStrategyDecision {
  sectionId: string;
  sectionRole: SectionRole;
  usage: SectionUsage;
  strategy: ExtractionStrategy;
  /** Reason the strategy was selected */
  strategyReason: string;
  roleConfidence: 'high' | 'medium' | 'low';
  roleReasonCodes: SectionRoleReasonCode[];
}

export interface DocumentExtractionPlan {
  documentId: string;
  documentType: DocumentResearchType;
  sourceLanguage: string;
  sectionDecisions: ExtractionStrategyDecision[];
  /** True if at least one decision has usage === 'target' */
  hasTargets: boolean;
  /** True if every decision has usage === 'skip' */
  allExcluded: boolean;
}
