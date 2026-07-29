import { Router } from 'express';
import authMiddleware, { isModerator } from '../middleware/authMiddleware';
import { contributePdfSource } from '../modules/academic/controllers/pdfContribution.controller';
import {
  cacheOriginalPdf,
  uploadOriginalPdf,
  deleteOriginalPdf,
} from '../modules/academic/controllers/originalPdfMutation.controller';
import {
  processUploadedPdfForApprovedSource,
  getUploadedPdfImportProgressForApprovedSource,
  cancelUploadedPdfImportForApprovedSource,
} from '../modules/academic/controllers/pdfImport.controller';
import {
  contributeSource,
  previewSource,
} from '../modules/academic/controllers/sourceContribution.controller';
import {
  getApprovedSourceById,
  getApprovedSources,
} from '../modules/academic/controllers/approvedSource.controller';
import { getApprovedSourceRead } from '../modules/academic/controllers/approvedSourceReader.controller';
import {
  getApprovedSourceOriginalDocument,
  getApprovedSourcePdfInline,
} from '../modules/academic/controllers/approvedSourceDocument.controller';
import { getApprovedSourceTranslation } from '../modules/academic/controllers/approvedSourceTranslation.controller';
import { uploadPdfMiddleware } from '../modules/academic/controllers/moderationPdfUpload.controller';


const router = Router();

/**
 * @swagger
 * /api/sources/approved:
 *   get:
 *     summary: Retrieve approved academic sources (paginated & searchable)
 *     tags: [Sources]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Search phrase (title, authors, journal, doi, url)
 *       - in: query
 *         name: doi
 *         schema:
 *           type: string
 *         description: Exact DOI lookup after canonical normalization; does not import a source
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 12
 *         description: Items per page (max 50)
 *     responses:
 *       200:
 *         description: Success retrieving catalog list
 *       401:
 *         description: Unauthorized
 *       400:
 *         description: Invalid DOI query
 */
router.get('/approved', authMiddleware, getApprovedSources);

/**
 * @swagger
 * /api/sources/contribute:
 *   post:
 *     summary: Submit an academic source contribution (DOI or URL)
 *     tags: [Sources]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               doi:
 *                 type: string
 *                 example: 10.1000/xyz123
 *               url:
 *                 type: string
 *                 example: https://example.com/paper.pdf
 *               submittedNote:
 *                 type: string
 *                 example: This paper explains sleep posture and REM.
 *     responses:
 *       201:
 *         description: Contribution submitted successfully
 *       400:
 *         description: Invalid input or missing DOI/URL
 *       409:
 *         description: Duplicate submission detected
 */
router.post('/contribute', authMiddleware, contributeSource);
router.post('/contribute-pdf', authMiddleware, uploadPdfMiddleware, contributePdfSource);
router.post('/preview', authMiddleware, previewSource);
router.get('/approved/:id', authMiddleware, getApprovedSourceById);
router.get('/approved/:id/read', authMiddleware, getApprovedSourceRead);
router.post('/approved/:id/read/translate', authMiddleware, getApprovedSourceTranslation);

router.get('/approved/:id/original-document', authMiddleware, getApprovedSourceOriginalDocument);
router.get('/approved/:id/pdf-inline', authMiddleware, getApprovedSourcePdfInline);
router.post('/approved/:id/cache-original-pdf', authMiddleware, isModerator, cacheOriginalPdf);
router.post('/approved/:id/upload-pdf', authMiddleware, isModerator, uploadPdfMiddleware, uploadOriginalPdf);
router.post('/approved/:id/process-uploaded-pdf', authMiddleware, isModerator, processUploadedPdfForApprovedSource);
router.get('/approved/:id/pdf-import-progress', authMiddleware, isModerator, getUploadedPdfImportProgressForApprovedSource);
router.post('/approved/:id/pdf-import-cancel', authMiddleware, isModerator, cancelUploadedPdfImportForApprovedSource);
router.delete('/approved/:id/original-pdf', authMiddleware, isModerator, deleteOriginalPdf);

export default router;
