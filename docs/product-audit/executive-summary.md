# Executive summary

**Audit date:** 2026-10-09. **Baseline:** `main` @ `9032151`. **Scope:** audit only.
No code, schema or production changes were made.

## Where FLH stands

Feels Like Home has a **substantial, coherent product built**:
- the buyer loop: import, priorities, Match, compare, map, commute, tour, archive;
- co-buyer collaboration with independent perspectives;
- a full Realtor role (suggestions, notes, tour suggestions, Realtor-started searches);
- a Capacitor iOS shell with a Share Extension and Universal Links.

The build passes, and the test suite passes in full: 710/710 with the real-Postgres
harness.

**What it lacks is evidence and launch plumbing, not features.**

1. **Nothing user-facing is "COMPLETE — VERIFIED".**
   - There is no recorded production verification since the schema-drift repair.
   - There is no real-device QA.
   - 60 capabilities are BUILT — QA PENDING; 16 NEED VERIFICATION, including 5
     affected by the unmerged multi-search fix.
2. **App Store blockers are known and small:**
   - in-app account deletion;
   - privacy policy, terms and support URL;
   - `PrivacyInfo.xcprivacy`;
   - Info.plist keys (camera — a likely crash path — and encryption; drop `armv7`);
   - the privacy label;
   - a reviewer account;
   - iPhone-only or iPad screenshots.
3. **Operational gaps:**
   - no CI;
   - no error monitoring;
   - no spend limits on RentCast/Google;
   - 3 high `npm audit` advisories;
   - an incomplete `.env.example`, which hides that `RENTCAST_API_KEY` and
     `APPLE_TEAM_ID` are required.
4. **Monetization (FLH+) is not started.** Only analytics event names exist.
   **Onboarding V2** has a flow definition and a state model, but no new screens.
   Both are correctly paused or sequenced, and neither blocks a free launch.
5. **Collaboration edge cases:**
   - a second co-buyer isn't prevented, although the V1 logic assumes one;
   - invitations can't be revoked;
   - invites are copy-link only, although the UI says "Send".

## Status count (150 capabilities)

| Status | Count | Note |
|---|---|---|
| COMPLETE — VERIFIED | 1 | Developer tooling only; 0 user-facing |
| BUILT — QA PENDING | 60 | |
| PARTIAL | 17 | |
| NOT STARTED | 49 | |
| DEFERRED | 3 | |
| SUPERSEDED | 1 | |
| UNKNOWN | 3 | |
| NEEDS VERIFICATION | 16 | 5 of them ⟳ in flight |

Separately, 48 parked ideas are tracked as FUTURE-001…048.

## Recommendation

**Launch free first (Roadmap A, about 3–4 weeks + review), then build Onboarding V2
and FLH+ (Roadmap B).** The critical path:
1. read-only production checks;
2. merge the multi-search fix after QA;
3. iOS plist and privacy manifest;
4. device QA and TestFlight;
5. legal pages;
6. account deletion;
7. App Store submission.

## Top 10 priorities

1. Run the read-only production checks ([audit-evidence.md](audit-evidence.md#production-checks-the-owner-should-run-read-only)).
2. QA and merge the multi-search invitation fix (`4168309`).
3. Add CI (tests + build on every PR).
4. iOS plist hygiene + privacy manifest (camera crash risk).
5. Real-device QA → TestFlight internal.
6. Privacy policy, terms, support page.
7. In-app account deletion.
8. Provider spend caps + error monitoring.
9. Co-buyer cap + invitation revoke + honest "Copy link" copy.
10. Patch the `next` advisories; add security headers.

Details are in [roadmap.md](roadmap.md), [launch-readiness.md](launch-readiness.md)
and [product-decisions.md](product-decisions.md).
