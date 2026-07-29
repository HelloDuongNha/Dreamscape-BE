export class DoclingTextRepairService {
  private static foldVietnameseToken(value: string): string {
    return value
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .replace(/đ/giu, match => match === 'Đ' ? 'D' : 'd')
      .toLocaleLowerCase('vi');
  }

  private static restoreTokenCase(source: string, replacement: string): string {
    if (source === source.toLocaleUpperCase('vi')) return replacement.toLocaleUpperCase('vi');
    if (/^\p{Lu}/u.test(source)) {
      return replacement.replace(/^\p{Ll}/u, letter => letter.toLocaleUpperCase('vi'));
    }
    return replacement;
  }

  /**
   * Learns accent variants from the complete document instead of maintaining a
   * growing list of book-specific replacements. A token is changed only when a
   * dominant, correctly accented spelling with the same accent-free skeleton is
   * repeatedly observed in the document and the neighbouring word supports it.
   */
  public static repairDocumentCorpus<T extends { text: string }>(blocks: T[]): T[] {
    const tokenPattern = /\p{L}{2,}/gu;
    const tokenRows = blocks.map(block => block.text.match(tokenPattern) || []);
    const formCounts = new Map<string, Map<string, number>>();
    const contextualCounts = new Map<string, number>();

    for (const tokens of tokenRows) {
      const normalized = tokens.map(token => token.toLocaleLowerCase('vi'));
      normalized.forEach((token, index) => {
        const skeleton = this.foldVietnameseToken(token);
        const forms = formCounts.get(skeleton) || new Map<string, number>();
        forms.set(token, (forms.get(token) || 0) + 1);
        formCounts.set(skeleton, forms);
        const left = index > 0 ? this.foldVietnameseToken(normalized[index - 1]) : '^';
        const right = index + 1 < normalized.length ? this.foldVietnameseToken(normalized[index + 1]) : '$';
        contextualCounts.set(`${left}|${token}|${right}`, (contextualCounts.get(`${left}|${token}|${right}`) || 0) + 1);
        contextualCounts.set(`${left}|${token}|*`, (contextualCounts.get(`${left}|${token}|*`) || 0) + 1);
        contextualCounts.set(`*|${token}|${right}`, (contextualCounts.get(`*|${token}|${right}`) || 0) + 1);
      });
    }

    const preferredForms = new Map<string, { token: string; count: number; runnerUp: number }>();
    for (const [skeleton, forms] of formCounts) {
      if (forms.size < 2) continue;
      const ranked = [...forms.entries()].sort((left, right) => right[1] - left[1]);
      const [winner, count] = ranked[0];
      const runnerUp = ranked[1]?.[1] || 0;
      if (count >= 3 && count >= runnerUp * 1.5 && /[ăâêôơưđà-ỹ]/iu.test(winner)) {
        preferredForms.set(skeleton, { token: winner, count, runnerUp });
      }
    }

    return blocks.map((block, blockIndex) => {
      const tokens = tokenRows[blockIndex];
      let tokenIndex = 0;
      const repaired = block.text.replace(tokenPattern, original => {
        const currentIndex = tokenIndex++;
        const lower = original.toLocaleLowerCase('vi');
        const preferred = preferredForms.get(this.foldVietnameseToken(lower));
        if (!preferred || preferred.token === lower) return original;

        const left = currentIndex > 0 ? this.foldVietnameseToken(tokens[currentIndex - 1]) : '^';
        const right = currentIndex + 1 < tokens.length ? this.foldVietnameseToken(tokens[currentIndex + 1]) : '$';
        const originalContext = (contextualCounts.get(`${left}|${lower}|${right}`) || 0) * 3
          + (contextualCounts.get(`${left}|${lower}|*`) || 0)
          + (contextualCounts.get(`*|${lower}|${right}`) || 0);
        const preferredContext = (contextualCounts.get(`${left}|${preferred.token}|${right}`) || 0) * 3
          + (contextualCounts.get(`${left}|${preferred.token}|*`) || 0)
          + (contextualCounts.get(`*|${preferred.token}|${right}`) || 0);

        // Context prevents valid words such as “lân” in “lân cận” from being
        // changed merely because “lần” is more frequent elsewhere.
        const strongDocumentDominance = preferred.count >= 4
          && preferred.count >= Math.max(1, preferred.runnerUp) * 3;
        if (preferredContext === 0 || (preferredContext <= originalContext && !strongDocumentDominance)) {
          return original;
        }
        return this.restoreTokenCase(original, preferred.token);
      });
      return repaired === block.text ? block : { ...block, text: repaired };
    });
  }

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
      .replace(/\bn\s*['’]\s*i\s+dung\b/giu, 'nội dung')
      .replace(/\bđư\s*['’]\s*c\b/giu, 'được')
      .replace(/\bm\s*['’]\s*t\b/giu, 'một');

    // High-confidence Vietnamese diacritic repairs use surrounding words,
    // never a global token replacement. For example, "lân" is valid in
    // "kỳ lân" and "lân cận", but after a quantity or before "nữa" it is
    // unambiguously the occurrence counter "lần".
    text = text
      .replace(/\b(\d[\d.,]*\s+)lân\b/giu, '$1lần')
      .replace(/\b((?:một|hai|ba|bốn|năm|sáu|bảy|tám|chín|mười|nhiều|vài|mấy|bao|mỗi|từng)\s+)lân\b/giu, '$1lần')
      .replace(/\blân(\s+(?:nữa|đầu|cuối|trước|sau|thứ|kế tiếp))\b/giu, 'lần$1')
      .replace(/(^|[^\p{L}\p{N}])đơn\s+thuân\b/giu, '$1đơn thuần')
      .replace(/\bthuân\s+(túy|nhất|thục|phục)\b/giu, 'thuần $1')
      .replace(/\bcẩu\s+nguyện\b/giu, 'cầu nguyện')
      .replace(/\bthẩn\s+linh\b/giu, 'thần linh')
      .replace(/\btruyên\s+(hình|tải|đạt|thống|thuyết)\b/giu, 'truyền $1')
      .replace(/\btruyển\s+(hình|tải|đạt|thống|thuyết)\b/giu, 'truyền $1')
      .replace(
        /\bnhiêu\s+(người|lần|điều|ý nghĩa|hơn|năm|tháng|vấn đề|ví dụ)(?=$|[^\p{L}])/giu,
        'nhiều $1',
      )
      .replace(/\bđiêu\s+(này|đó|gì|kiện|khoản)\b/giu, 'điều $1')
      .replace(/\bgân\s+(như|đây|đó|nhà|gũi)\b/giu, 'gần $1')
      .replace(/\bphỏng\s+văn\b/giu, 'phỏng vấn')
      .replace(/\bchiêu\s+sâu\b/giu, 'chiều sâu')
      .replace(/\bvấn\s+dê(?=$|[^\p{L}])/giu, 'vấn đề')
      .replace(/\bvể\s+(loại|các|những|việc|vấn đề|Jung)\b/giu, 'về $1')
      .replace(/\bquấy\s+rây(?=$|[^\p{L}])/giu, 'quấy rầy')
      .replace(/\bgia\s+dình\b/giu, 'gia đình')
      .replace(/\b(khởi|từ|ban)\s+đẩu\b/giu, '$1 đầu')
      .replace(/\btẩm\s+quan\s+trọng\b/giu, 'tầm quan trọng')
      .replace(/\bđể\s+nghị\b/giu, 'đề nghị')
      .replace(/\bdứng\b/giu, 'đứng')
      .replace(/\bdúng\s+(mực|là|như)\b/giu, 'đúng $1')
      .replace(/\bthành\s+phẩn\b/giu, 'thành phần')
      .replace(/\bđẩy\s+(đủ|ắp)\b/giu, 'đầy $1')
      .replace(/\btràn\s+trê(?=$|[^\p{L}])/giu, 'tràn trề')
      .replace(/\bdáng\s+tiếc\b/giu, 'đáng tiếc')
      .replace(/\bcú\s+khăng\s+khăng\b/giu, 'cứ khăng khăng')
      .replace(/\bsở\s+di\b/giu, 'sở dĩ')
      .replace(
        /\bvể\s+(tâm\s+lý|cuộc\s+đời|giá\s+trị|phần)(?=$|[^\p{L}])/giu,
        'về $1',
      )
      .replace(/\bnhiều\s+Ý\s+nghĩa\b/gu, 'nhiều ý nghĩa')
      .replace(/\bPhát\s+thanhTruyển\s+hình\b/gu, 'Phát thanh Truyền hình')
      .replace(/~\s*(?=(?:không|có|được|là|và|nhưng)\b)/giu, '');

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
