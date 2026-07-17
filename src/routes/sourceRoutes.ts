import { Router } from 'express';
import authMiddleware, { isModerator } from '../middleware/authMiddleware';
import { contributeSource, previewSource, getApprovedSources, getApprovedSourceById, getApprovedSourceRead, getApprovedSourceOriginalDocument, getApprovedSourcePdfInline, contributePdfSource, cacheOriginalPdf, uploadOriginalPdf, deleteOriginalPdf, processUploadedPdfForApprovedSource } from '../controllers/sourceController';
import { uploadPdfMiddleware } from '../controllers/moderationController';

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
router.get('/approved/:id/original-document', authMiddleware, getApprovedSourceOriginalDocument);
router.get('/approved/:id/pdf-inline', authMiddleware, getApprovedSourcePdfInline);
router.post('/approved/:id/cache-original-pdf', authMiddleware, isModerator, cacheOriginalPdf);
router.post('/approved/:id/upload-pdf', authMiddleware, isModerator, uploadPdfMiddleware, uploadOriginalPdf);
router.post('/approved/:id/process-uploaded-pdf', authMiddleware, isModerator, processUploadedPdfForApprovedSource);
router.delete('/approved/:id/original-pdf', authMiddleware, isModerator, deleteOriginalPdf);

export default router;
