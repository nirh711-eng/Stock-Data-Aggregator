---
name: OpenAPI codegen safety
description: Guardrail for Orval code generation when the OpenAPI source has YAML syntax errors.
---

Validate OpenAPI YAML syntax before rerunning Orval after a failed generation. Orval's clean step removes the generated React client output before its parser reports a malformed specification.

**Why:** A YAML indentation error can make code generation fail after cleanup, temporarily breaking imports throughout the frontend until a successful regeneration restores the files.

**How to apply:** When codegen reports it cannot resolve the input, check the YAML parser error and indentation first, then rerun the configured codegen command to regenerate the client and Zod outputs.