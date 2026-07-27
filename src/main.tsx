import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ConvexClientProvider } from "../components/providers/ConvexProvider";
import App from "./App";
import "./globals.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <ConvexClientProvider>
        <App />
      </ConvexClientProvider>
    </BrowserRouter>
  </React.StrictMode>
);
