---
name: Preference sync semantics
description: How local watchlists and saved sources converge with an authenticated account.
---

Legacy browser-only data is claimed and merged once per preference type on a device, then removed. Authenticated cache snapshots and migration markers are scoped to the Clerk user. Afterwards, individual add, update, and remove actions are committed atomically on the server rather than replacing the whole snapshot.

**Why:** Claiming legacy data only once preserves a first account's existing browser data without letting a later reload or another account resurrect deleted items or inherit a shared-browser cache. Operation-level mutations prevent simultaneous devices from accidentally discarding each other's additions or removals.

**How to apply:** Preserve the legacy-claim policy when evolving preference data. New preference types should use a server-side, user-scoped atomic mutation for normal edits, scoped local keys, and a server-authoritative path after their initial legacy claim.