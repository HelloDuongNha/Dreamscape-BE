import { Router } from 'express';
import authMiddleware, { isModerator } from '../middleware/authMiddleware';
import {
  getPendingSources,
  reviewSource,
  importFullText,
  buildChunks,
  uploadPdfMiddleware,
  uploadPdfFile,
  deleteSource,
  reimportFullText,
  getSourcePreview,
  getContributionPdfInline,
  cacheContributionPdf,
  deleteContributionPdf,
  processUploadedPdfForContribution
} from '../controllers/moderationController';
import {
  previewRuleV3Plan,
  dryRunRuleV3Extraction,
  startFullRuleV3Extraction,
  getFullRuleV3ExtractionProgress,
  getRuleV3SourceAnalysisSummary,
  getRuleV3Candidates,
  getRuleV3CandidateDetail,
  approveRuleV3Candidate,
  rejectRuleV3Candidate,
  bulkRuleV3Action
} from '../controllers/ruleV3ModerationController';

const router = Router();

/**
 * @swagger
 * /api/moderation/sources:
 *   get:
 *     summary: Retrieve source contributions by status (paginated)
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, approved, rejected]
 *           default: pending
 *         description: Filter contributions by status
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
 *           default: 20
 *         description: Number of items per page (max 50)
 *     responses:
 *       200:
 *         description: Success retrieving queue
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden (requires moderator role)
 */
router.get('/sources', authMiddleware, isModerator, getPendingSources);

/**
 * @swagger
 * /api/moderation/sources/{id}/status:
 *   patch:
 *     summary: Approve or reject a source contribution
 *     tags: [Moderation]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The source contribution ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reviewStatus
 *             properties:
 *               reviewStatus:
 *                 type: string
 *                 enum: [approved, rejected]
 *               reviewNote:
 *                 type: string
 *                 maxLength: 1000
 *     responses:
 *       200:
 *         description: Review recorded successfully
 *       400:
 *         description: Invalid status or note length
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Contribution not found
 *       409:
 *         description: Contribution already reviewed or duplicate exists
 */
router.patch('/sources/:id/status', authMiddleware, isModerator, reviewSource);
router.get('/sources/:id/preview', authMiddleware, isModerator, getSourcePreview);
router.get('/sources/:id/pdf-inline', authMiddleware, isModerator, getContributionPdfInline);
router.post('/sources/:id/cache-original-pdf', authMiddleware, isModerator, cacheContributionPdf);
router.post('/sources/:id/process-uploaded-pdf', authMiddleware, isModerator, processUploadedPdfForContribution);
router.delete('/sources/:id/original-pdf', authMiddleware, isModerator, deleteContributionPdf);
router.post('/sources/upload-pdf', authMiddleware, isModerator, uploadPdfMiddleware, uploadPdfFile);
router.post('/sources/:id/import-fulltext', authMiddleware, isModerator, importFullText);
router.post('/sources/:id/build-chunks', authMiddleware, isModerator, buildChunks);
router.get('/sources/:id/rules-v3/plan-preview', authMiddleware, isModerator, previewRuleV3Plan);
router.post('/sources/:id/rules-v3/work-units/:workUnitId/dry-run', authMiddleware, isModerator, dryRunRuleV3Extraction);
router.post('/sources/:id/rules-v3/extract', authMiddleware, isModerator, startFullRuleV3Extraction);
router.get('/sources/:id/rules-v3/summary', authMiddleware, isModerator, getRuleV3SourceAnalysisSummary);
router.get('/rules-v3/runs/:runId', authMiddleware, isModerator, getFullRuleV3ExtractionProgress);
router.get('/rules-v3/candidates', authMiddleware, isModerator, getRuleV3Candidates);
router.get('/rules-v3/candidates/:id', authMiddleware, isModerator, getRuleV3CandidateDetail);
router.post('/rules-v3/candidates/:id/approve', authMiddleware, isModerator, approveRuleV3Candidate);
router.post('/rules-v3/candidates/:id/reject', authMiddleware, isModerator, rejectRuleV3Candidate);
router.post('/rules-v3/bulk-action', authMiddleware, isModerator, bulkRuleV3Action);
router.delete('/sources/:id', authMiddleware, isModerator, deleteSource);
router.post('/sources/:id/reimport-fulltext', authMiddleware, isModerator, reimportFullText);

export default router;
