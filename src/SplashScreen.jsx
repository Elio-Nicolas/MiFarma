import { useEffect, useState } from "react";
import "./SplashScreen.css";

export default function SplashScreen() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = window.setTimeout(() => setVisible(false), reduceMotion ? 350 : 1900);
    return () => window.clearTimeout(timer);
  }, []);
  if (!visible) return null;
  return (
    <div className="mifarma-splash" role="status" aria-label="Iniciando MiFarma">
      <div className="mifarma-splash__center">
        <div className="mifarma-splash__symbol" aria-hidden="true">
          <span className="mifarma-splash__ring" />
          <svg viewBox="0 0 100 100" fill="none" aria-hidden="true"><path d="M39 9h22v30h30v22H61v30H39V61H9V39h30V9Z" fill="currentColor" /></svg>
        </div>
        <div className="mifarma-splash__brand">Mi<span>Farma</span></div>
        <p className="mifarma-splash__tagline">Tu farmacia de turno, siempre cerca.</p>
      </div>
    </div>
  );
}
