const { withAndroidManifest } = require("expo/config-plugins");

/**
 * Android 11+ (targetSdk 30+, this app targets 36) hides other apps from
 * `PackageManager` unless the caller declares a matching `<queries>` entry.
 * Razorpay's Standard Checkout needs to enumerate installed UPI apps to
 * offer them and to fire the UPI **intent** that app-switches to Google
 * Pay / PhonePe / Paytm — without this block that list comes back empty and
 * the "pay with a UPI app" flow silently falls back to collect-request.
 *
 * react-native-razorpay@3's own AndroidManifest declares only the Checkout
 * activity, not these queries, so we add them here. Runs on every
 * `expo prebuild`, so it survives the native project being regenerated.
 */
module.exports = function withUpiQueries(config) {
  return withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest.queries = manifest.queries || [];

    const alreadyHasUpi = manifest.queries.some((q) =>
      (q.intent || []).some((i) =>
        (i.data || []).some((d) => d.$ && d.$["android:scheme"] === "upi"),
      ),
    );
    if (!alreadyHasUpi) {
      manifest.queries.push({
        intent: [
          {
            action: [{ $: { "android:name": "android.intent.action.VIEW" } }],
            data: [{ $: { "android:scheme": "upi", "android:host": "pay" } }],
          },
        ],
      });
    }
    return config;
  });
};
