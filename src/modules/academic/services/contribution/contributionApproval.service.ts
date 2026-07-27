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
  return buildApprovalResult(contribution, academicSource, outcome);
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
