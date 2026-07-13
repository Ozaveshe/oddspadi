# Affiliate readiness

OddsPadi's affiliate layer is deliberately dormant. Bare odds and bookmaker attribution remain visible, but no outbound bookmaker CTA renders unless a commercial tag **and** an explicitly approved country code are configured for that operator.

This is an engineering control, not a legal determination. Before enabling any operator-country pair, OddsPadi needs a signed affiliate agreement, written confirmation that the operator may accept customers and advertise in that market, review of the landing URL and tracking parameter, age-gating and responsible-play copy approval, and a documented owner and expiry/review date. Recheck the regulator's live operator register at launch and renewal; a global brand licence is not evidence of local permission.

## Activation checklist

1. Confirm the exact legal operator entity, trade name, licence number, permitted channel, territories and licence expiry with local counsel.
2. Confirm that affiliate publishing, odds comparison, deep linking, promotions and tracking cookies are permitted by the licence, agreement and local advertising rules.
3. Record the approved operator-country pairs. Supported launch codes are `NG`, `GH`, `KE` and `ZA`; an empty list means disabled.
4. Configure the server-only tag and markets variables documented in `.env.example`. Never expose contract credentials in `NEXT_PUBLIC_*` variables.
5. Test the destination, `rel="sponsored noopener"`, 18+ copy, consent-gated `affiliate_outbound_clicked` event, geo behaviour and bare-odds fallback.
6. Add a calendar review before each licence or agreement expiry and immediately disable a pair if its status becomes uncertain.

## Market-specific verification

- **Nigeria (`NG`)**: regulation and operator registers can be jurisdiction-specific. Confirm the visitor market and the relevant state or FCT authority rather than relying on a single national assumption. The [FCT Lottery Regulation Office](https://lro.abj.gov.ng/functions-of-the-commission/) describes licensing for online and retail sports betting in the FCT, while the [Oyo State Gaming Board](https://gamingboard.oyostate.gov.ng/sports-betting/) publishes its own sports-betting operator list.
- **Ghana (`GH`)**: verify the operator and current licence period against the [Gaming Commission of Ghana licensed-operators register](https://www.gamingcommission.gov.gh/licensed-operators/). The Commission also states that gaming marketing promotions may require a permit in its [official FAQ](https://www.gamingcommission.gov.gh/faqs/); obtain campaign-specific approval where applicable.
- **Kenya (`KE`)**: verify the current regulator, operator licence and advertising requirements. The official [Gambling Regulatory Authority / BCLB site](https://www.bclb.go.ke/) publishes licensing, operations, foreign-operator and advertising regulations; do not activate from an old operator list alone.
- **South Africa (`ZA`)**: verify the bookmaker's online-betting licence with the issuing Provincial Licensing Authority. The [National Gambling Board FAQ](https://www.ngb.org.za/faqs/) says legal online betting requires a South African bookmaker licensed by a provincial board and an 18+ customer; confirm the relevant province and digital-platform licence details.

## Environment contract

Each supported bookmaker has a tag variable and a comma-separated markets variable, for example:

```dotenv
ODDSPADI_AFFILIATE_BETWAY_TAG=contract-provided-value
ODDSPADI_AFFILIATE_BETWAY_MARKETS=GH,ZA
```

Both must be present. Unknown bookmaker keys, unsupported countries, blank tags and missing market approvals all resolve to `null`, leaving attributed odds with no outbound link. Bookmaker URL and query-parameter changes require a code review because affiliate programmes do not share one standard tag format.

## Trust rules

- Affiliate placement never changes model probabilities, pick selection, value gates or displayed losses.
- Copy says “View at {bookmaker}”, never “bet now”, “sure odds” or guaranteed-return language.
- The responsible-play line must remain adjacent to every active CTA.
- Commercial status must not suppress the bookmaker name on a genuinely sourced quote; attribution and monetisation are separate concerns.
