import type { AudioFileRecord } from "./contracts";

export function compactAudioFileRecord(
  file: AudioFileRecord,
): AudioFileRecord {
  const measurements = file.oracle.measurements;
  if (!measurements) return { ...file, detailLevel: "summary" };
  return {
    ...file,
    detailLevel: "summary",
    oracle: {
      ...file.oracle,
      measurements: {
        ...measurements,
        waveform: measurements.waveform
          ? { ...measurements.waveform, points: [] }
          : null,
        spectrogram: { ...measurements.spectrogram, slices: [] },
        spectrogramPyramid: undefined,
      },
    },
  };
}

export function restoreAudioFileDetails(
  summary: AudioFileRecord,
  full: AudioFileRecord | null,
): AudioFileRecord {
  if (summary.detailLevel !== "summary" || !full) return summary;
  const { detailLevel: _detailLevel, ...record } = summary;
  const summaryMeasurements = record.oracle.measurements;
  const fullMeasurements = full.oracle.measurements;
  if (!summaryMeasurements || !fullMeasurements) {
    return record as AudioFileRecord;
  }
  return {
    ...record,
    oracle: {
      ...record.oracle,
      measurements: {
        ...summaryMeasurements,
        waveform: fullMeasurements.waveform,
        spectrogram: fullMeasurements.spectrogram,
        spectrogramPyramid: fullMeasurements.spectrogramPyramid,
      },
    },
  } as AudioFileRecord;
}
