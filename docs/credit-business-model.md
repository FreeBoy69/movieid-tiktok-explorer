# AutoYT credit business model

Research checked 26 September 2026. Public plan details change often; recheck the linked pages before publishing comparisons or changing customer prices.

## Competitor patterns

| Product | Verified public pattern | What it suggests for AutoYT |
| --- | --- | --- |
| [Higgsfield](https://higgsfield.ai/pricing) | Sells tiered subscriptions for AI media creation; its public pricing page describes credit-based plans and unlimited access to selected tools. | Package access to a creative workflow, while charging expensive models by measured use. “Unlimited” must have a clearly defined scope. |
| [Runway](https://runway.com/pricing) | Monthly plan credits; model, duration, and resolution affect consumption. Free users get a one-time 125-credit deposit. Paid users can buy extra credits; the page distinguishes monthly-credit rollover from purchased-credit expiry. | Show model-specific prices before generation, make renewal rules clear, and add separately purchased credits only after payment settlement is integrated. |
| [Pika](https://pika.art/pricing) | Monthly credit allowances, credit packs, and model-specific generation costs are presented alongside plans. Commercial-license access differs by tier. | Keep a transparent credit schedule and sell more credits to users who exhaust their allowance. |
| [Artlist](https://artlist.io/page/pricing/max) | The official pricing page returned HTTP 403 during this review. | No current Artlist price or credit claim is used in our decisions until it can be verified directly. |

These are observable pricing mechanics, not evidence of any competitor's actual profit or provider contracts.

## AutoYT decisions

1. Keep credits as the customer-facing unit. One credit remains 100 internal cost tokens, currently about $0.0001 of metered provider cost. This makes expensive models spend more credits without maintaining a separate fixed price for every model.
2. Keep the current Free, Creator, Pro, and Studio prices unchanged pending live usage review. Existing prices were seeded assumptions, not market-validated package prices.
3. In Admin Billing, show each plan's actual attributed provider spend over 30 days, flag estimated provider costs, and show a target price floor. The floor assumes full allowance usage, a 50% gross margin target, and a 10% revenue reserve for other variable costs. It is advice for review, not an automatic repricing action.
4. Treat listed plan value as potential recurring revenue, not collected revenue. The Paystack order ledger records verified payments separately.
5. Paystack checkout supports USD card purchases for a month of a paid plan and three credit packs. The server quotes the price, verifies the transaction reference, amount, currency, and customer email against Paystack, and grants credits through an idempotent database claim. Subscription credits expire at the end of the paid month. Customers pay again to renew; automatic recurring billing is not yet enabled.
6. Before live launch, configure a Kenyan Paystack merchant account with international card payments, apply migration `0010_paystack_billing.sql`, set `PAYSTACK_SECRET_KEY` and `APP_PUBLIC_URL`, and configure the signed webhook at `/api/billing/paystack/webhook`. Set `PAYSTACK_WEBHOOK_READY=1` only after the webhook is registered. Test a live low-value payment and refund reconciliation. Never grant paid credits from a browser success redirect alone.

## Simple investor example

The $25 pack grants 100,000 credits. At the current conversion, spending every credit costs AutoYT about $10 in AI provider fees. Paystack lists a 3.8% international-card fee for Kenyan merchants, or about $0.95 on a $25 US card payment. That leaves about $14.05 before storage, servers, support, refunds, and tax. This is an illustrative contribution calculation, not audited profit.

Paystack sources: [Kenya pricing and USD settlement](https://paystack.com/ke/pricing), [payment channels](https://paystack.com/docs/payments/payment-channels/), [subscriptions](https://paystack.com/docs/payments/subscriptions/). The public payment-channel list does not currently show Google Pay. Paystack can charge US-issued cards, but a Kenya merchant must have international payments enabled and US cards can still be declined by the issuer.

## Monthly operating review

For each plan, compare collected revenue, provider spend, estimated-cost share, infrastructure and storage allocation, payment fees, support cost, and refunds. Segment by heavy video users as well as median users. A pricing change should be reviewed against both full-allowance cost and observed usage before it affects existing subscribers.
