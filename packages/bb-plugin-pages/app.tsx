import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { PagesPanel } from "./src/ui/PagesPanel";
import "./styles.css";

export default definePluginApp((app) => {
  app.slots.navPanel({ id: "pages", title: "Pages", icon: "FileText", path: "pages", component: PagesPanel });
});
