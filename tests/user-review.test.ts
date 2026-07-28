import { describe, expect, it } from "vitest";
import {
  createUserReview,
  isUserReviewDisposition,
  USER_REVIEW_DISPOSITIONS,
} from "../shared/user-review";

describe("human review disposition", () => {
  it("accepts only the disclosed disposition vocabulary", () => {
    for (const value of USER_REVIEW_DISPOSITIONS) {
      expect(isUserReviewDisposition(value)).toBe(true);
    }
    expect(isUserReviewDisposition("clear")).toBe(false);
    expect(isUserReviewDisposition("approved")).toBe(false);
    expect(isUserReviewDisposition(null)).toBe(false);
  });

  it("bounds notes and removes unsafe control characters", () => {
    const review = createUserReview(
      "confirmed-issue",
      `  checked\u0000against source ${"x".repeat(1200)}  `,
      "2026-07-28T00:00:00.000Z",
    );
    expect(review).toMatchObject({
      status: "reviewed",
      reviewedAt: "2026-07-28T00:00:00.000Z",
      disposition: "confirmed-issue",
    });
    expect(review.note).not.toContain("\u0000");
    expect(review.note?.length).toBe(1000);
  });
});
