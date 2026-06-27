import { Router } from 'express';
import authMiddleware, { isModerator } from '../middleware/authMiddleware';
import {
  getPendingSources,
  reviewSource,
  importFullText,
  buildChunks,
  getRuleCandidates,
  getRuleCandidateDetail,
  updateRuleCandidate,
  approveRuleCandidate,
  rejectRuleCandidate,
  analyzeRules,
  deactivateRule,
  deactivateSourceRules,
  restoreRejectedCandidate,
  clearAllRejectedCandidates,
  deleteCandidate,
  getAnalyzeProgress,
  uploadPdfMiddleware,
  uploadPdfFile,
  deleteSource,
  reimportFullText
} from '../controllers/moderationController';
import { getKnowledgeRules } from '../controllers/knowledgeEvidenceController';

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
router.post('/sources/upload-pdf', authMiddleware, isModerator, uploadPdfMiddleware, uploadPdfFile);
router.post('/sources/:id/import-fulltext', authMiddleware, isModerator, importFullText);
router.post('/sources/:id/build-chunks', authMiddleware, isModerator, buildChunks);
router.post('/sources/:id/analyze-rules', authMiddleware, isModerator, analyzeRules);
router.get('/sources/:id/analyze-progress', authMiddleware, isModerator, getAnalyzeProgress);
router.delete('/sources/:id', authMiddleware, isModerator, deleteSource);
router.post('/sources/:id/reimport-fulltext', authMiddleware, isModerator, reimportFullText);
router.get('/rule-candidates', authMiddleware, isModerator, getRuleCandidates);
router.get('/rule-candidates/:id', authMiddleware, isModerator, getRuleCandidateDetail);
router.patch('/rule-candidates/:id', authMiddleware, isModerator, updateRuleCandidate);
router.post('/rule-candidates/:id/approve', authMiddleware, isModerator, approveRuleCandidate);
router.post('/rule-candidates/:id/reject', authMiddleware, isModerator, rejectRuleCandidate);

// Deactivation, restoration, and deletion routes (with confirmation)
router.post('/rules/:ruleId/deactivate', authMiddleware, isModerator, deactivateRule);
router.post('/sources/:id/deactivate-rules', authMiddleware, isModerator, deactivateSourceRules);
router.post('/rule-candidates/:id/restore', authMiddleware, isModerator, restoreRejectedCandidate);
router.delete('/rule-candidates/rejected', authMiddleware, isModerator, clearAllRejectedCandidates);
router.delete('/rule-candidates/:id', authMiddleware, isModerator, deleteCandidate);

// Knowledge Evidence Linking Endpoints
router.get('/knowledge-rules', authMiddleware, isModerator, getKnowledgeRules);
// router.get('/sources/:id/chunks/search', authMiddleware, isModerator, searchSourceChunks);
// router.post('/knowledge-rules/:ruleId/evidence-links', authMiddleware, isModerator, createEvidenceLink);
// router.get('/knowledge-rules/:ruleId/evidence-links', authMiddleware, isModerator, getEvidenceLinks);
// router.delete('/knowledge-rules/:ruleId/evidence-links/:linkId', authMiddleware, isModerator, removeEvidenceLink);

export default router;
