# Period export and card spacing Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax.

**Goal:** Restore local card rhythm and add inclusive wake-date range export.

**Architecture:** Feature-local layout correction, shared application range query and file payload builders, existing file ports and date helpers. Keep single-cycle operations unchanged.

**Tech Stack:** React, TypeScript, Vitest, Playwright, existing Android PDF port.

**Spec:** [design](../specs/2026-11-27-period-export-card-spacing-design.md)

## Global Constraints

- No schema/version changes, data writes, production data, device operations, or new dependencies.
- Existing entry points and selected-record statistics remain intact; include both start/end wake dates and complete cycles, use one calculation instant.

## Review Focus

- Same-day suffix and midnight crossings: selection tests using wake timestamps.
- Calendar month/week rollover and invalid February dates: range/preset tests.
- Open and empty ranges: preview/export tests and blocked share.
- Old exports still byte/structure identical: existing application and differential tests.
- Narrow screen, scrolling, duplicate exports: browser checks and shared busy lock.

### Task 1: Card spacing

- [x] Measure both tabs: Stats zero gap, History existing 12px; add browser test measuring adjacent card geometry.
- [x] Apply scoped CSS/markup fix preserving ordinary spacing and check 375×812 / 360×800, scroll, expansion, screenshots.

### Task 2: Range query and file export

- [x] Add tests for `periodRange(preset, nowMs)`, `previewPeriod(cycles, range, nowMs)` and `exportPeriod(kind, range, nowMs)`. Assert inclusive boundaries, order, two cycles same day, invalid/empty rejection, open summary, JSON/TXT/PDF payloads and no writes.
- [x] Implement `src/application/periodExport.ts` and expose query/types from application public entry. Reuse existing day TXT, PDF, JSON builders with selected cycles, fixed timestamp.
- [x] Add application export action using existing file port. Pass tests and retain original APIs.

### Task 3: Settings range UI and integration

- [x] Add browser tests for date fields, preset fill/edit, preview and actual JSON/TXT downloads, no data, invalid range, PDF platform message and narrow layout.
- [x] Consolidate into `ExportPanel` with one date range, conditional single-day exact cycle picker, preview and format group. Move backup to `Settings` data section, share existing busy lock; reuse existing single-cycle export with optional preview instant.
- [x] Verify screenshots and downloads, run full strict gate, independent branch review, address review findings and update outcome/status.
- Publish stacked PR after final gate; no merge.
