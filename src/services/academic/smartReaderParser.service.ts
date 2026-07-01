import fs from 'fs';
import { parseJatsXml } from './parsers/JatsXmlParser';
import { parseFrontiersHtml } from './parsers/FrontiersHtmlParser';
import { parsePmcHtml } from './parsers/PmcParser';
import { parsePlosHtml } from './parsers/PlosParser';
import { parseGenericHtml } from './parsers/GenericHtmlParser';
import { parsePdf } from './parsers/PdfParser';
import { CanonicalBlocksOutput } from './types';

export async function parseSourceFile(
  filePath: string,
  contentType: string,
  sourceType: string,
  pmcImageMap?: Map<string, string>
): Promise<CanonicalBlocksOutput> {
  // If PDF, parse binary content via Python script
  if (contentType === 'pdf' || sourceType === 'pdf' || sourceType === 'uploaded_pdf') {
    return parsePdf(filePath);
  }

  const content = fs.readFileSync(filePath, 'utf8');

  if (sourceType === 'jats_xml' || contentType === 'xml') {
    return parseJatsXml(content, pmcImageMap);
  }
  if (sourceType === 'frontiers_html') {
    return parseFrontiersHtml(content);
  }
  if (sourceType === 'pmc_html') {
    return parsePmcHtml(content);
  }
  if (sourceType === 'plos_html') {
    return parsePlosHtml(content);
  }

  if (contentType === 'html') {
    // Detect publisher signature within HTML content with high specificity
    if (content.includes('citation_publisher" content="Frontiers') || content.includes('class="ArticleContent"')) {
      return parseFrontiersHtml(content);
    }
    if (content.includes('name="ncbi_app" content="pmc"') || content.includes('class="pmc-sidebar"')) {
      return parsePmcHtml(content);
    }
    if (content.includes('citation_publisher" content="Public Library of Science') || content.includes('plos-header')) {
      return parsePlosHtml(content);
    }
    return parseGenericHtml(content);
  }

  throw new Error(`Unsupported content type or source type: contentType=${contentType}, sourceType=${sourceType}`);
}
