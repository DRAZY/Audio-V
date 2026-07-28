import type { AudioFileRecord } from "./contracts";

function evenlySample<T>(values: T[], maximum: number): T[] {
  if (values.length <= maximum) return values;
  return Array.from({ length: maximum }, (_, index) => {
    const sourceIndex = Math.round(
      (index * (values.length - 1)) / (maximum - 1),
    );
    return values[sourceIndex];
  });
}

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

export function archiveAudioFileRecord(
  file: AudioFileRecord,
): AudioFileRecord {
  const measurements = file.oracle.measurements;
  if (!measurements) return file;
  const overview = {
    ...measurements.spectrogram,
    slices: evenlySample(measurements.spectrogram.slices, 32),
  };
  return {
    ...file,
    oracle: {
      ...file.oracle,
      measurements: {
        ...measurements,
        waveform: measurements.waveform
          ? {
              ...measurements.waveform,
              points: evenlySample(measurements.waveform.points, 160),
            }
          : null,
        spectrogram: overview,
        spectrogramPyramid: [overview],
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
