import type {
  AudioFileRecord,
  UserReviewDisposition,
} from "./contracts";

export const USER_REVIEW_DISPOSITIONS = [
  "acknowledged",
  "accepted-intentional",
  "confirmed-issue",
  "false-positive",
  "remediated",
  "replacement-required",
  "follow-up-required",
] as const satisfies readonly UserReviewDisposition[];

export function isUserReviewDisposition(
  value: unknown,
): value is UserReviewDisposition {
  return (
    typeof value === "string" &&
    USER_REVIEW_DISPOSITIONS.includes(value as UserReviewDisposition)
  );
}

export function createUserReview(
  disposition: UserReviewDisposition,
  note: string,
  reviewedAt = new Date().toISOString(),
): NonNullable<AudioFileRecord["userReview"]> {
  const normalizedNote = note
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "")
    .trim()
    .slice(0, 1000);
  return {
    status: "reviewed",
    reviewedAt,
    disposition,
    ...(normalizedNote ? { note: normalizedNote } : {}),
  };
}
