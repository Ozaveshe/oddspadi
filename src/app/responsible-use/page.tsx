import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo/pageMetadata";

export const metadata: Metadata = pageMetadata({
  title: "Responsible Use — Risk, Limits and Support",
  description:
    "OddsPadi publishes probabilities, not guarantees. Age limits, honest risk guidance, and support organisations across Nigeria, Ghana, Kenya, South Africa and internationally.",
  path: "/responsible-use",
  socialTitle: "Responsible use — OddsPadi",
  socialDescription: "Probabilities are not guarantees. Know the risk, set limits, and find support near you."
});

/**
 * Support organisations, grouped by where the reader is.
 *
 * The site previously linked only BeGambleAware, a service for Great Britain,
 * on a product whose first audience is West Africa. Someone in Lagos following
 * that link finds help they cannot use.
 *
 * Deliberately no phone numbers: helpline numbers change, and a wrong number
 * at the moment someone reaches for it is worse than no number at all. Each
 * entry links to the organisation, which publishes its own current contacts.
 */
const SUPPORT_BY_REGION: Array<{
  region: string;
  entries: Array<{ name: string; href: string; note: string }>;
}> = [
  {
    region: "International",
    entries: [
      {
        name: "Gambling Therapy",
        href: "https://www.gamblingtherapy.org/",
        note: "Free online support in multiple languages, available worldwide."
      },
      {
        name: "Gamblers Anonymous",
        href: "https://www.gamblersanonymous.org/ga/locations",
        note: "Peer support groups; the locations page lists chapters by country."
      }
    ]
  },
  {
    region: "South Africa",
    entries: [
      {
        name: "National Responsible Gambling Programme",
        href: "https://www.responsiblegambling.org.za/",
        note: "Free counselling and treatment referrals, funded across the South African industry."
      }
    ]
  },
  {
    region: "Nigeria",
    entries: [
      {
        name: "Mentally Aware Nigeria Initiative (MANI)",
        href: "https://mentallyaware.org/",
        note: "Nigerian mental-health support. Not gambling-specific, but a route to help with the distress that can come with it."
      }
    ]
  },
  {
    region: "Ghana, Kenya and elsewhere in Africa",
    entries: [
      {
        name: "Gambling Therapy (global service)",
        href: "https://www.gamblingtherapy.org/",
        note: "Where no national gambling-specific service is easily reachable, this international service accepts anyone."
      }
    ]
  },
  {
    region: "United Kingdom",
    entries: [
      {
        name: "BeGambleAware",
        href: "https://www.begambleaware.org/",
        note: "Free, confidential support for people in Great Britain."
      }
    ]
  }
];

export default function ResponsibleUsePage() {
  return (
    <main id="main" className="container responsible-use">
      <div className="page-heading">
        <span className="section-kicker">Responsible use</span>
        <h1>Probabilities are not <span className="accent">guarantees</span></h1>
        <p>
          OddsPadi is an analysis product. It estimates how likely an outcome is, shows the evidence behind that
          estimate, and says plainly when the evidence is not good enough. It cannot tell you what will happen, and no
          model removes the risk of losing money.
        </p>
      </div>

      <section className="section" aria-labelledby="ru-what-heading">
        <div className="section-title"><div><span className="section-kicker">What a probability means</span><h2 id="ru-what-heading">A 70% read is not a win</h2></div></div>
        <p className="muted">
          If OddsPadi says an outcome is 70% likely and the model is well calibrated, that outcome should fail roughly
          three times in every ten. A run of losses inside a well-calibrated model is normal, not evidence that
          something is broken — and a run of wins is not proof that anything works. This is why the{" "}
          <Link className="text-link" href="/track-record">track record</Link> reports sample sizes and confidence
          intervals rather than a headline percentage.
        </p>
      </section>

      <section className="section" aria-labelledby="ru-age-heading">
        <div className="section-title"><div><span className="section-kicker">Age</span><h2 id="ru-age-heading">18+, and higher in some places</h2></div></div>
        <p className="muted">
          OddsPadi is intended for adults aged 18 or over. Some countries and states set the age higher, and some
          prohibit sports betting entirely. Betting law is local: it is your responsibility to know what applies where
          you are. OddsPadi does not accept bets, does not hold money, and is not a bookmaker.
        </p>
      </section>

      <section className="section" aria-labelledby="ru-limits-heading">
        <div className="section-title"><div><span className="section-kicker">Staying in control</span><h2 id="ru-limits-heading">Signs worth taking seriously</h2></div></div>
        <ul className="muted responsible-use-list">
          <li><strong>Chasing losses.</strong> Staking more to win back what you lost is the single most reliable way to lose more. A losing run does not make the next outcome more likely.</li>
          <li><strong>Money you need.</strong> If a stake would affect rent, food, school fees or a debt, it is not spare money.</li>
          <li><strong>Borrowing to bet</strong>, or hiding what you have staked from people close to you.</li>
          <li><strong>Betting to feel better</strong>, rather than because you found something you think is mispriced.</li>
          <li><strong>Losing time.</strong> Missing work, sleep or people because of it.</li>
        </ul>
        <p className="muted small">
          Set a limit before you look at a card, not after. Decide the amount you are willing to lose for the week and
          treat it as spent the moment you stake it.
        </p>
      </section>

      <section className="section" aria-labelledby="ru-support-heading">
        <div className="section-title"><div><span className="section-kicker">Support</span><h2 id="ru-support-heading">Where to find help</h2></div></div>
        <p className="muted small">
          We link to organisations rather than printing helpline numbers: numbers change, and a wrong number at the
          moment you reach for it is worse than none. Each organisation publishes its current contact details.
        </p>
        <div className="responsible-use-support">
          {SUPPORT_BY_REGION.map((group) => (
            <div className="responsible-use-region" key={group.region}>
              <h3>{group.region}</h3>
              <ul>
                {group.entries.map((entry) => (
                  <li key={entry.href + entry.name}>
                    <a href={entry.href} target="_blank" rel="noreferrer noopener">{entry.name}</a>
                    <span className="muted small">{entry.note}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="muted small">
          OddsPadi is not affiliated with these organisations and cannot provide counselling. If you are in immediate
          distress, contact your local emergency services or a health professional.
        </p>
      </section>

      <section className="section" aria-labelledby="ru-controls-heading">
        <div className="section-title"><div><span className="section-kicker">Your controls</span><h2 id="ru-controls-heading">What you can turn off</h2></div></div>
        <p className="muted">
          Matchday notifications are opt-in and can be switched off at any time from{" "}
          <Link className="text-link" href="/account">your account</Link>. Saved fixtures and the Bet Workspace are
          stored on your own device and can be cleared from <Link className="text-link" href="/my">My Padi</Link>{" "}
          without an account. Analytics is consent-based; declining it does not limit anything on the site.
        </p>
      </section>
    </main>
  );
}
