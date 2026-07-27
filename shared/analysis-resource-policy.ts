import type { AnalysisResourceLimits } from "./contracts";

const workerMemoryOptions = [128, 256, 384, 512] as const;
const nativeMemoryOptions = [256, 512, 1024, 2048] as const;
const threadOptions = [1, 2, 4] as const;

function greatestAllowed<T extends readonly number[]>(
  options: T,
  maximum: number,
): T[number] {
  return (
    [...options].reverse().find((value) => value <= maximum) ?? options[0]
  );
}

export interface ResolvedAnalysisResourcePolicy {
  limits: AnalysisResourceLimits;
  aggregateMemoryCeilingMb: number;
  aggregateThreadCeiling: number;
  systemBudgetMb: number;
  adjusted: boolean;
  explanation: string;
}

export function resolveAnalysisResourcePolicy(
  requested: AnalysisResourceLimits,
  totalMemoryBytes: number,
  logicalCpuCount: number,
): ResolvedAnalysisResourcePolicy {
  const totalMemoryMb = Math.max(2_048, totalMemoryBytes / 1024 / 1024);
  const systemBudgetMb = Math.floor(
    Math.min(4_096, Math.max(1_536, totalMemoryMb * 0.2)),
  );
  const applicationReserveMb = 768;
  let concurrency = requested.concurrency;
  let workerMemoryMb = requested.workerMemoryMb;
  const minimumPerFileMb =
    workerMemoryOptions[0] + nativeMemoryOptions[0];
  while (
    concurrency > 1 &&
    applicationReserveMb + concurrency * minimumPerFileMb > systemBudgetMb
  ) {
    concurrency = (concurrency - 1) as AnalysisResourceLimits["concurrency"];
  }
  const maximumWorkerPerFile = Math.max(
    workerMemoryOptions[0],
    Math.floor(
      (systemBudgetMb -
        applicationReserveMb -
        concurrency * nativeMemoryOptions[0]) /
        concurrency,
    ),
  );
  workerMemoryMb = greatestAllowed(
    workerMemoryOptions,
    Math.min(workerMemoryMb, maximumWorkerPerFile),
  );
  const maximumNativePerFile = Math.max(
    nativeMemoryOptions[0],
    Math.floor(
      (systemBudgetMb -
        applicationReserveMb -
        concurrency * workerMemoryMb) /
        concurrency,
    ),
  );
  const nativeProcessMemoryMb = greatestAllowed(
    nativeMemoryOptions,
    Math.min(requested.nativeProcessMemoryMb, maximumNativePerFile),
  );
  const maximumAggregateThreads = Math.max(
    2,
    Math.floor(Math.max(2, logicalCpuCount) * 0.75),
  );
  const ffmpegThreads = greatestAllowed(
    threadOptions,
    Math.min(
      requested.ffmpegThreads,
      Math.max(1, Math.floor(maximumAggregateThreads / concurrency)),
    ),
  );
  const limits: AnalysisResourceLimits = {
    concurrency,
    workerMemoryMb,
    ffmpegThreads,
    nativeProcessMemoryMb,
  };
  const aggregateMemoryCeilingMb =
    applicationReserveMb +
    concurrency * (workerMemoryMb + nativeProcessMemoryMb);
  const aggregateThreadCeiling = concurrency * ffmpegThreads;
  const adjusted =
    limits.concurrency !== requested.concurrency ||
    limits.workerMemoryMb !== requested.workerMemoryMb ||
    limits.ffmpegThreads !== requested.ffmpegThreads ||
    limits.nativeProcessMemoryMb !== requested.nativeProcessMemoryMb;
  return {
    limits,
    aggregateMemoryCeilingMb,
    aggregateThreadCeiling,
    systemBudgetMb,
    adjusted,
    explanation: adjusted
      ? `Audio-V reduced the requested combination to ${concurrency} concurrent file${concurrency === 1 ? "" : "s"}, ${workerMemoryMb} MB worker heap, ${ffmpegThreads} FFmpeg thread${ffmpegThreads === 1 ? "" : "s"} per file, and ${nativeProcessMemoryMb} MB native memory per file so its ${aggregateMemoryCeilingMb} MB aggregate ceiling remains within the ${systemBudgetMb} MB application budget.`
      : `The selected controls have a ${aggregateMemoryCeilingMb} MB aggregate memory ceiling and ${aggregateThreadCeiling} aggregate FFmpeg threads within the ${systemBudgetMb} MB application budget.`,
  };
}
