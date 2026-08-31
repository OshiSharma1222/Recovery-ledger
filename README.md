# Recovery Ledger

Every rupee a merchant loses falls into two buckets: money that was owed and never
captured (failed recurring debits) and money that was captured and clawed back
(disputes). Recovery Ledger puts both in one ledger, decides what to chase and what
to abandon, and proves the decision was right against a control group.

**Thesis: recovery is a resource allocation problem, and the hard part is knowing
what not to chase.**

---

## Results

| | policy | recovered | rate | of ceiling | retries | wasted | per win | nudges | days |
|---|:---|---:|---:|---:|---:|---:|---:|---:|---:|
| B0 | No recovery | ₹0 | 0.0% | 0.0% | 0 | 0 | — | 0 | 0.0 |
| B1 | Fixed retry (days 1/3/5) | ₹37.89L | 52.2% | 70.0% | 1,970 | 681 | 4.16 | 0 | 2.0 |
| B2 | Exponential backoff | ₹40.26L | 55.5% | 74.4% | 2,397 | 908 | 4.76 | 0 | 2.1 |
| **B3** | **Recovery Ledger** | **₹52.52L** | **72.4%** | **97.0%** | **1,384** | **338** | **2.23** | **1,330** | **5.3** |
| B4 | Oracle (ceiling) | ₹54.12L | 74.6% | 100.0% | 1,267 | 280 | 1.96 | 509 | 4.5 |

Against the fixed day-1/3/5 schedule almost every dunning stack ships with, the
Recovery Ledger recovers **+38.6% more money** while spending **29.7% fewer retries**
and **50.4% fewer attempts on rows that could never have been recovered**. It captures
**97.0%** of what a policy with perfect knowledge of every latent variable managed.

It does not win on every axis, and that is reported rather than buried: B3 sends
1,330 customer nudges against B1's zero, and takes 5.3 days to recover against B1's
2.0. Those are real costs. A merchant who cares more about inbox silence than about
recovery rate should read the nudge column and disagree with the ranking.

## Reproduce it

```bash
npm install
npm run bench
```

One command. Seeded end to end, so the numbers above are byte-identical on your
machine. **No API key. No database. No network.** The benchmark path deliberately has
no native dependency — delete `node_modules/better-sqlite3` and it still runs.

```bash
npm test              # 57 tests
npm run seed          # generate a population, write the ledger to SQLite
npm run decide        # classify one row, show the chosen action and why
npm run disputes      # Lane 2: evidence gap analysis, contest / do-not-contest
npm run dev           # dashboard: ledger, row detail, benchmark
npm run prove:exhaustive   # see the compiler reject an unhandled failure cause
```

## The insight

Recurring payments in India fail far more often than in card-first markets, and the
reasons are structural rather than behavioural. UPI Autopay and e-mandate debits fail
on mandate lifecycle events, not just balance. The RBI e-mandate framework adds
failure classes that do not exist elsewhere: a pre-debit notification before each
debit, a per-mandate amount cap, a mandate expiry date, and additional-factor
authentication above a threshold.

Most dunning systems collapse every failure into one bucket and retry on a fixed
schedule. That is the gap:

- Retrying an **expired mandate** five times recovers nothing and burns five attempts.
- Retrying a **cap-exceeded** debit at the same amount fails forever *by construction*.
- Retrying an **insufficient-funds** failure two days before payday is close to a coin
  flip; one day after is close to a sure thing.

**26% of this ledger is structurally unrecoverable.** For those rows the probability
of success is identically zero at every offset, for every policy, forever. A
day-1/3/5 schedule spends three attempts on each of them and recovers nothing, every
cycle, forever. That is the quantitative case for the `ABANDON` action, and it is why
the benchmark reports *wasted attempts* as a first-class metric.

## Failure taxonomy

Raw reason codes are quoted from Razorpay's published documentation, never invented.
Root causes and recovery actions are my abstraction on top of them, and
[`taxonomy.ts`](src/core/taxonomy.ts) draws that line explicitly.

| root cause | retryable? | action |
|---|---|---|
| `INSUFFICIENT_FUNDS` | yes, timing-sensitive | `RETRY_AT(predicted day)` |
| `MANDATE_EXPIRED` | no | `REQUEST_MANDATE_RENEWAL` |
| `MANDATE_AMOUNT_EXCEEDED` | not at this amount | `SPLIT_AMOUNT` |
| `MANDATE_REVOKED` | no | `ABANDON` + win-back flag |
| `CARD_EXPIRED` | no | `REQUEST_INSTRUMENT_UPDATE` |
| `PRE_DEBIT_NOTICE_FAILED` | yes, after fix | `RESEND_NOTICE` then retry |
| `ISSUER_DOWNTIME` | yes, soon | `RETRY_AT(short backoff)` |
| `TECHNICAL_DECLINE` | yes, immediately | `RETRY_AT(now + minutes)` |
| `DO_NOT_HONOUR` | ambiguous | bounded retry, then stop |
| `RISK_BLOCKED` | no | `ABANDON` |

The raw code space is genuinely ambiguous, which is what makes classification more
than a lookup. `mandate_not_active` means either *expired* or *revoked* — codes that
demand opposite actions. `payment_failed` is emitted by three unrelated causes. The
classifier disambiguates using the merchant's **own mandate record**: cap and expiry
are not hidden data, the merchant registered the mandate. The uncomfortable
observation is that most dunning stacks never join that record to the retry decision.

Measured classifier accuracy against ground truth: **96.3%**. Not 100%, and it should
not be — the residual is real ambiguity in the code space.

### The compiler proves every cause has an action

`RootCause` is a discriminated union, and the policy engine's switch ends in an
`assertNever` default. Adding a failure cause without deciding what to do about it is
a **build error**, not a production incident. Verify it yourself:

```bash
npm run prove:exhaustive
```

It adds an unhandled variant and shows `tsc` rejecting it in the classifier, the
policy engine and the simulator's response model. This is a real language guarantee,
not a claim, and it is the main reason this project is TypeScript rather than Python.

## Architecture

Full architecture documentation: [docs/DESIGN.md](docs/DESIGN.md).

```
  recurring debits ---.
                       \
                        v
                 [ Root cause classifier ]   rules, over real Razorpay codes
                        |
  disputes -------------'
                        |
                        v
                 [ RECOVERY LEDGER ]         single source of truth
                        |
                        v
                 [ Policy engine ]           picks action + timing
                        |
          .-------------+-------------.
          v                           v
   Lane 1 actions               Lane 2 actions
   retry / renew mandate /      assemble evidence /
   update instrument /          draft representment /
   split amount / ABANDON       DO NOT CONTEST
          |                           |
          '-------------+-------------'
                        v
                 [ Benchmark harness ]       policy vs baselines
```

One Next.js app. The single structural rule: **nothing in `src/core/` imports React.**
A third recovery source — refund abuse, unreconciled settlements — drops in by
producing `LedgerRow`s with a new `source`. Lane 2 is the proof: adding disputes
required no change to `ledger.ts` at all.

## What is real vs what is simulated

The highest-credibility section in this repo, and the line most submissions blur.

| | status |
|---|---|
| Razorpay reason code strings | **Real.** Quoted from published docs — see [docs/RESEARCH.md](docs/RESEARCH.md) |
| Visa VCR / Mastercard dispute codes | **Real.** Verify against current Core Rules before quoting on camera |
| RBI e-mandate constraints (24h notice, ₹15,000 AFA ceiling, ₹1,00,000 for insurance/MF/card bills) | **Real**, from public reporting on the RBI directions. Not from the circular itself — verify before quoting a figure |
| Mapping raw code → root cause | **My abstraction.** Rules, not ML, and the file says so |
| Timing estimator | **Learned**, from simulated outcome history |
| Customer population, balance curves, downtime, responsiveness | **Simulated.** Authored by me |
| Response model (does action A at time t succeed?) | **Simulated.** Authored by me, frozen before the policy existed |
| Dispute cases | **Hand-authored.** Nine cases, chosen to exercise every branch |
| Representment letters | **Template** unless run with `--live` and an API key. Every draft is labelled with its source |
| Recovery rates, lift, ceiling capture | **Measured** against the simulator, not against production |

### The limitation, stated plainly

> The simulator's response model is authored by me, so this benchmark measures policy
> quality against **a stated model of the world, not against production reality**. The
> simulator parameters were frozen and committed before the policy engine was written;
> see commit [`551c340`](../../commit/551c340b3069305e4b6373db73ede8019a6cb471).

Verify that ordering yourself:

```bash
git log --follow --oneline -- src/core/simulator/params.ts
```

That file should have **exactly one commit**, and it should be an ancestor of the first
commit touching `src/core/policy/`. If `params.ts` were edited after the policy engine
landed, the benchmark would be void and you could see that in ten seconds.

One calibration pass was made *before* the freeze, while `policy/` was still an empty
directory, because the first draft's cause mix did not resemble Indian recurring
payments. It cut terminal causes from 36.9% to 22% and raised insufficient-funds from
17% to 42%. Note the direction: that made the benchmark **harder** for the policy
under test, since terminal causes are where `ABANDON` earns its advantage. The full
disclosure is in the [file header](src/core/simulator/params.ts).

### Other methodological choices

**Train/test split.** The timing estimator is fitted on a population from a different
seed than the one it is scored on. `assertDisjointSeeds()` refuses to run if they ever
match, so it is structural rather than a convention someone can quietly break.

**Common random numbers.** The world's randomness is seeded per (row, attempt), never
per policy. If B1 and B3 both re-present the same debit on the same day, they get the
same coin flip. Without this a large share of the gap between policies would be
sampling noise at this ledger size.

**The oracle is greedy, not optimal.** B4 sees every latent variable and takes the best
action available at each step, but it does not solve the multi-step scheduling problem
exactly. It is a very strong upper bound, not a mathematical one. Calling it "optimal"
would be an overclaim, and a benchmark integrity check warns if any policy exceeds it —
which caught a real bug during development, when an earlier B4 capped itself at three
retries while B3 was allowed five and duly came out at "107% of ceiling".

**Uniform probing is an idealisation.** Training observations come from probing retry
offsets uniformly. Real merchant history is whatever the old dunning system did, which
means it is heavily confounded toward days 1, 3 and 5. This makes the estimator's job
easier than reality would.

## Lane 2: disputes

Same ledger, same interface, different action set. Deliberately thin — nine
hand-authored cases, no simulator, no separate benchmark, and no quantitative claim.

The useful output is not the per-case win probability, it is the **systemic gap
report**: a merchant who learns that three cases were blocked for want of a 3DS log or
a cancellation record can fix that once, upstream, and stop losing them. A missing
mandatory artifact is modelled as a wall rather than a discount, because networks will
not review a representment without it — a proportional penalty would produce
confident-looking 40% estimates on cases that cannot be reviewed at all.

Visa **13.2 (Cancelled Recurring Transaction)** is the tie back to Lane 1, and it is
not a coincidence. It is literally a dispute about a recurring debit, and its
compelling evidence includes the signed mandate and proof the RBI pre-debit notice was
delivered — data Lane 1 already handles. That overlap is the argument for one ledger
rather than two teams with two tools.

## What I would build next

1. **Read the actual track brief.** Everything here is reasoned from the payments
   domain rather than from Razorpay's problem statement. This is the largest open risk.
2. **Verify the RBI figures against the primary circular**, not secondary reporting.
3. **Learn the classifier's ambiguous cases** instead of ruling them. `payment_failed`
   and `payment_declined` carry almost no information; a model over merchant-side
   features would beat the current rules on exactly those.
4. **Confounded training data.** Fit the estimator on realistically biased history and
   measure how much lift survives. I expect meaningfully less.
5. **A third source.** Refund abuse or unreconciled settlements, to demonstrate the
   architecture claim a second time.
6. **Per-customer nudge budgets.** B3's 1,330 nudges is the weakest number in the
   table and a real merchant would cap it.

## Repo layout

```
src/core/            zero React, zero Next
  taxonomy.ts        RootCause / RecoveryAction unions, real Razorpay codes
  ledger.ts          row schema, no runtime dependencies
  ledger-store.ts    SQLite, deliberately off the benchmark path
  classify.ts        raw code + context -> root cause (rules)
  simulator/
    params.ts        FROZEN before policy was written
    population.ts    customers with latent state
    environment.ts   the response model
  policy/
    timing.ts        the learned component
    engine.ts        B3, with the never check
    baselines.ts     B0, B1, B2, B4
  bench/             harness and metrics
  disputes/          Lane 2
src/app/             3 screens
scripts/             bench, seed, decide, disputes
results/benchmark.md generated
```

---

Built for the Razorpay Internship Program, Track 3: AI Revenue Recovery.
