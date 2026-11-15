import "./styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { Store } from "./store";

const root = document.getElementById("kuroko-root");
if (!root) throw new Error("The kuroko 2 mount point was not found.");
const store = new Store();
createRoot(root).render(<StrictMode><App store={store} /></StrictMode>);
