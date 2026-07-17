import {
  getZodiacSign,
  getLifePathNumber,
  getLifePathKeywords,
  getHoraryBranch,
  ICulturalProfile,
} from '../../data/culturalRules';

/**
 * Interface representing a single score factor in Component B.
 */
export interface IScoringFactor {
  source: string;
  impact: number;
  reason: string;
}

/**
 * Interface representing Component B User Scoring Profile.
 */
export interface IScoringProfile {
  profileScore: number;
  profileImpact: number;
  factors: IScoringFactor[];
  lastComputedAt: Date;
}

/**
 * Builds the cultural profile object based on the deterministic rules.
 * 
 * @param birthDate Birth date string in YYYY-MM-DD format
 * @param birthHour Birth hour string in HH:MM format
 * @returns An ICulturalProfile containing zodiac, lifePath, and horaryHour data
 */
export function buildCulturalProfile(birthDate: string, birthHour?: string): ICulturalProfile {
  const zodiac = getZodiacSign(birthDate);
  const lifePathNum = getLifePathNumber(birthDate);
  const lifePathKeywords = getLifePathKeywords(lifePathNum);
  const horaryBranch = getHoraryBranch(birthHour);

  return {
    zodiac: {
      sign: zodiac.sign,
      viName: zodiac.viName,
      element: zodiac.element,
      tags: zodiac.tags,
    },
    lifePath: {
      number: lifePathNum,
      keywords: lifePathKeywords,
    },
    horaryHour: {
      branch: horaryBranch,
    },
  };
}

/**
 * Computes Component B scoring profile deterministically based on user's measured psychological metrics.
 * 
 * @param measuredProfile The measuredPsychologicalProfile object
 * @returns Component B scoring profile
 */
export function buildScoringProfile(measuredProfile?: any): IScoringProfile {
  let profileScore = 50;
  let profileImpact = 0;
  const factors: IScoringFactor[] = [];

  const bigFive = measuredProfile?.bigFive;
  const schemas = measuredProfile?.schemas;

  // 1. Neuroticism Trait Impact
  if (bigFive && bigFive.enabled) {
    const neuroticism = bigFive.neuroticism;
    if (typeof neuroticism === 'number') {
      if (neuroticism >= 0.85) {
        factors.push({
          source: 'high_neuroticism',
          impact: -8,
          reason: 'Very high neuroticism trait detected, raising distress sensitivity.'
        });
      } else if (neuroticism >= 0.70) {
        factors.push({
          source: 'high_neuroticism',
          impact: -5,
          reason: 'High neuroticism trait detected, raising distress sensitivity.'
        });
      }
    }
  }

  // 2. Schema Stress & Perfectionism Impact
  if (schemas && schemas.enabled) {
    const detected = schemas.detectedSchemas || [];
    const hasStressOrPerfectionism = detected.some((s: string) => {
      const lower = s.toLowerCase();
      return lower.includes('stress') || lower.includes('perfectionism');
    });
    if (hasStressOrPerfectionism) {
      factors.push({
        source: 'stress_perfectionism_schema',
        impact: -4,
        reason: 'Strong stress or perfectionism schema detected.'
      });
    }
  }

  // 3. Sleep Habit Bonus (+3)
  if (measuredProfile?.stableSleepHabit === true || 
      measuredProfile?.sleepHabit === 'stable' || 
      (measuredProfile?.habits && measuredProfile.habits.stableSleep === true)) {
    factors.push({
      source: 'stable_sleep_habit',
      impact: 3,
      reason: 'Stable sleep habit has a stabilizing effect on dream valence.'
    });
  }

  // 4. Relaxation Pattern Bonus (+3)
  if (measuredProfile?.confirmedRelaxationPattern === true || 
      measuredProfile?.relaxationPattern === 'confirmed' || 
      (measuredProfile?.habits && measuredProfile.habits.relaxationPattern === true)) {
    factors.push({
      source: 'confirmed_relaxation_pattern',
      impact: 3,
      reason: 'Confirmed pre-sleep relaxation pattern helps reduce nightmare frequency.'
    });
  }

  // If no factors exist, return neutral profile impact
  if (factors.length === 0) {
    factors.push({
      source: 'missing_measured_profile',
      impact: 0,
      reason: 'No measured psychological profile available.'
    });
  } else {
    profileImpact = factors.reduce((sum, f) => sum + f.impact, 0);
    profileScore = Math.min(100, Math.max(0, 50 + profileImpact));
  }

  return {
    profileScore,
    profileImpact,
    factors,
    lastComputedAt: new Date(),
  };
}
