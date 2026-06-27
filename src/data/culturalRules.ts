export interface ZodiacSign {
  sign: string;
  viName: string;
  element: string;
  tags: string[];
}

export type HoraryBranch =
  | 'rat'
  | 'ox'
  | 'tiger'
  | 'rabbit'
  | 'dragon'
  | 'snake'
  | 'horse'
  | 'goat'
  | 'monkey'
  | 'rooster'
  | 'dog'
  | 'pig'
  | 'unknown';

export interface ICulturalProfile {
  zodiac: {
    sign: string;
    viName: string;
    element: string;
    tags: string[];
  };
  lifePath: {
    number: number;
    keywords: string[];
  };
  horaryHour: {
    branch: string;
  };
}

export function getZodiacSign(birthDateStr: string): ZodiacSign {
  if (!birthDateStr || birthDateStr.trim() === '') {
    return { sign: 'unknown', viName: 'Chưa rõ', element: 'unknown', tags: [] };
  }
  const date = new Date(birthDateStr);
  if (isNaN(date.getTime())) {
    return { sign: 'unknown', viName: 'Chưa rõ', element: 'unknown', tags: [] };
  }
  // Use UTC to prevent timezone shift issues (e.g. UTC date could match user local timezone date)
  const month = date.getUTCMonth() + 1; // 1-12
  const day = date.getUTCDate();

  if ((month === 3 && day >= 21) || (month === 4 && day <= 19)) {
    return { sign: 'aries', viName: 'Bạch Dương', element: 'Fire', tags: ['courageous', 'passionate', 'initiator'] };
  } else if ((month === 4 && day >= 20) || (month === 5 && day <= 20)) {
    return { sign: 'taurus', viName: 'Kim Ngưu', element: 'Earth', tags: ['grounded', 'reliable', 'persistent'] };
  } else if ((month === 5 && day >= 21) || (month === 6 && day <= 20)) {
    return { sign: 'gemini', viName: 'Song Tử', element: 'Air', tags: ['curious', 'adaptable', 'expressive'] };
  } else if ((month === 6 && day >= 21) || (month === 7 && day <= 22)) {
    return { sign: 'cancer', viName: 'Cự Giải', element: 'Water', tags: ['intuitive', 'nurturing', 'protective'] };
  } else if ((month === 7 && day >= 23) || (month === 8 && day <= 22)) {
    return { sign: 'leo', viName: 'Sư Tử', element: 'Fire', tags: ['charismatic', 'confident', 'expressive'] };
  } else if ((month === 8 && day >= 23) || (month === 9 && day <= 22)) {
    return { sign: 'virgo', viName: 'Xử Nữ', element: 'Earth', tags: ['analytical', 'observant', 'meticulous'] };
  } else if ((month === 9 && day >= 23) || (month === 10 && day <= 22)) {
    return { sign: 'libra', viName: 'Thiên Bình', element: 'Air', tags: ['harmonious', 'diplomatic', 'artistic'] };
  } else if ((month === 10 && day >= 23) || (month === 11 && day <= 21)) {
    return { sign: 'scorpio', viName: 'Bọ Cạp', element: 'Water', tags: ['intense', 'transformative', 'secretive'] };
  } else if ((month === 11 && day >= 22) || (month === 12 && day <= 21)) {
    return { sign: 'sagittarius', viName: 'Nhân Mã', element: 'Fire', tags: ['philosophical', 'adventurous', 'optimistic'] };
  } else if ((month === 12 && day >= 22) || (month === 1 && day <= 19)) {
    return { sign: 'capricorn', viName: 'Ma Kết', element: 'Earth', tags: ['disciplined', 'ambitious', 'structured'] };
  } else if ((month === 1 && day >= 20) || (month === 2 && day <= 18)) {
    return { sign: 'aquarius', viName: 'Bảo Bình', element: 'Air', tags: ['innovative', 'humanitarian', 'independent'] };
  } else {
    return { sign: 'pisces', viName: 'Song Ngư', element: 'Water', tags: ['dreamy', 'empathetic', 'imaginative'] };
  }
}

export function getLifePathNumber(dateString: string): number {
  const digitsOnly = dateString.replace(/\D/g, '');
  if (!digitsOnly) return 0;

  let sum = digitsOnly.split('').reduce((acc, char) => acc + parseInt(char, 10), 0);

  while (sum > 9 && sum !== 11 && sum !== 22 && sum !== 33) {
    sum = sum
      .toString()
      .split('')
      .reduce((acc, char) => acc + parseInt(char, 10), 0);
  }
  return sum;
}

export function getLifePathKeywords(num: number): string[] {
  const mapping: Record<number, string[]> = {
    1: ['independence', 'leadership', 'innovation', 'pioneer'],
    2: ['diplomacy', 'harmony', 'cooperation', 'sensitivity'],
    3: ['expression', 'creativity', 'social', 'optimism'],
    4: ['stability', 'discipline', 'structure', 'pragmatism'],
    5: ['freedom', 'change', 'adventure', 'adaptability'],
    6: ['nurturing', 'responsibility', 'harmony', 'compassion'],
    7: ['analysis', 'spirituality', 'introspection', 'wisdom'],
    8: ['abundance', 'power', 'ambition', 'efficiency'],
    9: ['humanitarianism', 'completion', 'generosity', 'wisdom'],
    11: ['intuition', 'illumination', 'idealism', 'visionary'],
    22: ['master builder', 'practicality', 'manifestation', 'ambition'],
    33: ['master teacher', 'guidance', 'altruism', 'compassion'],
  };
  return mapping[num] || [];
}

export function getHoraryBranch(hourStr?: string): HoraryBranch {
  if (!hourStr) return 'unknown';
  const cleanHour = hourStr.trim().toLowerCase();
  if (
    cleanHour === '' ||
    cleanHour === 'none' ||
    cleanHour === 'unknown' ||
    cleanHour === 'null' ||
    cleanHour === 'undefined'
  ) {
    return 'unknown';
  }
  try {
    const parts = cleanHour.split(':');
    if (parts.length < 2) return 'unknown';
    const h = parseInt(parts[0], 10);
    if (isNaN(h)) return 'unknown';

    if (h >= 23 || h < 1) {
      return 'rat';
    } else if (h >= 1 && h < 3) {
      return 'ox';
    } else if (h >= 3 && h < 5) {
      return 'tiger';
    } else if (h >= 5 && h < 7) {
      return 'rabbit';
    } else if (h >= 7 && h < 9) {
      return 'dragon';
    } else if (h >= 9 && h < 11) {
      return 'snake';
    } else if (h >= 11 && h < 13) {
      return 'horse';
    } else if (h >= 13 && h < 15) {
      return 'goat';
    } else if (h >= 15 && h < 17) {
      return 'monkey';
    } else if (h >= 17 && h < 19) {
      return 'rooster';
    } else if (h >= 19 && h < 21) {
      return 'dog';
    } else if (h >= 21 && h < 23) {
      return 'pig';
    }
  } catch (e) {
    // safe fallback
  }
  return 'unknown';
}
