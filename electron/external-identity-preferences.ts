import path from "node:path";
import { promises as fs } from "node:fs";

export interface ExternalIdentityPreferences {
  acoustIdEnabled: boolean;
  musicBrainzEnabled: boolean;
  acoustIdApiKey: string;
  hasStoredAcoustIdApiKey: boolean;
  protection: "os-encrypted" | "unavailable";
}

export interface ExternalIdentityPreferencesUpdate {
  acoustIdEnabled: boolean;
  musicBrainzEnabled: boolean;
  acoustIdApiKey: string | null;
}

export interface IdentitySecretProtector {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

interface StoredExternalIdentityPreferences {
  schema: "Audio-V external identity preferences v1";
  acoustIdEnabled: boolean;
  musicBrainzEnabled: boolean;
  encryptedAcoustIdApiKey?: string;
}

const defaults: ExternalIdentityPreferences = {
  acoustIdEnabled: false,
  musicBrainzEnabled: false,
  acoustIdApiKey: "",
  hasStoredAcoustIdApiKey: false,
  protection: "unavailable",
};

export class ExternalIdentityPreferencesStore {
  readonly #filePath: string;
  readonly #protector: IdentitySecretProtector;

  constructor(filePath: string, protector: IdentitySecretProtector) {
    this.#filePath = filePath;
    this.#protector = protector;
  }

  async load(): Promise<ExternalIdentityPreferences> {
    const protection = this.#protector.isEncryptionAvailable()
      ? "os-encrypted"
      : "unavailable";
    let stored: StoredExternalIdentityPreferences;
    try {
      stored = JSON.parse(
        await fs.readFile(this.#filePath, "utf8"),
      ) as StoredExternalIdentityPreferences;
    } catch {
      return { ...defaults, protection };
    }
    if (
      stored.schema !== "Audio-V external identity preferences v1" ||
      typeof stored.acoustIdEnabled !== "boolean" ||
      typeof stored.musicBrainzEnabled !== "boolean"
    ) {
      return { ...defaults, protection };
    }
    let acoustIdApiKey = "";
    if (
      stored.encryptedAcoustIdApiKey &&
      this.#protector.isEncryptionAvailable()
    ) {
      try {
        acoustIdApiKey = this.#protector.decryptString(
          Buffer.from(stored.encryptedAcoustIdApiKey, "base64"),
        );
      } catch {
        acoustIdApiKey = "";
      }
    }
    return {
      acoustIdEnabled: stored.acoustIdEnabled,
      musicBrainzEnabled: stored.musicBrainzEnabled,
      acoustIdApiKey,
      hasStoredAcoustIdApiKey: Boolean(acoustIdApiKey),
      protection,
    };
  }

  async save(
    update: ExternalIdentityPreferencesUpdate,
  ): Promise<ExternalIdentityPreferences> {
    const key = update.acoustIdApiKey?.trim() ?? "";
    if (key && !this.#protector.isEncryptionAvailable()) {
      throw new Error(
        "Secure operating-system credential storage is unavailable. Audio-V will not save an AcoustID key as plaintext.",
      );
    }
    const stored: StoredExternalIdentityPreferences = {
      schema: "Audio-V external identity preferences v1",
      acoustIdEnabled: update.acoustIdEnabled,
      musicBrainzEnabled: update.musicBrainzEnabled,
      ...(key
        ? {
            encryptedAcoustIdApiKey: this.#protector
              .encryptString(key)
              .toString("base64"),
          }
        : {}),
    };
    await fs.mkdir(path.dirname(this.#filePath), { recursive: true });
    const temporaryPath = `${this.#filePath}.${process.pid}.tmp`;
    await fs.writeFile(
      temporaryPath,
      `${JSON.stringify(stored, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 },
    );
    await fs.rename(temporaryPath, this.#filePath);
    await fs.chmod(this.#filePath, 0o600).catch(() => undefined);
    return this.load();
  }
}
