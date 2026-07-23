import { NextFunction, Request, Response, Router } from 'express';
import authMiddleware from '../middleware/authMiddleware';
import { isOracleFeatureEnabled } from '../config/oracleConfig';
import {
  cancelOracleRun,
  branchOracleTurn,
  createOracleThread,
  deleteOracleThread,
  getOracleThread,
  getOracleRunStatus,
  listOracleThreads,
  postOracleTurn,
  streamOracleRunEvents,
  updateOracleThread,
} from '../controllers/oracleController';
import {
  activateOracleCredentialController,
  createOracleCredential,
  deleteOracleCredential,
  listOracleCredentials,
  testOracleCredential,
} from '../controllers/oracleCredentialController';

const router = Router();

router.use((_req: Request, res: Response, next: NextFunction) => {
  if (!isOracleFeatureEnabled()) {
    res.status(404).json({
      success: false,
      code: 'oracle_not_available',
      message: 'Không tìm thấy tài nguyên.',
    });
    return;
  }
  // Oracle thread/run state changes independently of the current URL. A cached
  // 304 response has no JSON body and makes the authenticated SPA treat a
  // successful refresh as a failed request.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
router.use(authMiddleware);

router.get('/threads', listOracleThreads);
router.get('/credentials', listOracleCredentials);
router.post('/credentials', createOracleCredential);
router.post('/credentials/:id/test', testOracleCredential);
router.post('/credentials/:id/activate', activateOracleCredentialController);
router.delete('/credentials/:id', deleteOracleCredential);
router.post('/threads', createOracleThread);
router.get('/threads/:id', getOracleThread);
router.patch('/threads/:id', updateOracleThread);
router.delete('/threads/:id', deleteOracleThread);
router.post('/threads/:id/turns', postOracleTurn);
router.post('/threads/:id/turns/:turnId/branch', branchOracleTurn);
router.get('/runs/:runId', getOracleRunStatus);
router.get('/runs/:runId/events', streamOracleRunEvents);
router.post('/runs/:runId/cancel', cancelOracleRun);

export default router;
