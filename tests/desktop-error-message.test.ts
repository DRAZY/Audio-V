import { describe, expect, it } from "vitest";
import { desktopErrorMessage } from "../shared/desktop-error-message";

describe("desktop error messages", () => {
  it("removes Electron IPC plumbing from a user-facing failure", () => {
    expect(
      desktopErrorMessage(
        new Error(
          "Error invoking remote method 'acoustid:validate-api-key': Error: AcoustID rejected the application API key.",
        ),
        "Validation failed.",
      ),
    ).toBe("AcoustID rejected the application API key.");
  });

  it("uses a stable fallback when no readable detail exists", () => {
    expect(desktopErrorMessage(null, "Validation failed.")).toBe(
      "Validation failed.",
    );
  });
});
