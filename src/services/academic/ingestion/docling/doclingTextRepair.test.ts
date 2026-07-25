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
assert.equal(
  DoclingTextRepairService.repairText('phóng đại lên 2.000.000 lân; một lân nữa nhưng kỳ lân vẫn ở lân cận'),
  'phóng đại lên 2.000.000 lần; một lần nữa nhưng kỳ lân vẫn ở lân cận',
);
assert.equal(
  DoclingTextRepairService.repairText('một cách đơn thuân và thuân túy'),
  'một cách đơn thuần và thuần túy',
);
assert.equal(
  DoclingTextRepairService.repairText('vị sư cẩu nguyện trước Mặt trời thẩn linh'),
  'vị sư cầu nguyện trước Mặt trời thần linh',
);
assert.equal(
  DoclingTextRepairService.repairText(
    'truyển hình có chiêu sâu; nhiêu ví dụ vể các vấn dê vốn quấy rây; gia dình từ đẩu',
  ),
  'truyền hình có chiều sâu; nhiều ví dụ về các vấn đề vốn quấy rầy; gia đình từ đầu',
);
assert.equal(
  DoclingTextRepairService.repairText('Anh ta ~không đi được nghĩa là anh ta không tiếp tục được nữa'),
  'Anh ta không đi được nghĩa là anh ta không tiếp tục được nữa',
);
assert.equal(
  DoclingTextRepairService.repairText(
    'Phát thanhTruyển hình; dáng tiếc; tẩm quan trọng; cú khăng khăng; tràn trê; kiến thức vể tâm lý học',
  ),
  'Phát thanh Truyền hình; đáng tiếc; tầm quan trọng; cứ khăng khăng; tràn trề; kiến thức về tâm lý học',
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

const crossPageFlow = DoclingAdapterService.mapToCanonicalBlocks({
  success: true,
  title: 'Cross-page fixture',
  pageCount: 2,
  duration: 1,
  ocrUsed: true,
  warnings: [],
  referenceQualityDegraded: false,
  items: [
    {
      id: 'page-1-tail',
      type: 'paragraph',
      text: 'Jung rất hài lòng không chỉ vì nhận được các lá thư (hộp thư',
      pageNumber: 1,
    },
    {
      id: 'page-2-head',
      type: 'paragraph',
      text: 'của ông lúc nào cũng đầy ắp) mà còn vì nhận được chúng từ những người.',
      pageNumber: 2,
    },
  ],
}, []);

assert.equal(crossPageFlow.canonicalOutput.blocks.length, 1);
assert.equal(
  crossPageFlow.canonicalOutput.blocks[0]?.text,
  'Jung rất hài lòng không chỉ vì nhận được các lá thư (hộp thư của ông lúc nào cũng đầy ắp) mà còn vì nhận được chúng từ những người.',
);

console.log('DOCLING TEXT REPAIR: 15 PASSED, 0 FAILED');
