# Recovery Ledger: Architecture

This document explains how the system is put together and why each seam is
where it is. The README covers results and reproduction; this covers structure.

## System overview

```
  recurring debits ---.
                       \
                        v
                 [ Root cause classifier ]   rules over real Razorpay codes
                        |
  disputes -------------'
                        |
                        v
                 [ RECOVERY LEDGER ]         single source of truth
                        |
                        v
                 [ Policy engine ]           action + timing, incl. ABANDON
                        |
          .-------------+-------------.
          v                           v
   Lane 1 actions               Lane 2 actions
   retry / renew mandate /      assemble evidence /
   update instrument /          draft representment /
   split amount / ABANDON       do not contest
          |                           |
          '-------------+-------------'
                        v
                 [ Benchmark harness ]       policy vs 5 baselines
```

One Next.js app, no separate API server, no monorepo. The single structural
rule that keeps the engine portable: **nothing in `src/core/` imports React or
Next.** The core is a plain TypeScript library; the dashboard and the CLI are
two thin consumers of it.

## The agent loop

The brief asks for an agent that detects revenue at risk, determines the right
intervention, and executes a bounded recovery. That maps onto the pipeline
directly:

| brief | component |
|---|---|
| detect | every failed debit and every dispute becomes a `LedgerRow` |
| diagnose | `classify.ts` turns the raw gateway code into a root cause |
| decide | `policy/engine.ts` picks the action, the timing, and a rationale |
| act | the action executes against the environment (simulated here) |
| bounded | `ABANDON`, a hard attempt cap, and EV-negative "do not contest" |

The loop is deliberately not an LLM prompt chain. Retry decisions run
thousands of times per day per merchant, must be auditable rupee by rupee, and
must never hallucinate a debit. The learned part (retry timing) is a
calibrated probability table; the language-model part is confined to Lane 2
letter drafting, where prose is actually the deliverable and every draft is
labelled with its provenance.

## The ledger

`ledger.ts` defines one row shape for every at-risk rupee. Money never
captured (a failed recurring debit) and money captured then clawed back (a
dispute) get the same columns: amount, raw code, root cause, chosen action,
status, attempts, nudges, recovered amount, and a human-readable rationale.

Statuses distinguish two ways of ending without the money:

- `ABANDONED`: we chose to stop. A decision.
- `LOST`: we tried and ran out of runway. A failure.

Keeping those separate is what lets the benchmark price the value of stopping.

Persistence is split on purpose: `ledger.ts` is pure types and helpers with
zero runtime dependencies; `ledger-store.ts` holds the SQLite (better-sqlite3)
store. The benchmark imports only the pure half, so `npm run bench` works even
on a machine where the native module fails to build. A test walks the import
graph from the bench entrypoint and fails if a native dependency ever creeps
in.

## Classification

Raw gateway codes are Razorpay's real published reason codes, and the mapping
to root causes is rules, not ML. The interesting part is that the raw code
space is ambiguous: `mandate_not_active` means either an expired mandate
(renewal can fix it) or a revoked one (nothing can), and those demand opposite
actions. The classifier resolves the ambiguity by joining the merchant's own
mandate record (cap, expiry, instrument expiry), which the merchant holds by
definition, since they registered the mandate. Measured accuracy against the
simulator's ground truth is 96.3%; the residual is genuine ambiguity in codes
like `payment_failed`.

Each classification carries a confidence and an evidence list, surfaced
verbatim in the dashboard.

## Simulator

The simulator is the environment; the policy is the agent. Customers carry
latent state the policy never sees: salary day, a balance curve over the pay
cycle, mandate cap and expiry, issuer bank with a downtime schedule, and a
responsiveness score. Debits resolve against this state, and the response
model answers the only question the benchmark needs: given action A at time t
on this customer, does it succeed?

Two disciplines make the numbers mean something:

1. **Frozen parameters.** Every probability in the response model was
   committed (`551c340`) before any policy code existed, and the file has not
   been touched since. `git log` on `src/core/simulator/params.ts` shows
   exactly one commit. A benchmark whose environment is tuned after seeing the
   policy is a self-fulfilling prophecy.
2. **Seeded randomness everywhere.** A small seeded PRNG replaces
   `Math.random()` throughout, so the benchmark is byte-identical on any
   machine.

## Policy engine

`RootCause` and `RecoveryAction` are discriminated unions, and the engine's
switch ends in an `assertNever` default. Adding a failure cause without
deciding its recovery action is a compile error. `npm run prove:exhaustive`
demonstrates the compiler rejecting an unhandled variant at four sites.

For `INSUFFICIENT_FUNDS`, timing comes from `policy/timing.ts`: an empirical
estimate of P(success | cause, customer segment, day offset), counted from
simulated history with Laplace smoothing. About sixty lines, no dependencies,
and fully interpretable: when a merchant asks why the retry fired on the 3rd,
the table answers directly. It is trained on a population from a different
seed than the one it is evaluated on, and `assertDisjointSeeds()` refuses to
run otherwise.

Customer contact is bounded by policy: at most two messages per case, and a
single collections escalation. Recovery is not allowed to become spam.

Every decision returns three things: the action, the day offset, and a
rationale sentence. The rationale is not written for the UI; the dashboard
renders whatever the engine said.

## Benchmark harness

Six policies run over the identical ledger with the identical attempt budget:

| id | policy | role |
|---|---|---|
| B0 | no recovery | floor |
| B1 | fixed retry, days 1/3/5 | industry-typical dunning |
| B2 | exponential backoff | smarter transient handling, still cause-blind |
| B2T | learned timing, cause-blind | a smart-retry product, built from B3's own timing model |
| B3 | Recovery Ledger | system under test |
| B4 | greedy full-information oracle | ceiling |

Design choices that keep the comparison honest:

- **Common random numbers.** Outcome randomness is seeded per (row, attempt),
  never per policy, so two policies retrying the same debit on the same day
  get the same coin flip.
- **The oracle shares the budget.** B4 sees every latent variable but gets the
  same attempt cap as everyone else. An integrity check fails the run if any
  policy exceeds the oracle. During development it caught a B4 that
  self-limited to three retries and was promptly beaten by B3.
- **B3 cannot peek.** The oracle's view travels through the shared policy
  context, and a test asserts B3's decisions are identical with and without it
  present.
- **All metrics reported**, including the ones B3 loses: it sends far more
  customer nudges than the fixed schedule and takes longer per recovery.

## Lane 2: disputes

Nine hand-authored cases against real Visa VCR and Mastercard reason codes.
Each case flows through the same three steps: look up what evidence the reason
code requires, match it against what the merchant holds, and decide.

A missing mandatory artifact is modelled as a wall, not a discount, because
networks will not review the representment without it, so those cases collapse to
near-zero win probability instead of a misleading 40%. When the packet is
complete, the decision is expected value against a fixed representment cost,
which produces the second form of bounded recovery: a complete case on a small
amount is still "do not contest".

Letter drafting has three provenance-labelled sources: a cached model output
(keyed on a hash of the prompt), a live Claude call behind an explicit
`--live` flag, and a deterministic template. The repo never calls the API
implicitly, and template output is never presented as model output.

Visa 13.2 (cancelled recurring transaction) ties the lanes together: its
compelling evidence includes the signed e-mandate and proof the RBI pre-debit
notice was delivered, which is data Lane 1 already manages.

## Dashboard

Four screens: the ledger table, a day-by-day replay of the recovery race, a row
detail page (raw code → root cause →
action → rationale), and the benchmark. Server components call the engine
directly instead of reading SQLite; the full benchmark takes ~130ms, so the
dashboard works on a fresh clone with no seed step and no native module on the
render path. Every page accepts a `?seed=` query parameter and recomputes the
entire world for it, which is the live proof that nothing on screen is a
recording.

## Extending with a third source

A new recovery source (refund abuse, unreconciled settlements) plugs in by
producing `LedgerRow`s with a new `source` value and an action set for the
policy layer. Lane 2 is the existence proof: adding disputes required no
change to the ledger schema at all.

## Invariants under test

| invariant | enforced by |
|---|---|
| terminal causes never recover by retrying, at any offset | environment test over 1,500 customers |
| every cause has a defined action | `assertNever` + `prove:exhaustive` |
| B3 never reads latent state | decision-equality test with/without oracle view |
| no policy out-recovers the oracle | benchmark integrity check + test |
| train and eval seeds are disjoint | `assertDisjointSeeds()` at run start |
| bench path has no native dependency | import-graph walk from `scripts/bench.ts` |
| identical results across runs | byte-equality test on repeated runs |
| at most two customer contacts per row | per-row assertion over the full B3 run |
| cause-awareness beats timing alone | B3 vs B2T assertion, and a 20-seed sweep |
| drafts never cite evidence the merchant lacks | per-case letter test |
