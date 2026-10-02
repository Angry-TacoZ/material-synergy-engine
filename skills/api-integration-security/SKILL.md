---
name: api-integration-security
description: Review and implement integrations with external APIs and services.
---

# API Integration Security

- Identify which code runs in the browser and which runs on a trusted server.
- Keep private credentials server-side; never ship them in browser bundles.
- Validate and constrain inputs before forwarding them to external services.
- Apply least-privilege authorization, timeouts, and safe error handling.
- Avoid logging secrets or sensitive request content; sanitize persisted errors and generated output.
- Clearly label mocked or simulated integrations and verify real integrations separately.
