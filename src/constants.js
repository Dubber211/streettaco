export const DEFAULT_CENTER = [41.6764, -86.252];
export const DEFAULT_RADIUS_MILES = 0.5;
export const MOBILE_TRUCK_EXPIRATION_HOURS = 48;
export const MAX_TRUCKS_PER_DAY = 5;
export const RADIUS_OPTIONS = [0.5, 1, 3, 5, 10, 25];

export const STORAGE_KEYS = {
  trucks: "street-taco-trucks",
  userVotes: "street-taco-user-votes",
  radius: "street-taco-radius",
  addHistory: "street-taco-add-history",
  myTruckIds: "street-taco-my-trucks",
  onboarding: "street-taco-onboarding-v3",
  theme: "street-taco-theme",
  favorites: "street-taco-favorites",
  confirmHistory: "street-taco-confirm-history",
  reportHistory: "street-taco-report-history",
  eulaAccepted: "street-taco-eula-accepted",
};

export const MAX_NAME_LENGTH = 40;
export const MAX_FOOD_LENGTH = 30;
export const CONFIRM_COOLDOWN_MINUTES = 30;
export const REPORT_COOLDOWN_MINUTES = 30;
export const ADD_COOLDOWN_MINUTES = 15;
export const PROXIMITY_KEY = "street-taco-proximity-prompts";
export const PROXIMITY_RADIUS_MILES = 0.5;

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Blocked words are now stored in Supabase (blocked_words table)
// and enforced server-side via Postgres triggers.
// Client fetches the list on load for instant UX feedback.

export const FOOD_EMOJIS = {
  tacos: "🌮", taco: "🌮",
  burger: "🍔", burgers: "🍔",
  pizza: "🍕",
  dessert: "🍦", desserts: "🍦", sweets: "🍦", ice: "🍦",
  bbq: "🔥", barbecue: "🔥",
  sushi: "🍱",
  noodle: "🍜", noodles: "🍜",
  hot: "🌭", hotdog: "🌭",
  chicken: "🍗",
  seafood: "🦞", fish: "🐟",
  default: "🚚",
};

export const TILE_DARK = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
export const TILE_LIGHT = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

export const ONBOARDING_STEPS = [
  { type: "modal", icon: "🚚", title: "Welcome to StreetTaco", body: "Find the best food trucks near you, powered by people like you. Let's show you around — it only takes a sec." },
  { type: "spotlight", icon: "🗺️", title: "Your map", body: "This is where food trucks show up. Drag to explore, pinch to zoom, or search for a city.", target: ".map-wrapper", position: "bottom" },
  { type: "spotlight", icon: "📍", title: "Spot a truck?", body: "Tap this to drop a pin and share a food truck you found with the community.", target: ".map-add-truck-overlay", position: "bottom-left" },
  { type: "spotlight", icon: "🔍", title: "Find your area", body: "Use your location or type in a city/ZIP to jump to the right spot on the map.", target: ".controls-bar", position: "bottom" },
  { type: "spotlight", icon: "🗳️", title: "Vote & comment", body: "Each truck card shows votes, comments, and status. Tap to interact.", target: ".list-section", position: "top" },
  { type: "modal", icon: "🧭", title: "Get directions", body: "Tap the compass icon on any truck to open navigation in Google Maps or Apple Maps. We'll take you right to it!" },
  { type: "eula", icon: "📜", title: "End User License Agreement", body: "" },
  { type: "modal", icon: "🌮", title: "You're all set!", body: "Start exploring, add trucks you find, and help your community eat well." },
];
