<!-- Thanks for contributing! Keep PRs focused on one concern. -->

## What & why
<!-- What does this change, and why? Link any related issue (e.g. "Closes #123"). -->

## How it was verified
<!-- Commands you ran, manual checks, screenshots for UI changes. -->

## Checklist
- [ ] Focused on a single concern (unrelated cleanups split out)
- [ ] `go test -race ./cmd/... ./internal/...` passes (matches CI)
- [ ] Frontend: `npm run build`, `npm run lint`, `npm test` pass (if UI touched)
- [ ] Tests added/updated for the change; bug fixes include a regression test
- [ ] Routes changed? Updated **both** `docs/api/openapi.yaml` and `cmd/mailtrap-local/openapi.yaml`
- [ ] Docs/README updated if behavior or flags changed
