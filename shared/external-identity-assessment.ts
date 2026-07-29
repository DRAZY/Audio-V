import type {
  AcoustIdLookup,
  ExternalIdentityAssessment,
  MetadataInventory,
  MusicBrainzEnrichment,
} from "./contracts";

const identityLimitation =
  "External identity evidence can corroborate a recording label or expose a metadata conflict. It does not prove file integrity, mastering provenance, ownership, edition, or audio quality and never changes the Oracle verdict.";

function normalizedTokens(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/&/gu, " and ")
    .split(/[^\p{Letter}\p{Number}]+/gu)
    .filter(
      (token) =>
        token.length > 0 &&
        !["and", "feat", "featuring", "with"].includes(token),
    )
    .sort();
}

function equivalentText(left: string, right: string): boolean {
  return normalizedTokens(left).join(" ") === normalizedTokens(right).join(" ");
}

function equivalentArtists(left: string[], right: string[]): boolean {
  if (left.length === 0 || right.length === 0) return false;
  return (
    left.flatMap(normalizedTokens).sort().join(" ") ===
    right.flatMap(normalizedTokens).sort().join(" ")
  );
}

export function assessExternalIdentity(
  metadata: MetadataInventory,
  acoustId: AcoustIdLookup,
  musicBrainz?: MusicBrainzEnrichment,
): ExternalIdentityAssessment {
  const acoustIdMatched = acoustId.status === "matched";
  const musicBrainzMatched = musicBrainz?.status === "matched";
  const providers: ExternalIdentityAssessment["providers"] = [
    ...(acoustIdMatched ? (["acoustid"] as const) : []),
    ...(musicBrainzMatched ? (["musicbrainz"] as const) : []),
  ];
  const basis: ExternalIdentityAssessment["basis"] = acoustIdMatched
    ? "acoustic-match"
    : musicBrainzMatched && musicBrainz.source === "embedded-mbid"
      ? "embedded-id-lookup"
      : null;
  const recordingId =
    musicBrainzMatched && musicBrainz.recordingId
      ? musicBrainz.recordingId
      : acoustId.recordingIds[0] ?? null;
  const title =
    musicBrainzMatched && musicBrainz.title
      ? musicBrainz.title
      : acoustId.recordingTitles[0] || null;
  const artists = musicBrainzMatched
    ? musicBrainz.artists.map((artist) => artist.name)
    : [];
  const comparisons: ExternalIdentityAssessment["comparisons"] = [];

  if (
    metadata.musicBrainzRecordingIds.length > 0 &&
    acoustId.recordingIds.length > 0
  ) {
    const declaredIds = metadata.musicBrainzRecordingIds.map((id) =>
      id.toLocaleLowerCase("en-US"),
    );
    const identifiedIds = acoustId.recordingIds.map((id) =>
      id.toLocaleLowerCase("en-US"),
    );
    comparisons.push({
      field: "recording-id",
      declared: metadata.musicBrainzRecordingIds,
      identified: acoustId.recordingIds,
      result: declaredIds.some((id) => identifiedIds.includes(id))
        ? "agrees"
        : "conflicts",
    });
  }
  if (metadata.title && title) {
    comparisons.push({
      field: "title",
      declared: [metadata.title],
      identified: [title],
      result: equivalentText(metadata.title, title) ? "agrees" : "conflicts",
    });
  }
  const declaredArtists = [
    ...new Set(
      metadata.artists.length > 0 ? metadata.artists : metadata.albumArtists,
    ),
  ];
  if (declaredArtists.length > 0 && artists.length > 0) {
    comparisons.push({
      field: "artist",
      declared: declaredArtists,
      identified: artists,
      result: equivalentArtists(declaredArtists, artists)
        ? "agrees"
        : "conflicts",
    });
  }

  const conflicts = comparisons.filter(
    (comparison) => comparison.result === "conflicts",
  );
  const agreements = comparisons.filter(
    (comparison) => comparison.result === "agrees",
  );
  if (providers.length === 0 || basis === null) {
    return {
      status: "inconclusive",
      basis: null,
      providers,
      recordingId,
      title,
      artists,
      comparisons,
      summary:
        "No enabled external service produced a recording identity that can be compared with this file.",
      limitation: identityLimitation,
    };
  }
  if (conflicts.length > 0) {
    return {
      status: "metadata-conflict",
      basis,
      providers,
      recordingId,
      title,
      artists,
      comparisons,
      summary:
        `External identity evidence conflicts with declared ${conflicts.map((item) => item.field).join(" and ")} metadata. Review the labels; the audio-quality verdict is unchanged.`,
      limitation: identityLimitation,
    };
  }
  if (agreements.length > 0) {
    return {
      status: "metadata-corroborated",
      basis,
      providers,
      recordingId,
      title,
      artists,
      comparisons,
      summary:
        `External identity evidence agrees with ${agreements.map((item) => item.field).join(" and ")} metadata. This corroborates the label, not the file's integrity or quality.`,
      limitation: identityLimitation,
    };
  }
  return {
    status: "identity-matched",
    basis,
    providers,
    recordingId,
    title,
    artists,
    comparisons,
    summary:
      "An external recording identity was found, but the file does not declare enough comparable metadata for corroboration.",
    limitation: identityLimitation,
  };
}
