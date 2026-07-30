import type {
  DeliveryProfileId,
  DeliveryProfileSelection,
} from "./contracts";

export const deliveryProfiles: Readonly<
  Record<Exclude<DeliveryProfileId, "none">, DeliveryProfileSelection>
> = {
  "ebu-r128-programme": {
    id: "ebu-r128-programme",
    label: "EBU R 128 programme QC",
    targetLoudnessLufs: -23,
    minimumLoudnessLufs: -23.2,
    maximumLoudnessLufs: -22.8,
    maximumTruePeakDbtp: -1,
    reference: "EBU R 128 v5.0 (2023)",
    referenceUrl: "https://tech.ebu.ch/files/live/sites/tech/files/shared/r/r128.pdf",
    qualification:
      "Finished-programme quality control: ±0.2 LU measurement tolerance and −1 dBTP production maximum. Live and intentionally quieter exceptions require human interpretation.",
  },
  "atsc-a85": {
    id: "atsc-a85",
    label: "ATSC A/85 delivery",
    targetLoudnessLufs: -24,
    minimumLoudnessLufs: -26,
    maximumLoudnessLufs: -22,
    maximumTruePeakDbtp: -2,
    reference: "ATSC A/85:2026-07 Annex M",
    referenceUrl:
      "https://www.atsc.org/wp-content/uploads/2026/07/A85-2026-07-Annex-M.pdf",
    qualification:
      "Default content exchange without metadata: −24 LKFS with anticipated ±2 dB measurement variation and −2 dBTP maximum. Dialogue-gated long-form requirements may need specialist measurement.",
  },
  "aes-streaming-track": {
    id: "aes-streaming-track",
    label: "AES internet music · track",
    targetLoudnessLufs: -16,
    minimumLoudnessLufs: -20,
    maximumLoudnessLufs: -15.8,
    maximumTruePeakDbtp: -1,
    reference: "AES TD1008.1.21-9",
    referenceUrl:
      "https://aes.org/wp-content/uploads/2024/01/20210924_TD1008_v3.13.pdf",
    qualification:
      "Track-normalized music reference: −16 LUFS, +0.2 LU upper tolerance, −1 dBTP maximum at lossy-codec input, and a general −20 LUFS operational floor. Wide-dynamic-range exceptions require human interpretation.",
  },
};

export function resolveDeliveryProfile(
  id: DeliveryProfileId,
): DeliveryProfileSelection | undefined {
  return id === "none" ? undefined : { ...deliveryProfiles[id] };
}

export function isDeliveryProfileId(
  value: unknown,
): value is DeliveryProfileId {
  return (
    value === "none" ||
    value === "ebu-r128-programme" ||
    value === "atsc-a85" ||
    value === "aes-streaming-track"
  );
}
