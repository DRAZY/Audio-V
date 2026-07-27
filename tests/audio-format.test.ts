import { describe, expect, it } from "vitest";
import {
  audioCodecLabel,
  audioFormatLabel,
  isUsableAudioLabel,
} from "../shared/audio-format";
import { AUDIO_EXTENSIONS } from "../shared/contracts";

describe("audio format labels", () => {
  it("uses the determined file format instead of an unknown codec prefix", () => {
    expect(
      audioFormatLabel({
        extension: "FLAC",
        codec: "unknown",
        container: "flac",
      }),
    ).toBe("FLAC");
    expect(
      audioFormatLabel({
        extension: "wav",
        codec: "unknown",
        container: "wav",
      }),
    ).toBe("WAV");
  });

  it("falls back through codec and container when no extension is available", () => {
    expect(audioFormatLabel({ codec: "mp3", container: "mp3" })).toBe("MP3");
    expect(audioFormatLabel({ codec: "unknown", container: "ogg" })).toBe(
      "OGG",
    );
    expect(audioFormatLabel({ codec: "unknown", container: "unknown" })).toBe(
      "Unidentified audio",
    );
  });

  it("replaces unavailable FFprobe long names with a friendly codec name", () => {
    expect(audioCodecLabel("flac", "unknown")).toBe("FLAC");
    expect(audioCodecLabel("pcm_s24le", "unknown")).toBe("PCM");
    expect(isUsableAudioLabel("unknown")).toBe(false);
  });

  it("accepts the expanded FFmpeg-backed audio extension set", () => {
    expect(AUDIO_EXTENSIONS.length).toBeGreaterThanOrEqual(35);
    expect(AUDIO_EXTENSIONS).toEqual(
      expect.arrayContaining([
        ".ac3",
        ".amr",
        ".au",
        ".caf",
        ".mka",
        ".mp2",
        ".mpc",
        ".tta",
        ".voc",
        ".weba",
      ]),
    );
  });
});
