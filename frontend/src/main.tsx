import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/newsreader";
import "@blocknote/mantine/style.css";
import "./styles.css";
import "./styles/database.css";
import "./styles/home.css";
import "./styles/home-custom.css";
import App from "./App";

const root = document.getElementById("root");
if (!root) throw new Error("Noteral root element is missing");
createRoot(root).render(<App />);
