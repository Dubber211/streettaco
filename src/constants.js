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
  onboarding: "street-taco-onboarding-v4",
  theme: "street-taco-theme",
  favorites: "street-taco-favorites",
  confirmHistory: "street-taco-confirm-history",
  reportHistory: "street-taco-report-history",
  eulaAccepted: "street-taco-eula-accepted-v2",
  notifyNewTrucks: "street-taco-notify-new",
  notifyFavorites: "street-taco-notify-favorites",
  userId: "street-taco-user-id",
  installDismissed: "street-taco-install-dismissed",
  proximityPrompts: "street-taco-proximity-prompts",
};

export const MAX_NAME_LENGTH = 40;
export const MAX_FOOD_LENGTH = 30;
export const CONFIRM_COOLDOWN_MINUTES = 30;
export const REPORT_COOLDOWN_MINUTES = 30;
export const ADD_COOLDOWN_MINUTES = 15;
export const PROXIMITY_KEY = STORAGE_KEYS.proximityPrompts;
export const PROXIMITY_RADIUS_MILES = 0.25;

export const VAPID_PUBLIC_KEY = "BEivrz-goKCjHc7I271kS2xWt_CbEKT69FbP3dTNSuNTINu2x5Y-xkgZHUW_ba0DMZPG2b_1qnwzpXj9F4Hlxdw";

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

export const TILE_DARK = "https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png";
export const TILE_DARK_LABELS = "https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png";
export const TILE_LIGHT = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";

export const ONBOARDING_STEPS = [
  { type: "modal", icon: "🚚", title: "Welcome to StreetTaco", body: "Real people spotting real trucks — right now, near you." },
  { type: "spotlight", icon: "🗺️", title: "The map is your guide", body: "Food trucks appear right on the map. Drag to explore, pinch to zoom, or use the search pill to jump to a city.", target: ".floating-header", position: "bottom" },
  { type: "modal", icon: "📍", title: "Spot a truck?", body: "See the + button in the corner? Tap it to drop a pin and share a food truck you found with the community." },
  { type: "modal", icon: "📋", title: "Slide up for details", body: "The panel at the bottom has your truck list. Drag it up to browse nearby trucks, filter by favorites, and leave comments." },
  { type: "modal", icon: "🧭", title: "Get directions", body: "Tap any truck on the map, then hit the Go button to open navigation and head straight there." },
  { type: "eula", icon: "📜", title: "End User License Agreement", body: "" },
  { type: "modal", icon: "🌮", title: "You're all set!", body: "Start exploring, add trucks you find, and help your community eat well." },
];
