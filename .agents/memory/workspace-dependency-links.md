---
name: Workspace dependency links
description: How missing artifact-level dependency links affect local validation and workflows.
---

Artifact package manifests and the lockfile can list direct dependencies while their links are missing from the artifact's `node_modules` directory. This makes typechecks, Vite imports, and API builds fail with unresolved-package errors even when the edited feature is valid.

**Why:** Missing dependency links are a workspace setup problem, not necessarily a regression in the changed files. Treating these errors as feature failures leads to unrelated code changes.

**How to apply:** When a build reports an unresolved package that is already declared and locked, check its artifact-level link before debugging feature code. Validate changed files separately where possible, then restore the workspace dependencies through the approved package-management path before running browser-level verification.