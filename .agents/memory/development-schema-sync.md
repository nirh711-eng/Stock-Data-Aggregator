---
name: Development schema sync
description: Ensuring availability-history features can persist to the development database.
---

Schema source files and migrations do not guarantee the current development database has the corresponding table.

**Why:** Availability tracking intentionally degrades without breaking sector scans when persistence fails, so a missing table can otherwise look like a working scan with tracking merely unavailable.

**How to apply:** When an availability response says tracking is unavailable, inspect the API log, confirm the development database schema, apply the existing schema through the supported development flow if needed, and rerun the coverage scan before acting on failure streaks.