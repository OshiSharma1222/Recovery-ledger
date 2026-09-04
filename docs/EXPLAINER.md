# Recovery Ledger, explained in plain words

Read this once and you can explain the whole project without notes.

## The one-liner

> When a subscription payment fails, most companies just retry it blindly.
> This project first asks WHY it failed, then does the one thing that can
> actually fix it, and, when nothing can, it stops wasting everyone's time.

## The story, in five sentences

1. In India, subscription payments (UPI Autopay, e-mandates, cards) fail all
   the time, and a failed payment is money the business has earned but not
   received.
2. Most billing systems handle every failure the same way: retry on day 1,
   day 3, day 5, and hope.
3. But failures have very different reasons. "Not enough balance" is fixed by
   waiting for payday. An "expired mandate" can NEVER be fixed by retrying,
   only by asking the customer to re-approve it.
4. This project reads the failure reason, picks the right fix for each one,
   and, for the roughly 25% of money that nothing can bring back, it stops
   and spends its effort elsewhere.
5. To prove it works, six strategies compete on the same set of failed
   payments, and this one recovers 37% more money than the standard schedule
   while bothering customers less.

## What the numbers mean

| you will see | it means |
|---|---|
| ₹72.57L at risk | the total stuck money in the test |
| ₹51.89L / 71.5% | what this project got back |
| +36.9% | how much more it got back than the day-1/3/5 schedule |
| +23.1% vs smart timing | the gain that comes purely from understanding WHY payments fail, since that comparison strategy already retries at perfect times |
| 95.9% of winnable | a "cheating" strategy that can see everything, even customers' real bank balances, only got ₹54.12L; this project got 95.9% of that |
| Dead tries: 338 vs 681 | retries wasted on payments that could never succeed; half of what the blind schedule wastes |
| 321 messages | texts and emails sent to customers, capped at 2 per person |
| 20 / 20 seeds | the test was re-run on 20 fresh random worlds and this project won every time |

## What each screen shows

- **Home**: the pitch, the four steps, and live decisions from the engine.
- **Ledger**: the list of stuck money. One row per failed payment or dispute.
  Click a row: what the bank said, what it really means, what we did, why.
- **Replay**: press play and watch 45 days pass. Grey bar is the old way,
  green bar is this project. The gap is the point.
- **Benchmark**: the full scoreboard of all six strategies with every cost
  counted, including the ones where this project loses (it is slower, and it
  sends messages where the schedules send none).

## The party trick

Add `?seed=anyword` to any page URL. The entire test world regenerates around
that word, every number changes, and this project still wins. That is the
proof nothing is hardcoded. In the terminal, `npm run bench` prints the same
scoreboard in about a second.

## The 30-second pitch (say this)

"Failed subscription payments cost Indian merchants real money, and most
billing systems retry them blindly on a fixed schedule. Recovery Ledger reads
the failure reason first. Balance problem? Retry right after payday. Expired
mandate? A retry can never work, so ask the customer to renew instead.
Nothing can work? Stop, and spend the effort where money can actually come
back. On a seeded benchmark it recovers 37% more than standard dunning with
half the wasted retries, and you can reproduce every number on your laptop
with one command."

## The 2-minute version (structure)

1. Problem: subscription payment failures in India are structural. RBI
   e-mandate rules add failure types that do not exist elsewhere: amount
   caps, mandate expiry, a required pre-debit notice. (20s)
2. Insight: recovery is a resource allocation problem. The hard part is
   knowing what NOT to chase. About a quarter of failed money is
   unrecoverable by any retry. (20s)
3. What I built: one ledger for every stuck rupee, a classifier that reads
   the real Razorpay failure codes, a decision engine with an ABANDON action,
   and a timing model learned from history. Disputes flow through the same
   ledger, which shows the design extends. (30s)
4. Proof: six strategies, same world, same budget. Show the benchmark table
   or the replay race. Name the honest costs too: slower, and it messages
   customers. (30s)
5. Honesty: the world is simulated and I authored it, but the parameters
   were frozen in a commit before any policy code existed, and the result
   holds across 20 fresh seeds. (20s)

## Plain answers to hard questions

**"Where is the AI?"**
Three layers, each the smallest tool that works. Rules translate bank codes,
because that is a dictionary, not a learning problem. A learned probability
model picks retry timing, because that genuinely varies by customer and day.
An LLM drafts dispute letters, because that is a writing problem. A payment
retry must be auditable to the rupee, so I do not put a chatbot in that loop,
and I will defend that choice.

**"How is this different from Razorpay's own smart retries?"**
Smart retries answer WHEN to retry. This also answers WHETHER and WHAT
ELSE. I built a smart-timing strategy with the exact same timing model as a
baseline; understanding causes still beats it by 23%, using 39% fewer tries.

**"Is this real data?"**
The failure codes, RBI rules and dispute codes are real. The customers are
simulated, and I say so on the benchmark page itself. The simulator's
parameters were frozen and committed before the policy engine was written,
so the test could not be quietly tuned to flatter the result.

**"Why should the business stop chasing money?"**
Because a quarter of it is unrecoverable by construction. An expired mandate
fails 100% of retries forever. Every retry spent there is a retry not spent
on a payment that would have succeeded tomorrow, plus an annoyed customer.
Stopping is not giving up; it is reallocating.

**"What would you do next?"**
Verify the RBI figures against the primary circular, learn the ambiguous
code mappings from data instead of rules, respect per-rail retry caps, and
plug in a third money source like refund abuse to prove the ledger extends.
