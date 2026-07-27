export function splitForGroup(
  groupId: string,
): "development" | "calibration" | "test";

export function validateCorpus(corpus: unknown): {
  errors: string[];
  groupCount: number;
};

export function validateRecipes(
  recipes: unknown,
  minimumCasesPerMaster: number,
): {
  errors: string[];
};

export function clopperPearson(
  successes: number,
  total: number,
  alpha?: number,
): {
  lower: number | null;
  upper: number | null;
};
