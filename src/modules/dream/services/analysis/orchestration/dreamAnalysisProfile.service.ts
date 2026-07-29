import mongoose from 'mongoose';
import UserDreamProfile from '../../../models/UserDreamProfile';

const defaultProfile = {
  basicProfile: { fullName: '', gender: 'unknown', birthDate: '', birthHour: '', birthTimeUnknown: true },
  culturalProfile: {
    zodiac: { sign: 'unknown', viName: 'Chưa rõ', element: 'unknown', tags: [] },
    lifePath: { number: 0, keywords: [] },
    horaryHour: { branch: 'unknown' },
  },
  measuredPsychologicalProfile: {
    bigFive: { enabled: false, source: null, openness: null, conscientiousness: null, extraversion: null, agreeableness: null, neuroticism: null },
    chronotype: { enabled: false, source: null, type: null },
    schemas: { enabled: false, source: null, detectedSchemas: [] },
  },
  learnedPersonalPattern: { totalDreams: 0, commonSymbols: [], commonThemes: [], commonEmotions: [], averageDreamScore: null },
  preferences: { allowCulturalAnalysis: true, allowFingerprintAnalysis: false, allowPsychologicalPersonalization: false, allowCommunitySimilarity: false },
};

export async function loadDreamAnalysisProfile(userId: string): Promise<any> {
  const userProfile = await UserDreamProfile.findOne({
    userId: new mongoose.Types.ObjectId(userId),
  }).lean();

  return {
    ...defaultProfile,
    ...userProfile,
    basicProfile: { ...defaultProfile.basicProfile, ...userProfile?.basicProfile },
    culturalProfile: { ...defaultProfile.culturalProfile, ...userProfile?.culturalProfile },
    measuredPsychologicalProfile: {
      ...defaultProfile.measuredPsychologicalProfile,
      ...userProfile?.measuredPsychologicalProfile,
      bigFive: {
        ...defaultProfile.measuredPsychologicalProfile.bigFive,
        ...userProfile?.measuredPsychologicalProfile?.bigFive,
      },
      chronotype: {
        ...defaultProfile.measuredPsychologicalProfile.chronotype,
        ...userProfile?.measuredPsychologicalProfile?.chronotype,
      },
      schemas: {
        ...defaultProfile.measuredPsychologicalProfile.schemas,
        ...userProfile?.measuredPsychologicalProfile?.schemas,
      },
    },
    learnedPersonalPattern: {
      ...defaultProfile.learnedPersonalPattern,
      ...userProfile?.learnedPersonalPattern,
    },
    preferences: { ...defaultProfile.preferences, ...userProfile?.preferences },
  };
}

export function buildDreamProfilePrompt(profileData: any): {
  profileText: string;
  culturalProfileUsed: boolean;
  hasBirthProfile: boolean;
} {
  const basicProfile = profileData.basicProfile || {};
  const bigFive = profileData.measuredPsychologicalProfile.bigFive || {};
  const chronotype = profileData.measuredPsychologicalProfile.chronotype || {};
  const schemas = profileData.measuredPsychologicalProfile.schemas || {};
  const hasBirthProfile = !!(
    (profileData.basicProfile?.birthDate && profileData.basicProfile.birthDate.trim() !== '')
    || (profileData.culturalProfile?.zodiac?.sign && profileData.culturalProfile.zodiac.sign !== 'unknown')
    || (profileData.culturalProfile?.lifePath?.number && profileData.culturalProfile.lifePath.number !== 0)
    || (profileData.culturalProfile?.horaryHour?.branch && profileData.culturalProfile.horaryHour.branch !== 'unknown')
  );

  // Cultural parameters stay disabled until a curated, citable source exists.
  const culturalEvidenceAvailable = false;
  const culturalProfileUsed = profileData.preferences?.allowCulturalAnalysis === true
    && hasBirthProfile
    && culturalEvidenceAvailable;
  const culturalProfileText = culturalProfileUsed
    ? `Zodiac: ${profileData.culturalProfile.zodiac.viName} (Sign: ${profileData.culturalProfile.zodiac.sign}, Element: ${profileData.culturalProfile.zodiac.element}, Tags: ${profileData.culturalProfile.zodiac.tags.join(', ')}), Life Path: ${profileData.culturalProfile.lifePath.number} (Keywords: ${profileData.culturalProfile.lifePath.keywords.join(', ')}), Horary Hour: ${profileData.culturalProfile.horaryHour.branch}`
    : 'Unavailable or not allowed; do not generate cultural claims';

  return {
    culturalProfileUsed,
    hasBirthProfile,
    profileText: `
User Profile Context:
- Full Name: ${basicProfile.fullName || 'Anonymous'}
- Gender: ${basicProfile.gender || 'unknown'}
- Cultural Parameters: ${culturalProfileText}
- Measured Personality: ${
  bigFive.enabled
    ? `Big Five Profile [Openness: ${bigFive.openness}, Conscientiousness: ${bigFive.conscientiousness}, Extraversion: ${bigFive.extraversion}, Agreeableness: ${bigFive.agreeableness}, Neuroticism: ${bigFive.neuroticism}]`
    : 'Disabled/Not measured'
}
- Chronotype: ${chronotype.enabled ? chronotype.type : 'Disabled/Not measured'}
- Core Schemas: ${schemas.enabled ? schemas.detectedSchemas.join(', ') : 'Disabled/Not measured'}
`,
  };
}
