# Third-party notices

This project reuses ideas, layout and some code from other open-source projects.
Each entry below names the source, its licence, and what was taken.

## AiCode (jieapi/AiCode)

- Source: https://github.com/jieapi/AiCode
- Copyright: the AiCode authors (see the upstream repository for the full list)
- Licence: GNU General Public License v3.0 (GPL-3.0), full text at https://github.com/jieapi/AiCode/blob/main/LICENSE
- What is reused:
  - Visual direction for the Linux pages (dark graphite surfaces, green accent,
    state badge, bottom tab bar). Implemented in `linux-look.css`. No stylesheet
    or image asset is copied.
  - Feature direction for the Linux workspace (agent modes, checkpoints, skills,
    memory, sub-agents, Git view). Ported feature by feature, each change noted
    in the commit message.

When code is copied verbatim from AiCode, the copied file keeps its original
copyright header and is listed here with its path.

## Termux and PRoot (via AiCode)

AiCode itself builds on Termux (terminal components, GPL/Apache licences
depending on the file) and PRoot. Any file copied from those projects keeps its
original header and is listed here.

## This project

Traliran AI Hub is licensed under AGPL-3.0 (see `LICENSE`). GPL-3.0 and AGPL-3.0
are designed to be compatible, so GPL-3.0 material from AiCode can be combined
into this AGPL-3.0 project. This is our reading of the licences, not legal
advice. Copyright notices of copied material are kept with it.

## Container image list (AiCode)

- `linux-images.js` follows the distribution, version and sizes in AiCode's
  `app/src/main/assets/container-images.json` (jieapi/AiCode, GPL-3.0). The
  download paths follow the same pattern. Descriptions are written for this
  project. No AiCode asset is copied.
- `android/app/src/main/java/com/traliran/aihub/RootfsInstaller.java` supports
  several images, which is the same idea as AiCode's container image manager.
  The code is written for this project.

## XZ for Java (org.tukaani:xz)

- Used by the Android app to unpack `.tar.xz` rootfs archives (Debian).
- Licence: public domain (see https://tukaani.org/xz/java.html).

## Debian root filesystems

- Debian 12 (bookworm) and 13 (trixie) rootfs archives are downloaded from the Debian
  official-images build host (`doi-janky.infosiftr.net`), as listed in AiCode's
  `container-images.json`. Each archive is checked against the `.sha256` file published
  next to it. Debian is free software; its licences apply to the archive contents.
