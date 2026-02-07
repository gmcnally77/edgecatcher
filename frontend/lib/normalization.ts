// lib/normalization.ts

/**
 * RUTHLESS NORMALIZATION
 * 1. Lowercase everything.
 * 2. Remove all non-alphanumeric characters (spaces, dashes, dots).
 * 3. Standardize common abbreviations (NY -> newyork).
 */
export function normalizeRunnerName(name: string): string {
  if (!name) return '';

  let clean = name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Remove diacritical marks (é -> e, ñ -> n)
    .replace(/ł/g, 'l')  // Polish ł -> l (Syguła -> Sygula)
    .replace(/ø/g, 'o')  // Nordic ø -> o
    .replace(/\./g, '') // St. Louis -> St Louis
    .replace(/'/g, '')  // O'Malley -> OMalley
    .replace(/-/g, ' ') // hyphen to space
    .trim();

  // Dictionary for Sports specific abbreviations (Expand this as we find bugs)
  const dictionary: Record<string, string> = {
    'ny giants': 'new york giants',
    'ny jets': 'new york jets',
    'la rams': 'los angeles rams',
    'la chargers': 'los angeles chargers',
    'man utd': 'manchester united',
    'alex volkanovski': 'alexander volkanovski', // Specific fix for your MMA observation
    'cameron smith': 'cam smith'
  };

  // Check dictionary first
  Object.keys(dictionary).forEach(key => {
    if (clean.includes(key)) {
      clean = clean.replace(key, dictionary[key]);
    }
  });

  // FINAL STRIP: Remove spaces to handle "Man City" vs "ManCity"
  return clean.replace(/\s+/g, '');
}

/**
 * FUZZY MATCHER
 * Returns true if strings are > 85% similar.
 * Useful when Exchange says "Volkanovski" and Bookie says "A. Volkanovski"
 */
export function areNamesSimilar(nameA: string, nameB: string): boolean {
    const normA = normalizeRunnerName(nameA);
    const normB = normalizeRunnerName(nameB);

    if (normA === normB) return true;
    if (normA.includes(normB) || normB.includes(normA)) return true;

    return false; // Strict for now, open up if needed
}