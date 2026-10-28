import { PREAPPROVED, type QuoteParams, type ScreenFlag, type ServiceId, type Settings } from "./types";

function has(text: string, re: RegExp): boolean {
  return re.test(text);
}

/**
 * License screen. Pre-approved services pass unless the description drifts
 * into a licensed trade, or pre-1978 painting while RRP certified is off.
 * Prices are never decided here.
 */
export function classify(
  id: ServiceId,
  desc: string,
  p: QuoteParams,
  est: number,
  settings: Pick<Settings, "rrpCertified" | "builderThreshold">,
): ScreenFlag {
  const t = desc.toLowerCase();
  const rrp = settings.rrpCertified;
  const threshold = settings.builderThreshold;

  if (has(t, /(furnace|hvac|air condition|\bac unit|duct|gas line|gas pipe|boiler|propane|gas fireplace|water heater)/)) {
    return {
      level: "refer",
      trade: "Mechanical / fuel gas (HVAC)",
      why: "Heating, cooling, ductwork and gas piping need a licensed mechanical contractor.",
      rule: "Skilled Trades Regulation Act, art. 8 (MCL 339.5807); LARA mechanical permit page",
    };
  }

  if (
    has(t, /(outlet|receptacle|rewir|wiring|breaker|electrical panel|light fixture|ceiling fan|light switch|gfci|circuit|hardwir)/) ||
    (id === "tv" && p.conceal === "power")
  ) {
    if (has(t, /(breaker|panel|circuit|rewir|add an outlet|new outlet|move an outlet|move the outlet|run power)/)) {
      return {
        level: "refer",
        trade: "Electrical",
        why: "New or moved wiring, circuits or panel work needs a licensed electrical contractor and permit.",
        rule: "Skilled Trades Regulation Act, art. 7 (MCL 339.5737)",
      };
    }
    return {
      level: "review",
      trade: "Electrical (possible minor repair)",
      why: "A like-for-like swap may fall under the 'minor repair work' exemption (electrical wiring worth $100 or less). The owner confirms or refers out.",
      rule: "MCL 339.5703(c) 'minor repair work'; MCL 339.5737",
    };
  }

  if (has(t, /(faucet|toilet|sink|drain|pipe|plumb|shower valve|garbage disposal|sump|water line)/)) {
    if (has(t, /(re-?pipe|new line|move|relocat|add a|sewer|water line|shower valve)/)) {
      return {
        level: "refer",
        trade: "Plumbing",
        why: "Changes to the plumbing system need a licensed plumber and permit.",
        rule: "Skilled Trades Regulation Act, art. 11 (MCL 339.6107)",
      };
    }
    return {
      level: "review",
      trade: "Plumbing (possible minor repair)",
      why: "Replacing a faucet or valve with no change to the plumbing system is 'minor repair' and doesn't need a plumbing license, unless it's part of a larger renovation. The owner confirms.",
      rule: "MCL 339.6103(b) and 339.6107(2)(a)",
    };
  }

  if (has(t, /(asbestos|popcorn|vermiculite|pipe wrap)/)) {
    return {
      level: "review",
      trade: "Possible asbestos",
      why: "Test first. Removing friable asbestos needs a MIOSHA-licensed abatement contractor beyond small incidental amounts done by certain licensed trades.",
      rule: "Asbestos Abatement Contractors Licensing Act (MCL 338.3101 et seq.); MIOSHA asbestos program",
    };
  }

  const paintOnly = id === "paint" && has(t, /(paint|stain)/) && !has(t, /(joist|board|repair|replace|framing)/);
  if (
    !paintOnly &&
    has(
      t,
      /(deck|joist|framing|load.?bearing|remove a wall|wall removal|addition|roof|shingle|siding|gutter|concrete|masonry|tile|insulation|waterproof|replace windows|install windows|structural|beam|porch|stairs)/,
    )
  ) {
    const rounded = Math.round(est);
    if (est >= threshold) {
      return {
        level: "refer",
        trade: "Residential builder / maintenance & alteration (e.g., carpentry, roofing)",
        why: `This is licensed residential work and the estimate ($${rounded.toLocaleString("en-US")}) is $${threshold} or more.`,
        rule: "MCL 339.2401, 339.2403(f), 339.2404(3); LARA homeowner page",
      };
    }
    return {
      level: "review",
      trade: `Residential maintenance & alteration (under $${threshold})`,
      why: `Under $${threshold} total (labor + materials) can be exempt, but not if it's part of a larger project or split up to stay under.`,
      rule: "MCL 339.2403(f)",
    };
  }

  if (id === "paint" && p.pre1978 && !rrp) {
    return {
      level: "review",
      trade: "Lead-safe (EPA RRP), pre-1978 home",
      why: "Dale isn't EPA RRP certified yet, so pre-1978 painting jobs go to the owner instead of auto-quoting. The owner confirms the prep stays under EPA's small-area limits (or refers it out) before releasing a quote.",
      rule: "EPA RRP rule, 40 CFR 745 Subpart E; Dale's rule until he's certified",
    };
  }

  if (!PREAPPROVED.includes(id)) {
    return {
      level: "review",
      trade: "Not on the pre-approved list",
      why: "Work outside Dale's pre-approved services goes to the owner to confirm no license is needed.",
      rule: "Dale's rule",
    };
  }

  return {
    level: "ok",
    trade: "Pre-approved service",
    why: "On Dale's pre-approved list and nothing in the description points to a licensed trade.",
    rule: "Dale's rule; painting removed from licensed trades by 2018 PA 527 (eff. Mar. 28, 2019)",
  };
}
