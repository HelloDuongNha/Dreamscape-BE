import { CanonicalBlocksOutput, ReaderQualityReport } from '../../types/canonical.types';

export function validateQuality(
  output: CanonicalBlocksOutput,
  chosenParser: string,
  chosenCandidate: string,
  fallbackUsed: boolean,
  processingTimeMs: number
): ReaderQualityReport {
  const blocks = output.blocks || [];
  const textContent = blocks.map(b => b.text).join(' ');

  // Metrics Counters
  let blockCount = blocks.length;
  let headingCount = 0;
  let paragraphCount = 0;
  let listItemCount = 0;
  let referenceCount = 0;
  let figureCount = 0;
  let tableCount = 0;
  let metadataCount = 0;
  let footnoteCount = 0;

  let untitledCount = 0;
  let duplicateMarkerCount = 0;
  let noiseWordCount = 0;
  let embeddedPageNumberCount = 0;

  const markersSeen = new Set<string>();

  for (const b of blocks) {
    if (b.blockType === 'heading') {
      headingCount++;
      markersSeen.clear(); // Reset seen markers when entering a new section heading
    }
    else if (b.blockType === 'paragraph') paragraphCount++;
    else if (b.blockType === 'list_item') {
      listItemCount++;
      if (b.marker) {
        if (markersSeen.has(b.marker) && b.marker !== '-') {
          duplicateMarkerCount++;
        }
        markersSeen.add(b.marker);
      }
    }
    else if (b.blockType === 'reference') referenceCount++;
    else if (b.blockType === 'figure') figureCount++;
    else if (b.blockType === 'table') tableCount++;
    else if (b.blockType === 'metadata') metadataCount++;
    else if (b.blockType === 'page_break') footnoteCount++;

    if (b.text.toLowerCase().includes('untitled')) {
      untitledCount++;
    }

    // Check for noise words
    if (/png|tif|original image|larger image|click here/gi.test(b.text)) {
      noiseWordCount++;
    }

    // Check for generic noise phrases
    const textLower = b.text.toLowerCase();
    const genericNoisePhrases = [
      'article metrics',
      'front. psychol',
      'sec. consciousness research',
      'volume 7 - 2016',
      'share on',
      'view article impact',
      'related articles',
      'people also looked at',
      'export citation',
      'download article',
      'crossmark',
      'edited by',
      'reviewed by'
    ];
    for (const phrase of genericNoisePhrases) {
      if (textLower.includes(phrase)) {
        noiseWordCount++;
      }
    }

    // Multiple uppercase initials check (e.g. WZWei Zhang)
    if (/^[A-Z]{2,}[A-Z][a-z]+/g.test(b.text)) {
      noiseWordCount++;
    }

    // Check for embedded page breaks mid-paragraph
    if (/page\s+\d+/gi.test(b.text) && b.blockType === 'paragraph') {
      embeddedPageNumberCount++;
    }
  }

  // Find position of the first real body paragraph
  let firstBodyIdx = -1;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.blockType === 'paragraph' && b.text.length > 80 && !b.text.toLowerCase().includes('front. psychol')) {
      firstBodyIdx = i;
      break;
    }
  }

  let leadingMetadataBlocks = 0;
  if (firstBodyIdx > 0) {
    for (let i = 0; i < firstBodyIdx; i++) {
      const b = blocks[i];
      if (b.blockType === 'paragraph' || b.blockType === 'list_item' || b.blockType === 'metadata') {
        leadingMetadataBlocks++;
      }
    }
  }

  // Duplicate title check
  let duplicateTitleCount = 0;
  const titlesSeen = new Set<string>();
  for (const b of blocks) {
    if (b.blockType === 'title') {
      if (titlesSeen.has(b.text)) {
        duplicateTitleCount++;
      }
      titlesSeen.add(b.text);
    }
  }

  const metadataRatio = blockCount > 0 ? (metadataCount + noiseWordCount + leadingMetadataBlocks) / blockCount : 0;

  // Subscores logic (0 to 100)
  
  // 1. Heading Score
  let headingScore = 100;
  if (headingCount === 0) headingScore = 20;
  else if (untitledCount > 0) headingScore = Math.max(0, 100 - (untitledCount * 25));

  // 2. Paragraph Score
  let paragraphScore = 100;
  if (paragraphCount < 3) paragraphScore = Math.max(10, paragraphCount * 30);

  // 3. Reference Score
  let referenceScore = 100;
  // If there's a references heading but no references blocks, score is 0
  const hasRefHeading = blocks.some(b => b.blockType === 'heading' && b.text.toLowerCase().includes('reference'));
  if (hasRefHeading && referenceCount === 0) {
    referenceScore = 0;
  } else if (referenceCount > 0 && referenceCount < 3) {
    referenceScore = 50; // too low, merged paragraphs suspect
  }

  // 4. List Score
  let listScore = 100;

  // 5. Noise Score
  let noiseScore = Math.max(0, 100 - (noiseWordCount * 10));

  // 6. Metadata Score
  let metadataScore = metadataCount > 0 ? 100 : 80;

  // 7. Figure Score
  let figureScore = 100; // default standard

  // 8. Table Score
  let tableScore = 100; // default standard

  // 9. Whitespace Score
  let whitespaceScore = 100;
  const duplicateSpaces = (textContent.match(/\s{3,}/g) || []).length;
  if (duplicateSpaces > 0) {
    whitespaceScore = Math.max(0, 100 - (duplicateSpaces * 5));
  }

  // 10. Page Continuity Score
  let pageContinuityScore = Math.max(0, 100 - (embeddedPageNumberCount * 20));

  // Overall Score Calculation (weighted average)
  const weights = {
    heading: 0.15,
    paragraph: 0.20,
    reference: 0.15,
    list: 0.15,
    noise: 0.15,
    metadata: 0.05,
    whitespace: 0.05,
    continuity: 0.10
  };

  let overallScore = Math.round(
    headingScore * weights.heading +
    paragraphScore * weights.paragraph +
    referenceScore * weights.reference +
    listScore * weights.list +
    noiseScore * weights.noise +
    metadataScore * weights.metadata +
    whitespaceScore * weights.whitespace +
    pageContinuityScore * weights.continuity
  );

  // Apply generic structural penalties
  if (metadataRatio > 0.2) {
    overallScore = Math.max(0, overallScore - Math.round((metadataRatio - 0.2) * 50));
  }
  if (leadingMetadataBlocks > 5) {
    overallScore = Math.max(0, overallScore - Math.min(20, (leadingMetadataBlocks - 5) * 4));
  }
  if (duplicateTitleCount > 0) {
    overallScore = Math.max(0, overallScore - (duplicateTitleCount * 15));
  }

  overallScore = Math.max(0, Math.min(100, overallScore));

  const warnings: string[] = [];
  if (overallScore < 70) warnings.push('Độ chính xác chất lượng văn bản thấp.');
  if (headingCount === 0) warnings.push('Không tìm thấy đề mục phân cấp.');
  if (hasRefHeading && referenceCount === 0) warnings.push('Có mục Tài liệu tham khảo nhưng không tách được danh sách.');
  if (duplicateMarkerCount > 0) warnings.push('Phát hiện dấu hiệu trùng lặp marker danh sách.');
  if (noiseWordCount > 0) warnings.push('Chứa cụm từ hình ảnh bổ sung không cần thiết.');
  if (embeddedPageNumberCount > 0) warnings.push('Phát hiện số trang hiển thị xen giữa văn bản.');

  return {
    overallScore,
    headingScore,
    paragraphScore,
    referenceScore,
    listScore,
    noiseScore,
    metadataScore,
    figureScore,
    tableScore,
    whitespaceScore,
    pageContinuityScore,
    warnings,
    chosenParser,
    chosenCandidate,
    fallbackUsed,
    processingTimeMs,
    metrics: {
      blockCount,
      headingCount,
      paragraphCount,
      listItemCount,
      referenceCount,
      figureCount,
      tableCount
    }
  };
}
