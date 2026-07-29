export const boilerplateHeadings = [
  /rights\s+and\s+permissions/i,
  /about\s+this\s+article/i,
  /cite\s+this\s+article/i,
  /download\s+references/i,
  /author\s+information/i,
  /authors\s+and\s+affiliations/i,
  /ethics\s+declarations/i,
  /competing\s+interests/i,
  /additional\s+information/i,
  /corresponding\s+authors/i,
  /author\s+contributions/i,
  /contributions/i,
  /acknowledgements/i,
  /acknowledgments/i,
  /similar\s+content/i,
  /subject/i
];

export const pdfArtifactPatterns = [
  /^page\s+\d+$/i,
  /^page\s+\d+\s+of\s+\d+$/i,
  /^\d+\s*$/i, // lone numbers
  /www\.nature\.com\/tp/i,
  /translational\s+psychiatry/i,
  /^article$/i,
  /^open$/i,
  /^opinion$/i,
  /journal\s+pre-proof/i,
  /published\s+online/i,
  /accepted\s+manuscript/i,
  /©\s+the\s+author/i,
  /©\s+\d{4}/i,
  /all\s+rights\s+reserved/i,
  /springer\s+nature/i,
  /https:\/\/doi\.org\/10\./i
];

export const navigationWidgetPatterns = [
  /trang\s+sau/i,
  /trang\s+trước/i,
  /save\s+article/i,
  /advertisement/i,
  /cookie/i,
  /verify\s+you\s+are\s+human/i,
  /ddos\s+protection/i,
  /cloudflare/i,
  /sign\s+in/i,
  /log\s+in/i,
  /subscribe/i,
  /metrics/i,
  /altmetric/i,
  /view\s+article\s+impact/i,
  /download\s+pdf/i,
  /browser\s+version/i,
  /limited\s+support/i,
  /similar\s+content/i,
  /related\s+articles/i,
  /recommended\s+articles/i,
  /you\s+may\s+also\s+like/i,
  /article\s+recommendations/i,
  /other\s+articles/i,
  /latest\s+articles/i,
  /trending\s+articles/i,
  /featured\s+articles/i,
  /metrics/i,
  /altmetric/i,
  /open\s+access/i,
  /publication\s+history/i,
  /history/i
];

export const garbagePatterns = [
  /^[0-9\(\)\:\;\,\.\s\-\/\#\+\*\\_]+$/, // character garbage
  /^[a-z]\s*$/i // single stray letters
];
