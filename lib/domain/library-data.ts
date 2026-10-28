export type LibraryGroup = "handy" | "trades" | "build";

export type LibraryEntry = {
  id: string;
  name: string;
  group: LibraryGroup;
  unit: string;
  nationalLow: number | null;
  nationalHigh: number | null;
  localLow: number | null;
  localHigh: number | null;
  source: string;
  notes: string;
  keywords: string[];
  performs: boolean;
  sortOrder: number;
  /** If this entry matches, drop these other ids so a specific job is not priced twice. */
  suppressIds: string[];
};

function row(
  id: string,
  name: string,
  group: LibraryGroup,
  unit: string,
  national: [number, number] | null,
  local: [number, number] | null,
  source: string,
  notes: string,
  keywords: string[],
  performs: boolean,
  sortOrder: number,
  suppressIds: string[] = [],
): LibraryEntry {
  return {
    id,
    name,
    group,
    unit,
    nationalLow: national ? national[0] : null,
    nationalHigh: national ? national[1] : null,
    localLow: local ? local[0] : null,
    localHigh: local ? local[1] : null,
    source,
    notes,
    keywords,
    performs,
    sortOrder,
    suppressIds,
  };
}

/**
 * Northern Michigan cost reference. Numbers are the published low and high,
 * not a price Dale has approved for the rate sheet. Handy work defaults to
 * we-do-it. Licensed trades and builder work default to refer-out.
 */
export const LIBRARY_SEED: LibraryEntry[] = [
  row("drywall-patch", "Drywall patch", "handy", "per patch", [300, 500], null, "HomeGuide, drywall repair cost", "Small patches, not a full sheet.", ["drywall patch", "patch the drywall", "patch drywall", "hole in the drywall", "hole in drywall", "drywall hole"], true, 1, ["drywall-large"]),
  row("drywall-large", "Drywall, large area", "handy", "per sq ft", [3, 8], null, "HomeGuide, drywall repair cost", "Hang or replace drywall by the square foot.", ["hang drywall", "drywall", "sheetrock"], true, 2),
  row("caulking", "Caulking", "handy", "per lin ft", [1.25, 4], null, "HomeAdvisor, cost of caulking", "Fixture caulk jobs are often a flat visit; this row is per foot.", ["caulk", "caulking"], true, 3),
  row("interior-door", "Interior door", "handy", "per door", [155, 688], null, "HomeGuide, interior door installation cost", "Prehung interior door, installed.", ["interior door", "bedroom door", "closet door"], true, 4),
  row("lock", "Lock", "handy", "per lock", [75, 200], null, "HomeGuide, door installation cost", "Lockset or deadbolt swap.", ["deadbolt", "door knob", "doorknob", "lockset", "lock"], true, 5),
  row("baseboard", "Baseboard", "handy", "per lin ft", [6, 9], null, "HomeGuide, baseboard installation cost", "Installed baseboard.", ["baseboard", "base board"], true, 6),
  row("crown", "Crown molding", "handy", "per lin ft", [7, 16], null, "HomeGuide, crown molding cost", "Installed crown.", ["crown molding", "crown moulding"], true, 7),
  row("carpentry", "Minor carpentry repair", "handy", "per job", [250, 800], null, "HomeGuide, handyman prices", "Small wood repairs that are not a deck, roof, or addition.", ["carpentry", "carpenter", "wood repair"], true, 8),
  row("shelving", "Shelving", "handy", "per job", [150, 500], null, "HomeGuide, handyman prices", "Built-in or wall shelves, one job.", ["shelving", "shelves", "shelf"], true, 9),
  row("pressure-wash", "Pressure washing", "handy", "per sq ft", [0.08, 0.77], null, "HomeGuide, pressure washing prices", "Cold wash through hot wash. Whole-house jobs often land around $170 to $360.", ["pressure wash", "pressure washing", "power wash", "power washing"], true, 10),
  row("gutter-cleaning", "Gutter cleaning", "handy", "per lin ft", [0.5, 2.5], null, "HomeGuide, gutter cleaning cost", "Cleaning only, not new gutters.", ["gutter cleaning", "clean the gutters", "gutter clean"], true, 11),
  row("fence-repair", "Fence repair", "handy", "per lin ft", [20, 35], null, "HomeGuide, fence repair cost", "A typical repair job is often $300 to $900.", ["fence repair", "repair the fence", "fix the fence"], true, 12),
  row("deck-repair", "Deck repair", "handy", "per job", [750, 2500], null, "HomeGuide, deck repair cost", "Typical repair job. Boards, rails, and stairs are components of that job.", ["deck repair", "repair the deck", "fix the deck"], true, 13),
  row("flooring", "Flooring", "handy", "per sq ft", [4, 25], null, "HomeGuide, flooring installation cost", "Through hardwood high. Material and install.", ["hardwood floor", "laminate floor", "vinyl plank", "flooring"], true, 14),
  row("tile", "Tile", "handy", "per sq ft", [10, 50], null, "HomeGuide, tile installation cost", "Floor or wall tile, installed.", ["backsplash", "tiling", "tile"], true, 15),
  row("interior-demo", "Interior demolition", "handy", "per sq ft", [2, 8], null, "HomeGuide, interior demolition cost", "Non-structural demo.", ["demolition", "demo the", "tear out"], true, 16),

  row("electrician-labor", "Electrician labor", "trades", "per hour", [50, 120], null, "HomeGuide, electrician cost", "Wage-style range, not a customer price. Dropped when a specific electrical job matches.", ["electrician", "electrical work"], false, 17),
  row("outlet", "Outlet", "trades", "per outlet", [100, 450], null, "HomeGuide, electrician cost", "Outlet or receptacle, installed.", ["receptacle", "gfci", "outlet"], false, 18, ["electrician-labor"]),
  row("light-fixture", "Light fixture", "trades", "per fixture", [158, 1021], null, "HomeGuide, light fixture installation cost", "Fixture swap or new fixture.", ["ceiling fan", "light fixture", "light switch"], false, 19, ["electrician-labor"]),
  row("panel-upgrade", "Electrical panel", "trades", "per panel", [1300, 2000], null, "HomeGuide, electrical panel cost", "Panel upgrade.", ["panel upgrade", "breaker panel", "electrical panel", "service panel", "rewire"], false, 20, ["electrician-labor"]),
  row("plumber-labor", "Plumber labor", "trades", "per hour", [45, 200], null, "HomeGuide, plumber cost", "Wage-style range. Dropped when a specific plumbing job matches.", ["plumber", "plumbing"], false, 21),
  row("faucet", "Faucet", "trades", "per fixture", [200, 600], null, "HomeGuide, faucet installation cost", "Installed, including a typical faucet.", ["faucet"], false, 22, ["plumber-labor"]),
  row("toilet", "Toilet", "trades", "per fixture", [350, 800], null, "HomeGuide, toilet installation cost", "Installed toilet.", ["toilet"], false, 23, ["plumber-labor"]),
  row("water-heater", "Water heater", "trades", "per unit", [600, 3100], null, "HomeGuide, water heater installation cost", "Tank water heater. Tankless runs higher.", ["water heater"], false, 24, ["plumber-labor"]),
  row("furnace", "Furnace", "trades", "per system", [2823, 10000], null, "HomeGuide, furnace replacement cost", "Gas furnace high. Propane can run to about $14,200.", ["furnace", "boiler"], false, 25),
  row("central-ac", "Central air", "trades", "per system", [3887, 8073], null, "HomeGuide, central air cost", "Central air system.", ["central air", "air conditioner", "ac unit"], false, 26),
  row("roof-asphalt", "Asphalt roof", "trades", "per square (100 sq ft)", [300, 600], [320, 750], "HomeGuide national; Traverse City whole-roof jobs", "Local high is $750 per square from Traverse City roofs of about 20 to 25 squares at $8,000 to $15,000. Prefer local.", ["shingles", "shingle", "roof"], false, 27),

  row("siding", "Siding, installed", "build", "per sq ft", [4, 13], [8.53, 17.48], "HomeGuide national; Traverse City siding jobs", "Local from a 2,000 sq ft house: vinyl low about $17,050, LP high about $34,950.", ["siding"], false, 28),
  row("siding-material", "Siding material only", "build", "per sq ft", [4, 12], [5, 18], "Michigan vinyl through fiber-cement", "Material, not the installed price.", ["siding material"], false, 29),
  row("new-deck", "New deck", "build", "per sq ft", [25, 80], [45, 100], "HomeGuide national; local pressure-treated through premium", "New deck, not a repair.", ["build a deck", "build the deck", "new deck"], false, 30),
  row("deck-replacement", "Deck replacement", "build", "per sq ft", [30, 55], [52, 130], "Traverse City deck jobs", "Local from a 12 by 16 deck: pressure-treated low about $52 per sq ft, composite high about $130.", ["deck replacement", "replace the deck", "replace deck"], false, 31),
  row("replacement-window", "Replacement window", "build", "per window", [450, 1500], [1500, 3500], "HomeGuide national; local installed window", "Prefer the local installed range.", ["replacement window", "replace the window", "replace windows", "new windows", "window replacement"], false, 32),
  row("front-door", "Front door", "build", "per door", [500, 2500], null, "HomeGuide, front door replacement cost", "Doubles can run to about $6,500.", ["front door", "entry door", "exterior door"], false, 33),
  row("room-addition", "Room addition", "build", "per sq ft", [125, 250], null, "HomeGuide, home addition cost", "Traverse City additions are often $80,000 to $200,000 for a whole job. Do not mix that with this per-foot range.", ["room addition", "home addition", "add a room"], false, 34),
  row("bathroom-remodel", "Bathroom remodel", "build", "per job", [3500, 7500], [12000, 55000], "HomeGuide national; local guest through primary", "Prefer local.", ["bathroom remodel", "remodel the bathroom"], false, 35),
  row("kitchen-remodel", "Kitchen remodel", "build", "per job", [15000, 50000], [35000, 90000], "HomeGuide national; local kitchen jobs", "Prefer local.", ["kitchen remodel", "remodel the kitchen"], false, 36),
  row("basement-finish", "Basement finish", "build", "per job", null, [40000, 100000], "Local basement finish jobs", "No national range on this row. Use the local job range.", ["finish the basement", "basement finish", "finish a basement"], false, 37),
];

export const LIBRARY_GROUP_LABELS: Record<LibraryGroup, string> = {
  handy: "Handyman",
  trades: "Licensed trades",
  build: "Builder work",
};
