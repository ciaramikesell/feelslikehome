# Executive summary

**Updated 2026-10-09 (decision lock).** Baseline: `main` @ `3651f7e`. Its code is
identical to the original audit baseline `9032151`. This is documentation and
planning only: no code, schema, native or production change was made.

## Where FLH stands

Feels Like Home has a **substantial, coherent product built**:
- the buyer loop: import, priorities, Match, compare, map, commute, tour, archive;
- co-buyer collaboration with independent perspectives;
- a full Realtor role;
- a Capacitor iOS shell with a Share Extension and Universal Links.

`main` passes 710/710 tests with the real-Postgres harness, and builds.

**Nothing user-facing is "COMPLETE — VERIFIED" yet.** There has been no recorded
production verification since the schema repair and no real-device QA. The status
counts below are unchanged by the decision lock: **a decision to build something is
not evidence that it is built.**

## The approved plan (all 18 decisions locked)

- **Free internal and external TestFlight; the public App Store release includes FLH+** ($9.99 lifetime planning price, subject to App Store Connect configuration). There is no client-side payment bypass; grandfathering is server-side (D-01).
- **The full Onboarding V2 ships before external TestFlight.** Existing users are never forced through it (D-02).
- **Account and collaboration integrity before beta:**
  - one co-buyer, enforced against concurrency (D-07);
  - email + copy-link invitations (D-08);
  - revocation (D-09);
  - leave with retain-or-delete (D-06);
  - account deletion that **automatically preserves the shared search for the remaining co-buyer** (D-05);
  - display-name privacy (D-16).
- **Offer Submitted / Under Contract in V1** (D-15).
- **iPhone-first remote-hosted native app** with real native polish and a branded offline screen (D-04, D-17, D-18).
- **Error monitoring, rate limits, quotas, legal pages, support** (D-10, D-12, D-13, D-14). The Send Feedback entry moves into Account (D-11).

The 10 product rules locked on 2026-10-07 are preserved. Two are not yet true in code
(R-1, R-2: Match pre-tour/after-tour separation and SQL alias parity) and are
scheduled.

## The multi-search fix

The owner reports it is fixed. The evidence:
- **the code is fixed on `4168309`** (re-run today: 719/719 tests, build OK);
- **it is not merged into `main`, not deployed from `main`, and not QA'd on the two real accounts.**

Merging it plus real-account QA is the first Phase 0 task (P0-01). Onboarding V2
builds on it.

## Biggest risks surfaced by reconciling the decisions

1. **Account deletion today would destroy shared data** (N-1…N-4). The FK cascades delete an owner's shared search and a co-buyer's shared homes, and Realtor deletion fails outright. D-05 needs a primary-search model, a deletion transaction and FK fixes.
2. **Succession collides with `unique(user_id)`.** Every user already owns a search. Recommended: a primary-search flag with a partial unique index. 18 lookup sites change.
3. **The co-buyer cap must be a DB index** to be concurrency-safe. The current acceptance lock is per-invitation only.
4. **Onboarding V2 must route five kinds of entrant differently.** It must build on the unmerged multi-search fix.
5. **FLH+ boundaries:**
   - succession vs per-search unlock (R-3);
   - the TestFlight vs grandfathering cutoff (R-4);
   - no server definition of the "free collaborative loop" yet.

Ten owner questions (Q-01…Q-10) carry recommended defaults. They are
implementation rules, not reopened decisions.

## Status count (150 capabilities — unchanged)

| Status | Count | Note |
|---|---|---|
| COMPLETE — VERIFIED | 1 | Developer tooling only; 0 user-facing |
| BUILT — QA PENDING | 60 | |
| PARTIAL | 17 | |
| NOT STARTED | 49 | |
| DEFERRED | 3 | |
| SUPERSEDED | 1 | |
| UNKNOWN | 3 | |
| NEEDS VERIFICATION | 16 | 5 of them ⟳ in flight (`4168309`) |

## Phases (no dates)

| Phase | Gate |
|---|---|
| Phase 0 — foundation and verification | G0 |
| Phase 1 — collaboration and account integrity | → G1/G2 |
| Phase 2 — Onboarding V2 and core experience | → G2 |
| Phase 3 — native polish and free TestFlight | G1 → G2 |
| Phase 4 — FLH+ and public launch | G3 |
| Phase 5 — post-launch | |

Parallel tracks: account integrity, onboarding UI, Match semantics, native config,
ops, legal drafting.

**Top-three risk tasks:**
- P1-06 account deletion with succession;
- P4-03 StoreKit with server verification;
- P1-05 primary-search model / P2-03 Match semantics.

Full detail:
- [roadmap.md](roadmap.md)
- [implementation-pr-sequence.md](implementation-pr-sequence.md)
- [decision-implementation-conflicts.md](decision-implementation-conflicts.md)
- [launch-readiness.md](launch-readiness.md)

## Original summary (2026-10-09, superseded recommendation)

The original audit recommended a free public launch first (Roadmap A), then Onboarding
V2 and FLH+. **That recommendation is superseded by D-01 and D-02.** Its findings
remain valid and are carried into the phases above. The original text is in git
history at `3651f7e`.
