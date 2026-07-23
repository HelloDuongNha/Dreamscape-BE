import assert from 'node:assert/strict';
import { DoclingTextRepairService } from './doclingTextRepair.service';
import { DoclingAdapterService } from './doclingAdapter.service';

assert.equal(
  DoclingTextRepairService.repairText("Taken from'An Introduction to Swarm Intelligence Issues' by Gianni Di Caro"),
  "Taken from 'An Introduction to Swarm Intelligence Issues' by Gianni Di Caro",
);
assert.equal(
  DoclingTextRepairService.repairText("Do đó n' i dung chủ đề của Con ngư'i và Biểu tư'ng"),
  'Do đó nội dung chủ đề của Con người và Biểu tượng',
);
assert.equal(
  DoclingTextRepairService.repairText('Available online at: http://order . ph . utexas . edu/Camazine . pdf'),
  'Available online at: http://order.ph.utexas.edu/Camazine.pdf',
);
assert.equal(
  DoclingTextRepairService.repairHtml("<table><tr><td>Con ngư'i</td><td>5.2 mg/dL</td></tr></table>"),
  '<table><tr><td>Con người</td><td>5.2 mg/dL</td></tr></table>',
);

const canonical = DoclingAdapterService.mapToCanonicalBlocks({
  success: true,
  title: 'OCR fixture',
  pageCount: 1,
  duration: 1,
  ocrUsed: true,
  warnings: [],
  referenceQualityDegraded: false,
  items: [
    { id: 'p1', type: 'paragraph', text: "Taken from'An Introduction' by Gianni Di Caro", pageNumber: 2 },
    {
      id: 't1',
      type: 'table',
      text: '',
      pageNumber: 2,
      html: "<table><tr><td>Con ngư'i</td></tr></table>",
      tableData: {
        version: 1,
        source: 'docling',
        reconstructionMethod: 'docling_native_v1',
        rowCount: 1,
        columnCount: 1,
        cells: [{ row: 0, column: 0, rowSpan: 1, columnSpan: 1, text: "Con ngư'i", role: 'data' }],
        rawCells: [],
        warnings: [],
      },
    },
  ],
}, []);

assert.equal(canonical.canonicalOutput.blocks[0]?.text, "Taken from 'An Introduction' by Gianni Di Caro");
assert.match(canonical.canonicalOutput.blocks[1]?.html || '', /Con người/u);
assert.equal(canonical.canonicalOutput.blocks[1]?.tableData?.cells[0]?.text, 'Con người');

console.log('DOCLING TEXT REPAIR: 7 PASSED, 0 FAILED');
