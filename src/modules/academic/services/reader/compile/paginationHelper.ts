/**
 * Computes the virtual page count of a list of blocks, matching the frontend's
 * paginateBlocks algorithm exactly.
 */
export function calculateVirtualPageCount(blocks: { blockType: string; text: string }[]): number {
  let pagesCount = 0;
  const normalBlocks = blocks.filter((b) => b.blockType !== 'metadata');
  
  if (normalBlocks.length > 0) {
    let wordCount = 0;
    const countWords = (t: string): number => {
      return (t || '').split(/\s+/).filter(Boolean).length;
    };
    
    for (const block of normalBlocks) {
      const words = countWords(block.text);
      if (block.blockType === 'heading') {
        if (wordCount >= 1000) {
          pagesCount++;
          wordCount = 0;
        }
        wordCount += words;
      } else {
        wordCount += words;
        if (wordCount >= 1500) {
          pagesCount++;
          wordCount = 0;
        }
      }
    }
    
    if (wordCount > 0) {
      pagesCount++;
    }
  }
  
  return pagesCount;
}
