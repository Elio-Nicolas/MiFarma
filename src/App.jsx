
import { useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  useMap,
  ZoomControl 

} from "react-leaflet";
import L from "leaflet";
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  Check,
  Clock3,
  Cross,
  LocateFixed,
  MapPin,
  MapPinned,
  Navigation,
  Phone,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Stethoscope
} from "lucide-react";

import turnosData from "./data/turnos.json";
import farmaciasSanLuisData from "./data/farmacias-san-luis.json";

const TIMEZONE = "America/Argentina/San_Luis";

const CITIES = [
  {
    id: "villa-mercedes",
    name: "Villa Mercedes",
    subtitle: "Departamento General Pedernera",
    lat: -33.6757,
    lng: -65.4578,
    radiusKm: 20
  },
  {
    id: "san-luis-capital",
    name: "San Luis Capital",
    subtitle: "Capital provincial",
    lat: -33.3017,
    lng: -66.3378,
    radiusKm: 18
  }
];

const pharmacyIcon = L.divIcon({
  className: "pharmacy-marker",
  html: `
    <div style="
      width:42px;height:42px;border-radius:16px;
      display:flex;align-items:center;justify-content:center;
      background:#5eead4;border:3px solid #ecfeff;
      color:#082f32;font-size:23px;
      box-shadow:0 8px 28px rgba(45,212,191,.38);
    ">✚</div>
  `,
  iconSize: [42, 42],
  iconAnchor: [21, 21],
  popupAnchor: [0, -20]
});

const userIcon = L.divIcon({
  className: "user-marker",
  html: `
    <div style="
      width:22px;height:22px;border-radius:50%;
      background:#60a5fa;border:4px solid white;
      box-shadow:0 0 0 7px rgba(96,165,250,.22);
    "></div>
  `,
  iconSize: [22, 22],
  iconAnchor: [11, 11]
});

function getLocalDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());

  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value])
  );

  return `${values.year}-${values.month}-${values.day}`;
}

function formatDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);

  return new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: TIMEZONE
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

function distanceKm(a, b) {
  const rad = (value) => (value * Math.PI) / 180;
  const earthRadius = 6371;

  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);

  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) *
      Math.cos(rad(b.lat)) *
      Math.sin(dLng / 2) ** 2;

  return earthRadius * 2 * Math.atan2(
    Math.sqrt(value),
    Math.sqrt(1 - value)
  );
}

function detectCity(position) {
  const point = {
    lat: position.coords.latitude,
    lng: position.coords.longitude
  };

  const accuracy = position.coords.accuracy;

  // Una ubicación demasiado imprecisa no debe decidir la ciudad.
  if (!Number.isFinite(accuracy) || accuracy > 5000) {
    return null;
  }

  const matches = CITIES.map((city) => ({
    city,
    distance: distanceKm(point, city)
  }))
    .filter(({ city, distance }) => distance <= city.radiusKm)
    .sort((a, b) => a.distance - b.distance);

  return matches[0]?.city ?? null;
}

function getShift(cityId, date) {
  const city = turnosData.ciudades?.[cityId];
  const shift = city?.turnos?.[date];

  if (!shift?.farmacia?.nombre || !shift?.farmacia?.direccion) {
    return null;
  }

  return shift;
}

function MapRecenter({ center }) {
  const map = useMap();

  useEffect(() => {
    if (center) {
      // map.getZoom() obtiene el zoom actual en vez de forzar el 13
      map.setView(center, map.getZoom(), { animate: true });
    }
  }, [center, map]);

  return null;
}


function CityCard({ city, selected, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`group relative flex min-h-40 flex-col justify-between overflow-hidden rounded-[24px] border p-5 text-left transition duration-300 hover:-translate-y-1 ${
        selected
          ? "border-teal-300/70 bg-teal-300/10 ring-1 ring-teal-300/30"
          : "border-white/[0.09] bg-white/[0.035] hover:border-white/20 hover:bg-white/[0.07]"
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/[0.07] text-teal-200">
          <MapPin size={21} />
        </div>

        {selected ? (
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-300 text-slate-950">
            <Check size={16} />
          </span>
        ) : (
          <ArrowDownRight
            size={20}
            className="text-slate-500 transition group-hover:translate-x-1 group-hover:text-teal-200"
          />
        )}
      </div>

      <div className="mt-6">
        <h3 className="text-lg font-semibold tracking-tight text-white">
          {city.name}
        </h3>
        <p className="mt-1 text-xs leading-5 text-slate-400">
          {city.subtitle}
        </p>
      </div>
    </button>
  );
}

function App() {
  const [selectedCity, setSelectedCity] = useState(null);
  const [userPosition, setUserPosition] = useState(null);
  const [locationStatus, setLocationStatus] = useState("loading");
  const [locationMessage, setLocationMessage] = useState("");
  const manualSelectionRef = useRef(false);
  const [retryCount, setRetryCount] = useState(0);
  const [selectedDate, setSelectedDate] = useState(getLocalDate);
  const [mappedPharmacies, setMappedPharmacies] = useState([]);
  const [geocodingStatus, setGeocodingStatus] = useState("idle");

  const today = getLocalDate();

  useEffect(() => {
    if (!navigator.geolocation) {
      setLocationStatus("manual");
      setLocationMessage(
        "Tu navegador no permite obtener la ubicación automáticamente."
      );
      return;
    }

    setLocationStatus("loading");
    setLocationMessage("Buscando tu ubicación...");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const point = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };

        setUserPosition(point);

        const detected = detectCity(position);

        if (manualSelectionRef.current) return;

        if (detected) {
          setSelectedCity(detected.id);
          setLocationStatus("detected");
          setLocationMessage(`Ubicación reconocida: ${detected.name}`);
        } else {
          setLocationStatus("manual");
          setLocationMessage(
            "No pudimos identificar con suficiente precisión una ciudad cubierta."
          );
        }
      },
      (error) => {
        if (manualSelectionRef.current) return;

        setLocationStatus("manual");

        const message =
          error.code === error.PERMISSION_DENIED
            ? "La ubicación está desactivada. Podés elegir tu ciudad."
            : error.code === error.TIMEOUT
              ? "La ubicación tardó demasiado. Elegí tu ciudad o intentá nuevamente."
              : "No pudimos obtener tu ubicación. Elegí tu ciudad manualmente.";

        setLocationMessage(message);
      },
      {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 300000
      }
    );
  }, [retryCount]);

  useEffect(() => {
    if (selectedCity !== "san-luis-capital") {
      setMappedPharmacies([]);
      setGeocodingStatus("idle");
      return;
    }

    let cancelled = false;

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    async function locatePharmacies() {
      setGeocodingStatus("loading");
      const cacheKey = "farmacias-sl-geocoding-v1";
      let cache = {};

      try {
        cache = JSON.parse(localStorage.getItem(cacheKey) || "{}");
      } catch {
        cache = {};
      }

      const cityCenter = CITIES.find((item) => item.id === "san-luis-capital");
      const source = farmaciasSanLuisData.farmacias;
      const located = [];
      const pending = source.filter((item) => !cache[item.id]);

      for (let index = 0; index < source.length; index += 1) {
        const item = source[index];
        const saved = cache[item.id];
        if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lng)) {
          located.push({ ...item, lat: saved.lat, lng: saved.lng });
        }
      }
      if (!cancelled) setMappedPharmacies([...located]);

      for (let start = 0; start < pending.length; start += 3) {
        if (cancelled) return;
        const batch = pending.slice(start, start + 3);
        const results = await Promise.all(batch.map(async (item) => {
          const query = `${item.nombre}, ${item.direccion}, San Luis, Argentina`;
          try {
            const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=1&lat=${cityCenter.lat}&lon=${cityCenter.lng}`;
            const response = await fetch(url);
            if (!response.ok) return null;
            const result = await response.json();
            const coordinates = result.features?.[0]?.geometry?.coordinates;
            if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
            const candidate = { lng: coordinates[0], lat: coordinates[1] };
            if (distanceKm(candidate, cityCenter) > 25) return null;
            return { ...item, ...candidate };
          } catch {
            return null;
          }
        }));

        if (cancelled) return;
        for (const result of results) {
          if (!result) continue;
          cache[result.id] = { lat: result.lat, lng: result.lng };
          located.push(result);
        }
        setMappedPharmacies([...located]);
        try {
          localStorage.setItem(cacheKey, JSON.stringify(cache));
        } catch {
          // La app sigue funcionando aunque el navegador no permita guardar caché.
        }
        await wait(350);
      }

      if (!cancelled) setGeocodingStatus("done");
    }

    locatePharmacies();
    return () => {
      cancelled = true;
    };
  }, [selectedCity]);

  const city = CITIES.find((item) => item.id === selectedCity) ?? null;

  const shift = useMemo(
    () => (selectedCity ? getShift(selectedCity, selectedDate) : null),
    [selectedCity, selectedDate]
  );

  const pharmacy = shift?.farmacia;
  const hasPharmacyCoordinates =
    Number.isFinite(pharmacy?.lat) && Number.isFinite(pharmacy?.lng);

  const mapCenter = hasPharmacyCoordinates
    ? [pharmacy.lat, pharmacy.lng]
    : city
      ? [city.lat, city.lng]
      : [-33.6757, -65.4578];

  const googleMapsUrl = hasPharmacyCoordinates
    ? `https://www.google.com/maps/dir/?api=1&destination=${pharmacy.lat},${pharmacy.lng}${
        userPosition
          ? `&origin=${userPosition.lat},${userPosition.lng}`
          : ""
      }`
    : pharmacy?.direccion
      ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
          `${pharmacy.direccion}, ${city?.name}, San Luis, Argentina`
        )}`
      : null;

  function chooseCity(cityId) {
    manualSelectionRef.current = true;
    setSelectedCity(cityId);
    setLocationStatus("manual-selected");
    setLocationMessage(`Ciudad seleccionada: ${CITIES.find((item) => item.id === cityId)?.name ?? ""}`);
  }

  function retryLocation() {
    manualSelectionRef.current = false;
    setSelectedCity(null);
    setRetryCount((count) => count + 1);
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#08111f] text-slate-100">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-48 left-1/2 h-96 w-[44rem] -translate-x-1/2 rounded-full bg-teal-400/[0.09] blur-[120px]"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute right-[-180px] top-[40rem] h-80 w-80 rounded-full bg-blue-500/[0.08] blur-[100px]"
      />

      <div className="relative mx-auto max-w-6xl px-4 pb-12 pt-5 sm:px-6 lg:px-8">
        <header className="flex items-center justify-between gap-3">
          <a href="#" className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-300 text-slate-950 shadow-lg shadow-teal-300/10">
              <Cross size={25} strokeWidth={2.5} />
            </div>

            <div>
              <p className="text-sm font-bold tracking-tight text-white">
                Farmacias <span className="text-teal-200">SL</span>
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                San Luis, Argentina
              </p>
            </div>
          </a>

          <div className="flex items-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.035] px-3 py-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-300 opacity-50" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-300" />
            </span>
            <span className="text-[11px] font-medium text-slate-300">
              Servicio gratuito
            </span>
          </div>
        </header>

        <section className="mx-auto max-w-3xl pb-8 pt-12 text-center sm:pb-10 sm:pt-16">
          <div className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border border-teal-300/15 bg-teal-300/[0.07] px-3.5 py-2 text-xs font-medium text-teal-100">
            <Sparkles size={14} />
            Encontrá tu farmacia en segundos
          </div>

          <h1 className="text-4xl font-semibold leading-[1.08] tracking-[-0.045em] text-white sm:text-6xl">
            Tu salud no
            <br />
            <span className="bg-gradient-to-r from-teal-200 via-teal-300 to-cyan-300 bg-clip-text text-transparent">
              puede esperar.
            </span>
          </h1>

          <p className="mx-auto mt-5 max-w-lg text-sm leading-6 text-slate-400 sm:text-base sm:leading-7">
            Encontrá la farmacia de turno más cercana en Villa Mercedes o San
            Luis Capital, estés donde estés.
          </p>
        </section>

        <section className="mx-auto max-w-3xl">
          <div className="rounded-[28px] border border-white/[0.09] bg-white/[0.035] p-4 shadow-2xl shadow-black/10 backdrop-blur-xl sm:p-6">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-400/10 text-blue-200">
                {locationStatus === "loading" ? (
                  <LocateFixed size={21} className="animate-pulse" />
                ) : (
                  <MapPinned size={21} />
                )}
              </div>

              <div className="min-w-0 flex-1">
                <p className="font-semibold text-white">
                  {locationStatus === "loading"
                    ? "Buscando tu ubicación"
                    : city
                      ? "Tu ciudad"
                      : "¿Dónde estás buscando?"}
                </p>
                <p className="mt-1 text-sm leading-6 text-slate-400">
                  {locationMessage ||
                    "Detectamos tu ubicación para ayudarte a encontrar tu farmacia."}
                </p>
              </div>

              {locationStatus === "loading" && (
                <RefreshCw
                  size={17}
                  className="mt-1 shrink-0 animate-spin text-teal-200"
                />
              )}

              {locationStatus !== "loading" && (
                <button
                  type="button"
                  onClick={retryLocation}
                  title="Volver a detectar mi ubicación"
                  className="rounded-xl p-2 text-slate-400 transition hover:bg-white/[0.07] hover:text-white"
                >
                  <LocateFixed size={18} />
                </button>
              )}
            </div>

            {(!city || locationStatus === "manual") && (
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {CITIES.map((item) => (
                  <CityCard
                    key={item.id}
                    city={item}
                    selected={selectedCity === item.id}
                    onClick={() => chooseCity(item.id)}
                  />
                ))}
              </div>
            )}

            {city && (
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-[#0b1727] px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <Check size={17} className="text-teal-200" />
                  <span className="text-sm text-slate-200">
                    Buscando en{" "}
                    <strong className="font-semibold text-white">
                      {city.name}
                    </strong>
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    manualSelectionRef.current = true;
                    setSelectedCity(null);
                    setLocationStatus("manual");
                    setLocationMessage("Elegí la ciudad que querés consultar.");
                  }}
                  className="text-xs font-medium text-teal-200 transition hover:text-teal-100"
                >
                  Cambiar ciudad
                </button>
              </div>
            )}
          </div>
        </section>

        {city && (
          <section className="mx-auto mt-6 max-w-3xl">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-200/80">
                  Tu consulta
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-white sm:text-2xl">
                  Farmacia de turno
                </h2>
                <p className="mt-1 text-sm capitalize text-slate-400">
                  {formatDate(selectedDate)}
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <label htmlFor="turn-date" className="text-xs font-medium text-slate-400">
                    Consultar fecha
                  </label>
                  <input
                    id="turn-date"
                    type="date"
                    value={selectedDate}
                    onChange={(event) => setSelectedDate(event.target.value)}
                    className="rounded-xl border border-white/10 bg-[#0b1727] px-3 py-2 text-sm text-white outline-none transition focus:border-teal-300/60"
                  />
                  {selectedDate !== today && (
                    <button
                      type="button"
                      onClick={() => setSelectedDate(today)}
                      className="text-xs font-semibold text-teal-200 transition hover:text-teal-100"
                    >
                      Volver a hoy
                    </button>
                  )}
                </div>
              </div>

              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] text-slate-300">
                <Clock3 size={19} />
              </div>
            </div>

            {shift ? (
              <div className="overflow-hidden rounded-[28px] border border-teal-200/15 bg-gradient-to-br from-teal-300/[0.09] via-white/[0.035] to-white/[0.02] p-5 sm:p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[20px] bg-teal-300 text-slate-950">
                    <Cross size={30} strokeWidth={2.5} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-300/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-teal-200">
                      <ShieldCheck size={12} />
                      Turno cargado
                    </span>

                    <h3 className="mt-3 text-xl font-semibold text-white sm:text-2xl">
                      {pharmacy.nombre}
                    </h3>

                    <p className="mt-2 flex items-start gap-2 text-sm leading-6 text-slate-300">
                      <MapPin
                        size={16}
                        className="mt-1 shrink-0 text-teal-200"
                      />
                      {pharmacy.direccion}
                    </p>
                  </div>
                </div>

                {shift.horario?.detalle && (
                  <div className="mt-5 flex items-start gap-3 rounded-2xl border border-white/[0.07] bg-black/10 p-3.5">
                    <Clock3 size={18} className="mt-0.5 shrink-0 text-teal-200" />
                    <div>
                      <p className="text-sm font-medium text-white">
                        Horario del turno
                      </p>
                      <p className="mt-1 text-sm text-slate-400">
                        {shift.horario.detalle}
                      </p>
                    </div>
                  </div>
                )}

                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {googleMapsUrl && (
                    <a
                      href={googleMapsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-teal-300 px-4 py-3 text-sm font-bold text-slate-950 transition hover:bg-teal-200"
                    >
                      <Navigation size={17} />
                      Cómo llegar
                      <ArrowRight size={16} />
                    </a>
                  )}

                  {pharmacy.telefono && (
                    <a
                      href={`tel:${pharmacy.telefono}`}
                      className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.08]"
                    >
                      <Phone size={17} />
                      Llamar a la farmacia
                    </a>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-[28px] border border-white/[0.09] bg-white/[0.035] p-5 sm:p-6">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-300/10 text-amber-200">
                    <Clock3 size={23} />
                  </div>

                  <div>
                    <h3 className="font-semibold text-white">
                      Estamos preparando esta consulta
                    </h3>
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      Todavía no hay un turno cargado para {city.name} en esta
                      fecha. No mostramos farmacias sin datos verificados.
                    </p>

                    <a
                      href="https://www.colfarsl.org.ar/farmacias-de-turno/"
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-teal-200 hover:text-teal-100"
                    >
                      Consultar fuente oficial
                      <ArrowRight size={16} />
                    </a>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {city && (
          <section className="mx-auto mt-8 max-w-3xl">
            <div className="mb-4 flex items-end justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-200/80">
                  Ubicación
                </p>
                <h2 className="mt-2 text-xl font-semibold tracking-tight text-white">
                  Mapa de la zona
                </h2>
              </div>

              <span className="text-xs text-slate-500">
                {hasPharmacyCoordinates
                  ? "Ubicación de la farmacia"
                  : "Centro de la ciudad"}
              </span>
            </div>

            <div className="relative h-[310px] overflow-hidden rounded-[28px] border border-white/[0.09] bg-[#111c2c] sm:h-[380px]">
             
             <a
                href="https://iored.com.ar/"
                target="_blank"
                rel="noopener noreferrer"
                className="absolute top-4 right-4 z-[1000] flex items-center gap-2 rounded-full border border-teal-500/30 bg-slate-950/80 px-3 py-1.5 text-xs font-medium text-teal-200 backdrop-blur-md transition-all duration-300 hover:scale-105 hover:border-teal-400 hover:bg-slate-950 shadow-lg"
             >
             <span className="relative flex h-2 w-2">
             <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-400 opacity-75"></span>
             <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-400"></span>
             </span>
               Desarrollado por <span className="font-semibold text-white">IO Red</span>
             </a>

              <MapContainer
                center={mapCenter}
                zoom={13}
                scrollWheelZoom={true}
                zoomControl={false}
                className="h-full w-full"
              >
                <ZoomControl position="bottomleft" />

                <MapRecenter center={mapCenter} />

                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {mappedPharmacies.map((mappedPharmacy) => (
                  <Marker
                    key={mappedPharmacy.id}
                    position={[mappedPharmacy.lat, mappedPharmacy.lng]}
                    icon={pharmacyIcon}
                  >
                    <Popup>
                      <strong>{mappedPharmacy.nombre}</strong>
                      <br />
                      {mappedPharmacy.direccion}
                      <br />
                      {mappedPharmacy.permanente
                        ? "Turno permanente"
                        : `Grupo de turno ${mappedPharmacy.grupo}`}
                      <br />
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${mappedPharmacy.direccion}, San Luis Capital, San Luis, Argentina}`)}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Cómo llegar
                      </a>
                    </Popup>
                  </Marker>
                ))}

                {hasPharmacyCoordinates && (
                  <Marker position={[pharmacy.lat, pharmacy.lng]} icon={pharmacyIcon}>
                    <Popup>
                      <strong>{pharmacy.nombre}</strong>
                      <br />
                      {pharmacy.direccion}
                    </Popup>
                  </Marker>
                )}

                {userPosition && (
                  <Marker
                    position={[userPosition.lat, userPosition.lng]}
                    icon={userIcon}
                  >
                    <Popup>Tu ubicación aproximada</Popup>
                  </Marker>
                )}
              </MapContainer>

              <div className="pointer-events-none absolute left-3 top-3 z-[500] rounded-xl border border-white/10 bg-[#08111f]/90 px-3 py-2 text-xs font-medium text-slate-200 shadow-lg backdrop-blur-md">
                <span className="mr-2 inline-block h-2 w-2 rounded-full bg-blue-400" />
                Tu ubicación
                {mappedPharmacies.length > 0 && (
                  <span className="ml-3">
                    <span className="mr-2 inline-block h-2 w-2 rounded-full bg-teal-300" />
                    Farmacias ({mappedPharmacies.length})
                  </span>
                )}
              </div>
            </div>

            {city.id === "san-luis-capital" && (
              <p className="mt-3 text-xs leading-5 text-slate-500">
                {geocodingStatus === "loading"
                  ? `Buscando ubicaciones de farmacias… ${mappedPharmacies.length} de ${farmaciasSanLuisData.farmacias.length} encontradas.`
                  : geocodingStatus === "done"
                    ? `Se ubicaron ${mappedPharmacies.length} de ${farmaciasSanLuisData.farmacias.length} farmacias. Las posiciones se calculan a partir de las direcciones y deben verificarse antes de usarlas como ubicación exacta.`
                    : "El mapa muestra el centro de la ciudad como referencia."}
              </p>
            )}
            {city.id !== "san-luis-capital" && !hasPharmacyCoordinates && (
              <p className="mt-3 text-xs leading-5 text-slate-500">
                Todavía no cargamos las ubicaciones de las farmacias de {city.name}.
              </p>
            )}
          </section>
        )}

        <section className="mx-auto mt-8 max-w-3xl">
          <div className="relative overflow-hidden rounded-[26px] border border-dashed border-white/[0.14] bg-white/[0.02] p-5 sm:p-6">
            <div
              aria-hidden="true"
              className="pointer-events-none absolute -right-8 -top-12 h-36 w-36 rounded-full bg-teal-300/[0.06] blur-3xl"
            />

            <div className="relative flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.04] text-teal-200">
                <Sparkles size={20} />
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold text-white">
                    Espacio para comercios locales
                  </h2>
                  <span className="rounded-full bg-white/[0.07] px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                    Próximamente
                  </span>
                </div>
                <p className="mt-2 max-w-lg text-sm leading-6 text-slate-400">
                  Un espacio para promociones y servicios de farmacias de la
                  zona..🏗️
                </p>
              </div>
            </div>
          </div>
        </section>

        <div className="mt-12 overflow-hidden rounded-[24px] border border-white/[0.06] bg-gradient-to-br from-slate-900/60 via-slate-950/40 to-teal-950/20 p-6 text-center shadow-2xl backdrop-blur-sm sm:p-8">
         <div className="mx-auto flex max-w-2xl flex-col items-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/10 text-teal-300 ring-1 ring-teal-500/20">
           <Sparkles size={18} className="animate-pulse" />
          </div>
    
          <h3 className="mt-4 text-xl font-bold tracking-tight text-white sm:text-2xl">
            ¿Necesitás una aplicación o software a medida?
          </h3>
    
         <p className="mt-2 text-sm leading-relaxed text-slate-400">
           En <span className="font-semibold text-teal-300">IO Red</span> transformamos ideas en soluciones digitales sólidas, escalables y pensadas para hacer crecer tu negocio.
         </p>
    
        <a
          href="https://iored.com.ar/"
          target="_blank"
          rel="noopener noreferrer"
          className="group mt-6 flex items-center gap-2 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 px-5 py-2.5 text-sm font-semibold text-slate-950 transition-all duration-300 hover:opacity-90 hover:shadow-[0_0_25px_rgba(45,212,191,0.3)] hover:-translate-y-0.5"
        >
         Conocé nuestro trabajo
       <ArrowRight size={16} className="transition-transform duration-300 group-hover:translate-x-1" />
       </a>
      </div>
     </div>

        <footer className="mx-auto mt-10 max-w-3xl border-t border-white/[0.07] pt-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-semibold text-white">
                Farmacias <span className="text-teal-200">SL</span>
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Una forma más simple de encontrar tu farmacia.
              </p>
            </div>

            <a
              href="https://www.colfarsl.org.ar/farmacias-de-turno/"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-xs text-slate-400 transition hover:text-teal-200"
            >
              <ShieldCheck size={15} />
              Fuente oficial de turnos
              <ArrowRight size={13} />
            </a>
          </div>
           <p className="mt-8 text-center text-[11px] leading-relaxed tracking-wide text-slate-500/80">
            <span className="block sm:inline font-medium text-slate-400">
              © {new Date().getFullYear()} <a href="https://iored.com.ar/" target="_blank" rel="noopener noreferrer" className="hover:text-teal-400 transition">IO Red</a>. Todos los derechos reservados.
            </span>
            <span className="hidden sm:inline mx-2 text-slate-700">|</span>
            <span className="block sm:inline text-slate-500 text-[10px]">
             Información de turnos referencial basada en fuentes oficiales. Geolocalización sujeta a precisión de dispositivo.
            </span>
           </p>
        </footer>
      </div>
    </main>
  );
}

export default App;
