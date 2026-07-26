import assert from 'assert';
import { inferDocumentLanguage, normalizeDocumentLanguage } from './documentLanguage.service';

assert.strictEqual(normalizeDocumentLanguage('vi-VT'), 'vi');
assert.strictEqual(normalizeDocumentLanguage('Vietnamese'), 'vi');
assert.strictEqual(normalizeDocumentLanguage('en-US'), 'en');
assert.strictEqual(inferDocumentLanguage(['Kết quả nghiên cứu cho thấy giấc mơ của người tham gia được mô tả trong các chương và không bị lược bỏ.']), 'vi');
assert.strictEqual(inferDocumentLanguage(['The results of the study were discussed with the participants and the dream content was analyzed in the chapter.']), 'en');
assert.strictEqual(inferDocumentLanguage(['123 symbols']), 'unknown');
console.log('DOCUMENT LANGUAGE: 6 PASSED, 0 FAILED');
