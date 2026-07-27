# Installing unsigned Audio-V development builds

Audio-V is currently distributed as an open-source development application without an Apple Developer ID certificate, Apple notarization, or Windows Authenticode certificate. macOS application bundles carry a reproducible ad-hoc code signature so macOS can verify that the complete bundle has not changed; that signature does not identify DRAZY to Apple and does not bypass Gatekeeper.

Unsigned does not mean that a build is safe. Only install Audio-V when the file came from the project's official GitHub Release and its SHA-256 value matches that release's `SHA256SUMS.txt` and `UNSIGNED_RELEASE_MANIFEST.json`.

## Verify the download

On macOS, place the downloaded artifact and `SHA256SUMS.txt` in the same directory:

```bash
shasum -a 256 -c SHA256SUMS.txt
```

On Windows PowerShell:

```powershell
Get-FileHash .\Audio-V-0.4.6-win-x64.exe -Algorithm SHA256
Get-Content .\SHA256SUMS.txt
```

Compare the complete 64-character digest, not a shortened prefix. Do not continue when it differs.

## macOS

The Apple Silicon DMG runs natively on Apple Silicon. The Universal DMG contains both Apple Silicon and Intel application and FFmpeg architectures.

Because the application has no Developer ID identity and is not notarized, macOS displays an unknown-developer or “Apple cannot check it for malicious software” warning. The app should no longer be reported as damaged because its complete bundle now has a valid ad-hoc integrity seal. After verifying the checksum and source:

1. Try to open Audio-V once.
2. Open **System Settings → Privacy & Security**.
3. In the Security section, choose **Open Anyway** for Audio-V and confirm.

The **Open Anyway** control is available for about an hour after the blocked launch attempt. This is Apple's per-application override. Audio-V does not recommend disabling Gatekeeper globally or removing quarantine attributes from arbitrary downloads. Apple's current guidance is [Open a Mac app from an unknown developer](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unknown-developer-mh40616/mac).

## Windows

The installer and portable build are both x64. The portable executable avoids installation but still stores Audio-V session data in the normal per-user application-data location; it is not a sandbox.

Windows may show **Unknown publisher** or **Windows protected your PC**. After verifying the checksum and official release source, some systems offer **More info → Run anyway**. Windows 11 Smart App Control enforcement or an organization policy can block unknown unsigned applications without an override. Do not weaken a managed security policy; build from the audited source or use a machine whose owner permits unsigned development applications.

Microsoft documents the current unsigned behavior in [SmartScreen reputation for Windows app developers](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation) and [Smart App Control](https://learn.microsoft.com/windows/apps/develop/smart-app-control/overview).

## Future signed distribution

The normal `dist:mac` command explicitly applies the pseudo-identity `-`, producing a complete ad-hoc signature while disabling certificate discovery and notarization. `dist:win` remains explicitly unsigned. Separate `dist:mac:signed` and `dist:win:signed` paths preserve future certificate integration without changing the development-distribution policy.

The macOS signed path retains Hardened Runtime and notarization configuration. It activates when Developer ID and Apple notarization credentials are supplied through the supported Electron Builder environment variables. The Windows signed path activates Authenticode when certificate credentials are supplied. Certificates, passwords, API keys, and signing tokens must remain in the local process environment or an external secret manager and must never be committed.
