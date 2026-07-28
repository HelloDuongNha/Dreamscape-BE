import { Request, Response } from 'express';
import { Types } from 'mongoose';
import OracleThread from '../models/OracleThread';
import OracleTurn from '../models/OracleTurn';
import OracleRun from '../models/OracleRun';
import OracleRunEvent from '../models/OracleRunEvent';
import KnowledgeRuleV3 from '../../rules_v3/models/KnowledgeRule';
import KnowledgeRuleEvidenceV3 from '../../rules_v3/models/KnowledgeRuleEvidence';
import AcademicSource from '../../academic/models/AcademicSource';
import { createOracleTurnRun } from '../services/oraclePersistence.service';
import { OracleContractError } from '../services/oracle.types';
import {
  parseClientRequestId,
  parseOracleContent,
  parseOracleMode,
  parseOracleObjectId,
} from '../services/oracle.validation';
import { ORACLE_RUN_EVENT_RETENTION_MS } from '../../../config/oracleConfig';
import {
  abortOracleRun,
  executeOracleRun,
} from '../services/oracleRun.service';
import {
  buildOracleCitationVerificationQuestion,
  localizeOracleRuleStatement,
  localizeOracleVerificationQuestion,
  ORACLE_CITATION_QUESTION_VERSION,
} from '../services/oracleRulePresentation.service';
import {
  getCurrentRuleValidationAnswers,
  setRuleValidationFeedback,
} from '../../rules_v3/services/ruleV3ValidationScore.service';
import { logger } from '../../../infrastructure/logger';

function requesterId(req: Request): Types.ObjectId {
  if (!req.user?._id) {
    throw new OracleContractError('oracle_not_found', 'Oracle resource was not found.');
  }
  return new Types.ObjectId(String(req.user._id));
}

function sendOracleError(res: Response, error: unknown): void {
  if (error instanceof OracleContractError) {
    const status = error.code === 'oracle_not_found'
      ? 404
      : error.code === 'oracle_idempotency_conflict'
        ? 409
        : error.code === 'oracle_invalid_request'
          ? 400
          : 500;
    res.status(status).json({
      success: false,
      code: error.code,
      message: status === 404
        ? 'Không tìm thấy tài nguyên Oracle.'
        : status === 409
          ? 'Yêu cầu này xung đột với một yêu cầu đã tồn tại.'
          : status === 400
            ? 'Dữ liệu yêu cầu Oracle không hợp lệ.'
            : 'Không thể lưu yêu cầu Oracle.',
      ...(status === 400 ? { reason: error.message } : {}),
    });
    return;
  }
  res.status(500).json({
    success: false,
    code: 'oracle_internal_error',
    message: 'Không thể xử lý yêu cầu Oracle.',
  });
}

function parseLimit(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) {
    throw new OracleContractError('oracle_invalid_request', 'Invalid pagination limit.');
  }
  return parsed;
}

function deriveThreadTitle(content: string): string {
  const compact = content.replace(/\s+/g, ' ').trim();
  if (compact.length <= 64) return compact;
  const shortened = compact.slice(0, 64);
  const wordBoundary = shortened.lastIndexOf(' ');
  return `${(wordBoundary >= 36 ? shortened.slice(0, wordBoundary) : shortened).trim()}…`;
}

// Creates one neutral yes/no check when a linked rule has never supplied a question.
function fallbackCitationQuestion(rule: any): {
  verificationKey: string;
  vi: string;
  en: string;
} {
  const question = buildOracleCitationVerificationQuestion(rule);
  return {
    verificationKey: `${String(rule._id)}:oracle-citation`,
    ...question,
  };
}

// Resolves a saved citation to its current argument through identity or exact evidence.
async function resolveCurrentCitationRule(ruleLink: {
  ruleId: string;
  ruleCode: string;
  quote?: string;
}, sourceIds: string[]): Promise<any | null> {
  const ruleIds = [ruleLink.ruleId].filter((value) => Types.ObjectId.isValid(value));
  const ruleCodes = [ruleLink.ruleCode, ruleLink.ruleId]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const currentRule = await KnowledgeRuleV3.findOne({
    status: { $in: ['pending', 'verified'] },
    $or: [
      { _id: { $in: ruleIds } },
      { ruleCode: { $in: ruleCodes } },
      { 'compositeComponents.sourceRuleId': { $in: ruleIds } },
      { 'compositeComponents.ruleCode': { $in: ruleCodes } },
    ],
  }).lean();
  if (currentRule) return currentRule;

  const evidenceSourceIds = sourceIds
    .filter((value) => Types.ObjectId.isValid(value))
    .map((value) => new Types.ObjectId(value));
  if (ruleLink.quote?.trim() && evidenceSourceIds.length) {
    const currentEvidence = await KnowledgeRuleEvidenceV3.findOne({
      sourceId: { $in: evidenceSourceIds },
      exactQuote: ruleLink.quote.trim(),
      stance: 'supports',
    }).sort({ createdAt: -1 }).select('ruleId').lean();
    if (currentEvidence?.ruleId) {
      const evidenceRule = await KnowledgeRuleV3.findOne({
        status: { $in: ['pending', 'verified'] },
        $or: [
          { _id: currentEvidence.ruleId },
          { 'compositeComponents.sourceRuleId': currentEvidence.ruleId },
        ],
      }).lean();
      if (evidenceRule) return evidenceRule;
    }
  }

  const retiredRule = await KnowledgeRuleV3.findOne({
    $or: [
      { _id: { $in: ruleIds } },
      { ruleCode: { $in: ruleCodes } },
    ],
    mergedIntoRuleId: { $exists: true },
  }).select('mergedIntoRuleId').lean();
  if (!retiredRule?.mergedIntoRuleId) return null;

  return KnowledgeRuleV3.findOne({
    _id: retiredRule.mergedIntoRuleId,
    status: { $in: ['pending', 'verified'] },
  }).lean();
}

function parseOracleValidationReply(content: string): 'yes' | 'no' | 'unsure' | null {
  const normalized = content.normalize('NFKC').trim().toLocaleLowerCase('vi');
  const explicitYes = /^(?:có|yes)\s*[.!?]*$/iu.test(normalized)
    || /^(?:có|yes)\s*[,;:—-]/iu.test(normalized)
    || /^có\s+(?:tôi|mình|đúng|điều|chính xác|chắc chắn)\b/iu.test(normalized)
    || /^yes\s+(?:i|that|this|it)\b/iu.test(normalized);
  if (explicitYes) return 'yes';
  const explicitNo = /^(?:không|no)\s*[.!?]*$/iu.test(normalized)
    || /^(?:không|no)\s*[,;:—-]/iu.test(normalized)
    || /^không\s+(?:tôi|mình|đúng|điều|chính xác)\b/iu.test(normalized)
    || /^no\s+(?:i|that|this|it)\b/iu.test(normalized);
  if (explicitNo) return 'no';
  if (/^(?:tôi\s+)?(?:chưa\s+chắc|không\s+chắc|not\s+sure|i'?m\s+not\s+sure)\b/iu.test(normalized)) {
    return 'unsure';
  }
  return null;
}

async function applyOracleReplyValidation(
  userId: Types.ObjectId,
  parentTurnId: Types.ObjectId | undefined,
  content: string,
): Promise<void> {
  const answer = parseOracleValidationReply(content);
  if (!answer || !parentTurnId) return;
  const parent = await OracleTurn.findOne({
    _id: parentTurnId,
    userId,
    role: 'assistant',
    status: 'completed',
  });
  if (!parent) return;
  const answerText = parent.contentBlocks.map((block) => block.text).join('\n');
  const candidates = parent.citations.flatMap((citation) =>
    (citation.ruleLinks || [])
      .filter((link) => link.verificationQuestion && link.verificationKey)
      .map((link) => ({
        citation,
        link,
        position: answerText.lastIndexOf(link.verificationQuestion || ''),
      })))
    .filter((item) => item.position >= 0)
    .sort((left, right) => right.position - left.position);
  const selected = candidates[0];
  if (!selected?.link.verificationKey || !selected.link.verificationQuestion) return;
  const currentRule = await resolveCurrentCitationRule(
    selected.link,
    [selected.citation.sourceId],
  );
  if (!currentRule) return;
  const currentRuleId = String(currentRule._id);
  const scoreUpdates = await setRuleValidationFeedback({
    userId,
    verificationKey: selected.link.verificationKey,
    origin: 'oracle',
    originId: parent._id as Types.ObjectId,
    questionText: selected.link.verificationQuestion,
    answer,
    directRuleIds: [currentRuleId],
    sourceId: selected.citation.sourceId,
    exactQuote: selected.link.quote,
  });
  const scoreByRuleId = new Map(scoreUpdates.map((item) => [item.ruleId, item.score]));
  const directScore = scoreByRuleId.get(currentRuleId);
  for (const citation of parent.citations) {
    for (const link of citation.ruleLinks || []) {
      link.evidenceScore = scoreByRuleId.get(link.ruleId) ?? link.evidenceScore;
      if (link.verificationKey === selected.link.verificationKey) {
        link.currentUserAnswer = answer;
        if (directScore != null) link.evidenceScore = directScore;
      }
    }
  }
  parent.markModified('citations');
  await parent.save();
}

export async function listOracleThreads(req: Request, res: Response): Promise<void> {
  try {
    const userId = requesterId(req);
    const limit = parseLimit(req.query.limit, 30, 50);
    const beforeId = req.query.beforeId ? parseOracleObjectId(req.query.beforeId) : null;
    const filter: Record<string, unknown> = {
      userId,
      deletedAt: { $exists: false },
      nextTurnSequence: { $gt: 0 },
    };
    if (beforeId) filter._id = { $lt: beforeId };
    const rows = await OracleThread.find(filter)
      .sort({ pinned: -1, lastTurnAt: -1, _id: -1 })
      .limit(limit + 1)
      .lean();
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const activeRuns = await OracleRun.find({
      userId,
      threadId: { $in: page.map((thread) => thread._id) },
      status: { $in: ['initializing', 'queued', 'running'] },
    })
      .sort({ createdAt: -1 })
      .select('_id threadId assistantTurnId status createdAt expectedMinMs expectedMaxMs stage stageStartedAt')
      .lean();
    const activeByThread = new Map(
      activeRuns.map((run) => [String(run.threadId), run]),
    );
    const data = page.map((thread) => {
      const activeRun = activeByThread.get(String(thread._id));
      if (activeRun) void executeOracleRun(activeRun._id);
      return {
        ...thread,
        activeRunId: activeRun ? String(activeRun._id) : null,
        activeRunStatus: activeRun?.status || null,
        activeRunStartedAt: activeRun?.createdAt || null,
        activeRunAssistantTurnId: activeRun ? String(activeRun.assistantTurnId) : null,
        activeRunExpectedMinMs: activeRun?.expectedMinMs || null,
        activeRunExpectedMaxMs: activeRun?.expectedMaxMs || null,
        activeRunStage: activeRun?.stage || 'thinking',
        activeRunStageStartedAt: activeRun?.stageStartedAt || activeRun?.createdAt || null,
      };
    });
    res.status(200).json({
      success: true,
      data,
      nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
    });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function createOracleThread(req: Request, res: Response): Promise<void> {
  try {
    const userId = requesterId(req);
    const mode = parseOracleMode(req.body?.mode ?? 'chat');
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    if (title.length > 120) {
      throw new OracleContractError('oracle_invalid_request', 'Thread title is too long.');
    }
    const thread = await OracleThread.create({
      userId,
      mode,
      title: title || 'New conversation',
      attachedDreamIds: [],
    });
    res.status(201).json({ success: true, data: thread });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function getOracleThread(req: Request, res: Response): Promise<void> {
  try {
    const userId = requesterId(req);
    const threadId = parseOracleObjectId(req.params.id);
    const limit = parseLimit(req.query.limit, 50, 100);
    const beforeSequence = req.query.beforeSequence === undefined
      ? null
      : Number(req.query.beforeSequence);
    if (beforeSequence !== null && (!Number.isInteger(beforeSequence) || beforeSequence < 1)) {
      throw new OracleContractError('oracle_invalid_request', 'Invalid turn cursor.');
    }
    const thread = await OracleThread.findOne({
      _id: threadId,
      userId,
      deletedAt: { $exists: false },
    }).lean();
    if (!thread) throw new OracleContractError('oracle_not_found', 'Oracle thread was not found.');

    const turnFilter: Record<string, unknown> = { threadId, userId };
    if (beforeSequence !== null) turnFilter.sequence = { $lt: beforeSequence };
    const rows = await OracleTurn.find(turnFilter)
      .sort({ sequence: -1 })
      .limit(limit + 1)
      .lean();
    const hasMore = rows.length > limit;
    // Giữ nguyên số citation đã lưu để endpoint chi tiết luôn mở đúng nguồn.
    const page = rows.slice(0, limit).reverse();
    res.status(200).json({
      success: true,
      data: {
        thread,
        turns: page,
        nextCursor: hasMore ? page[0]?.sequence ?? null : null,
      },
    });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function updateOracleThread(req: Request, res: Response): Promise<void> {
  try {
    const userId = requesterId(req);
    const threadId = parseOracleObjectId(req.params.id);
    const update: Record<string, unknown> = {};
    if (req.body?.title !== undefined) {
      if (typeof req.body.title !== 'string' || !req.body.title.trim() || req.body.title.trim().length > 120) {
        throw new OracleContractError('oracle_invalid_request', 'Invalid thread title.');
      }
      update.title = req.body.title.trim();
    }
    if (req.body?.pinned !== undefined) {
      if (typeof req.body.pinned !== 'boolean') throw new OracleContractError('oracle_invalid_request', 'Invalid pinned value.');
      update.pinned = req.body.pinned;
    }
    if (req.body?.archived !== undefined) {
      if (typeof req.body.archived !== 'boolean') throw new OracleContractError('oracle_invalid_request', 'Invalid archived value.');
      update.archived = req.body.archived;
    }
    if (Object.keys(update).length === 0) {
      throw new OracleContractError('oracle_invalid_request', 'No supported thread fields were provided.');
    }
    const thread = await OracleThread.findOneAndUpdate(
      { _id: threadId, userId, deletedAt: { $exists: false } },
      { $set: update },
      { new: true, runValidators: true },
    );
    if (!thread) throw new OracleContractError('oracle_not_found', 'Oracle thread was not found.');
    res.status(200).json({ success: true, data: thread });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function deleteOracleThread(req: Request, res: Response): Promise<void> {
  try {
    const userId = requesterId(req);
    const threadId = parseOracleObjectId(req.params.id);
    const now = new Date();
    const thread = await OracleThread.findOneAndUpdate(
      { _id: threadId, userId, deletedAt: { $exists: false } },
      { $set: { deletedAt: now, archived: true } },
      { new: true },
    );
    if (!thread) throw new OracleContractError('oracle_not_found', 'Oracle thread was not found.');

    const activeRuns = await OracleRun.find({
      threadId,
      userId,
      status: { $in: ['initializing', 'queued', 'running'] },
    }).select('_id');
    const runIds = activeRuns.map((run) => run._id);
    if (runIds.length > 0) {
      await Promise.all([
        OracleRun.updateMany(
          { _id: { $in: runIds }, userId },
          { $set: { status: 'cancelled', completedAt: now, errorCode: 'thread_deleted' } },
        ),
        OracleTurn.updateMany(
          { runId: { $in: runIds }, userId, role: 'assistant', status: { $in: ['queued', 'streaming'] } },
          { $set: { status: 'cancelled', finalizedAt: now } },
        ),
        OracleRunEvent.updateMany(
          { runId: { $in: runIds }, userId },
          { $set: { expiresAt: new Date(now.getTime() + ORACLE_RUN_EVENT_RETENTION_MS) } },
        ),
      ]);
    }
    res.status(200).json({ success: true, message: 'Thread deleted.' });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function postOracleTurn(req: Request, res: Response): Promise<void> {
  try {
    const userId = requesterId(req);
    const threadId = parseOracleObjectId(req.params.id);
    const clientRequestId = parseClientRequestId(req.body?.clientRequestId);
    const content = parseOracleContent(req.body?.content);
    const requestedParentId = req.body?.parentTurnId
      ? parseOracleObjectId(req.body.parentTurnId)
      : null;
    let parentTurnId: Types.ObjectId | undefined;
    if (requestedParentId) {
      const parent = await OracleTurn.findOne({
        _id: requestedParentId,
        threadId,
        userId,
        role: 'assistant',
        status: 'completed',
      }).select('_id');
      if (!parent) throw new OracleContractError('oracle_not_found', 'Oracle parent turn was not found.');
      parentTurnId = parent._id as Types.ObjectId;
    } else {
      const latestAssistant = await OracleTurn.findOne({
        threadId,
        userId,
        role: 'assistant',
        status: 'completed',
      }).sort({ sequence: -1 }).select('_id');
      parentTurnId = latestAssistant?._id as Types.ObjectId | undefined;
    }
    const result = await createOracleTurnRun({
      userId,
      threadId,
      clientRequestId,
      content,
      parentTurnId,
    });
    if (!result.replayed) {
      try {
        await applyOracleReplyValidation(userId, parentTurnId, content);
      } catch (error) {
        // A validation-score write must never strand the already-created,
        // idempotent Oracle run. The answer remains in the chat and can be
        // submitted again from the source modal.
        logger.warn('Oracle reply validation could not update the argument score.', {
          error: String(error),
          threadId: String(threadId),
          parentTurnId: parentTurnId ? String(parentTurnId) : null,
        });
      }
      await OracleThread.updateOne(
        { _id: threadId, userId, nextTurnSequence: 2 },
        { $set: { title: deriveThreadTitle(content) } },
      );
      void executeOracleRun(result.runId);
    }
    res.status(result.replayed ? 200 : 201).json({ success: true, data: result });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function submitOracleCitationFeedback(req: Request, res: Response): Promise<void> {
  try {
    const userId = requesterId(req);
    const turnId = parseOracleObjectId(req.params.turnId);
    const citationIndex = Number(req.params.index);
    const ruleId = String(req.body?.ruleId || '').trim();
    const answer = req.body?.answer === null
      ? null
      : String(req.body?.answer || '').trim() as 'yes' | 'no' | 'unsure';
    if (!Number.isInteger(citationIndex) || citationIndex < 1 || !ruleId) {
      throw new OracleContractError('oracle_invalid_request', 'Invalid citation feedback target.');
    }
    if (answer !== null && !['yes', 'no', 'unsure'].includes(answer)) {
      throw new OracleContractError('oracle_invalid_request', 'Invalid citation feedback answer.');
    }
    const turn = await OracleTurn.findOne({
      _id: turnId,
      userId,
      role: 'assistant',
      status: 'completed',
    });
    if (!turn) throw new OracleContractError('oracle_not_found', 'Oracle turn was not found.');
    const expectedSourceId = String(req.query.sourceId || '').trim();
    const expectedAcademicSource = expectedSourceId
      ? await AcademicSource.findOne({
          $or: [
            { _id: expectedSourceId },
            { sourceContributionId: expectedSourceId },
          ],
        }).select('_id sourceContributionId').lean()
      : null;
    const expectedSourceIds = new Set([
      expectedSourceId,
      expectedAcademicSource?._id ? String(expectedAcademicSource._id) : '',
      expectedAcademicSource?.sourceContributionId ? String(expectedAcademicSource.sourceContributionId) : '',
    ].filter(Boolean));
    const citation = (
      expectedSourceId
        ? turn.citations.find((item) => expectedSourceIds.has(item.sourceId))
        : null
    ) || turn.citations.find((item) => item.index === citationIndex);
    const ruleLink = citation?.ruleLinks?.find((item) =>
      item.ruleId === ruleId || item.ruleCode === ruleId);
    if (!citation || citation.sourceType !== 'academic_source' || !ruleLink?.verificationQuestion) {
      throw new OracleContractError('oracle_invalid_request', 'This citation has no rule-backed verification question.');
    }
    const currentRule = await resolveCurrentCitationRule(ruleLink, [...expectedSourceIds]);
    if (!currentRule) {
      throw new OracleContractError(
        'oracle_invalid_request',
        'The citation no longer has a current argument backed by this exact excerpt.',
      );
    }
    const canonicalRuleId = String(currentRule._id);
    const verificationKey = ruleLink.verificationKey || `${canonicalRuleId}:oracle-citation`;
    const scoreUpdates = await setRuleValidationFeedback({
      userId,
      verificationKey,
      origin: 'oracle',
      originId: turn._id as Types.ObjectId,
      questionText: ruleLink.verificationQuestion,
      answer,
      directRuleIds: [canonicalRuleId],
      sourceId: citation.sourceId,
      exactQuote: ruleLink.quote,
    });
    const scoreByRuleId = new Map(scoreUpdates.map((item) => [item.ruleId, item]));
    const directScore = scoreByRuleId.get(canonicalRuleId);
    for (const storedCitation of turn.citations) {
      for (const storedLink of storedCitation.ruleLinks || []) {
        const scoreUpdate = scoreByRuleId.get(storedLink.ruleId);
        if (scoreUpdate) storedLink.evidenceScore = scoreUpdate.score;
        if ((storedLink.ruleId === ruleId
          || storedLink.ruleId === canonicalRuleId
          || storedLink.ruleCode === ruleId
          || storedLink.ruleCode === ruleLink.ruleCode)
          && storedLink.verificationKey === verificationKey) {
          storedLink.currentUserAnswer = answer;
          if (directScore) storedLink.evidenceScore = directScore.score;
        }
      }
    }
    turn.markModified('citations');
    await turn.save();
    res.status(200).json({
      success: true,
      data: {
        ruleId,
        answer,
        score: directScore?.score ?? ruleLink.evidenceScore,
        scoreDelta: directScore?.scoreDelta ?? 0,
        voteDelta: directScore?.voteDelta ?? 0,
        scoreUpdates,
      },
    });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function getOracleCitationDetails(req: Request, res: Response): Promise<void> {
  try {
    const userId = requesterId(req);
    const turnId = parseOracleObjectId(req.params.turnId);
    const citationIndex = Number(req.params.index);
    if (!Number.isInteger(citationIndex) || citationIndex < 1) {
      throw new OracleContractError('oracle_invalid_request', 'Invalid citation index.');
    }
    const turn = await OracleTurn.findOne({
      _id: turnId,
      userId,
      role: 'assistant',
      status: 'completed',
    });
    if (!turn) throw new OracleContractError('oracle_not_found', 'Oracle turn was not found.');
    const expectedSourceId = String(req.query.sourceId || '').trim();
    const citation = (
      expectedSourceId
        ? turn.citations.find((item) => item.sourceId === expectedSourceId)
        : null
    ) || turn.citations.find((item) => item.index === citationIndex);
    if (!citation) throw new OracleContractError('oracle_not_found', 'Oracle citation was not found.');
    if (citation.sourceType !== 'academic_source') {
      res.status(200).json({ success: true, data: citation });
      return;
    }
    const academicSource = await AcademicSource.findOne({
      $or: [
        { _id: citation.sourceId },
        { sourceContributionId: citation.sourceId },
      ],
    }).select('_id sourceContributionId title year').lean();
    if (!academicSource) {
      throw new OracleContractError(
        'oracle_not_found',
        'The academic citation no longer points to an approved source.',
      );
    }
    const canonicalSourceId = String(academicSource._id);
    if (citation.sourceId !== canonicalSourceId) {
      citation.sourceId = canonicalSourceId;
      citation.title = academicSource.title || citation.title;
    }
    if (academicSource.year) citation.year = academicSource.year;

    if (citation.ruleLinks?.length) {
      if (!citation.year) {
        citation.year = academicSource.year;
      }
      const sourceAliases = [
        canonicalSourceId,
        academicSource.sourceContributionId ? String(academicSource.sourceContributionId) : '',
      ].filter(Boolean);
      const currentLinks = [];
      for (const link of citation.ruleLinks) {
        const currentRule = await resolveCurrentCitationRule(link, sourceAliases);
        if (!currentRule) continue;
        const currentEvidence = link.quote
          ? await KnowledgeRuleEvidenceV3.findOne({
            sourceId: { $in: sourceAliases },
            exactQuote: link.quote,
            stance: 'supports',
          }).sort({ createdAt: -1 }).select('_id').lean()
          : null;
        const verificationKey = `${String(currentRule._id)}:${
          currentEvidence?._id ? String(currentEvidence._id) : canonicalSourceId
        }:oracle-citation-${ORACLE_CITATION_QUESTION_VERSION}`;
        const existingQuestionIsCurrent = link.verificationKey === verificationKey
          && Boolean(link.verificationQuestion);
        if (!existingQuestionIsCurrent) {
          const freshQuestion = fallbackCitationQuestion(currentRule);
          link.verificationKey = verificationKey;
          link.verificationQuestion = freshQuestion.vi;
          link.localizedVerificationQuestion = freshQuestion;
          link.currentUserAnswer = null;
        }
        link.ruleId = String(currentRule._id);
        link.ruleCode = String(currentRule.ruleCode || link.ruleCode);
        link.statement = String(currentRule.statement || link.statement);
        link.evidenceScore = Number(currentRule.evidenceScore) || 0;
        link.supportingSourceCount = Number(currentRule.supportingSourceCount) || 0;
        currentLinks.push(link);
      }
      citation.ruleLinks = currentLinks;
      const verificationKeys = citation.ruleLinks
        .map((rule) => rule.verificationKey || '')
        .filter(Boolean);
      const answerByKey = await getCurrentRuleValidationAnswers(userId, verificationKeys);
      const linkedRuleIds = citation.ruleLinks
        .map((rule) => rule.ruleId)
        .filter((ruleId) => Types.ObjectId.isValid(ruleId));
      const linkedRuleCodes = citation.ruleLinks
        .flatMap((rule) => [rule.ruleId, rule.ruleCode])
        .filter((ruleCode) => ruleCode && !Types.ObjectId.isValid(ruleCode));
      const liveRules = await KnowledgeRuleV3.find({
        status: { $in: ['pending', 'verified'] },
        $or: [
          { _id: { $in: linkedRuleIds } },
          { ruleCode: { $in: linkedRuleCodes } },
          { 'compositeComponents.sourceRuleId': { $in: linkedRuleIds } },
          { 'compositeComponents.ruleCode': { $in: linkedRuleCodes } },
        ],
      }).select('_id ruleCode evidenceScore compositeComponents.sourceRuleId compositeComponents.ruleCode').lean();
      const scoreByRuleId = new Map<string, number>();
      for (const rule of liveRules) {
        const score = Number(rule.evidenceScore) || 0;
        scoreByRuleId.set(String(rule._id), score);
        scoreByRuleId.set(String(rule.ruleCode), score);
        for (const component of rule.compositeComponents || []) {
          scoreByRuleId.set(String(component.sourceRuleId), score);
          scoreByRuleId.set(String(component.ruleCode), score);
        }
      }
      for (const link of citation.ruleLinks) {
        link.localizedStatement = localizeOracleRuleStatement(link);
        link.localizedVerificationQuestion = localizeOracleVerificationQuestion(
          link,
          link.verificationQuestion,
        );
        link.currentUserAnswer = link.verificationKey
          ? answerByKey.get(link.verificationKey) || null
          : null;
        link.evidenceScore = scoreByRuleId.get(link.ruleId) ?? link.evidenceScore;
      }
      turn.markModified('citations');
      await turn.save();
      res.status(200).json({ success: true, data: citation });
      return;
    }
    const evidenceSourceIds = [
      canonicalSourceId,
      academicSource?.sourceContributionId ? String(academicSource.sourceContributionId) : '',
    ].filter(Boolean);
    const evidence = await KnowledgeRuleEvidenceV3.find({
      sourceId: { $in: evidenceSourceIds },
      stance: 'supports',
    }).sort({ verificationScore: -1, createdAt: 1 }).lean();
    const evidenceRuleIds = [...new Set(evidence.map((item) => String(item.ruleId)))];
    const rules = await KnowledgeRuleV3.find({
      status: { $in: ['pending', 'verified'] },
      $or: [
        { _id: { $in: evidenceRuleIds } },
        { 'compositeComponents.sourceRuleId': { $in: evidenceRuleIds } },
      ],
    }).lean();
    // Questions are generated for this citation version only; never reuse a
    // question or answer from an unrelated historical turn.
    const questionByRuleId = new Map<string, any>();
    const questionByRuleIdWithFallback = new Map<string, any>(questionByRuleId);
    for (const rule of rules) {
      const ownerIds = [String(rule._id), ...(rule.compositeComponents || []).map((item) => String(item.sourceRuleId))];
      if (!ownerIds.some((ownerId) => questionByRuleIdWithFallback.has(ownerId))) {
        questionByRuleIdWithFallback.set(String(rule._id), fallbackCitationQuestion(rule));
      }
    }
    const verificationKeys = [...questionByRuleIdWithFallback.values()]
      .map((question) => String(question.verificationKey || ''))
      .filter(Boolean);
    const currentAnswerByKey = await getCurrentRuleValidationAnswers(userId, verificationKeys);
    const links = await Promise.all(rules.map(async (rule) => {
      const ownerIds = [String(rule._id), ...(rule.compositeComponents || []).map((item) => String(item.sourceRuleId))];
      const linkedEvidence = evidence.find((item) => ownerIds.includes(String(item.ruleId)));
      const question = ownerIds
        .map((ownerId) => questionByRuleIdWithFallback.get(ownerId))
        .find(Boolean);
      const fallback = question?.vi && question?.en ? question : null;
      const verificationKey = `${String(rule._id)}:${
        String(linkedEvidence?._id || canonicalSourceId)
      }:oracle-citation-v2`;
      const verificationQuestion = String(
        question?.followUpQuestion || fallback?.vi || '',
      );
      return {
        ruleId: String(rule._id),
        ruleCode: rule.ruleCode,
        statement: rule.statement,
        localizedStatement: localizeOracleRuleStatement(rule),
        quote: linkedEvidence?.exactQuote || citation.excerpt,
        evidenceScore: rule.evidenceScore,
        supportingSourceCount: rule.supportingSourceCount,
        verificationKey,
        verificationQuestion,
        localizedVerificationQuestion: fallback
          ? { vi: fallback.vi, en: fallback.en }
          : localizeOracleVerificationQuestion(rule, question?.followUpQuestion),
        currentUserAnswer: verificationKey
          ? currentAnswerByKey.get(verificationKey) || null
          : null,
      };
    }));
    citation.ruleLinks = links;
    turn.markModified('citations');
    await turn.save();
    res.status(200).json({ success: true, data: citation });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function branchOracleTurn(req: Request, res: Response): Promise<void> {
  try {
    const userId = requesterId(req);
    const threadId = parseOracleObjectId(req.params.id);
    const originalTurnId = parseOracleObjectId(req.params.turnId);
    const clientRequestId = parseClientRequestId(req.body?.clientRequestId);
    const content = parseOracleContent(req.body?.content);
    const original = await OracleTurn.findOne({
      _id: originalTurnId,
      threadId,
      userId,
      role: 'user',
      status: 'completed',
    }).select('_id parentTurnId branchRootTurnId');
    if (!original) throw new OracleContractError('oracle_not_found', 'Oracle turn was not found.');

    const result = await createOracleTurnRun({
      userId,
      threadId,
      clientRequestId,
      content,
      parentTurnId: original.parentTurnId,
      branchRootTurnId: original.branchRootTurnId || original._id,
      supersedesTurnId: original._id,
    });
    if (!result.replayed) void executeOracleRun(result.runId);
    res.status(result.replayed ? 200 : 201).json({ success: true, data: result });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function cancelOracleRun(req: Request, res: Response): Promise<void> {
  try {
    const userId = requesterId(req);
    const runId = parseOracleObjectId(req.params.runId);
    const now = new Date();
    const run = await OracleRun.findOneAndUpdate(
      { _id: runId, userId, status: { $in: ['initializing', 'queued', 'running'] } },
      { $set: { status: 'cancelled', completedAt: now, errorCode: 'user_cancelled' } },
      { new: true },
    );
    if (!run) throw new OracleContractError('oracle_not_found', 'Oracle run was not found.');
    abortOracleRun(String(runId));
    await OracleTurn.updateOne(
      { _id: run.assistantTurnId, userId, status: { $in: ['queued', 'streaming'] } },
      { $set: { status: 'cancelled', finalizedAt: now } },
    );
    res.status(200).json({ success: true, message: 'Run cancelled.' });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function getOracleRunStatus(req: Request, res: Response): Promise<void> {
  try {
    const userId = requesterId(req);
    const runId = parseOracleObjectId(req.params.runId);
    const run = await OracleRun.findOne({ _id: runId, userId })
      .select(
        '_id threadId assistantTurnId status createdAt completedAt '
        + 'expectedMinMs expectedMaxMs stage stageStartedAt errorCode',
      )
      .lean();
    if (!run) throw new OracleContractError('oracle_not_found', 'Oracle run was not found.');
    if (['initializing', 'queued', 'running'].includes(run.status)) void executeOracleRun(run._id);
    res.status(200).json({
      success: true,
      data: {
        runId: String(run._id),
        threadId: String(run.threadId),
        assistantTurnId: String(run.assistantTurnId),
        status: run.status,
        startedAt: run.createdAt,
        completedAt: run.completedAt || null,
        expectedMinMs: run.expectedMinMs || null,
        expectedMaxMs: run.expectedMaxMs || null,
        stage: run.stage || 'thinking',
        stageStartedAt: run.stageStartedAt || run.createdAt,
        errorCode: run.errorCode || null,
      },
    });
  } catch (error) {
    sendOracleError(res, error);
  }
}

export async function streamOracleRunEvents(req: Request, res: Response): Promise<void> {
  try {
    const userId = requesterId(req);
    const runId = parseOracleObjectId(req.params.runId);
    const afterSequence = req.query.afterSequence === undefined ? 0 : Number(req.query.afterSequence);
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new OracleContractError('oracle_invalid_request', 'Invalid event cursor.');
    }
    const run = await OracleRun.findOne({ _id: runId, userId }).lean();
    if (!run) throw new OracleContractError('oracle_not_found', 'Oracle run was not found.');

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    let cursor = afterSequence;
    let closed = false;
    res.on('close', () => { closed = true; });
    const deadline = Date.now() + 25_000;
    while (!closed && Date.now() < deadline) {
      const events = await OracleRunEvent.find({ runId, userId, sequence: { $gt: cursor } })
        .sort({ sequence: 1 })
        .limit(100)
        .lean();
      for (const event of events) {
        cursor = event.sequence;
        res.write(`id: ${event.sequence}\n`);
        res.write(`event: ${event.eventType}\n`);
        res.write(`data: ${JSON.stringify({
          ...(event.payload || {}),
          _eventCreatedAt: event.createdAt,
        })}\n\n`);
      }
      const current = await OracleRun.findOne({ _id: runId, userId }).select('status').lean();
      if (!current || ['completed', 'failed', 'cancelled'].includes(current.status)) break;
        await new Promise((resolve) => setTimeout(resolve, 90));
    }
    if (!closed) res.end();
  } catch (error) {
    if (!res.headersSent) sendOracleError(res, error);
    else res.end();
  }
}
