import { useEffect, useState } from "react";
import { Download, X } from "lucide-react";

export default function InstallMiFarma() {
  const [prompt, setPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
    setInstalled(standalone);
    const onPrompt = (event) => { event.preventDefault(); setPrompt(event); };
    const onInstalled = () => { setInstalled(true); setPrompt(null); setShowHelp(false); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);
  if (installed) return null;
  const install = async () => {
    if (!prompt) { setShowHelp(true); return; }
    await prompt.prompt();
    await prompt.userChoice;
    setPrompt(null);
  };
  return <div className="fixed bottom-20 left-1/2 z-[1100] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 rounded-2xl border border-teal-300/30 bg-[#0f172a] p-4 text-white shadow-2xl sm:bottom-5">
    <div className="flex items-start gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-teal-300 text-2xl font-bold text-slate-950">✚</div><div className="min-w-0 flex-1"><p className="font-semibold">Llevá MiFarma en tu celular</p><p className="mt-1 text-xs leading-5 text-slate-300">Instalala gratis y accedé desde tu pantalla de inicio.</p></div><button type="button" onClick={() => document.getElementById("mifarma-install")?.remove()} aria-label="Cerrar" className="text-slate-400"><X size={18}/></button></div>
    <button type="button" onClick={install} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-teal-300 px-4 py-3 text-sm font-bold text-slate-950"><Download size={17}/> Instalar MiFarma</button>
    {showHelp && <p className="mt-3 text-xs leading-5 text-slate-200">En iPhone: abrí MiFarma en Safari, tocá Compartir y elegí «Agregar a pantalla de inicio». En Android: abrí el menú ⋮ de Chrome y elegí «Instalar app» o «Agregar a pantalla principal».</p>}
  </div>;
}
