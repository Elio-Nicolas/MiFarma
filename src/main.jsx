import React from "react";
import ReactDOM from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "./index.css";
import App from "./App.jsx";
import InstallMiFarma from "./InstallMiFarma.jsx";
import SplashScreen from "./SplashScreen.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
    <InstallMiFarma />
    <SplashScreen />
  </React.StrictMode>
);
