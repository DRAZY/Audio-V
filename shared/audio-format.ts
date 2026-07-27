interface AudioFormatIdentity {
  extension?: string | null;
  codec?: string | null;
  container?: string | null;
}

const unavailableLabels = new Set([
  "",
  "unknown",
  "unavailable",
  "not reported",
  "n/a",
  "none",
]);

const extensionLabels: Record<string, string> = {
  AIF: "AIFF",
  AIFF: "AIFF",
  M4A: "M4A",
  MP3: "MP3",
  WAV: "WAV",
  WMA: "WMA",
  WV: "WavPack",
};

const codecLabels: Record<string, string> = {
  aac: "AAC",
  alac: "ALAC",
  ape: "Monkey's Audio",
  flac: "FLAC",
  mp3: "MP3",
  opus: "Opus",
  vorbis: "Vorbis",
  wavpack: "WavPack",
  wmalossless: "WMA Lossless",
  wmapro: "WMA Pro",
  wmav1: "WMA",
  wmav2: "WMA",
};

export function isUsableAudioLabel(value: string | null | undefined): boolean {
  return Boolean(
    value && !unavailableLabels.has(value.trim().toLowerCase()),
  );
}

export function audioCodecLabel(
  codecName: string | null | undefined,
  codecLongName?: string | null,
): string {
  if (isUsableAudioLabel(codecLongName)) return codecLongName!.trim();
  if (!isUsableAudioLabel(codecName)) return "Codec not reported";
  const normalized = codecName!.trim().toLowerCase();
  if (normalized.startsWith("pcm_")) return "PCM";
  return codecLabels[normalized] ?? codecName!.trim().toUpperCase();
}

export function audioFormatLabel(file: AudioFormatIdentity): string {
  const extension = file.extension?.replace(/^\./u, "").trim().toUpperCase();
  if (extension) return extensionLabels[extension] ?? extension;

  if (isUsableAudioLabel(file.codec)) {
    return audioCodecLabel(file.codec);
  }
  if (isUsableAudioLabel(file.container)) {
    const container = file.container!.split(",")[0].trim();
    return extensionLabels[container.toUpperCase()] ?? container.toUpperCase();
  }
  return "Unidentified audio";
}
