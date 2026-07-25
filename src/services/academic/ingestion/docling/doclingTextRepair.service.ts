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
