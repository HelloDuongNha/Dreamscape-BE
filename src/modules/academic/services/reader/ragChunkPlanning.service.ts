import type mongoose from 'mongoose';

export interface PlannedRagChunk {
  text: string;
  sectionType: string;
  sectionTitle?: string;
  pageStart?: number;
  pageEnd?: number;
  sectionId: mongoose.Types.ObjectId;
}

function createChunk(
  sections: any[],
  heading: string,
): PlannedRagChunk | null {
  if (!sections.length) return null;
  const joined = sections.map(section => section.text).join('\n\n');
  const text = `${heading ? `[Heading: ${heading}]\n\n` : ''}${joined}`.slice(0, 8000);
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const isAbstract = sections.some(section => section.sectionType === 'abstract');
  if (wordCount < 40 && !(isAbstract && wordCount >= 10)) return null;

  const starts = sections
    .map(section => section.pageStart)
    .filter((value): value is number => value !== undefined);
  const ends = sections
    .map(section => section.pageEnd)
    .filter((value): value is number => value !== undefined);
  return {
    text,
    sectionType: isAbstract ? 'abstract' : sections[0].sectionType || 'paragraph',
    sectionTitle: heading || undefined,
    pageStart: starts.length ? Math.min(...starts) : undefined,
    pageEnd: ends.length ? Math.max(...ends) : undefined,
    sectionId: sections[0]._id,
  };
}

function splitLargeSection(section: any, heading: string): PlannedRagChunk[] {
  const words = section.text.split(/\s+/).filter(Boolean);
  const chunks: PlannedRagChunk[] = [];
  for (let start = 0; start < words.length;) {
    const end = Math.min(start + 1000, words.length);
    const body = words.slice(start, end).join(' ');
    const text = `${heading ? `[Heading: ${heading}]\n\n` : ''}${body}`.slice(0, 8000);
    if (text.split(/\s+/).filter(Boolean).length >= 80) {
      chunks.push({
        text,
        sectionType: section.sectionType || 'paragraph',
        sectionTitle: heading || undefined,
        pageStart: section.pageStart,
        pageEnd: section.pageEnd,
        sectionId: section._id,
      });
    }
    if (end === words.length) break;
    start += 850;
  }
  return chunks;
}

export function planRagChunks(sections: any[]): PlannedRagChunk[] {
  if (!sections.length) {
    throw new Error('Tài liệu không chứa phân đoạn văn bản nào.');
  }
  const eligible = sections.filter(
    section => section.sectionType !== 'metadata' && section.sectionType !== 'reference_item',
  );
  if (!eligible.length) {
    throw new Error('Tài liệu không chứa phân đoạn hợp lệ để xây dựng dữ liệu RAG.');
  }

  const planned: PlannedRagChunk[] = [];
  let heading = '';
  let accumulated: any[] = [];
  let accumulatedWords = 0;
  const flush = () => {
    const chunk = createChunk(accumulated, heading);
    if (chunk) planned.push(chunk);
    accumulated = [];
    accumulatedWords = 0;
  };

  for (const section of eligible) {
    if (section.sectionType === 'heading') {
      flush();
      heading = section.text;
      continue;
    }
    const words = section.text.split(/\s+/).filter(Boolean).length;
    if (words > 1200) {
      flush();
      planned.push(...splitLargeSection(section, heading));
      continue;
    }
    if (accumulatedWords + words > 1200) flush();
    accumulated.push(section);
    accumulatedWords += words;
  }
  flush();

  if (!planned.length) {
    const content = eligible
      .filter(section => section.sectionType !== 'heading')
      .map(section => section.text)
      .join('\n\n');
    if (content.trim()) {
      const first = eligible.find(section => section.sectionType !== 'heading') || eligible[0];
      planned.push({
        text: content.slice(0, 8000),
        sectionType: first.sectionType || 'paragraph',
        pageStart: first.pageStart,
        pageEnd: first.pageEnd,
        sectionId: first._id,
      });
    }
  }
  if (planned.length > 300) {
    throw new Error('Tài liệu quá dài để xây dựng dữ liệu RAG trong phiên bản hiện tại.');
  }
  if (!planned.length) {
    throw new Error('Không có nội dung văn bản hợp lệ để xây dựng dữ liệu RAG.');
  }
  return planned;
}
