---
name: Safe article URL fetching
description: Security boundary for fetching metadata from user-provided article URLs.
---

User-provided article URLs must be DNS-resolved and rejected unless every resolved address is public, then fetched through a connection pinned to one validated address. Every redirect must restart that validation flow. This includes IPv4-mapped IPv6 representations.

**Why:** A hostname-only preflight can be bypassed when DNS changes between validation and connection, turning metadata extraction into server-side request forgery.

**How to apply:** Preserve address pinning, manual redirect handling, and query-free error logging whenever changing the URL metadata reader or adding another outbound fetch path for untrusted URLs.