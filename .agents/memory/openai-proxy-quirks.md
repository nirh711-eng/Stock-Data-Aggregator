---
name: OpenAI Proxy Quirks
description: gpt-5-mini behavior via Replit AI proxy — token limits and unsupported features
---

## Rule
**Always use `max_completion_tokens: 4096` for ANY endpoint that needs non-empty AI output.**

## Why
gpt-5-mini (via Replit AI proxy) is a reasoning model. It consumes most of `max_completion_tokens` on internal "thinking" tokens before producing visible output. Values below ~3000 typically yield `content: ""` (empty string). Observed:
- 500 tokens → empty content (5s response)
- 1500 tokens → empty content (12s response)
- 4096 tokens → content returned (works for all tasks: deep analysis, daily analysis, profile/agreements extraction)

## How to apply
- Deep analysis: `max_completion_tokens: 4096` ✓
- Daily analysis: `max_completion_tokens: 3000` (was working — close to the edge; if it ever breaks, bump to 4096)
- Profile/agreements: `max_completion_tokens: 4096` ✓
- Any new AI endpoint: start at 4096

## Also unsupported
- `response_format: { type: "json_object" }` — NOT supported by the Replit proxy. Use jsonrepair to parse output instead.
