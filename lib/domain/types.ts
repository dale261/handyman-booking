export type ServiceId =
  | "paint"
  | "tv"
  | "blinds"
  | "furniture"
  | "yard"
  | "clean"
  | "helper"
  | "other";

export const SERVICE_LABELS: Record<ServiceId, string> = {
  paint: "Painting",
  tv: "TV mounting",
  blinds: "Blinds and curtains",
  furniture: "Furniture assembly",
  yard: "Yard cleanup",
  clean: "Household cleaning",
  helper: "Hire a helper",
  other: "Something else",
};

/** Listed services Dale pre-approved. Anything else goes to owner review. */
export const PREAPPROVED: ServiceId[] = [
  "paint",
  "tv",
  "blinds",
  "furniture",
  "yard",
  "clean",
  "helper",
];

export type QuoteParams = {
  rooms: number;
  sqft: number;
  height: "8" | "9" | "11";
  cond: "good" | "fair" | "poor";
  doors: number;
  colors: number;
  ceilings: boolean;
  pre1978: boolean;
  tvSize: "55" | "75" | "85";
  wall: "drywall" | "plaster" | "brick";
  conceal: "none" | "raceway" | "lowvolt" | "power";
  items: number;
  itemKind: "small" | "medium" | "large";
  hours: number;
  haul: boolean;
  deep: boolean;
  helpers: number;
  materials: number;
  windows: number;
  blindKind: "blinds" | "curtains";
};

export const DEFAULT_PARAMS: QuoteParams = {
  rooms: 1,
  sqft: 150,
  height: "8",
  cond: "good",
  doors: 1,
  colors: 1,
  ceilings: false,
  pre1978: false,
  tvSize: "55",
  wall: "drywall",
  conceal: "none",
  items: 1,
  itemKind: "medium",
  hours: 3,
  haul: false,
  deep: false,
  helpers: 1,
  materials: 0,
  windows: 1,
  blindKind: "blinds",
};

export type LineKind =
  | "service"
  | "materials"
  | "premium"
  | "minimum"
  | "travel"
  | "urgency"
  | "pickup";

export type QuoteLine = {
  label: string;
  detail: string;
  amount: number;
  kind: LineKind;
};

export type QuoteResult = {
  scope: string;
  lines: QuoteLine[];
  assumptions: string[];
  total: number;
};

export type ScreenLevel = "ok" | "review" | "refer";

export type ScreenFlag = {
  level: ScreenLevel;
  trade: string;
  why: string;
  rule: string;
};

export type Settings = {
  shopAddress: string;
  shopLat: number;
  shopLng: number;
  ownerNotifyEmail: string;
  rrpCertified: boolean;
  premiumEnabled: boolean;
  premiumMultiplier: number;
  premiumCounties: string[];
  depositThreshold: number;
  cancelFee: number;
  holdHours: number;
  bufferMinutes: number;
  roadFactor: number;
  driveFactor: number;
  drivePadMinutes: number;
  mileRate: number;
  travelMinimum: number;
  hourly: number;
  minimumJob: number;
  helperRate: number;
  helperMax: number;
  helperMaxHours: number;
  paintSqft: number;
  paintCeiling: number;
  paintDoor: number;
  paintColor: number;
  paintCrewSize: number;
  yardCrewSize: number;
  tvSmall: number;
  tvMid: number;
  tvLarge: number;
  tvConceal: number;
  tvPlaster: number;
  tvBrick: number;
  tvRaceway: number;
  asmSmall: number;
  asmMedium: number;
  asmLarge: number;
  blindsEach: number;
  urgency: number;
  pickup: number;
  haul: number;
  height9: number;
  height11: number;
  condFair: number;
  condPoor: number;
  deepClean: number;
  onsitePaint: number;
  onsiteTv: number;
  onsiteBlinds: number;
  onsiteFurniture: number;
  onsiteYard: number;
  onsiteClean: number;
  onsiteOther: number;
  slotStartMin: number;
  slotEndMin: number;
  slotStepMin: number;
  /** Michigan residential builder license threshold (labor + materials). Not a price Dale sets. */
  builderThreshold: number;
  /** Most OpenAI quote calls for the whole shop in one Detroit day. */
  aiDailyCap: number;
  /** Most OpenAI quote calls for one customer in one Detroit day. */
  aiCustomerDailyCap: number;
};

export type ZipRecord = {
  zip: string;
  city: string;
  county: string;
  countiesSpanned: string[];
  status: "auto_book" | "owner_review";
  flagReason: string;
  countyNote: string;
  milesFromCadillac: number | null;
  lat: number | null;
  lng: number | null;
  source: string;
};

export type AreaCheck = {
  found: boolean;
  zip: string;
  auto: boolean;
  inTable: boolean;
  label: string;
  detail: string;
  milesFromCadillac: number | null;
  county: string;
  city: string;
  lat: number | null;
  lng: number | null;
};
