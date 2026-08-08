import { createRoot } from "react-dom/client";
import { App } from "./app/App.jsx";
import "./styles.css";

export { App } from "./app/App.jsx";

const container = document.getElementById("root");

if (container) {
  // _appRoot persiste en el nodo DOM entre re-ejecuciones de HMR,
  // evitando llamar a createRoot() sobre el mismo contenedor dos veces.
  if (!container._appRoot) {
    container._appRoot = createRoot(container);
  }
  container._appRoot.render(<App />);
}
