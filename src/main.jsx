import { createRoot } from "react-dom/client";
import { App } from "./app/App.jsx";
import "./styles.css";

export { App } from "./app/App.jsx";

const container = document.getElementById("root");

if (container) {
  if (!container.__root) container.__root = createRoot(container);
  container.__root.render(<App />);
}
