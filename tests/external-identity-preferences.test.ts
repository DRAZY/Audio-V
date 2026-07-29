import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  ExternalIdentityPreferencesStore,
  type IdentitySecretProtector,
} from "../electron/external-identity-preferences";

let temporaryDirectory = "";

afterEach(async () => {
  if (temporaryDirectory) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    temporaryDirectory = "";
  }
});

function protector(available = true): IdentitySecretProtector {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) =>
      Buffer.from([...value].reverse().join(""), "utf8"),
    decryptString: (value) =>
      [...value.toString("utf8")].reverse().join(""),
  };
}

describe("ExternalIdentityPreferencesStore", () => {
  it("restores enabled services and an encrypted AcoustID key", async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(process.cwd(), "tests", ".tmp-identity-preferences-"),
    );
    const filePath = path.join(temporaryDirectory, "preferences.json");
    const store = new ExternalIdentityPreferencesStore(
      filePath,
      protector(),
    );

    await store.save({
      acoustIdEnabled: true,
      musicBrainzEnabled: true,
      acoustIdApiKey: "ABCDEFGHIJ",
    });
    const restored = await new ExternalIdentityPreferencesStore(
      filePath,
      protector(),
    ).load();
    const persistedText = await fs.readFile(filePath, "utf8");

    expect(restored).toMatchObject({
      acoustIdEnabled: true,
      musicBrainzEnabled: true,
      acoustIdApiKey: "ABCDEFGHIJ",
      hasStoredAcoustIdApiKey: true,
      protection: "os-encrypted",
    });
    expect(persistedText).not.toContain("ABCDEFGHIJ");
  });

  it("clears a stored key while retaining the MusicBrainz preference", async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(process.cwd(), "tests", ".tmp-identity-clear-"),
    );
    const store = new ExternalIdentityPreferencesStore(
      path.join(temporaryDirectory, "preferences.json"),
      protector(),
    );
    await store.save({
      acoustIdEnabled: true,
      musicBrainzEnabled: true,
      acoustIdApiKey: "ABCDEFGHIJ",
    });

    const cleared = await store.save({
      acoustIdEnabled: false,
      musicBrainzEnabled: true,
      acoustIdApiKey: null,
    });

    expect(cleared).toMatchObject({
      acoustIdEnabled: false,
      musicBrainzEnabled: true,
      acoustIdApiKey: "",
      hasStoredAcoustIdApiKey: false,
    });
  });

  it("refuses to persist a plaintext key without OS encryption", async () => {
    temporaryDirectory = await fs.mkdtemp(
      path.join(process.cwd(), "tests", ".tmp-identity-unavailable-"),
    );
    const store = new ExternalIdentityPreferencesStore(
      path.join(temporaryDirectory, "preferences.json"),
      protector(false),
    );

    await expect(
      store.save({
        acoustIdEnabled: true,
        musicBrainzEnabled: false,
        acoustIdApiKey: "ABCDEFGHIJ",
      }),
    ).rejects.toThrow("will not save an AcoustID key as plaintext");
  });
});
