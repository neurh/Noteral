import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/newsreader";
import "@blocknote/mantine/style.css";
import "./styles.css";
import "./styles/database.css";
import "./styles/database-formula.css";
import "./styles/database-cells.css";
import "./styles/home.css";
import "./styles/home-custom.css";
import "./styles/extensions.css";
import "./styles/assistant.css";
import "./styles/browser.css";
import "./styles/editor-toolbars.css";
import App from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("Noteral root element is missing");
createRoot(root).render(<App />);
