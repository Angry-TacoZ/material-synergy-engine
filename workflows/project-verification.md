---
name: project-verification
description: Run safe, scope-appropriate project checks and report their evidence.
---

# Project Verification

1. Identify checks that cover the changed behavior and use the project's canonical verifier when available.
2. Run targeted checks during implementation and the full canonical verifier before substantial delivery, a PR, deployment, or a readiness claim.
3. Keep checks deterministic and non-destructive. Do not use paid APIs or live mutations without explicit authorization.
4. Report exact results, omitted checks, and remaining risk. Treat unavailable evidence as not assessed, never as a pass.
5. Confirm unrelated dirty files remain intact and report generated files.
