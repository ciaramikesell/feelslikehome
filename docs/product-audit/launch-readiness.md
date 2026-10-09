# Launch readiness

**Updated 2026-10-09** for the locked decisions (`main` @ `3651f7e`). The original
verdict and the L0–L4 milestone tables are preserved at the end.

**Verdict: not ready for any external release.**
- **G0 (private dev/device QA)** is reachable once the in-flight multi-search fix
  (`4168309`) is merged and the read-only production checks are run.
- Under D-01 and D-02:
  - external TestFlight requires the full Onboarding V2 and the account-integrity work;
  - the **public release requires FLH+**.

**Key to the "Required by" column**
- **Platform:** required by Apple's rules or tooling. Without it, upload, Beta App Review or App Review is expected to fail.
- **FLH:** an FLH product-quality or approved-decision requirement.
- Gates are cumulative: each one includes everything in the gates before it.

## G0 — Private development / device QA

| Item | Task | Required by | Status today |
|---|---|---|---|
| Multi-search fix merged, deployed, **real-account QA on both accounts** | P0-01 | FLH (D-03) | **Not merged.** `4168309`: 719/719 tests and build OK, re-run 2026-10-09. Production deployment and real-account QA: **not done** |
| Read-only production verification (inventory, fingerprints, co-buyer checks, beta-feedback, env names, AASA) | P0-02 | FLH | Not run since the repair (owner reports the migrations were applied) |
| Read-only preflights for Phase 1 | P0-03 | FLH | Not written |
| CI on PRs | P0-04 | FLH | None |
| Vercel production-branch / domain verification (N-10) | P0-05 | FLH | Unverified anomaly |
| Error monitoring with redaction | P0-07 | FLH (D-10: "before beta") | None |
| Provider quotas/alerts **and** app rate limits | P0-08 | FLH (D-12) | None |
| Dependency advisories patched | P0-06 | FLH | 3 high, 1 moderate |

## G1 — Internal TestFlight (free)

| Item | Task | Required by | Status today |
|---|---|---|---|
| Signed archive uploads; version/build scheme | P3-07 | **Platform** | Team ID set; 1.0 (1); never uploaded (UNKNOWN) |
| `ITSAppUsesNonExemptEncryption` | P3-02 | **Platform** (export compliance per build; can be answered manually, but the key avoids it) | Missing |
| `PrivacyInfo.xcprivacy` (required-reason APIs) | P3-02 | **Platform** (upload validation) | Missing |
| `NSCameraUsageDescription` (the file input offers Take Photo) | P3-02 | **Platform** (crash and rejection otherwise) | Missing |
| Remove legacy `armv7` capability | P3-02 | Platform hygiene | Present |
| iPhone-only target | P3-01 | FLH (D-04) | Device family 1,2 |
| Branded offline screen + Retry, bundled | P3-03 | FLH (D-17) | None |
| Send Feedback in Account; floating tab removed | P3-05 | FLH (D-11) | Floating tab |
| One-co-buyer cap (concurrency-safe) | P1-01 | FLH (D-07) | No cap |
| Invitation revocation (view + revoke, server-enforced) | P1-02 | FLH (D-09: "before beta") | Not settable |
| Device QA of the core journeys | P3-07 | FLH | Not done |

> Onboarding V2 is **not** required for G1. It is required for G2 (D-02).

## G2 — External TestFlight (free; Beta App Review)

| Item | Task | Required by | Status today |
|---|---|---|---|
| Privacy policy URL | P3-06 | **Platform** (App Store Connect beta info) | None |
| Beta App Description, feedback email, demo account + review notes | P3-08 | **Platform** (Beta App Review, login-gated app) | None |
| Support email + `/support` (mailbox verified) | P3-06 | FLH (D-14); platform-required at G3 | None |
| **Full Onboarding V2** (Welcome → … → Homes + Get Started) | P2-01…P2-05 | FLH (D-02) | Flow keys only |
| Location areas + Match pre-tour / after-tour separation, JS/SQL parity | P2-02, P2-03 | FLH (locked rules 6, 9) | Not built (R-1, R-2) |
| Offer Submitted / Under Contract | P2-06 | FLH (D-15) | Not built |
| Invitation email + Copy link | P1-03 | FLH (D-08) | Copy only |
| Leave: retain or delete; retained data hidden | P1-04 | FLH (D-06) | Retain only; visible to Realtor (N-5) |
| Primary-search model + **account deletion with automatic succession** | P1-05, P1-06 | FLH (D-05). Account deletion becomes **platform-required at G3** (5.1.1(v)) | None. Current FKs would destroy shared data (N-1…N-4) |
| Display-name privacy | P1-07 | FLH (D-16) | Unrestricted |
| Journey regression on the V2 build | P2-07 | FLH | — |

## G3 — Public App Store with FLH+

| Item | Task | Required by | Status today |
|---|---|---|---|
| In-app account deletion | P1-06 | **Platform** (Guideline 5.1.1(v)) | None |
| Privacy policy + support URL in metadata | P3-06 | **Platform** | None |
| App Privacy label from verified flows | P4-07 | **Platform** | None |
| iPhone screenshots | P4-07 | **Platform** | None |
| IAP for the digital unlock (no external purchase steering) | P4-03 | **Platform** (Guideline 3.1.1) | None |
| Restore Purchases available | P4-04 | **Platform** (3.1.1 expectation for non-consumables) | None |
| Terms of use / EULA reference | P3-06 | Platform expectation for IAP (standard EULA acceptable); FLH wants its own (D-13) | None |
| Server-verified purchases, refunds → revoke, no silent transfer | P4-03 | FLH (locked rule 7) | None |
| Entitlements + server-enforced limits (2 free homes; free collab loop; per-search unlock; Realtors free) | P4-01, P4-02 | FLH (locked rules 1–5) | None |
| Grandfathering executed at the cutoff | P4-05 | FLH (locked rule 6) | None |
| Paywall + Account purchase state | P4-04 | FLH | None |
| App Review 4.2 notes (native behaviours) | P4-07 | Platform risk; **approval not guaranteed** | — |
| Legal pages reviewed before publication | P3-06 | FLH (D-13) | — |

## Hidden blockers (updated)

The original 14 are below. Status changes and new items:

- **New: the account-deletion FK graph (N-1…N-4).** Deleting an auth user today:
  - deletes an owner's whole shared search;
  - deletes shared homes a co-buyer created;
  - orphans other homes;
  - and **fails** for Realtors with authored rows.

  No one should delete users from the Supabase dashboard until P1-06 lands.
- **New: Realtors can read departed members' retained personal rows (N-5).**
- **New: concurrent acceptance can exceed the co-buyer limit (N-6).** The fix is race-proof only as a DB index.
- **New: the TestFlight vs grandfathering cutoff (R-4).** Paywall QA needs post-cutoff accounts.
- **New: succession vs per-search FLH+ unlock (R-3).**
- **Updated, original #4:** a second co-buyer is now an approved cap (D-07), scheduled in P1-01.
- **Updated, original #5:** revocation is approved (D-09), scheduled in P1-02.
- **Unchanged:** the original items 1–3 and 6–14 still apply.

### Original hidden blockers (2026-10-09, unchanged)

1. AASA is empty without `APPLE_TEAM_ID`.
2. Import fails without `RENTCAST_API_KEY`.
3. Camera crash path (no `NSCameraUsageDescription`).
4. A second co-buyer is not prevented.
5. Pending invitations cannot be revoked.
6. Removed members' personal rows are retained.
7. `schema.sql` is not the full truth.
8. No CI.
9. Default Supabase mailer limits.
10. Beta-feedback flag is on in source.
11. `resolve_display_name` resolves any user.
12. `npm audit`: 3 high.
13. The native app is entirely remote.
14. Landing says "Create a free account". Still true under FLH+ (free tier), but the paywall copy must match.

## Superseded: original milestone model (L0–L4)

The original audit defined:
- L0 web private beta;
- L1 internal TestFlight;
- L2 external TestFlight;
- L3 a free public App Store release;
- L4 FLH+.

**L3-without-FLH+ is no longer an approved milestone (D-01).** L0/L1/L2 map to
G0/G1/G2, and L3 + L4 merge into G3. The full original tables are in git history:
`docs/product-audit/launch-readiness.md` @ `3651f7e`.
