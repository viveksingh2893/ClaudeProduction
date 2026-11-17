// Keep the placeholder implementation in one place while exposing Doctor as
// a real tab destination. Remaining deep links to /more/doctor continue to
// work, but bottom-nav entry points use this route so the tab bar stays mounted.
export { default } from "../more/doctor";
