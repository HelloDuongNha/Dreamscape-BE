import { logger } from '../../../../infrastructure/logger';
import UserDreamProfile from '../../../dream/models/UserDreamProfile';
import User from '../../models/User';
import { buildCulturalProfile, buildScoringProfile } from './profileBuilder.service';

type DreamProfileSyncMode = 'initialize' | 'refresh';

export async function synchronizeUserDreamProfile(
  user: InstanceType<typeof User>,
  mode: DreamProfileSyncMode,
): Promise<void> {
  try {
    const mutableUser = user as any;
    const existingProfile =
      mode === 'refresh'
        ? await UserDreamProfile.findOne({ userId: user._id })
        : null;
    const culturalProfile = buildCulturalProfile(
      mutableUser.birth_date || '',
      mutableUser.birth_hour || '',
    );
    const scoringProfile = buildScoringProfile(
      existingProfile?.measuredPsychologicalProfile,
    );

    await UserDreamProfile.updateOne(
      { userId: user._id },
      buildDreamProfileUpdate(mutableUser, culturalProfile, scoringProfile),
      { upsert: true },
    );
    logger.info(dreamProfileSuccessMessage(mode), { userId: String(user._id) });
  } catch (error) {
    logger.error(dreamProfileFailureMessage(mode), error, {
      userId: String(user._id),
    });
  }
}

function buildDreamProfileUpdate(
  user: any,
  culturalProfile: ReturnType<typeof buildCulturalProfile>,
  scoringProfile: ReturnType<typeof buildScoringProfile>,
) {
  return {
    $set: {
      basicProfile: {
        fullName: user.fullName || '',
        gender: user.gender || 'unknown',
        birthDate: user.birth_date || '',
        birthHour: user.birth_hour || '',
        birthTimeUnknown: !user.birth_hour || user.birth_hour === 'none',
      },
      culturalProfile,
      scoringProfile,
      updatedAt: new Date(),
    },
    $setOnInsert: {
      measuredPsychologicalProfile: {
        bigFive: {
          enabled: false,
          source: null,
          openness: null,
          conscientiousness: null,
          extraversion: null,
          agreeableness: null,
          neuroticism: null,
        },
        chronotype: { enabled: false, source: null, type: null },
        schemas: { enabled: false, source: null, detectedSchemas: [] },
      },
      learnedPersonalPattern: {
        totalDreams: 0,
        commonSymbols: [],
        commonThemes: [],
        commonEmotions: [],
        averageDreamScore: null,
      },
      preferences: {
        allowCulturalAnalysis: true,
        allowFingerprintAnalysis: false,
        allowPsychologicalPersonalization: false,
        allowCommunitySimilarity: false,
      },
      createdAt: new Date(),
    },
  };
}

function dreamProfileSuccessMessage(mode: DreamProfileSyncMode): string {
  return mode === 'initialize'
    ? 'User dream profile initialized upon registration verification.'
    : 'User dream profile updated successfully.';
}

function dreamProfileFailureMessage(mode: DreamProfileSyncMode): string {
  return mode === 'initialize'
    ? 'Failed to initialize user dream profile.'
    : 'Failed to update user dream profile.';
}
