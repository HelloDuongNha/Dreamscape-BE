import { Types } from 'mongoose';
import {
  ApprovalOutcome,
  ApprovalContribution,
} from '../../dto/contributionWorkflow.dto';
import AcademicSource, {
  IAcademicSource,
} from '../../models/AcademicSource';
import { mapSourceOriginAndUrls } from '../source/academicSourceResponse.service';
import { finalizeApprovedSource } from './contributionApprovalFinalization.service';
import {
  createAcademicSource,
  prepareContribution,
} from './contributionApprovalPreparation.service';
import { recordApproval } from './contributionStats.service';
import { reconcileOracleEvidenceGapsForSources } from '../../../oracle/services/oracleEvidenceGap.service';
import {
  startAutomaticRuleV3Extraction,
  type AutomaticRuleExtractionStart,
} from '../../../rules_v3/services/extraction/ruleV3AutomaticExtraction.service';

export type ContributionApprovalResult =
  | { status: 200; body: Record<string, unknown> }
  | { status: 409; body: Record<string, unknown> };

// Approve a contribution, persist its source and finish any reader promotion.
export async function approveSourceContribution(
  contribution: ApprovalContribution,
  reviewerId: Types.ObjectId,
  title: string,
  reviewNote: string,
  reviewNoteProvided: boolean,
  previousStatus: string,
): Promise<ContributionApprovalResult> {
  if (await findDuplicateSource(contribution)) return duplicateApprovalResult();

  const prepared = await prepareContribution(contribution, title);
  const academicSource = createAcademicSource(contribution, prepared);
  await academicSource.save();

  await markContributionApproved(
    contribution,
    reviewerId,
    reviewNote,
    reviewNoteProvided,
  );
  await recordApprovalBestEffort(contribution, previousStatus);

  const outcome = await finalizeApprovedSource(
    academicSource,
    { ...prepared, contribution },
    reviewerId,
  );
  await preserveApprovedTitle(academicSource, prepared.metadata.title);
  const ruleExtraction = await startRuleExtractionBestEffort(academicSource);
  await reconcileEvidenceGapsBestEffort(academicSource, contribution);
  return buildApprovalResult(contribution, academicSource, outcome, ruleExtraction);
}

// Keep the reviewed scholarly title authoritative after reader promotion or import.
async function preserveApprovedTitle(
  academicSource: IAcademicSource,
  approvedTitle: string | undefined,
): Promise<void> {
  if (!approvedTitle || academicSource.title === approvedTitle) return;
  academicSource.title = approvedTitle;
  academicSource.metadata = {
    ...(academicSource.metadata || {}),
    title: approvedTitle,
  };
  await academicSource.save();
}

async function startRuleExtractionBestEffort(
  academicSource: IAcademicSource,
): Promise<AutomaticRuleExtractionStart> {
  try {
    return await startAutomaticRuleV3Extraction(String(academicSource._id));
  } catch (error) {
    console.error('Failed to start Rule V3 extraction after source approval:', error);
    return {
      status: 'failed',
      errorCode: 'automatic_start_failed',
    };
  }
}

async function reconcileEvidenceGapsBestEffort(
  academicSource: IAcademicSource,
  contribution: ApprovalContribution,
): Promise<void> {
  try {
    await reconcileOracleEvidenceGapsForSources([
      academicSource._id,
      contribution._id,
    ]);
  } catch (error) {
    console.error('Failed to reconcile Oracle evidence gaps after source approval:', error);
  }
}

async function findDuplicateSource(contribution: ApprovalContribution) {
  const conditions: Record<string, unknown>[] = [
    { sourceContributionId: contribution._id },
  ];
  if (contribution.normalizedDoi) {
    conditions.push({ normalizedDoi: contribution.normalizedDoi });
  }
  if (contribution.normalizedUrl) {
    conditions.push({ normalizedUrl: contribution.normalizedUrl });
  }
  return AcademicSource.findOne({ $or: conditions });
}

async function markContributionApproved(
  contribution: ApprovalContribution,
  reviewerId: Types.ObjectId,
  reviewNote: string,
  reviewNoteProvided: boolean,
): Promise<void> {
  contribution.reviewStatus = 'approved';
  contribution.reviewedBy = reviewerId;
  contribution.reviewedAt = new Date();
  if (reviewNoteProvided) contribution.reviewNote = reviewNote || undefined;
  await contribution.save();
}

async function recordApprovalBestEffort(
  contribution: ApprovalContribution,
  previousStatus: string,
): Promise<void> {
  if (previousStatus === 'approved') return;
  try {
    await recordApproval(contribution.submittedBy.toString(), contribution);
  } catch (error) {
    console.error('Failed to record contribution approval:', error);
  }
}

function buildApprovalResult(
  contribution: ApprovalContribution,
  academicSource: IAcademicSource,
  outcome: ApprovalOutcome,
  ruleExtraction: AutomaticRuleExtractionStart,
): ContributionApprovalResult {
  return {
    status: 200,
    body: {
      success: true,
      warning: outcome.warning,
      code: outcome.code,
      message: outcome.message,
      details: outcome.details,
      data: {
        contribution: mapSourceOriginAndUrls(contribution),
        academicSource: mapSourceOriginAndUrls(academicSource),
        fullText: outcome.fullText,
        ruleExtraction,
      },
    },
  };
}

function duplicateApprovalResult(): ContributionApprovalResult {
  return {
    status: 409,
    body: {
      success: false,
      message: 'An academic source with the same contribution ID, DOI, or URL already exists.',
    },
  };
}
