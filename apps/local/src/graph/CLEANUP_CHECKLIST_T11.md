# T11 Cleanup PR Checklist (§12.4)

- [ ] No runtime imports from legacy workflow/stage modules remain.
- [ ] No API routes accept or emit v1 checkpoint/stage payloads.
- [ ] No UI code references legacy stage/checkpoint models.
- [ ] No DB migrations or ORM models reference deprecated v1 schema.
- [ ] No feature flags keep dual-read/dual-write alive (flag removed, not just disabled).
- [ ] `rg -n "checkpoint|stage-based|legacy workflow|v1Task\\.checkpoints" src/` returns only intentional migration-history docs/tests.
- [ ] CI includes a guard test that fails if legacy engine entry points reappear.
