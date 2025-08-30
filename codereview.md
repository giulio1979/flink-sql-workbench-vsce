# Flink SQL Workbench — Code Review (prioritized)

This document summarizes code-review findings, prioritized by severity, with concrete remediation and verification suggestions. It focuses on the issues reported previously and adds explicit test and CI guidance.

Priority legend
- High — security, stability, or correctness risk; fix ASAP.
- Medium — reliability, UX, or maintainability; fix in upcoming sprints.
- Low — documentation, cosmetic, or long-term refactors.

## High priority

- Webview HTML injection and Content Security Policy (CSP)
	- Problem: HTML for job details and other panels is built via template literals and interpolates raw values without escaping.
	- Files: `src/extension.ts` (job details webview), `src/providers/SettingsWebviewProvider.ts` (settings HTML)
	- Remediation: Escape user-provided values before interpolation or adopt a library such as DOMPurify; add a strict webview CSP and reduce use of `innerHTML`-style templating.
	- Verification: Unit test that HTML output is escaped for characters like `<`, `>` and `"`; manual smoke test verifying injection vectors blocked.

- Unsafely-typed error handling (`error: any`) and missing structured logs
	- Problem: `catch (error: any)` is used widely; messages shown to users may be unhelpful and stack traces discarded.
	- Files: `src/extension.ts`, `src/services/*.ts` (many occurrences)
	- Remediation: Use typed error wrappers or at minimum capture `error.message` and `error.stack`; surface actionable messages to users and detailed logs to output window.
	- Verification: Static check to find `catch (error: any)` and replace with typed handlers; add unit tests that assert user-facing messages are meaningful for mocked failures.

## Medium priority

- Centralize configuration defaults (gateway URL and others)
	- Problem: Default `'http://localhost:8083'` appears in multiple places (`src/extension.ts`, `src/providers/SettingsWebviewProvider.ts`, tests).
	- Files: `src/extension.ts`, `src/providers/SettingsWebviewProvider.ts`, `src/test/integration.test.ts`
	- Remediation: Create a single config helper or constant (e.g., `src/config.ts`) and reference it; prefer reading from `workspace.getConfiguration()` with a documented fallback policy.
	- Verification: Replace hardcoded literals and run tests to ensure behavior unchanged.

- Tests coverage and test strategy
	- Problem: Unit coverage for commands/providers is lacking; integration tests exist but rely on an external Flink gateway.
	- Files: `src/test/extension.test.ts`, `src/test/integration.test.ts`
	- Remediation: Add unit tests for `extension.ts` commands using `vscode` test-mocks; add targeted unit tests for `StatementManager`, `SessionManager`, and `FlinkApiService` using HTTP mocks (nock or similar). In CI, mock the gateway or gate integration tests behind an environment flag (e.g., `RUN_INTEGRATION=true`).
	- Verification: New unit tests pass locally and in CI; integration tests are optional in CI unless a real gateway is provided.

- Results UI only shows last result for batch executions
	- Problem: `executeAllQueries` aggregates results but only displays the last successful result in `resultsProvider`.
	- Files: `src/extension.ts`, `src/providers/ResultsWebviewProvider.ts`
	- Remediation: Support aggregated/multi-result views (tabs or combined summary) in the results UI.
	- Verification: Unit test for `executeAllQueries` that expects `resultsProvider.updateResults` called with an aggregated payload or multiple updates.

- Unsanitized UI text and missing accessibility
	- Problem: Webview elements lack ARIA labels and formatting replacement can remove undo history.
	- Files: `src/webview/editor.js`, `src/providers/*.ts` (webviews)
	- Remediation: Add ARIA attributes, keyboard shortcuts documentation, and use Monaco edit operations (or pushUndoStop) for formatting to preserve undo.
	- Verification: Manual accessibility checks (keyboard-only), unit tests for format routine that assert undo stack preserved when possible.

## Low priority

- Duplicate keywords and fragile SQL formatter in webview
	- Problem: Duplicate 'FOR' in Monaco keywords and a brittle local `formatSql()` function.
	- Files: `src/webview/editor.js`
	- Remediation: Remove duplicates; use a tested SQL formatter library (`sql-formatter`) or call out that the built-in formatter is opt-in and fragile.
	- Verification: Lint check for duplicate entries; unit tests for format output on sample queries.

- Progress reporting uses hardcoded increments
	- Problem: `progress.report({ increment: 10 })` and other hardcoded increments are used.
	- Files: `src/extension.ts`
	- Remediation: Drive progress from backend events when possible; otherwise compute adaptive increments.
	- Verification: Unit test that progress receives reasonable increments for a simulated workload.

- Placeholder commands and user messaging
	- Problem: Commands like `setCatalog` and `insertTableReference` only show 'will be implemented'.
	- Files: `src/extension.ts`
	- Remediation: Either implement minimal behavior or hide/not advertise the commands until ready.
	- Verification: Ensure commands are not advertised in the README/command palette if not implemented.

## Testing improvements (concrete plan)

1) Unit tests (priority: Medium)
	 - Add unit tests for `extension.ts` commands using `sinon`/`proxyquire` or the VS Code test API mocks. Test inputs and expected calls to `statementManager`, `resultsProvider`, `vscode.window.show*`.
	 - Add unit tests for `StatementManager`, `SessionManager`, `FlinkApiService` using HTTP mocks (e.g., `nock` for node), focusing on happy path and error handling.

2) Integration tests (already present)
	 - Keep `src/test/integration.test.ts` but gate it in CI with `RUN_INTEGRATION` env var. In CI, provide a mocked gateway container or skip.
	 - Add small end-to-end tests for session lifecycle and cancel semantics.

3) Test data and fixtures
	 - Add fixtures for common gateway responses in `test/fixtures/*` and use them in unit tests.

4) CI configuration
	 - Run unit tests on each PR. Run integration tests if `RUN_INTEGRATION=true` and a gateway host is reachable.
	 - Fail PRs on lint errors and TypeScript compile errors.

5) Coverage targets
	 - Aim for >70% unit coverage on core services (`StatementManager`, `SessionManager`, `FlinkApiService`) before larger refactors.

## Quick wins (low-effort, high-value)
- Remove duplicate Monaco keyword in `src/webview/editor.js` (trivial).
- Centralize the gateway URL constant (create `src/config.ts`) and reference it from `extension.ts`, `SettingsWebviewProvider.ts`, and tests.
- Add a small HTML-escape helper and apply it to job details webview templates.

## Next steps / recommended roadmap
1. High (1–2 days): Add HTML escaping for webviews and add CSP; fix error logging to capture stack traces.
2. Medium (2–5 days): Centralize config defaults; add unit tests for commands and core services; add CI gating for integration tests.
3. Low (ongoing): Improve webview UX (accessibility, Monaco undo), replace fragile SQL formatter with a library, and document activation events + packaging metadata.

## Notes
- This review focused on findings and actionable remediation; it did not include an exhaustive static analysis (run `eslint --fix` and TypeScript checks for more items).
- I can implement quick wins (e.g., centralize gateway default, remove duplicate keyword, add HTML escaping) — pick one and I will apply it and run tests.

---
This file should be updated as issues are resolved or new findings are discovered.
