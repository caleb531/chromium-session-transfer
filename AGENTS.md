# Chromium Session Transfer

## Overview

Chromium Session Transfer is a browser extension with a local macOS helper. It
opens selected tabs in another running Chromium browser after restoring their
stored website sessions.

Use this file to preserve deliberate behavior during unrelated changes. When a
requested change revises a design choice, or inspection shows that guidance is
stale, update the relevant guidance alongside the change.

## Transfer guarantees

- Scope transfers to the selected tabs and their applicable storage and cookies.
  Parent-domain cookie permissions can be broader than the transfer scope.
  Saved domain patterns control preselection independently of permission grants.
- Keep transfer snapshots in memory and send them only over local channels.
  Report the failing stage and underlying error without exposing credentials or raw
  payloads. Send diagnostics to stderr during native messaging transfers so
  stdout remains available for protocol messages.
- Preserve the checks for destination tabs that share storage or cookies and
  let relevant background workers stop naturally. Restore and verify the
  destination state before letting the site run its own code.
- Preserve the destination checkpoint for best-effort rollback before website
  navigation. Report incomplete rollback and navigation failures distinctly.
  A loaded page alone cannot confirm that the site accepted the session.
- Keep the picker open and try to bring the error into view on failure. Close
  source tabs and the picker only under their respective success settings.

## Development and verification

- Keep routine builds separate from `host:install`. Reinstallation can change
  the helper's signing identity and reset its macOS privacy grants. Use the
  [README](README.md#working-on-the-project) for build, refresh, and reinstall
  guidance when handing off changes to the user.
- Verify source and destination support separately before making compatibility
  claims. A browser registry entry makes the browser selectable. Build checks
  establish that the code compiles. An end-to-end transfer exercises the
  browser integration. Report which checks you actually ran.
- Use the existing base and semantic color palettes in both themes. Preserve
  the picker as a dedicated tab during unrelated UI changes so users have room
  to select and review a batch.
