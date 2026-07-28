import type {
  AnalysisResourceLimits,
  AudioSourceSelection,
  AuditRecoveryState,
  AuditResumeStrategy,
} from "./contracts";

export const safeRecoveryResourceLimits: AnalysisResourceLimits = {
  concurrency: 1,
  workerMemoryMb: 256,
  ffmpegThreads: 1,
  nativeProcessMemoryMb: 512,
};

export function createAuditRecoveryState(
  priorSource: AudioSourceSelection,
  candidatePaths: readonly string[],
  strategy: AuditResumeStrategy,
  fallbackTarget: AnalysisResourceLimits,
): AuditRecoveryState {
  const normalizedCandidates = [...new Set(candidatePaths)];
  const priorCandidates = new Set(
    priorSource.recovery?.candidatePaths ?? [],
  );
  const repeatedCandidates =
    strategy === "adaptive-safe"
      ? normalizedCandidates.filter((entry) => priorCandidates.has(entry))
      : [];
  const repeatedSet = new Set(repeatedCandidates);
  const safeCandidates =
    strategy === "adaptive-safe"
      ? normalizedCandidates.filter((entry) => !repeatedSet.has(entry))
      : [];
  return {
    strategy,
    attempt: (priorSource.recovery?.attempt ?? 0) + 1,
    candidatePaths: normalizedCandidates,
    safeCandidatePaths: safeCandidates,
    quarantinedCandidatePaths: repeatedCandidates,
    targetResourceLimits:
      priorSource.recovery?.targetResourceLimits ??
      priorSource.resourceLimits ??
      fallbackTarget,
  };
}
