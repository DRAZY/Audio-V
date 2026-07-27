import { promises as fs } from "node:fs";
import path from "node:path";
import type { IAudioMetadata } from "music-metadata";
import type { MetadataInventory } from "../shared/contracts";

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function gain(value: unknown): number | null {
  if (typeof value === "object" && value && "dB" in value) {
    return finite((value as { dB?: unknown }).dB);
  }
  if (typeof value !== "string" && typeof value !== "number") return null;
  return finite(String(value).replace(/\s*dB\s*$/iu, ""));
}

function peak(value: unknown): number | null {
  if (typeof value === "object" && value && "ratio" in value) {
    return finite((value as { ratio?: unknown }).ratio);
  }
  return finite(value);
}

function unique(values: Array<string | undefined | null>): string[] {
  return [...new Set(values.flatMap((value) => value?.trim() ? [value.trim()] : []))];
}

function nativeTags(metadata: IAudioMetadata): Array<{ key: string; value: string }> {
  return Object.values(metadata.native)
    .flat()
    .flatMap((tag) => {
      const value =
        typeof tag.value === "string" || typeof tag.value === "number"
          ? String(tag.value)
          : null;
      return value ? [{ key: tag.id, value: value.slice(0, 2_000) }] : [];
    })
    .slice(0, 250);
}

async function sidecarCueSheets(
  filePath: string,
): Promise<{ paths: string[]; trackCount: number }> {
  const directory = path.dirname(filePath);
  const base = path.basename(filePath);
  const candidates = (await fs.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".cue")
    .map((entry) => path.join(directory, entry.name));
  const matches: string[] = [];
  let trackCount = 0;
  for (const candidate of candidates.slice(0, 100)) {
    const text = await fs.readFile(candidate, "utf8").catch(() => "");
    const referencesFile =
      new RegExp(`FILE\\s+["']?${base.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}["']?`, "iu")
        .test(text) ||
      (candidates.length === 1 && !/\bFILE\b/iu.test(text));
    if (referencesFile) {
      matches.push(candidate);
      trackCount += (text.match(/^\s*TRACK\s+\d+\s+/gimu) ?? []).length;
    }
  }
  return { paths: matches, trackCount };
}

export async function buildMetadataInventory(
  filePath: string,
  metadata: IAudioMetadata,
): Promise<MetadataInventory> {
  const common = metadata.common;
  const tags = nativeTags(metadata);
  const embeddedCue = tags.find((tag) => /^(CUESHEET|CUE_SHEET)$/iu.test(tag.key));
  const sidecars = await sidecarCueSheets(filePath);
  return {
    title: common.title ?? null,
    artists: unique([...(common.artists ?? []), common.artist]),
    album: common.album ?? null,
    albumArtists: unique([common.albumartist]),
    composers: unique((common.composer ?? []).map((entry) => entry)),
    genres: unique(common.genre ?? []),
    date: common.date ?? common.originaldate ?? null,
    year: common.year ?? null,
    trackNumber: common.track.no,
    trackTotal: common.track.of,
    discNumber: common.disk.no,
    discTotal: common.disk.of,
    bpm: finite(common.bpm),
    isrcs: unique(common.isrc ?? []),
    musicBrainzRecordingIds: unique(
      Array.isArray(common.musicbrainz_recordingid)
        ? common.musicbrainz_recordingid
        : [common.musicbrainz_recordingid],
    ),
    acoustId: common.acoustid_id ?? null,
    replayGain: {
      trackGainDb: gain(common.replaygain_track_gain),
      trackPeak: peak(common.replaygain_track_peak),
      albumGainDb: gain(common.replaygain_album_gain),
      albumPeak: peak(common.replaygain_album_peak),
    },
    cueSheet: {
      embedded: Boolean(embeddedCue),
      sidecarPaths: sidecars.paths,
      trackCount:
        sidecars.trackCount +
        (embeddedCue
          ? (embeddedCue.value.match(/^\s*TRACK\s+\d+\s+/gimu) ?? []).length
          : 0),
    },
    tags,
  };
}

export const emptyMetadataInventory: MetadataInventory = {
  title: null,
  artists: [],
  album: null,
  albumArtists: [],
  composers: [],
  genres: [],
  date: null,
  year: null,
  trackNumber: null,
  trackTotal: null,
  discNumber: null,
  discTotal: null,
  bpm: null,
  isrcs: [],
  musicBrainzRecordingIds: [],
  acoustId: null,
  replayGain: {
    trackGainDb: null,
    trackPeak: null,
    albumGainDb: null,
    albumPeak: null,
  },
  cueSheet: { embedded: false, sidecarPaths: [], trackCount: 0 },
  tags: [],
};
