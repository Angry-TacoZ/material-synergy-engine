---
name: ci-baseline
description: Establish or review a deterministic continuous-integration baseline.
---

# CI Baseline

- Use the project's selected stack and lockfile; do not introduce a stack to an empty project without James's input.
- Keep CI repeatable, non-destructive, and independent of personal credentials.
- Run the canonical verification command and make failures visible.
- Do not connect paid services, production data, or deployment credentials to routine checks without explicit authorization.
