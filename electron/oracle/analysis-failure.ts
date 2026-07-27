import type {
  OracleFailure,
  OracleFailureStage,
} from "../../shared/contracts";
import { EngineProcessError } from "./ffmpeg-runtime";

export class OracleStageError extends Error {
  constructor(
    readonly stage: OracleFailureStage,
    cause: unknown,
  ) {
    super(
      cause instanceof Error ? cause.message : "The analysis stage failed.",
      { cause },
    );
    this.name = "OracleStageError";
  }
}

export async function atOracleStage<T>(
  stage: OracleFailureStage,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof OracleStageError) throw error;
    throw new OracleStageError(stage, error);
  }
}

const deterministicDecodeEvidence =
  /(?:invalid data|error while decoding|decode error|corrupt|truncat|unexpected end|end of file|crc|checksum|header missing|invalid header|invalid sync|invalid frame|frame .*failed|failed to read .*frame|packet .*corrupt|input buffer exhausted|overread|incomplete frame)/iu;

function underlyingError(error: unknown): {
  stage: OracleFailureStage;
  cause: unknown;
} {
  if (error instanceof OracleStageError) {
    return { stage: error.stage, cause: error.cause };
  }
  return { stage: "oracle-engine", cause: error };
}

export function classifyOracleFailure(error: unknown): OracleFailure {
  const { stage, cause } = underlyingError(error);
  const summary =
    cause instanceof Error ? cause.message : "The analysis operation failed.";
  const processError =
    cause instanceof EngineProcessError ? cause : null;
  const exactEvidence = processError?.stderr || summary;
  const deterministicFileFailure =
    (stage === "stream-probe" ||
      stage === "full-decode" ||
      stage === "integrity-verification") &&
    ((processError?.reason === "exit" &&
      deterministicDecodeEvidence.test(exactEvidence)) ||
      deterministicDecodeEvidence.test(summary));

  if (deterministicFileFailure) {
    return {
      category: "file-integrity",
      stage,
      code:
        stage === "integrity-verification"
          ? "INTEGRITY_VERIFICATION_FAILED"
          : stage === "stream-probe"
            ? "STREAM_PROBE_INTEGRITY_FAILED"
          : "DECODE_INTEGRITY_FAILED",
      summary:
        stage === "integrity-verification"
          ? "A deterministic integrity verification failed."
          : stage === "stream-probe"
            ? "The stream probe reported deterministic structural corruption in the selected file."
          : "The decoder reported deterministic corruption while reading the audio stream.",
      evidence: exactEvidence,
    };
  }

  const code =
    processError?.reason === "launch"
      ? "ENGINE_UNAVAILABLE"
      : processError?.reason === "timeout"
        ? "ENGINE_TIMEOUT"
        : processError?.reason === "output-limit"
          ? "ENGINE_OUTPUT_LIMIT"
          : stage === "stream-probe"
            ? "STREAM_PROBE_ERROR"
            : stage === "full-decode"
              ? "DECODE_TOOL_ERROR"
              : stage === "signal-measurement"
                ? "MEASUREMENT_ERROR"
                : stage === "integrity-verification"
                  ? "INTEGRITY_TOOL_ERROR"
                  : "ORACLE_INTERNAL_ERROR";

  return {
    category: "analysis-error",
    stage,
    code,
    summary:
      "Audio-V could not complete this analysis stage. No file-integrity verdict was issued.",
    evidence: exactEvidence,
  };
}
