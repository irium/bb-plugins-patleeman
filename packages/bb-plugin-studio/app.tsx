// bb-plugin-studio frontend: the Studio collection, one nav panel whose
// sub-path filters it to a kind.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { StudioPanel } from "./src/ui/StudioPanel";

export default definePluginApp((app) => {
  app.slots.navPanel({ id: "studio", title: "Studio", icon: "studio/studio", path: "studio", component: StudioPanel });
});
