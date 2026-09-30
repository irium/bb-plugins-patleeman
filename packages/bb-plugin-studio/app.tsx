// bb-plugin-studio frontend: the Studio collection, one nav panel whose
// sub-path filters it to a kind, and the sidebar's Studio tabs.
import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { SidebarTabs } from "./src/ui/SidebarTabs";
import { StudioPanel } from "./src/ui/StudioPanel";

export default definePluginApp((app) => {
  app.slots.navPanel({ id: "studio", title: "Studio", icon: "studio/studio", path: "studio", component: StudioPanel });
  // Renders nothing itself; portals the tabs section into the Studio Sidebar.
  app.slots.experimental_appOverlay({ id: "sidebar-tabs", component: SidebarTabs });
});
