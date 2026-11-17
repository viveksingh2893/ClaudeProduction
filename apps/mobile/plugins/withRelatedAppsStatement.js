const { withAndroidManifest, withStringsXml } = require("expo/config-plugins");

const STATEMENT = JSON.stringify([
  {
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "web", site: "https://katra4u.com" },
  },
]);

function withRelatedAppsString(config) {
  return withStringsXml(config, (config) => {
    const strings = config.modResults.resources.string || [];
    const existing = strings.find((entry) => entry.$?.name === "asset_statements");
    if (existing) existing._ = STATEMENT;
    else strings.push({ $: { name: "asset_statements", translatable: "false" }, _: STATEMENT });
    config.modResults.resources.string = strings;
    return config;
  });
}

function withRelatedAppsMetadata(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) return config;
    application["meta-data"] = application["meta-data"] || [];
    const metadata = application["meta-data"];
    const existing = metadata.find((entry) => entry.$?.["android:name"] === "asset_statements");
    const value = {
      "android:name": "asset_statements",
      "android:resource": "@string/asset_statements",
    };
    if (existing) existing.$ = value;
    else metadata.push({ $: value });
    return config;
  });
}

module.exports = function withRelatedAppsStatement(config) {
  return withRelatedAppsMetadata(withRelatedAppsString(config));
};
