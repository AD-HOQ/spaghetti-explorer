import React from "react";
import ReactDOM from "react-dom/client";
import "@react-sigma/core/lib/style.css";
import "react-checkbox-tree/lib/react-checkbox-tree.css";
import "./styles.css";
import { App } from "./App";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
