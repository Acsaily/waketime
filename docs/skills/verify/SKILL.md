---
name: waketime-verify
description: Run waketime's local verification gates after a code, data, UI, or native change. Use this skill whenever the task touches the waketime repo and the user asks to "check", "verify", "run tests", "validate", "验收", "跑一下检查", or asks whether a change is safe; also use it before claiming a fix is complete. It selects domain/application/data/contract/UI/native scope, separates fast check from strict acceptance, rebuilds the isolated 8307835 baseline, replays property seeds, runs the read-only production-backup differential, and explains what must not be reported as final APK/E2E evidence.
---

# Waketime verify

Verify the actual candidate, not a stale report. The authoritative project knowledge lives in tracked docs, not in `.claude/`:

- [Verification gates and evidence boundaries](../../architecture/verification.md)
- [Data lifecycle and known baseline behavior](../../architecture/data-lifecycle.md)
- [Module map](../../architecture/module-map.md)
- [AGENTS.md](../../../AGENTS.md)

`.claude/` is intentionally git-ignored. Keep this file as the versioned source; if you want a local skill copy, copy it to `.claude/skills/verify/SKILL.md` without changing `.gitignore` or adding user-local settings.

## Choose the gate

`check` is fast feedback. `strict` is the blocking local acceptance gate.

```powershell
node scripts/verify.mjs check
node scripts/verify.mjs strict
```

- `check`: typecheck + observation lint/arch + unit tests. It does **not** run format check, differential, browser E2E, or native JUnit. Never present a `check` pass as final acceptance.
- `strict`: typecheck + strict lint/arch + format check + unit/property + differential self/baseline + browser E2E + native JUnit. It still does **not** build or install an APK and does not operate a device.
- Do not use `strict --no-native` to make a final claim; it exists only for a genuinely missing toolchain, and the report must say native JUnit was not run.

## Pick the area from the diff

Read `git status` and the changed files first. Pass one or more areas to narrow the tests while keeping static gates:

| Changed area                                             | Area          |
| -------------------------------------------------------- | ------------- |
| `src/modules`, `tests/modules`, `tests/core`             | `domain`      |
| `src/application`, `tests/application`                   | `application` |
| `tests/data`, store/migration/recovery code              | `data`        |
| `contracts/`, `tests/contracts`, Java timer contract     | `contract`    |
| `src/features`, `src/shared/ui`, `tests/ui`, `tests/e2e` | `ui`          |
| `android/app/src/main/java`, Java tests                  | `native`      |

Examples:

```powershell
node scripts/verify.mjs check --areas ui
node scripts/verify.mjs strict --areas domain,application,data
node scripts/verify.mjs list
```

If you are unsure, run the full `strict`; a missing area is a coverage gap, not a reason to weaken a gate.

## Baseline and differential

The baseline is the real `8307835` tree, isolated under `.superpowers/sdd/2026-11-26-engineering-refactor/baseline-8307835`. Do not point the baseline adapter at candidate code.

```powershell
node scripts/verify.mjs baseline --check
node scripts/verify.mjs baseline --rebuild   # only when missing; refuses non-empty target
```

Manual equivalent:

```bash
git archive --format=tar 8307835 | tar -x -C <baseline-dir>
(cd <baseline-dir> && npm ci)
```

Run `npm run test:differential:self` first: old-v-old must be zero and the six deliberate perturbations must be detected. Then run `npm run test:differential`. A zero-difference result is only meaningful after the self-test passes.

## Property replay

The property suite uses fast-check with independent oracles and default seed `26092601 + index`.

```powershell
node scripts/verify.mjs property
node scripts/verify.mjs property --seed 26092601 --path 12:3
```

On failure, take `seed` and `counterexamplePath` from the fast-check output and replay them. Do not relax the property to hide a counterexample; record it as a known baseline gap or fix the code under a separately approved contract change.

## Production backup differential

Only run this when the user explicitly provides a local, repo-external production backup. Never copy the file, print contents, or add its path to tracked docs.

```powershell
node scripts/verify.mjs private `
  --backup E:\path-outside-repo\waketime-backup.json `
  --now 1795708800000 `
  --tz Asia/Shanghai
```

- `--backup` must be an absolute path outside the repository; the wrapper rejects repo-internal paths.
- `--now` must be at or after every record boundary; `--tz` is one of `Asia/Shanghai`, `UTC`, `America/New_York`.
- Output is aggregate only. The script re-reads the file at the end and fails if the original changed.
- Current recorded result: 16 cycles / 140 segments, zero field/catalog differences, original unchanged. This is JSON data regression, **not** proof of native timer continuity or APK upgrade.

## Native JUnit

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
. .\scripts\env.ps1
.\android\gradlew.bat :app:testDebugUnitTest --console=plain
```

Use `.toolchain/jdk21`; never fall back to system JDK 25. The shared `contracts/timer-cases.json` is wired into Gradle test inputs, so fixture changes rerun the native tests. Unit tests do not need signing keys. Do not claim a release APK exists while production signing is missing.

## MuMu device E2E

Device E2E is separate from `check`/`strict` and requires explicit authorization. Identify the instance first; never reuse an old port blindly, scan ports, restart the shared ADB server, or operate a real phone.

```powershell
node scripts/verify.mjs mumu -- selftest
node scripts/verify.mjs mumu -- identity --adb "<MuMu adb.exe>" --instance 1 --serial 127.0.0.1:16416
node scripts/verify.mjs mumu -- scenario plan <name> --adb "<MuMu adb.exe>" --instance 1 --serial 127.0.0.1:16416
node scripts/verify.mjs mumu -- scenario run <name> --adb "<MuMu adb.exe>" --instance 1 --serial 127.0.0.1:16416 --execute
```

The guard verifies the MuMu instance index, name, state, and serial map to one another; it adds `-s <serial>` itself and rejects manual `-s`. Preserve evidence under the ignored `test-results/mumu-e2e/` directory. A launch, screenshot, or install alone is not E2E closure; require an observable action plus persisted readback. If identity is unclear, stop.

## Report

Report the exact commands, the area selected, pass/fail counts, and any step not run. Separate:

- local code evidence (`strict` result);
- production JSON evidence (aggregate differential);
- native device evidence (APK, install, readback);
- known baseline behavior that was intentionally preserved.

Never claim "fixed", "complete", "final APK", or "E2E passed" from a build log, a page opening, or another agent's historical report. If a gate fails, report the failing step and do not delete or weaken the assertion. If the same check fails after three substantive repair rounds, escalate.
