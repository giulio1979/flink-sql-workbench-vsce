# Flink SQL Workbench — Code Review (prioritized)


Priority legend
- High — security, stability, or correctness risk; fix ASAP.
- Medium — reliability, UX, or maintainability; fix in upcoming sprints.
- Low — documentation, cosmetic, or long-term refactors.
## High priority

- Webview HTML injection and Content Security Policy (CSP)
 	- Problem: HTML for job details and other panels is built via template literals and interpolates raw values without escaping.
 	- Files: `src/extension.ts` (job details webview), `src/providers/SettingsWebviewProvider.ts` (settings HTML)
 	- Remediation: PARTIALLY APPLIED — HTML-escape helpers were added (`src/utils/html.ts`) and applied to results/job webviews; a nonce-based minimal CSP is injected in `ResultsWebviewProvider`.
 	- Verification: Unit and integration tests executed; manual smoke tests for fixed templates passed. Remaining webviews should be audited similarly.

- Unsafely-typed error handling (`error: any`) and missing structured logs
 	- Problem: `catch (error: any)` is used widely; messages shown to users may be unhelpful and stack traces discarded.
 	- Files: `src/extension.ts`, `src/services/*.ts` (many occurrences)
 	- Verification: Activation errors now emit normalized logs; add tests for additional error flows as needed.

## Medium priority

- Centralize configuration defaults (gateway URL and others)
 	- Problem: Default `'http://localhost:8083'` appears in multiple places (`src/extension.ts`, `src/providers/SettingsWebviewProvider.ts`, tests).
 	- Files: `src/extension.ts`, `src/providers/SettingsWebviewProvider.ts`, `src/test/integration.test.ts`
 	- Verification: Tests and integration runs passed using `DEFAULT_FLINK_GATEWAY_URL`.

- Tests coverage and test strategy
 	- Problem: Unit coverage for commands/providers is lacking; integration tests exist but rely on an external Flink gateway.
 	- Files: `src/test/extension.test.ts`, `src/test/integration.test.ts`
 	- Verification: Local test runs with integration enabled pass (20 passing). Recommend CI gating and coverage reports.

- Results UI only shows last result for batch executions
 	- Problem: `executeAllQueries` aggregates results but only displays the last successful result in `resultsProvider`.
 	- Files: `src/extension.ts`, `src/providers/ResultsWebviewProvider.ts`
 	- Verification: Unit test for `executeAllQueries` that expects `resultsProvider.updateResults` called with an aggregated payload or multiple updates.

- Unsanitized UI text and missing accessibility
 	- Problem: Webview elements lack ARIA labels and formatting replacement can remove undo history.
 	- Files: `src/webview/editor.js`, `src/providers/*.ts` (webviews)
 	- Remediation: PARTIAL — HTML escaping applied to webviews; accessibility improvements (ARIA, undo-preserving formatting) remain on the roadmap.
 	- Verification: HTML escaping verified; accessibility items pending.
## Low priority

- Duplicate keywords and fragile SQL formatter in webview
 	- Problem: Duplicate 'FOR' in Monaco keywords and a brittle local `formatSql()` function.
 	- Files: `src/webview/editor.js`
 	- Verification: Lint check for duplicate entries; unit tests for format output on sample queries.

- Progress reporting uses hardcoded increments
 	- Problem: `progress.report({ increment: 10 })` and other hardcoded increments are used.
 	- Files: `src/extension.ts`
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
- Remove duplicate Monaco keyword in `src/webview/editor.js` (trivial).
- Centralize the gateway URL constant (create `src/config.ts`) and reference it from `extension.ts`, `SettingsWebviewProvider.ts`, and tests.
- Centralized gateway URL: DONE (`src/config.ts`).
- HTML-escape helper and applied to results/job webviews: DONE (`src/utils/html.ts`, `ResultsWebviewProvider`, `extension.ts` job details).
- Remove duplicate Monaco keyword in `src/webview/editor.js` (still open).

## Next steps / recommended roadmap
1. High (1–2 days): Add HTML escaping for webviews and add CSP; fix error logging to capture stack traces.
2. Medium (2–5 days): Centralize config defaults; add unit tests for commands and core services; add CI gating for integration tests.
3. Low (ongoing): Improve webview UX (accessibility, Monaco undo), replace fragile SQL formatter with a library, and document activation events + packaging metadata.

## Notes

This file should be updated as issues are resolved or new findings are discovered.
