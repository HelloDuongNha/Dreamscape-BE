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
  compactUsedCitations,
  executeOracleRun,
} from '../services/oracleRun.service';
import {
  buildRuleGroundedFallbackHypotheses,
  resolveQuestionRuleIds,
} from '../../dream/services/dreamAnalysisGrounding.service';
import {
  localizeOracleRuleStatement,
  localizeOracleVerificationQuestion,
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
  const scoreUpdates = await setRuleValidationFeedback({
    userId,
    verificationKey: selected.link.verificationKey,
    origin: 'oracle',
    originId: parent._id as Types.ObjectId,
    questionText: selected.link.verificationQuestion,
    answer,
    directRuleIds: [selected.link.ruleId],
    sourceId: selected.citation.sourceId,
    exactQuote: selected.link.quote,
  });
  const scoreByRuleId = new Map(scoreUpdates.map((item) => [item.ruleId, item.score]));
  for (const citation of parent.citations) {
    for (const link of citation.ruleLinks || []) {
      link.evidenceScore = scoreByRuleId.get(link.ruleId) ?? link.evidenceScore;
      if (link.verificationKey === selected.link.verificationKey) {
        link.currentUserAnswer = answer;
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
    const page = rows.slice(0, limit).reverse().map((turn) => {
      if (turn.role !== 'assistant' || !turn.citations.length) return turn;
      const textBlockIndex = turn.contentBlocks.findIndex((block) => block.type === 'text');
      if (textBlockIndex < 0) return turn;
      const compacted = compactUsedCitations(
        turn.contentBlocks[textBlockIndex].text,
        turn.citations,
      );
      const contentBlocks = turn.contentBlocks.map((block, index) => (
        index === textBlockIndex ? { ...block, text: compacted.text } : block
      ));
      return { ...turn, contentBlocks, citations: compacted.citations };
    });
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
    if (!Number.isInteger(citationIndex) || citationIndex < 1 || !Types.ObjectId.isValid(ruleId)) {
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
    const citation = turn.citations.find((item) => item.index === citationIndex);
    const ruleLink = citation?.ruleLinks?.find((item) => item.ruleId === ruleId);
    if (!citation || citation.sourceType !== 'academic_source' || !ruleLink?.verificationQuestion) {
      throw new OracleContractError('oracle_invalid_request', 'This citation has no rule-backed verification question.');
    }
    const verifiedRule = await KnowledgeRuleV3.findOne({ _id: ruleId, status: 'verified' })
      .select('_id')
      .lean();
    if (!verifiedRule) {
      throw new OracleContractError('oracle_invalid_request', 'The linked rule is not approved.');
    }
    const verificationKey = ruleLink.verificationKey || `${ruleId}:oracle-citation`;
    const scoreUpdates = await setRuleValidationFeedback({
      userId,
      verificationKey,
      origin: 'oracle',
      originId: turn._id as Types.ObjectId,
      questionText: ruleLink.verificationQuestion,
      answer,
      directRuleIds: [ruleId],
      sourceId: citation.sourceId,
      exactQuote: ruleLink.quote,
    });
    const scoreByRuleId = new Map(scoreUpdates.map((item) => [item.ruleId, item]));
    for (const storedCitation of turn.citations) {
      for (const storedLink of storedCitation.ruleLinks || []) {
        const scoreUpdate = scoreByRuleId.get(storedLink.ruleId);
        if (scoreUpdate) storedLink.evidenceScore = scoreUpdate.score;
        if (storedLink.ruleId === ruleId
          && storedLink.verificationKey === verificationKey) {
          storedLink.currentUserAnswer = answer;
        }
      }
    }
    turn.markModified('citations');
    await turn.save();
    const directScore = scoreUpdates.find((item) => item.ruleId === ruleId);
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
    const citation = turn.citations.find((item) => item.index === citationIndex);
    if (!citation) throw new OracleContractError('oracle_not_found', 'Oracle citation was not found.');
    if (citation.sourceType !== 'academic_source') {
      res.status(200).json({ success: true, data: citation });
      return;
    }
    if (citation.ruleLinks?.length) {
      if (!citation.year) {
        const sourceYear = await AcademicSource.findById(citation.sourceId).select('year').lean();
        if (sourceYear?.year) citation.year = sourceYear.year;
      }
      const verificationKeys = citation.ruleLinks
        .map((rule) => rule.verificationKey || '')
        .filter(Boolean);
      const answerByKey = await getCurrentRuleValidationAnswers(userId, verificationKeys);
      const liveRules = await KnowledgeRuleV3.find({
        _id: { $in: citation.ruleLinks.map((rule) => rule.ruleId) },
        status: 'verified',
      }).select('_id evidenceScore').lean();
      const scoreByRuleId = new Map(
        liveRules.map((rule) => [String(rule._id), Number(rule.evidenceScore) || 0]),
      );
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
    const academicSource = await AcademicSource.findById(citation.sourceId)
      .select('_id sourceContributionId year')
      .lean();
    if (academicSource?.year) citation.year = academicSource.year;
    const evidenceSourceIds = [
      citation.sourceId,
      academicSource?.sourceContributionId ? String(academicSource.sourceContributionId) : '',
    ].filter(Boolean);
    const evidence = await KnowledgeRuleEvidenceV3.find({
      sourceId: { $in: evidenceSourceIds },
      stance: 'supports',
    }).sort({ verificationScore: -1, createdAt: 1 }).lean();
    const evidenceRuleIds = [...new Set(evidence.map((item) => String(item.ruleId)))];
    const rules = await KnowledgeRuleV3.find({
      status: 'verified',
      $or: [
        { _id: { $in: evidenceRuleIds } },
        { 'compositeComponents.sourceRuleId': { $in: evidenceRuleIds } },
      ],
    }).lean();
    const userTurn = turn.parentTurnId
      ? await OracleTurn.findOne({ _id: turn.parentTurnId, userId, role: 'user' }).lean()
      : null;
    const narrative = userTurn?.contentBlocks.map((block) => block.text).join('\n') || '';
    const ruleShapes = rules.map((rule) => ({
      ...rule,
      ruleId: String(rule._id),
      ruleStatement: rule.statement,
      factor: rule.subject,
      outcome: rule.outcome,
      applicationTier: Number(rule.evidenceScore) >= 60 && Number(rule.supportingSourceCount) >= 2
        ? 'supported'
        : 'exploratory',
    }));
    const questions = buildRuleGroundedFallbackHypotheses(ruleShapes, narrative);
    const questionByRuleId = new Map<string, any>();
    for (const question of questions) {
      for (const id of resolveQuestionRuleIds(question)) {
        if (!questionByRuleId.has(id)) questionByRuleId.set(id, question);
      }
    }
    const verificationKeys = questions
      .map((question) => String(question.verificationKey || ''))
      .filter(Boolean);
    const currentAnswerByKey = await getCurrentRuleValidationAnswers(userId, verificationKeys);
    const links = await Promise.all(rules.map(async (rule) => {
      const ownerIds = [String(rule._id), ...(rule.compositeComponents || []).map((item) => String(item.sourceRuleId))];
      const linkedEvidence = evidence.find((item) => ownerIds.includes(String(item.ruleId)));
      const question = questionByRuleId.get(String(rule._id));
      return {
        ruleId: String(rule._id),
        ruleCode: rule.ruleCode,
        statement: rule.statement,
        localizedStatement: localizeOracleRuleStatement(rule),
        quote: linkedEvidence?.exactQuote || citation.excerpt,
        evidenceScore: rule.evidenceScore,
        supportingSourceCount: rule.supportingSourceCount,
        ...(question ? {
          verificationKey: String(question.verificationKey || ''),
          verificationQuestion: String(question.followUpQuestion || ''),
          localizedVerificationQuestion: localizeOracleVerificationQuestion(
            rule,
            question.followUpQuestion,
          ),
        } : {}),
        currentUserAnswer: question?.verificationKey
          ? currentAnswerByKey.get(String(question.verificationKey)) || null
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
