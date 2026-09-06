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
| B0 | No recovery | ₹0 | 0.0% | 0.0% | 0 | 0 | - | 0 | 0.0 |
| B1 | Fixed retry (days 1/3/5) | ₹37.89L | 52.2% | 70.0% | 1,970 | 681 | 4.16 | 0 | 2.0 |
| B2 | Exponential backoff | ₹40.26L | 55.5% | 74.4% | 2,397 | 908 | 4.76 | 0 | 2.1 |
| B2T | Smart timing, cause-blind | ₹42.13L | 58.1% | 77.9% | 2,236 | 908 | 4.30 | 0 | 7.8 |
| **B3** | **Recovery Ledger** | **₹51.89L** | **71.5%** | **95.9%** | **1,369** | **338** | **2.23** | **321** | **5.3** |
| B4 | Oracle (ceiling) | ₹54.12L | 74.6% | 100.0% | 1,267 | 280 | 1.96 | 509 | 4.5 |

Against the fixed day-1/3/5 schedule, the Recovery Ledger recovers **+36.9% more
money** while spending **30.5% fewer retries** and **50.4% fewer attempts on rows
that could never have been recovered**. Against a smart-retry policy that uses the
same learned timing model but no cause classification (B2T, see below), it still
recovers **+23.1% more**. It captures **95.9%** of what a policy with perfect
knowledge of every latent variable managed.

Where it loses, reported rather than buried: B3 takes 5.3 days per recovery against
B1's 2.0, and it contacts customers 321 times where the dumb schedules send nothing.
Customer contact is capped at two messages per case by policy, which costs a little
recovery and buys a lot of goodwill; the uncapped variant recovered 1.2% more while
sending four times the messages, and that trade is the wrong one.

## Reproduce it

```bash
npm install
npm run bench
```

One command. Seeded end to end, so the numbers above are byte-identical on your
machine. **No API key. No database. No network.** The benchmark path deliberately
has no native dependency; delete `node_modules/better-sqlite3` and it still runs.

```bash
npm run bench:sweep        # the same benchmark over 20 unseen seeds
npm test                   # 60 tests
npm run seed               # generate a population, write the ledger to SQLite
npm run decide             # classify one row, show the chosen action and why
npm run disputes           # Lane 2: evidence gaps, contest or walk away
npm run dev                # dashboard: home, ledger, replay, benchmark
npm run prove:exhaustive   # watch the compiler reject an unhandled failure cause
npm run build:verify       # production build check, safe while npm run dev is running
npm run dev:clean          # dev server from a wiped .next, fixes a wedged server
```

### Not a recording, not hardcoded

Every figure on the dashboard is computed at request time by running the simulator,
the classifier and all six policies. To verify that live, hand the dashboard a world
it has never seen:

```
http://localhost:3000/benchmark?seed=any-words-you-like
```

Or use the box on the ledger, replay and benchmark screens: type any word, press
Run, and watch every number rebuild. The population, the failures and every number
on every screen recompute for that world, and the ranking holds. `npm run bench -- --seed=x`
does the same in the terminal, and `/replay` plays the 90-day recovery race day by
day so you can watch rows resolve instead of reading a table.

## The insight

Recurring payments in India fail far more often than in card-first markets, and the
reasons are structural rather than behavioural. UPI Autopay and e-mandate debits
fail on mandate lifecycle events, not just balance. The RBI e-mandate framework adds
failure classes that do not exist elsewhere: a pre-debit notification before each
debit, a per-mandate amount cap, a mandate expiry date, and additional-factor
authentication above a threshold.

Most dunning systems collapse every failure into one bucket and retry on a
schedule. That is the gap:

- Retrying an **expired mandate** five times recovers nothing and burns five attempts.
- Retrying a **cap-exceeded** debit at the same amount fails forever *by construction*.
- Retrying an **insufficient-funds** failure two days before payday is close to a
  coin flip; one day after is close to a sure thing.

**26% of this ledger is structurally unrecoverable.** For those rows the probability
of success is identically zero at every offset, for every policy, forever. A
schedule spends attempts on each of them every cycle and recovers nothing. That is
the quantitative case for the `ABANDON` action, and it is why the benchmark reports
*wasted attempts* as a first-class metric.

## How is this different from smart-retry products?

Commercial dunning products (Stripe Smart Retries, and retry optimisation in
gateways generally) learn *when* to retry. B2T is that policy, built from this
project's own parts: it uses the identical learned timing model B3 uses, picks the
best remaining window for every retry, and treats every failure the same way.

It recovers ₹42.13L. B3 recovers ₹51.89L, a **+23.1%** gap, while spending 39%
fewer retries. The entire difference is cause-awareness and bounded recovery:
knowing that a quarter of the ledger cannot be retried back to life, renewing
mandates instead of re-presenting into them, splitting cap-breached amounts, and
walking away from the rest. Timing is necessary; it is not sufficient. That gap is
the project's contribution, isolated as a single number.

## Where is the AI?

Deliberately layered, and stated plainly rather than dressed up:

- **Rules** map raw gateway codes to root causes. This is a mapping, not learning,
  and the file says so. Reviewers can tell, so pretending otherwise costs more than
  it buys.
- **Learned**: the retry-timing model, P(success | cause, segment, day), fitted on
  simulated outcome history. This is where the lift over schedules comes from, and
  it is interpretable enough to answer "why did you retry on the 3rd" directly.
- **LLM**: representment drafting in Lane 2, behind an explicit `--live` flag with
  a prompt-hash cache, so the repo runs end to end with no API key. Every draft is
  labelled MODEL, CACHE or TEMPLATE, and template output is never presented as
  model output.

A retry decision runs thousands of times a day and must be auditable to the rupee;
a prompt chain is the wrong tool for that layer and the right tool for the prose
layer. Using the smallest adequate model at each layer is the design position, and
I will defend it over "LLM everywhere" in any review.

## Failure taxonomy

Raw reason codes are quoted from Razorpay's published documentation, never
invented. Root causes and recovery actions are my abstraction on top of them, and
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
than a lookup. `mandate_not_active` means either *expired* or *revoked*, and those
demand opposite actions. `payment_failed` is emitted by three unrelated causes. The
classifier disambiguates using the merchant's **own mandate record**: cap and
expiry are not hidden data, the merchant registered the mandate. The uncomfortable
observation is that most dunning stacks never join that record to the retry
decision.

Measured classifier accuracy against ground truth: **96.3%**. Not 100%, and it
should not be; the residual is real ambiguity in the code space.

### The compiler proves every cause has an action

`RootCause` is a discriminated union, and the policy engine's switch ends in an
`assertNever` default. Adding a failure cause without deciding what to do about it
is a **build error**, not a production incident. Verify it yourself:

```bash
npm run prove:exhaustive
```

It adds an unhandled variant and shows `tsc` rejecting it at every site that must
have an opinion about a cause. This is a real language guarantee, not a claim.

## Architecture

Pitch deck: [docs/pitch.html](docs/pitch.html) and video script with timer:
[docs/script.html](docs/script.html), both open in a browser. Plain-words walkthrough: [docs/EXPLAINER.md](docs/EXPLAINER.md). Full architecture: [docs/DESIGN.md](docs/DESIGN.md).

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
                 [ Benchmark harness ]       policy vs 5 baselines
```

One Next.js app. The single structural rule: **nothing in `src/core/` imports
React.** A third recovery source (refund abuse, unreconciled settlements) drops in
by producing `LedgerRow`s with a new `source`. Lane 2 is the proof: adding disputes
required no change to `ledger.ts` at all.

## Robustness

The committed benchmark uses one seed. `npm run bench:sweep` re-runs everything on
20 seeds the code has never been tuned against:

| | min | median | max |
|---|---:|---:|---:|
| lift vs fixed schedule | +12.4% | +33.9% | +40.5% |
| lift vs smart timing | +5.5% | +16.9% | +28.6% |
| share of oracle ceiling | 90.5% | 96.3% | 98.7% |

B3 wins on every one of the 20 seeds, against every baseline. The full per-seed
table is written to [results/robustness.md](results/robustness.md). Note what this
does and does not show: the ranking is not an artifact of a lucky draw, but the
simulator parameters are the same in every run, so the authored-world limitation
below stands in full.

## What is real vs what is simulated

The highest-credibility section in this repo, and the line most submissions blur.

| | status |
|---|---|
| Razorpay reason code strings | **Real.** Quoted from published docs; see [docs/RESEARCH.md](docs/RESEARCH.md) |
| Visa VCR / Mastercard dispute codes | **Real.** Verify against current Core Rules before quoting on camera |
| RBI e-mandate constraints (24h notice, ₹15,000 AFA ceiling, ₹1,00,000 for insurance/MF/card bills) | **Real**, from public reporting on the RBI directions. Not from the circular itself; verify before quoting a figure |
| Mapping raw code to root cause | **My abstraction.** Rules, not ML, and the file says so |
| Timing estimator | **Learned**, from simulated outcome history |
| Customer population, balance curves, downtime, responsiveness | **Simulated.** Authored by me |
| Response model (does action A at time t succeed?) | **Simulated.** Authored by me, frozen before the policy existed |
| Dispute cases | **Hand-authored.** Nine cases, chosen to exercise every branch |
| Dispute win-rate priors, evidence weights, filing costs | **Stated assumptions**, not measurements. The engine's contribution is the decision procedure; a merchant would substitute their own numbers |
| Representment letters | **Template** unless run with `--live` and an API key. Every draft is labelled with its source |
| Recovery rates, lift, ceiling capture | **Measured** against the simulator, not against production |

### The limitation, stated plainly

> The simulator's response model is authored by me, so this benchmark measures
> policy quality against **a stated model of the world, not against production
> reality**. The simulator parameters were frozen and committed before the policy
> engine was written; see commit
> [`551c340`](../../commit/551c340b3069305e4b6373db73ede8019a6cb471).

Verify that ordering yourself:

```bash
git log --follow --oneline -- src/core/simulator/params.ts
```

That file should have **exactly one commit**, and it should be an ancestor of the
first commit touching `src/core/policy/`. If `params.ts` were edited after the
policy engine landed, the benchmark would be void and you could see that in ten
seconds.

One calibration pass was made *before* the freeze, while `policy/` was still an
empty directory, because the first draft's cause mix did not resemble Indian
recurring payments. It cut terminal causes from 36.9% to 22% and raised
insufficient-funds from 17% to 42%. Note the direction: that made the benchmark
**harder** for the policy under test, since terminal causes are where `ABANDON`
earns its advantage. The full disclosure is in the
[file header](src/core/simulator/params.ts).

### Other methodological choices

**Train/test split.** The timing estimator is fitted on a population from a
different seed than the one it is scored on. `assertDisjointSeeds()` refuses to run
if they ever match, so it is structural rather than a convention someone can
quietly break.

**Common random numbers.** The world's randomness is seeded per (row, attempt),
never per policy. If two policies re-present the same debit on the same day, they
get the same coin flip. Without this a large share of the gap between policies
would be sampling noise at this ledger size.

**The oracle is greedy, not optimal.** B4 sees every latent variable and takes the
best action available at each step, but it does not solve the multi-step scheduling
problem exactly. It is a very strong upper bound, not a mathematical one. A
benchmark integrity check warns if any policy exceeds it, and that check caught a
real bug during development: an earlier B4 capped itself at three retries while B3
was allowed five, and B3 duly came out at "107% of ceiling".

**Known simplifications.** The attempt budget of six per row is generous; NPCI and
network rules cap re-presentment more tightly on some rails, and a production
policy would take the rail's cap as a constraint input. Training observations come
from probing retry offsets uniformly, while real merchant history is confounded
toward whatever the old dunning system did, which makes the estimator's job easier
here than it would be in production.

## Lane 2: disputes

Same ledger, same interface, different action set. Deliberately thin: nine
hand-authored cases, no simulator, no separate benchmark, and no quantitative
claim. Win-rate priors, evidence weights and filing costs are stated assumptions,
labelled as such in the output; what Lane 2 demonstrates is the decision procedure,
not the numbers.

The useful output is not the per-case win probability, it is the **systemic gap
report**: a merchant who learns that three cases were blocked for want of a 3DS log
or a cancellation record can fix that once, upstream, and stop losing them. A
missing mandatory artifact is modelled as a wall rather than a discount, because
networks will not review a representment without it.

Visa **13.2 (Cancelled Recurring Transaction)** is the tie back to Lane 1, and it
is not a coincidence. It is literally a dispute about a recurring debit, and its
compelling evidence includes the signed mandate and proof the RBI pre-debit notice
was delivered, which is data Lane 1 already handles. That overlap is the argument
for one ledger rather than two teams with two tools.

## What I would build next

1. **Verify the RBI figures against the primary circular**, not secondary reporting.
2. **Learn the classifier's ambiguous cases** instead of ruling them.
   `payment_failed` and `payment_declined` carry almost no information; a model
   over merchant-side features would beat the current rules on exactly those.
3. **Confounded training data.** Fit the estimator on realistically biased history
   and measure how much lift survives. I expect meaningfully less.
4. **Rail-aware attempt caps.** Take each rail's re-presentment limit as a policy
   constraint instead of one global budget.
5. **A third source.** Refund abuse or unreconciled settlements, to demonstrate the
   architecture claim a second time.

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
    engine.ts        B3, with the never check and the contact cap
    baselines.ts     B0, B1, B2, B2T, B4
  bench/             harness, metrics, robustness sweep
  disputes/          Lane 2
src/app/             ledger, row detail, replay, benchmark
scripts/             bench, seed, decide, disputes
results/             benchmark.md and robustness.md, generated
```

---

