import { promises as fs } from "node:fs";
import path from "node:path";
import type { IAudioMetadata } from "music-metadata";
import type { CueTrackDefinition, MetadataInventory } from "../shared/contracts";

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
): Promise<{ paths: string[]; tracks: CueTrackDefinition[]; trackCount: number }> {
  const directory = path.dirname(filePath);
  const base = path.basename(filePath);
  const candidates = (await fs.readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".cue")
    .map((entry) => path.join(directory, entry.name));
  const matches: string[] = [];
  const tracks: CueTrackDefinition[] = [];
  let trackCount = 0;
  for (const candidate of candidates.slice(0, 100)) {
    const text = await fs.readFile(candidate, "utf8").catch(() => "");
    const referencesFile =
      new RegExp(`FILE\\s+["']?${base.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}["']?`, "iu")
        .test(text) ||
      (candidates.length === 1 && !/\bFILE\b/iu.test(text));
    if (referencesFile) {
      matches.push(candidate);
      tracks.push(...parseCueTracks(text, filePath));
      trackCount += (text.match(/^\s*TRACK\s+\d+\s+AUDIO\b/gimu) ?? []).length;
    }
  }
  return { paths: matches, tracks, trackCount };
}

function parseCueTracks(text: string, filePath: string): CueTrackDefinition[] {
  const targetName = path.basename(filePath).toLocaleLowerCase();
  let currentFile = targetName;
  let current: CueTrackDefinition | null = null;
  const tracks: CueTrackDefinition[] = [];
  const commit = () => {
    if (current && current.index01Seconds >= 0) tracks.push(current);
    current = null;
  };
  for (const line of text.split(/\r?\n/gu)) {
    const file = line.match(/^\s*FILE\s+(?:"([^"]+)"|'([^']+)'|(\S+))/iu);
    if (file) {
      commit();
      currentFile = path.basename(file[1] ?? file[2] ?? file[3]).toLocaleLowerCase();
      continue;
    }
    const track = line.match(/^\s*TRACK\s+(\d+)\s+AUDIO\b/iu);
    if (track) {
      commit();
      if (currentFile === targetName) {
        current = {
          trackNumber: Number(track[1]),
          title: null,
          performer: null,
          sourcePath: filePath,
          index00Seconds: null,
          index01Seconds: -1,
          endSeconds: null,
        };
      }
      continue;
    }
    if (!current) continue;
    const title = line.match(/^\s*TITLE\s+(?:"([^"]*)"|'([^']*)'|(.+))$/iu);
    if (title) {
      current.title = (title[1] ?? title[2] ?? title[3]).trim() || null;
      continue;
    }
    const performer = line.match(/^\s*PERFORMER\s+(?:"([^"]*)"|'([^']*)'|(.+))$/iu);
    if (performer) {
      current.performer =
        (performer[1] ?? performer[2] ?? performer[3]).trim() || null;
      continue;
    }
    const index = line.match(/^\s*INDEX\s+(00|01)\s+(\d+):(\d+):(\d+)/iu);
    if (index) {
      const seconds =
        Number(index[2]) * 60 + Number(index[3]) + Number(index[4]) / 75;
      if (index[1] === "00") current.index00Seconds = seconds;
      else current.index01Seconds = seconds;
    }
  }
  commit();
  for (let index = 0; index < tracks.length - 1; index += 1) {
    tracks[index].endSeconds =
      tracks[index + 1].index00Seconds ?? tracks[index + 1].index01Seconds;
  }
  return tracks;
}

export async function buildMetadataInventory(
  filePath: string,
  metadata: IAudioMetadata,
): Promise<MetadataInventory> {
  const common = metadata.common;
  const tags = nativeTags(metadata);
  const embeddedCue = tags.find((tag) => /^(CUESHEET|CUE_SHEET)$/iu.test(tag.key));
  const sidecars = await sidecarCueSheets(filePath);
  const embeddedTracks = embeddedCue
    ? parseCueTracks(embeddedCue.value, filePath)
    : [];
  const cueTracks = [...sidecars.tracks, ...embeddedTracks].filter(
    (track, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.trackNumber === track.trackNumber &&
          candidate.index01Seconds === track.index01Seconds,
      ) === index,
  );
  const sourceDuration = finite(metadata.format.duration);
  if (cueTracks.length > 0 && sourceDuration !== null) {
    cueTracks[cueTracks.length - 1].endSeconds = sourceDuration;
  }
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
          ? (embeddedCue.value.match(/^\s*TRACK\s+\d+\s+AUDIO\b/gimu) ?? []).length
          : 0),
      tracks: cueTracks,
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
  cueSheet: { embedded: false, sidecarPaths: [], trackCount: 0, tracks: [] },
  tags: [],
};
