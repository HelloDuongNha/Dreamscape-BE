export class DoclingTextRepairService {
  public static repairText(input: string): string {
    let text = (input || '').normalize('NFC');

    text = text.replace(/https?\s*:\s*\/\s*\/[^\s]+(?:\s+[./]\s*[^\s]+)+/giu, match =>
      match.replace(/\s*:\s*/g, ':').replace(/\s*\/\s*/g, '/').replace(/\s*\.\s*/g, '.'),
    );
    text = text.replace(/\b(?:Self\s*Organizing|self\s*organizing)\b/gu, match =>
      match[0] === 'S' ? 'Self-Organizing' : 'self-organizing',
    );
    text = text.replace(/\bselforganization\b/giu, 'self-organization');
    text = text.replace(/\btwostage\b/giu, 'two-stage');
    text = text.replace(/\bdreamlag\b/giu, 'dream-lag');

    // Repair collapsed quotation boundaries before the text is persisted and
    // before browser translation sees it.
    text = text.replace(/([\p{Ll}])'(?=[\p{Lu}])/gu, "$1 '");
    text = text.replace(/\s+'\s*,\s*/gu, ', ');
    text = text.replace(/\s+([,.;:!?])/gu, '$1');

    // Conservative Vietnamese font-map repairs. Ambiguous corruption remains
    // unchanged rather than being guessed into canonical academic content.
    text = text
      .replace(/\bngư\s*['’]\s*i\b/giu, 'người')
      .replace(/\btư\s*['’]\s*ng\b/giu, 'tượng')
      .replace(/\bn\s*['’]\s*i\s+dung\b/giu, 'nội dung');

    text = text.replace(/(^|\n)\s*['’"`-]\s*(?=\n|$)/gu, '$1');
    text = text.replace(/,\s*(\d{1,3})\s+(\d{1,3})(?=\s*(?:\n|$))/gu, ', $1–$2');
    return text.replace(/[ \t]{2,}/g, ' ').trim();
  }

  public static repairHtml(html: string): string {
    if (!html) return html;
    return html.replace(/(^|>)([^<]+)(?=<|$)/gu, (match, boundary: string, value: string) => {
      if (!value.trim()) return match;
      const leading = value.match(/^\s*/u)?.[0] || '';
      const trailing = value.match(/\s*$/u)?.[0] || '';
      return `${boundary}${leading}${this.repairText(value)}${trailing}`;
    });
  }
}
