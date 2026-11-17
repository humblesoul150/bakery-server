const SecuritySettings = require("../models/securitySettings");

const SETTINGS_ID = "global";
const SETTINGS_CACHE_MS = 30_000;
const LOGIN_PROTECTION_DEFAULTS = {
  lockoutEnabled: true,
  maxAttempts: 5,
  attemptWindow: 15,
  lockDuration: 15,
  maxLockoutsBeforeManual: 5,
  escalationWindowHours: 24,
  notifyLockouts: true,
};
let cachedSettings;
let cacheExpiresAt = 0;

async function getSecuritySettings({ refresh = false } = {}) {
  if (!refresh && cachedSettings && Date.now() < cacheExpiresAt) {
    return cachedSettings;
  }

  let settings = await SecuritySettings.findById(SETTINGS_ID).lean();
  if (!settings) {
    settings = await SecuritySettings.findByIdAndUpdate(
      SETTINGS_ID,
      { $setOnInsert: {} },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();
  }

  settings = { ...LOGIN_PROTECTION_DEFAULTS, ...settings };
  cachedSettings = settings;
  cacheExpiresAt = Date.now() + SETTINGS_CACHE_MS;
  return settings;
}

function cacheSecuritySettings(settings) {
  cachedSettings = { ...LOGIN_PROTECTION_DEFAULTS, ...settings };
  cacheExpiresAt = Date.now() + SETTINGS_CACHE_MS;
}

module.exports = {
  LOGIN_PROTECTION_DEFAULTS,
  SETTINGS_ID,
  cacheSecuritySettings,
  getSecuritySettings,
};
