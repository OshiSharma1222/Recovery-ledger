# Day 1 research: real error codes and real regulatory constraints

Captured 2026-08-30. This file exists so that every "real" claim in the repo has a
traceable source, and so the README's *what is real vs what is simulated* table is
not something I have to reconstruct from memory on Day 5.

**Rule applied throughout: raw reason codes are quoted, never invented.** Root
causes and recovery actions are my own abstraction layer on top of them, and that
line is drawn explicitly in `src/core/taxonomy.ts`.

---

## 1. Razorpay e-mandate / recurring reason codes

Source: [Handle Errors — Recurring Payments (e-mandate)](https://razorpay.com/docs/payments/recurring-payments/emandate/errors/)

Razorpay splits these into two lifecycle stages, which matters: a code can mean
different things at registration than it does on a subsequent debit.

### 1.1 Registration-stage failures

`already_declined`, `authentication_failed`, `bank_account_invalid`,
`bank_account_validation_failed`, `bank_technical_error`, `card_expired`,
`card_number_invalid`, `debit_instrument_blocked`, `debit_instrument_inactive`,
`duplicate_request`, `gateway_technical_error`, `incorrect_card_expiry_date`,
`incorrect_cvv`, `incorrect_otp`, `incorrect_pin`, `insufficient_funds`,
`joint_account_not_allowed`, `otp_attempts_exceeded`, `payment_cancelled`,
`payment_failed`, `payment_pending_approval`, `payment_risk_check_failed`,
`payment_timed_out`, `server_error`, `transaction_limit_exceeded`,
`user_not_registered_for_netbanking`

### 1.2 Subsequent-payment failures — this is Lane 1's actual input

These are the codes that arrive on a failed recurring debit, so these are what the
classifier consumes:

| Code | Razorpay's stated retryability |
|---|---|
| `bank_account_invalid` | No — re-register |
| `bank_account_validation_failed` | Yes |
| `bank_technical_error` | Yes |
| `debit_instrument_blocked` | No — contact bank |
| `debit_instrument_inactive` | No — contact bank |
| `gateway_technical_error` | Yes |
| `incorrect_ifsc` | No — re-register |
| `input_validation_failed` | No — fix input |
| `insufficient_funds` | Yes |
| `invalid_amount` | No — fix input |
| `mandate_not_active` | No — re-register |
| `payment_cancelled` | Yes |
| `payment_declined` | Yes |
| `payment_failed` | Yes |
| `payment_mandate_not_active` | Yes — not yet active at bank |
| `payment_timed_out` | Yes |
| `server_error` | Yes |
| `transaction_limit_exceeded` | Yes |

**The observation the project is built on:** Razorpay's own "retryable" flag is
binary and time-free. It tells you *whether* to retry, never *when*. For
`insufficient_funds` — the single largest bucket — "yes, retryable" is almost
content-free advice, because the answer depends entirely on where in the
customer's pay cycle you present the debit. That gap is exactly what
`core/policy/timing.ts` is for.

Note also that `mandate_not_active` and `payment_mandate_not_active` are nearly
identical strings with opposite retryability. A dunning system that string-matches
on `mandate` gets this backwards. The classifier handles them separately.

## 2. Razorpay general payment error codes

Source: [List of Errors](https://razorpay.com/docs/errors/payments/list/)

Additional codes used in the taxonomy, drawn from the `BAD_REQUEST_ERROR` and
`GATEWAY_ERROR` tables:

- **Caps and limits:** `transaction_limit_exceeded`,
  `transaction_daily_limit_exceeded`, `transaction_daily_count_exceeded`,
  `transaction_frequency_limit_exceeded` ("NPCI frequency limit exhausted"),
  `mcc_amount_limit_exceeded`, `amount_less_than_minimum_amount`
- **Mandate lifecycle:** `mandate_creation_declined`, `mandate_creation_expired`,
  `mandate_creation_failed`, `mandate_creation_timeout`,
  `reqauth_mandate_not_acknowledged`, `funds_blocked_by_mandate`
- **Downtime:** `bank_not_available`, `bank_cutoff_in_progress`,
  `issuer_technical_error`, `psp_not_available`, `psp_app_not_available`,
  `upi_app_technical_error`, `payment_declined_due_to_high_traffic`
- **Ambiguous decline:** `payment_declined`, `payment_failed`, `debit_declined`,
  `card_declined`
- **Risk:** `payment_risk_check_failed`, `compliance_violation`

`bank_cutoff_in_progress` is worth calling out: core banking systems have a nightly
cutoff window during which debits simply cannot be processed. It is a downtime
class with a *predictable schedule*, which is the cheapest possible win for a
timing-aware policy and invisible to a fixed day-1/3/5 schedule.

## 3. UPI-specific codes

Source: [UPI Error Codes](https://razorpay.com/docs/errors/payments/upi/)

`bank_technical_error`, `credit_failed`, `gateway_technical_error`,
`insufficient_funds`, `invalid_vpa`, `payment_cancelled`,
`payment_collect_request_expired`, `payment_declined`, `payment_timed_out`,
`vpa_resolution_failed`

Underlying NPCI codes surface in dashboards and are useful context, though the
Razorpay API abstracts most of them: `Z9` (insufficient funds), `Z8` (per
transaction limit exceeded), `Z7` (frequency limit), `U28` / `U30` (bank down or
debit failure), `U69` (collect expired).

## 4. RBI e-mandate framework

Sourced from public reporting and law-firm summaries of the RBI directions on
recurring digital transactions — see links below. **These figures have been revised
more than once. Verify against the RBI circular itself before quoting a number in
the video or the README** (this is open item 14.3 in the plan and is still open).

What the simulator models:

| Constraint | Value modelled | Why it creates a failure class |
|---|---|---|
| Pre-debit notification | At least **24 hours** before debit; must carry merchant name, amount, date/time, mandate reference and reason | If the notice does not land, the debit is not eligible. The fix is to re-send and re-present, not to retry harder. |
| AFA on first transaction | Always required at registration | Registration failures are a distinct population from debit failures |
| AFA exemption ceiling | **₹15,000** per transaction | Above it, every debit needs AFA, materially raising the failure rate |
| Higher ceiling | **₹1,00,000** for insurance premiums, mutual fund subscriptions, credit card bills | Amount alone does not determine AFA — product category does too |
| Per-mandate amount cap | Set by customer at registration | A debit above the cap fails **forever** at that amount. Retrying is structurally guaranteed to fail. |
| Mandate expiry | Set at registration | After expiry, no debit succeeds regardless of balance |
| Post-transaction notification | Required, with grievance redressal info | Not modelled — no bearing on recovery |

These are encoded in `src/core/simulator/params.ts` under the `RBI` constant.

### Why this matters more than it looks

Three of these — the amount cap, mandate expiry, and revocation — produce failures
where **the success probability is identically zero at every future point in time**.
No retry schedule recovers them. A day-1/3/5 dunning system spends three attempts
on each one and recovers nothing, every time, forever.

That is the quantitative case for the `ABANDON` action, and it is why the benchmark
reports *wasted attempts* as a first-class metric rather than only recovery rate.

## 5. Still open (plan section 14)

1. **The actual track brief has not been read.** Everything here is reasoned from
   the payments domain. Read it and adjust before Day 5.
2. Verify the RBI figures against the primary circular, not secondary reporting.
3. Submission mechanics: repo visibility, video hosting, deadline in IST.

## Sources

- [Handle Errors — Recurring Payments (e-mandate) | Razorpay Docs](https://razorpay.com/docs/payments/recurring-payments/emandate/errors/)
- [List of Errors | Razorpay Docs](https://razorpay.com/docs/errors/payments/list/)
- [UPI Error Codes | Razorpay Docs](https://razorpay.com/docs/errors/payments/upi/)
- [UPI Autopay | Razorpay Docs](https://razorpay.com/docs/payments/payment-gateway/s2s-integration/recurring-payments/upi/)
- [RBI's Digital Payments E-Mandate Framework — Conventus Law](https://conventuslaw.com/report/rbis-digital-payments-e-mandate-framework-2026-consolidated-directions-for-recurring-digital-transactions/)
- [New RBI Rules: Digital Payments E-Mandate Framework — Economic Law Practice](https://economiclawspractice.com/new-rbi-rules-2026-complete-guide-to-digital-payments-e-mandate-framework-for-cards-upi-ppis/)
- [RBI Guidelines on E-mandates for recurring transactions — NovoJuris](https://www.novojuris.com/thought-leadership/rbi-guidelines-on-e-mandates-for-recurring-transaction.html)
- [UPI autopay revocations hit 20mn per month on low customer balance — Business Standard](https://www.business-standard.com/amp/finance/news/upi-autopay-revocations-hit-20-mn-monthly-over-low-customer-balances-125090700500_1.html)
