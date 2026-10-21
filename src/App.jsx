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
  ArrowDownRight,
  ArrowRight,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Cross,
  Info,
  LocateFixed,
  MapPin,
  MapPinned,
  Navigation,
  Phone,
  RefreshCw,
  Share2,
  ShieldCheck,
  Sparkles,
  X
} from "lucide-react";

import turnosData from "./data/turnos.json";
import farmaciasSanLuisData from "./data/farmacias-san-luis.json";
import farmaciasVillaMercedesData from "./data/farmacias-villa-mercedes.json";
import farmaciasJustoDaractData from "./data/farmacias-justo-daract.json";

const TIMEZONE = "America/Argentina/San_Luis";

// Ciudades cuyo turno sale de un calendario (día -> grupo) y un listado de
// farmacias por grupo.
const GROUP_CITY_DATA = {
  "villa-mercedes": farmaciasVillaMercedesData,
  "justo-daract": farmaciasJustoDaractData,
  "san-luis-capital": farmaciasSanLuisData
};

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
    id: "justo-daract",
    name: "Justo Daract",
    subtitle: "Provincia de San Luis",
    lat: -33.8658,
    lng: -65.1778,
    radiusKm: 8
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

// Configuración del geocoding por ciudad (caché propia y filtro de distancia).
const GEOCODING_CONFIG = {
  "san-luis-capital": {
    cacheKey: "farmacias-sl-geocoding-v1",
    localidad: "San Luis",
    maxDistanceKm: 25
  },
  "justo-daract": {
    cacheKey: "farmacias-jd-geocoding-v1",
    localidad: "Justo Daract, San Luis",
    maxDistanceKm: 10
  },
  "villa-mercedes": {
    cacheKey: "farmacias-vm-geocoding-v2",
    localidad: "Villa Mercedes, San Luis",
    maxDistanceKm: 15
  }
};

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

const pharmacyIconMuted = L.divIcon({
  className: "pharmacy-marker",
  html: `
    <div style="
      width:42px;height:42px;border-radius:16px;
      display:flex;align-items:center;justify-content:center;
      background:#94a3b8;border:3px solid #e2e8f0;
      color:#0f172a;font-size:23px;opacity:.55;
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

// Villa Mercedes: antes de esta hora sigue vigente el turno del día anterior.
const VM_SHIFT_CHANGE_HOUR = 8;

function getLocalHour() {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIMEZONE,
    hour: "2-digit",
    hourCycle: "h23"
  }).format(new Date());

  return Number(hour);
}

function shiftDate(dateString, days) {
  const [year, month, day] = dateString.split("-").map(Number);

  return new Date(Date.UTC(year, month - 1, day + days, 12))
    .toISOString()
    .slice(0, 10);
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

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const NAME_STOPWORDS = new Set([
  "farmacia", "farmacias", "suc", "sucursal", "del", "de", "la", "las", "los", "san", "santa"
]);

function nameTokens(value) {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 2 && !NAME_STOPWORDS.has(token));
}

// Para farmacias sin dirección: acepta solo resultados que sean farmacias y
// compartan alguna palabra significativa con el nombre buscado.
function matchesPharmacyName(feature, item) {
  const props = feature?.properties ?? {};
  if (props.osm_value !== "pharmacy") return false;

  const found = nameTokens(props.name);
  return nameTokens(item.nombre).some((token) => found.includes(token));
}

function getTelHref(phone) {
  const first = String(phone).split(/[-/]/)[0].replace(/[^\d+]/g, "");
  return `tel:${first}`;
}

// Ciudades por grupo: el turno sale del calendario (día -> grupo) y del
// listado de farmacias de cada grupo. Un grupo puede tener 1, 2 o 3 farmacias.
function getGroupShift(cityId, date) {
  const data = GROUP_CITY_DATA[cityId];
  if (!data) return null;

  const [year, month, day] = date.split("-");
  const group =
    data.calendario?.[date] ??
    data.calendario?.[`${year}-${month}`]?.[String(Number(day))];

  if (!group) return null;

  const farmacias = data.grupos?.[group];
  if (!farmacias?.length) return null;

  const horarioTurno = data.horarioTurno;

  return {
    grupo: group,
    farmacias,
    horario: horarioTurno ? { detalle: horarioTurno } : null
  };
}

function getShift(cityId, date) {
  const groupShift = getGroupShift(cityId, date);
  if (groupShift) return groupShift;

  const city = turnosData.ciudades?.[cityId];
  const shift = city?.turnos?.[date];

  if (!shift?.farmacia?.nombre || !shift?.farmacia?.direccion) {
    return null;
  }

  return shift;
}

// Si la farmacia no tiene dirección cargada se busca por nombre.
function getDirectionsUrl(item, cityName) {
  const place = item.direccion || `Farmacia ${item.nombre}`;

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    `${place}, ${cityName}, San Luis, Argentina`
  )}`;
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

// Al tocar una farmacia de la lista, el mapa vuela hasta ella y abre su popup.
function MapFocus({ target, markerRefs }) {
  const map = useMap();

  useEffect(() => {
    if (!target) return undefined;

    const openPopup = () => markerRefs.current[target.id]?.openPopup();

    map.once("moveend", openPopup);
    // Respaldo por si el mapa ya estaba ahí y no dispara "moveend".
    const timer = setTimeout(openPopup, 1000);
    map.flyTo(target.position, Math.max(map.getZoom(), 16), { duration: 0.8 });

    return () => {
      clearTimeout(timer);
      map.off("moveend", openPopup);
    };
  }, [target, map, markerRefs]);

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

const STATUS_TONES = {
  turno: "bg-teal-300/10 text-teal-200",
  "24h": "bg-teal-300/10 text-teal-200",
  "sin-turno": "bg-amber-300/10 text-amber-200",
  desconocido: "bg-white/[0.07] text-slate-300"
};

function NearestRow({ title, entry, status, cityName, onShowOnMap, onShare }) {
  const { item, distance } = entry;

  return (
    <div className="rounded-2xl border border-white/[0.07] bg-black/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-400">{title}</p>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_TONES[status.key]}`}
        >
          {status.label}
        </span>
      </div>

      <p className="mt-2 text-lg font-semibold text-white">{item.nombre}</p>
      <p className="mt-1 text-sm text-slate-400">
        A {formatDistance(distance)} aprox., en línea recta
      </p>

      {item.direccion && (
        <p className="mt-1 flex items-start gap-2 text-sm leading-6 text-slate-300">
          <MapPin size={15} className="mt-1 shrink-0 text-teal-200" />
          {item.direccion}
        </p>
      )}

      {status.key === "sin-turno" && (
        <p className="mt-2 text-xs leading-5 text-amber-200/90">
          No está de turno, así que puede estar cerrada. Llamá antes de ir.
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={getDirectionsUrl(item, cityName)}
          target="_blank"
          rel="noreferrer"
          className="flex min-h-11 min-w-[9rem] flex-1 items-center justify-center gap-2 rounded-xl bg-teal-300 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-teal-200"
        >
          <Navigation size={16} />
          Cómo llegar
        </a>

        <button
          type="button"
          onClick={() => onShowOnMap(item)}
          className="flex min-h-11 min-w-[9rem] flex-1 items-center justify-center gap-2 rounded-xl border border-teal-300/30 bg-teal-300/10 px-4 py-2.5 text-sm font-semibold text-teal-100 transition hover:bg-teal-300/20"
        >
          <MapPinned size={16} />
          Ver en el mapa
        </button>

        <button
          type="button"
          onClick={() => onShare(item, status)}
          className="flex min-h-11 min-w-[9rem] flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.08]"
        >
          <Share2 size={16} />
          Compartir
        </button>

        {item.telefono && (
          <a
            href={getTelHref(item.telefono)}
            className="flex min-h-11 min-w-[9rem] flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.08]"
          >
            <Phone size={16} />
            Llamar
          </a>
        )}
      </div>
    </div>
  );
}

// Farmacia más cercana a la persona, esté o no de turno.
function NearestCard({
  cityName,
  userPosition,
  locationStatus,
  positionRequest,
  geocodingStatus,
  locatedCount,
  totalCount,
  nearby,
  getStatus,
  onRetryLocation,
  onShowOnMap,
  onShare
}) {
  let content;

  if (!userPosition) {
    const searching = locationStatus === "loading" || positionRequest === "loading";

    content = searching ? (
      <p className="text-sm leading-6 text-slate-400">Buscando tu ubicación…</p>
    ) : (
      <div>
        <p className="text-sm leading-6 text-slate-400">
          {positionRequest === "error"
            ? "No pudimos obtener tu ubicación. Revisá que el permiso esté activado en el navegador."
            : "Necesitamos tu ubicación para decirte cuál es la farmacia más cercana."}
        </p>
        <button
          type="button"
          onClick={onRetryLocation}
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl bg-teal-300 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-teal-200"
        >
          <LocateFixed size={16} />
          Usar mi ubicación
        </button>
      </div>
    );
  } else if (!nearby) {
    content = (
      <p className="text-sm leading-6 text-slate-400">
        {geocodingStatus === "done"
          ? "No pudimos ubicar farmacias para calcular la más cercana."
          : `Ubicando farmacias… ${locatedCount} de ${totalCount}.`}
      </p>
    );
  } else if (nearby.nearest.distance > 40) {
    content = (
      <p className="text-sm leading-6 text-slate-400">
        Parece que no estás en {cityName}: la farmacia más cercana que conocemos
        queda a {formatDistance(nearby.nearest.distance)}.
      </p>
    );
  } else {
    const nearestStatus = getStatus(nearby.nearest.item);
    const sameAsOpen = nearby.nearestOpen?.item.id === nearby.nearest.item.id;

    const nearestTitle = sameAsOpen
      ? nearestStatus.key === "24h"
        ? "La más cercana, y abre las 24 h"
        : "La más cercana, y está de turno"
      : "La más cercana";

    content = (
      <div className="space-y-3">
        <NearestRow
          title={nearestTitle}
          entry={nearby.nearest}
          status={nearestStatus}
          cityName={cityName}
          onShowOnMap={onShowOnMap}
          onShare={onShare}
        />

        {nearby.nearestOpen && !sameAsOpen && (
          <NearestRow
            title="La de turno más cercana"
            entry={nearby.nearestOpen}
            status={getStatus(nearby.nearestOpen.item)}
            cityName={cityName}
            onShowOnMap={onShowOnMap}
            onShare={onShare}
          />
        )}

        {geocodingStatus === "loading" && (
          <p className="text-xs leading-5 text-slate-500">
            Seguimos ubicando farmacias ({locatedCount} de {totalCount}); puede
            aparecer una más cercana.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-[28px] border border-blue-300/20 bg-gradient-to-br from-blue-400/[0.09] via-white/[0.035] to-white/[0.02] p-5 sm:p-6">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-400/10 text-blue-200">
          <MapPinned size={21} />
        </div>
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-white">
            Farmacia más cercana
          </h2>
          <p className="mt-0.5 text-sm text-slate-400">
            Cualquier día y hora, esté o no de turno.
          </p>
        </div>
      </div>

      {content}
    </div>
  );
}

function formatDistance(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  return `${km.toFixed(1).replace(".", ",")} km`;
}

// Turno por grupo (Villa Mercedes): lista de farmacias de turno.
function GroupShiftCard({
  shift,
  cityName,
  located,
  userPosition,
  geocodingStatus,
  onShowOnMap,
  onShare
}) {
  // Si hay ubicación del usuario, la más cercana va primero.
  const items = useMemo(() => {
    const rows = shift.farmacias.map((item) => {
      const spot = located.find((point) => point.id === item.id);
      return {
        item,
        isLocated: Boolean(spot),
        distance: spot && userPosition ? distanceKm(userPosition, spot) : null
      };
    });

    return rows.sort((a, b) => {
      if (a.distance === null && b.distance === null) return 0;
      if (a.distance === null) return 1;
      if (b.distance === null) return -1;
      return a.distance - b.distance;
    });
  }, [shift, located, userPosition]);

  return (
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
            Grupo de turno {shift.grupo}
          </h3>
          <p className="mt-1 text-sm text-slate-400">
            {shift.farmacias.length}{" "}
            {shift.farmacias.length === 1
              ? "farmacia de turno"
              : "farmacias de turno"}
          </p>
        </div>
      </div>

      {shift.horario?.detalle && (
        <div className="mt-5 flex items-start gap-3 rounded-2xl border border-white/[0.07] bg-black/10 p-3.5">
          <Clock3 size={18} className="mt-0.5 shrink-0 text-teal-200" />
          <div>
            <p className="text-sm font-medium text-white">Horario del turno</p>
            <p className="mt-1 text-sm text-slate-400">
              {shift.horario.detalle}
            </p>
          </div>
        </div>
      )}

      <ul className="mt-5 space-y-3">
        {items.map(({ item, isLocated, distance }) => (
          <li
            key={item.id}
            className="rounded-2xl border border-white/[0.07] bg-black/10 p-4"
          >
            <div className="flex flex-wrap items-start justify-between gap-2">
              <p className="font-semibold text-white">{item.nombre}</p>
              {distance !== null && (
                <span className="rounded-full bg-blue-400/10 px-2.5 py-1 text-[11px] font-medium text-blue-200">
                  a {formatDistance(distance)} aprox.
                </span>
              )}
            </div>

            {item.direccion && (
              <p className="mt-1.5 flex items-start gap-2 text-sm leading-6 text-slate-300">
                <MapPin size={15} className="mt-1 shrink-0 text-teal-200" />
                {item.direccion}
              </p>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => onShowOnMap(item)}
                disabled={!isLocated}
                className="flex min-h-11 min-w-[9rem] flex-1 items-center justify-center gap-2 rounded-xl border border-teal-300/30 bg-teal-300/10 px-4 py-2.5 text-sm font-semibold text-teal-100 transition hover:bg-teal-300/20 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <MapPinned size={16} />
                {isLocated
                  ? "Ver en el mapa"
                  : geocodingStatus === "done"
                    ? "Sin ubicación"
                    : "Ubicando…"}
              </button>

              <a
                href={getDirectionsUrl(item, cityName)}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-11 min-w-[9rem] flex-1 items-center justify-center gap-2 rounded-xl bg-teal-300 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-teal-200"
              >
                <Navigation size={16} />
                Cómo llegar
              </a>

              <button
                type="button"
                onClick={() => onShare(item)}
                className="flex min-h-11 min-w-[9rem] flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.08]"
              >
                <Share2 size={16} />
                Compartir
              </button>

              {item.telefono && (
                <a
                  href={getTelHref(item.telefono)}
                  className="flex min-h-11 min-w-[9rem] flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.08]"
                >
                  <Phone size={16} />
                  Llamar
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const WEEKDAYS = ["L", "M", "M", "J", "V", "S", "D"];

function monthTitle(monthKey) {
  const [year, month] = monthKey.split("-").map(Number);
  const text = new Intl.DateTimeFormat("es-AR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(year, month - 1, 1, 12)));

  return text.charAt(0).toUpperCase() + text.slice(1);
}

function shiftMonth(monthKey, delta) {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1, 12));

  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatShortDate(dateString) {
  const [year, month, day] = dateString.split("-").map(Number);

  return new Intl.DateTimeFormat("es-AR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC"
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}

// Próximas fechas de turno de una farmacia (desde la fecha dada).
function getUpcomingTurns(cityId, item, fromDate, limit = 8) {
  const dates = [];

  if (GROUP_CITY_DATA[cityId] && item.grupo) {
    const calendar = GROUP_CITY_DATA[cityId].calendario ?? {};

    for (const [monthKey, days] of Object.entries(calendar)) {
      for (const [day, group] of Object.entries(days)) {
        if (group === item.grupo) {
          dates.push(`${monthKey}-${day.padStart(2, "0")}`);
        }
      }
    }
  } else {
    const target = normalizeText(item.nombre);
    const turnos = turnosData.ciudades?.[cityId]?.turnos ?? {};

    for (const [date, shift] of Object.entries(turnos)) {
      const name = normalizeText(shift?.farmacia?.nombre);
      if (name && (name === target || name === `farmacia ${target}`)) {
        dates.push(date);
      }
    }
  }

  return dates.filter((date) => date >= fromDate).sort().slice(0, limit);
}

const ABOUT_STATUS_GUIDE = [
  {
    key: "turno",
    label: "De turno hoy",
    text: "La farmacia está en el grupo de turno de esa fecha."
  },
  {
    key: "24h",
    label: "Abierta 24 h",
    text: "Es una farmacia permanente."
  },
  {
    key: "sin-turno",
    label: "Sin turno hoy",
    text: "No está de turno, así que puede estar cerrada. Llamá antes de ir."
  },
  {
    key: "desconocido",
    label: "Confirmá el horario llamando",
    text: "No tenemos el dato de turno de esa farmacia para la fecha."
  }
];

function AboutSection({ title, children }) {
  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-teal-200/80">
        {title}
      </h3>
      <div className="mt-2 space-y-2 text-sm leading-6 text-slate-300">
        {children}
      </div>
    </section>
  );
}

// "Acerca de": qué hace la app, por qué existe, cómo usarla y cómo leer lo que muestra.
function AboutDialog({ open, onClose }) {
  useEffect(() => {
    if (!open) return undefined;

    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;

    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[3000] flex items-end justify-center bg-black/60 sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-title"
        onClick={(event) => event.stopPropagation()}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-[28px] border border-white/[0.09] bg-[#0b1727] p-5 shadow-2xl sm:rounded-[28px] sm:p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-200/80">
              Acerca de
            </p>
            <h2
              id="about-title"
              className="mt-1 text-xl font-semibold tracking-tight text-white"
            >
              Cómo funciona Farmacias SL
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="rounded-xl p-2 text-slate-400 transition hover:bg-white/[0.07] hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        <AboutSection title="¿Para qué sirve?">
          <p>
            Te dice qué farmacia está de turno hoy, o el día que elijas, en
            Villa Mercedes, Justo Daract y San Luis Capital, y cuál es la más
            cercana a donde estás. Desde ahí podés verla en el mapa, llamar,
            pedir cómo llegar y compartirla por WhatsApp.
          </p>
        </AboutSection>

        <AboutSection title="¿Por qué existe?">
          <p>
            Los turnos se publican como planillas: un calendario con una letra
            por día y otro listado que dice qué farmacias forman cada grupo.
            Para saber cuál está de turno hay que cruzar las dos tablas, y casi
            siempre justo cuando hay apuro.
          </p>
          <p>
            Esta app hace ese cruce por vos y le suma el mapa, la distancia y
            los botones para llamar o ir. Los datos salen de las planillas de
            turnos de 2026 (en San Luis Capital y Justo Daract, del Ministerio
            de Salud – Inspección de Farmacias).
          </p>
        </AboutSection>

        <AboutSection title="Cómo usarla">
          <ol className="list-decimal space-y-2 pl-5">
            <li>
              <strong className="text-white">Elegí tu ciudad.</strong> Si diste
              permiso de ubicación, la reconoce sola; si no, tocá una de las
              tarjetas.
            </li>
            <li>
              <strong className="text-white">Mirá el turno en “Hoy”.</strong>{" "}
              Con “Consultar fecha” elegís otro día y con “Volver a hoy”
              regresás.
            </li>
            <li>
              <strong className="text-white">Farmacia más cercana.</strong>{" "}
              Necesita tu ubicación. Te muestra la más cercana, esté o no de
              turno, y la de turno más cercana.
            </li>
            <li>
              <strong className="text-white">Usá los botones.</strong> “Ver en
              el mapa”, “Cómo llegar” (abre Google Maps), “Llamar” y
              “Compartir”.
            </li>
            <li>
              <strong className="text-white">Calendario.</strong> Mirá el mes
              completo, tocá un día para ver sus farmacias o buscá una farmacia
              para saber cuándo le toca.
            </li>
          </ol>
        </AboutSection>

        <AboutSection title="Cómo leer lo que ves">
          <ul className="space-y-2">
            {ABOUT_STATUS_GUIDE.map((item) => (
              <li key={item.key} className="flex flex-wrap items-start gap-2">
                <span
                  className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_TONES[item.key]}`}
                >
                  {item.label}
                </span>
                <span className="min-w-0 flex-1">{item.text}</span>
              </li>
            ))}
          </ul>
          <p>
            <strong className="text-white">Grupo (la letra):</strong> las
            farmacias de un mismo grupo comparten los mismos días de turno.
          </p>
          <p>
            <strong className="text-white">Mapa:</strong> en Villa Mercedes y
            Justo Daract, el celeste es la farmacia de turno y el gris
            desvanecido son las 3 más cercanas sin turno. En San Luis Capital se
            muestran todas.
          </p>
          <p>
            <strong className="text-white">“A 1,2 km aprox.”:</strong> es la
            distancia en línea recta, no por las calles.
          </p>
        </AboutSection>

        <AboutSection title="Cosas a tener en cuenta">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              La posición en el mapa se calcula a partir del nombre o la
              dirección y puede ser aproximada. Ante la duda, llamá o usá “Cómo
              llegar”.
            </li>
            <li>
              Una farmacia sin turno puede estar abierta en su horario habitual:
              no tenemos esos horarios.
            </li>
            <li>
              Es información de referencia. Ante una urgencia médica, no
              esperes: llamá al servicio de emergencias.
            </li>
          </ul>
        </AboutSection>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.07] pt-4">
          <p className="text-xs text-slate-500">
            Desarrollada por{" "}
            <a
              href="https://iored.com.ar/"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-teal-200 hover:text-teal-100"
            >
              IO Red
            </a>
          </p>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-teal-300 px-5 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-teal-200"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
}

function TabBar({ active, onChange }) {
  const tabs = [
    { id: "hoy", label: "Hoy", Icon: Cross },
    { id: "calendario", label: "Calendario", Icon: CalendarDays }
  ];

  return (
    <nav
      aria-label="Secciones"
      className="fixed inset-x-0 bottom-0 z-[2000] border-t border-white/10 bg-[#08111f]/95 backdrop-blur-xl"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <div className="mx-auto flex max-w-3xl">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            aria-current={active === id ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-semibold transition ${
              active === id
                ? "text-teal-200"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Icon size={20} />
            {label}
          </button>
        ))}
      </div>
    </nav>
  );
}

function CalendarTab({
  cityId,
  cityName,
  selectedDate,
  today,
  farmacias,
  onPickDate
}) {
  const [monthKey, setMonthKey] = useState(selectedDate.slice(0, 7));
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState(null);

  const [year, month] = monthKey.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  // La semana arranca en lunes.
  const offset = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;

  const cells = [];
  for (let index = 0; index < offset; index += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const date = `${monthKey}-${String(day).padStart(2, "0")}`;
    const shift = getShift(cityId, date);

    cells.push({
      day,
      date,
      label: shift?.grupo ?? shift?.farmacia?.nombre?.split(" ")[0] ?? null
    });
  }

  const matches = useMemo(() => {
    const text = normalizeText(query);
    if (text.length < 2 || picked) return [];

    return farmacias
      .filter((item) => normalizeText(item.nombre).includes(text))
      .slice(0, 6);
  }, [query, picked, farmacias]);

  const turns = useMemo(
    () => (picked ? getUpcomingTurns(cityId, picked, today) : []),
    [picked, cityId, today]
  );

  return (
    <section className="mx-auto mt-6 max-w-3xl space-y-6">
      <div className="rounded-[28px] border border-white/[0.09] bg-white/[0.035] p-4 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            aria-label="Mes anterior"
            onClick={() => setMonthKey(shiftMonth(monthKey, -1))}
            className="rounded-xl p-2 text-slate-300 transition hover:bg-white/[0.07]"
          >
            <ChevronLeft size={20} />
          </button>

          <div className="text-center">
            <h2 className="text-lg font-semibold text-white">
              {monthTitle(monthKey)}
            </h2>
            <p className="text-xs text-slate-500">{cityName}</p>
          </div>

          <button
            type="button"
            aria-label="Mes siguiente"
            onClick={() => setMonthKey(shiftMonth(monthKey, 1))}
            className="rounded-xl p-2 text-slate-300 transition hover:bg-white/[0.07]"
          >
            <ChevronRight size={20} />
          </button>
        </div>

        <div className="mt-4 grid grid-cols-7 gap-1.5 text-center">
          {WEEKDAYS.map((weekday, index) => (
            <span
              key={index}
              className="py-1 text-[11px] font-semibold text-slate-500"
            >
              {weekday}
            </span>
          ))}

          {cells.map((cell, index) =>
            cell ? (
              <button
                key={cell.date}
                type="button"
                onClick={() => onPickDate(cell.date)}
                aria-label={`${cell.day}${cell.label ? `, ${cell.label}` : ""}`}
                className={`flex aspect-square flex-col items-center justify-center rounded-xl border text-sm transition ${
                  cell.date === selectedDate
                    ? "border-teal-300/70 bg-teal-300/15 text-white"
                    : cell.date === today
                      ? "border-blue-300/50 bg-white/[0.03] text-white"
                      : "border-white/[0.06] bg-white/[0.03] text-slate-200 hover:bg-white/[0.08]"
                } ${cell.label ? "" : "opacity-50"}`}
              >
                <span>{cell.day}</span>
                {cell.label && (
                  <span className="mt-0.5 max-w-full truncate px-0.5 text-[10px] font-bold text-teal-200">
                    {cell.label}
                  </span>
                )}
              </button>
            ) : (
              <span key={`empty-${index}`} />
            )
          )}
        </div>

        <p className="mt-4 text-xs leading-5 text-slate-500">
          {GROUP_CITY_DATA[cityId]
            ? "La letra es el grupo de turno de cada día. Tocá un día para ver sus farmacias."
            : "Tocá un día para ver la farmacia de turno."}
        </p>
      </div>

      <div className="rounded-[28px] border border-white/[0.09] bg-white/[0.035] p-5 sm:p-6">
        <h2 className="text-lg font-semibold text-white">
          ¿Cuándo le toca a tu farmacia?
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Buscala por nombre y mirá sus próximos turnos.
        </p>

        <label htmlFor="pharmacy-search" className="sr-only">
          Nombre de la farmacia
        </label>
        <input
          id="pharmacy-search"
          type="search"
          value={picked ? picked.nombre : query}
          onChange={(event) => {
            setPicked(null);
            setQuery(event.target.value);
          }}
          placeholder="Por ejemplo: Del Aguila"
          className="mt-4 w-full rounded-xl border border-white/10 bg-[#0b1727] px-3 py-3 text-sm text-white outline-none transition focus:border-teal-300/60"
        />

        {matches.length > 0 && (
          <ul className="mt-2 divide-y divide-white/[0.06] overflow-hidden rounded-xl border border-white/[0.08] bg-[#0b1727]">
            {matches.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    setPicked(item);
                    setQuery(item.nombre);
                  }}
                  className="w-full px-3 py-3 text-left text-sm text-slate-200 transition hover:bg-white/[0.06]"
                >
                  {item.nombre}
                  {item.direccion && (
                    <span className="block text-xs text-slate-500">
                      {item.direccion}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        {picked && (
          <div className="mt-5">
            <p className="text-sm font-semibold text-white">
              Próximos turnos de {picked.nombre}
              {GROUP_CITY_DATA[cityId] && picked.grupo
                ? ` (grupo ${picked.grupo})`
                : ""}
            </p>

            {turns.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {turns.map((date) => (
                  <button
                    key={date}
                    type="button"
                    onClick={() => onPickDate(date)}
                    className="rounded-full border border-teal-300/30 bg-teal-300/10 px-3 py-1.5 text-xs font-semibold capitalize text-teal-100 transition hover:bg-teal-300/20"
                  >
                    {formatShortDate(date)}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-sm leading-6 text-slate-400">
                No encontramos turnos cargados para esta farmacia desde hoy.
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function App() {
  const [selectedCity, setSelectedCity] = useState(null);
  const [userPosition, setUserPosition] = useState(null);
  const [locationStatus, setLocationStatus] = useState("loading");
  const [locationMessage, setLocationMessage] = useState("");
  const manualSelectionRef = useRef(false);
  const mapBoxRef = useRef(null);
  const markerRefs = useRef({});
  const [mapTarget, setMapTarget] = useState(null);
  const [positionRequest, setPositionRequest] = useState("idle");
  const [activeTab, setActiveTab] = useState("hoy");
  const [aboutOpen, setAboutOpen] = useState(false);
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

  const city = CITIES.find((item) => item.id === selectedCity) ?? null;

  const usingPreviousDayShift =
    selectedCity === "villa-mercedes" &&
    selectedDate === today &&
    getLocalHour() < VM_SHIFT_CHANGE_HOUR;

  const effectiveDate = usingPreviousDayShift
    ? shiftDate(selectedDate, -1)
    : selectedDate;

  const shift = useMemo(
    () => (selectedCity ? getShift(selectedCity, effectiveDate) : null),
    [selectedCity, effectiveDate]
  );

  // Todas las farmacias de la ciudad se ubican en el mapa: hacen falta para
  // calcular la más cercana, esté o no de turno.
  const farmaciasToLocate = useMemo(() => {
    if (selectedCity === "san-luis-capital") {
      return farmaciasSanLuisData.farmacias;
    }
    if (GROUP_CITY_DATA[selectedCity]) {
      return GROUP_CITY_DATA[selectedCity].farmacias;
    }
    return [];
  }, [selectedCity]);

  const dayWord = selectedDate === today ? "hoy" : "ese día";

  // Ids de las farmacias de turno en la fecha consultada.
  // Villa Mercedes: sale del calendario. San Luis: se compara el nombre del
  // turno cargado con el listado (si no coincide, el estado queda "desconocido").
  const dutyIds = useMemo(() => {
    if (!shift) return new Set();
    if (shift.farmacias) return new Set(shift.farmacias.map((item) => item.id));

    const target = normalizeText(shift.farmacia?.nombre);
    if (!target) return new Set();

    return new Set(
      farmaciasToLocate
        .filter((item) => {
          const name = normalizeText(item.nombre);
          return name && (name === target || `farmacia ${name}` === target);
        })
        .map((item) => item.id)
    );
  }, [shift, farmaciasToLocate]);

  function getStatus(item) {
    if (item.permanente) return { key: "24h", label: "Abierta 24 h" };
    if (dutyIds.size === 0) {
      return { key: "desconocido", label: "Confirmá el horario llamando" };
    }
    return dutyIds.has(item.id)
      ? { key: "turno", label: `De turno ${dayWord}` }
      : { key: "sin-turno", label: `Sin turno ${dayWord}` };
  }

  // Marcadores visibles. Villa Mercedes: las de turno y, si hay ubicación, las
  // 3 más cercanas sin turno (desvanecidas). San Luis: todas, como antes.
  const visiblePharmacies = useMemo(() => {
    if (!GROUP_CITY_DATA[selectedCity] || selectedCity === "san-luis-capital") {
      return mappedPharmacies;
    }

    const duty = mappedPharmacies.filter((item) => dutyIds.has(item.id));
    if (!userPosition) return duty;

    const closest = mappedPharmacies
      .filter((item) => !dutyIds.has(item.id))
      .map((item) => ({ item, distance: distanceKm(userPosition, item) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3)
      .map(({ item }) => item);

    return [...duty, ...closest];
  }, [selectedCity, mappedPharmacies, dutyIds, userPosition]);

  // La más cercana a la persona (de turno o no) y la de turno más cercana.
  const nearby = useMemo(() => {
    if (!userPosition || mappedPharmacies.length === 0) return null;

    const ranked = mappedPharmacies
      .map((item) => ({ item, distance: distanceKm(userPosition, item) }))
      .sort((a, b) => a.distance - b.distance);

    return {
      nearest: ranked[0],
      nearestOpen:
        ranked.find(({ item }) => item.permanente || dutyIds.has(item.id)) ?? null
    };
  }, [userPosition, mappedPharmacies, dutyIds]);

  // Villa Mercedes: sin ubicación de la persona solo se buscan las de turno;
  // con ubicación se buscan todas (hacen falta para calcular las más cercanas).
  const locateList = useMemo(() => {
    if (GROUP_CITY_DATA[selectedCity] && !userPosition) {
      return farmaciasToLocate.filter((item) => item.permanente || dutyIds.has(item.id));
    }
    return farmaciasToLocate;
  }, [selectedCity, userPosition, farmaciasToLocate, dutyIds]);

  useEffect(() => {
    const config = GEOCODING_CONFIG[selectedCity];

    if (!config || locateList.length === 0) {
      setMappedPharmacies([]);
      setGeocodingStatus("idle");
      return;
    }

    let cancelled = false;
    let blocked = false;

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const DAY_MS = 24 * 60 * 60 * 1000;

    async function locatePharmacies() {
      setGeocodingStatus("loading");
      let cache = {};

      try {
        cache = JSON.parse(localStorage.getItem(config.cacheKey) || "{}");
      } catch {
        cache = {};
      }

      const cityCenter = CITIES.find((item) => item.id === selectedCity);
      const gentle = Boolean(GROUP_CITY_DATA[selectedCity]);
      const located = [];

      for (const item of locateList) {
        const saved = cache[item.id];
        if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lng)) {
          located.push({ ...item, lat: saved.lat, lng: saved.lng });
        }
      }
      if (!cancelled) setMappedPharmacies([...located]);

      // Pendientes: las que no están en caché (o fallaron hace más de un día).
      // Las de turno van primero: son las que la persona necesita ya.
      const pending = locateList
        .filter((item) => {
          const saved = cache[item.id];
          if (!saved) return true;
          return Boolean(saved.failedAt) && Date.now() - saved.failedAt > DAY_MS;
        })
        .sort((a, b) => Number(dutyIds.has(b.id)) - Number(dutyIds.has(a.id)));

      function persist() {
        try {
          localStorage.setItem(config.cacheKey, JSON.stringify(cache));
        } catch {
          // La app sigue funcionando aunque el navegador no permita guardar caché.
        }
      }

      function record(result) {
        cache[result.id] = { lat: result.lat, lng: result.lng };
        located.push(result);
      }

      async function lookup(item) {
        // Sin dirección cargada se busca por nombre ("Farmacia X").
        const query = [
          item.direccion ? item.nombre : `Farmacia ${item.nombre}`,
          item.direccion,
          config.localidad,
          "Argentina"
        ]
          .filter(Boolean)
          .join(", ");

        try {
          const isDuty = dutyIds.has(item.id);
          const byName = !item.direccion && !isDuty;
          const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=${byName ? 5 : 1}&lat=${cityCenter.lat}&lon=${cityCenter.lng}`;
          const response = await fetch(url);

          // El servicio está limitando los pedidos: no insistir.
          if (response.status === 429 || response.status === 403) {
            blocked = true;
            return null;
          }
          if (!response.ok) return null;

          const result = await response.json();
          const features = result.features ?? [];
          const inRange = (candidate) => {
            const point = candidate?.geometry?.coordinates;
            return (
              Array.isArray(point) &&
              point.length >= 2 &&
              distanceKm({ lat: point[1], lng: point[0] }, cityCenter) <=
                config.maxDistanceKm
            );
          };
          // Primero una farmacia que coincida con el nombre; si no hay,
          // el primer resultado dentro de la zona (posición aproximada).
          const feature = byName
            ? features.find((candidate) => matchesPharmacyName(candidate, item)) ??
              features.find(inRange)
            : features[0];
          const coordinates = feature?.geometry?.coordinates;
          if (!Array.isArray(coordinates) || coordinates.length < 2) return null;

          const candidate = { lng: coordinates[0], lat: coordinates[1] };
          if (distanceKm(candidate, cityCenter) > config.maxDistanceKm) return null;
          return { ...item, ...candidate };
        } catch {
          return null;
        }
      }

      if (!gentle) {
        // San Luis: lotes de 3, igual que antes.
        for (let start = 0; start < pending.length; start += 3) {
          if (cancelled) return;
          const results = await Promise.all(pending.slice(start, start + 3).map(lookup));

          if (cancelled) return;
          results.forEach((result) => {
            if (result) record(result);
          });
          setMappedPharmacies([...located]);
          persist();
          await wait(350);
        }
      } else {
        const dutyPending = pending.filter((item) => dutyIds.has(item.id));
        const restPending = pending.filter((item) => !dutyIds.has(item.id));

        // 1) Las de turno (2 o 3 pedidos), con un reintento si alguna falla.
        let todo = dutyPending;
        for (let attempt = 0; attempt < 2 && todo.length > 0; attempt += 1) {
          if (attempt > 0) await wait(1500);
          if (cancelled) return;

          const results = await Promise.all(todo.map(lookup));
          if (cancelled) return;

          const failed = [];
          results.forEach((result, index) => {
            if (result) record(result);
            else failed.push(todo[index]);
          });
          setMappedPharmacies([...located]);
          persist();
          todo = failed;
        }

        // 2) El resto (para calcular las más cercanas): de a una y despacio.
        //    Si el servicio bloquea, se corta y se reintenta en otra visita.
        for (const item of restPending) {
          if (cancelled || blocked) break;

          const result = await lookup(item);
          if (cancelled) return;

          if (result) record(result);
          else if (!blocked) cache[item.id] = { failedAt: Date.now() };

          setMappedPharmacies([...located]);
          persist();
          await wait(1000);
        }
      }

      if (!cancelled) setGeocodingStatus("done");
    }

    locatePharmacies();
    return () => {
      cancelled = true;
    };
  }, [selectedCity, locateList, dutyIds]);

  const pharmacy = shift?.farmacia;
  const pharmacyLat = pharmacy?.lat;
  const pharmacyLng = pharmacy?.lng;
  const hasPharmacyCoordinates =
    Number.isFinite(pharmacyLat) && Number.isFinite(pharmacyLng);

  // useMemo evita que el mapa se recentre en cada render (por ejemplo al
  // llegar cada lote de farmacias geolocalizadas).
  const mapCenter = useMemo(() => {
    if (hasPharmacyCoordinates) return [pharmacyLat, pharmacyLng];
    if (city) return [city.lat, city.lng];
    return [-33.6757, -65.4578];
  }, [hasPharmacyCoordinates, pharmacyLat, pharmacyLng, city]);

  const googleMapsUrl = hasPharmacyCoordinates
    ? `https://www.google.com/maps/dir/?api=1&destination=${pharmacyLat},${pharmacyLng}${
        userPosition
          ? `&origin=${userPosition.lat},${userPosition.lng}`
          : ""
      }`
    : pharmacy?.direccion
      ? getDirectionsUrl(pharmacy, city?.name)
      : null;

  const locatedLabel = "farmacias";

  function chooseCity(cityId) {
    manualSelectionRef.current = true;
    setSelectedCity(cityId);
    setLocationStatus("manual-selected");
    setLocationMessage(`Ciudad seleccionada: ${CITIES.find((item) => item.id === cityId)?.name ?? ""}`);
  }

  function changeTab(tab) {
    setActiveTab(tab);
    setMapTarget(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function pickDateFromCalendar(date) {
    setSelectedDate(date);
    changeTab("hoy");
  }

  function refreshUserPosition() {
    if (!navigator.geolocation) {
      setPositionRequest("error");
      return;
    }

    setPositionRequest("loading");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setUserPosition({
          lat: position.coords.latitude,
          lng: position.coords.longitude
        });
        setPositionRequest("idle");
      },
      () => setPositionRequest("error"),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
    );
  }

  function shareTodayShift() {
    if (!city || !shift) return;

    const pharmacies = shift.farmacias?.length
      ? shift.farmacias
      : shift.farmacia
        ? [shift.farmacia]
        : [];

    if (!pharmacies.length) return;

    const permanent = GROUP_CITY_DATA[selectedCity]?.permanentes ?? [];
    const dateLabel = formatDate(effectiveDate);
    const lines = [
      `💊 MiFarma · Farmacias de turno en ${city.name}`,
      `📅 ${dateLabel}`,
      shift.grupo ? `Grupo ${shift.grupo}` : null,
      ...pharmacies.map((item) => `• ${item.nombre}${item.direccion ? ` — ${item.direccion}` : ""}${item.telefono ? ` · Tel: ${item.telefono}` : ""}`),
      shift.horario?.detalle ? `🕒 ${shift.horario.detalle}` : null,
      permanent.length ? "\nFarmacias permanentes:" : null,
      ...permanent.map((item) => `• ${item.nombre}${item.direccion ? ` — ${item.direccion}` : ""}`),
      "\nConsultá los turnos actualizados:",
      "https://farmacias.iored.com.ar/"
    ].filter(Boolean);

    window.open(
      `https://wa.me/?text=${encodeURIComponent(lines.join("\\n"))}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  async function shareFarmacia(item, status) {
    const cityName = city?.name ?? "San Luis";
    const tag =
      status && (status.key === "turno" || status.key === "24h")
        ? ` (${status.label})`
        : "";

    const lines = [
      `💊 ${item.nombre}${tag}`,
      item.direccion ? `📍 ${item.direccion}, ${cityName}` : `📍 ${cityName}`,
      item.telefono ? `📞 ${item.telefono}` : null,
      `🧭 ${getDirectionsUrl(item, cityName)}`
    ].filter(Boolean);

    const text = lines.join("\n");
    const url = `${window.location.origin}${window.location.pathname}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: `Farmacia ${item.nombre}`, text, url });
      } catch {
        // La persona canceló el menú de compartir.
      }
      return;
    }

    window.open(
      `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`,
      "_blank",
      "noopener,noreferrer"
    );
  }

  function showOnMap(item) {
    const spot = mappedPharmacies.find((point) => point.id === item.id);
    if (!spot) return;

    setMapTarget({ id: spot.id, position: [spot.lat, spot.lng], nonce: Date.now() });
    mapBoxRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
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

      <div className="relative mx-auto max-w-6xl px-4 pb-28 pt-5 sm:px-6 lg:px-8">
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

          <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAboutOpen(true)}
            aria-label="Cómo funciona la app"
            className="flex items-center gap-2 rounded-full border border-teal-300/25 bg-teal-300/[0.07] px-3 py-2 text-[11px] font-semibold text-teal-100 transition hover:bg-teal-300/15"
          >
            <Info size={15} />
            <span className="hidden sm:inline">Cómo funciona</span>
          </button>

          <div className="flex items-center gap-2 rounded-full border border-white/[0.09] bg-white/[0.035] px-3 py-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-teal-300 opacity-50" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-teal-300" />
            </span>
            <span className="text-[11px] font-medium text-slate-300">
              Servicio gratuito
            </span>
          </div>
          </div>
        </header>

        {activeTab === "hoy" ? (
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
            Encontrá la farmacia de turno más cercana en Villa Mercedes, Justo
            Daract o San Luis Capital, estés donde estés.
          </p>
        </section>
        ) : (
          <div className="h-6" />
        )}

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
              <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
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

        {city && activeTab === "hoy" && shift && (
          <div className="mx-auto mt-5 max-w-3xl">
            <button
              type="button"
              onClick={shareTodayShift}
              className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-teal-300 px-5 py-3 text-sm font-bold text-slate-950 transition hover:bg-teal-200"
            >
              <Share2 size={18} />
              Compartir turno de hoy por WhatsApp
            </button>
          </div>
        )}

        {city && activeTab === "hoy" && (
          <section className="mx-auto mt-6 max-w-3xl">
            <NearestCard
              cityName={city.name}
              userPosition={userPosition}
              locationStatus={locationStatus}
              positionRequest={positionRequest}
              geocodingStatus={geocodingStatus}
              locatedCount={mappedPharmacies.length}
              totalCount={locateList.length}
              nearby={nearby}
              getStatus={getStatus}
              onRetryLocation={refreshUserPosition}
              onShowOnMap={showOnMap}
              onShare={shareFarmacia}
            />
          </section>
        )}

        {city && activeTab === "hoy" && (
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

            {usingPreviousDayShift && (
              <p className="mb-3 rounded-2xl border border-amber-300/20 bg-amber-300/[0.07] px-4 py-3 text-xs leading-5 text-amber-100">
                Todavía no son las {VM_SHIFT_CHANGE_HOUR}:00, por eso sigue vigente
                el turno de ayer ({formatDate(effectiveDate)}).
              </p>
            )}

            {shift?.farmacias ? (
              <GroupShiftCard
                shift={shift}
                cityName={city.name}
                located={mappedPharmacies}
                userPosition={userPosition}
                geocodingStatus={geocodingStatus}
                onShowOnMap={showOnMap}
                onShare={(item) => shareFarmacia(item, getStatus(item))}
              />
            ) : shift ? (
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
                      href={getTelHref(pharmacy.telefono)}
                      className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.08]"
                    >
                      <Phone size={17} />
                      Llamar a la farmacia
                    </a>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      shareFarmacia(pharmacy, {
                        key: "turno",
                        label: `De turno ${dayWord}`
                      })
                    }
                    className="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.08] sm:col-span-2"
                  >
                    <Share2 size={17} />
                    Compartir esta farmacia
                  </button>
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

        {city && activeTab === "hoy" && (
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

            <div
              ref={mapBoxRef}
              className="relative h-[310px] overflow-hidden rounded-[28px] border border-white/[0.09] bg-[#111c2c] sm:h-[380px]"
            >

              <a
                href="https://iored.com.ar/"
                target="_blank"
                rel="noopener noreferrer"
                className="absolute bottom-4 right-4 z-[1000] flex items-center gap-2 rounded-full border border-teal-500/30 bg-slate-950/80 px-3 py-1.5 text-xs font-medium text-teal-200 backdrop-blur-md transition-all duration-300 hover:scale-105 hover:border-teal-400 hover:bg-slate-950 shadow-lg"
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
                <MapFocus target={mapTarget} markerRefs={markerRefs} />

                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                {visiblePharmacies.map((mappedPharmacy) => (
                  <Marker
                    key={mappedPharmacy.id}
                    position={[mappedPharmacy.lat, mappedPharmacy.lng]}
                    icon={
                      GROUP_CITY_DATA[selectedCity] &&
                      selectedCity !== "san-luis-capital" &&
                      !dutyIds.has(mappedPharmacy.id)
                        ? pharmacyIconMuted
                        : pharmacyIcon
                    }
                    ref={(marker) => {
                      if (marker) markerRefs.current[mappedPharmacy.id] = marker;
                    }}
                  >
                    <Popup>
                      <strong>{mappedPharmacy.nombre}</strong>
                      <br />
                      {mappedPharmacy.direccion && (
                        <>
                          {mappedPharmacy.direccion}
                          <br />
                        </>
                      )}
                      {mappedPharmacy.permanente
                        ? "Turno permanente"
                        : dutyIds.has(mappedPharmacy.id)
                          ? `De turno ${dayWord} · Grupo ${mappedPharmacy.grupo}`
                          : `Grupo de turno ${mappedPharmacy.grupo}`}
                      <br />
                      <a
                        href={getDirectionsUrl(mappedPharmacy, city.name)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Cómo llegar
                      </a>
                    </Popup>
                  </Marker>
                ))}

                {hasPharmacyCoordinates && (
                  <Marker position={[pharmacyLat, pharmacyLng]} icon={pharmacyIcon}>
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
                {visiblePharmacies.length > 0 && (
                  <span className="ml-3">
                    <span className="mr-2 inline-block h-2 w-2 rounded-full bg-teal-300" />
                    Farmacias ({visiblePharmacies.length})
                  </span>
                )}
              </div>
            </div>

            {locateList.length > 0 ? (
              <p className="mt-3 text-xs leading-5 text-slate-500">
                {geocodingStatus === "loading"
                  ? `Buscando ubicaciones de ${locatedLabel}… ${mappedPharmacies.length} de ${locateList.length} encontradas.`
                  : geocodingStatus === "done"
                    ? `Se ubicaron ${mappedPharmacies.length} de ${locateList.length} ${locatedLabel}. Las posiciones se calculan a partir de ${selectedCity === "villa-mercedes" ? "los nombres" : "las direcciones"} y deben verificarse antes de usarlas como ubicación exacta.`
                    : "El mapa muestra el centro de la ciudad como referencia."}
              </p>
            ) : (
              !hasPharmacyCoordinates && (
                <p className="mt-3 text-xs leading-5 text-slate-500">
                  Todavía no cargamos las ubicaciones de las farmacias de {city.name}.
                </p>
              )
            )}
          </section>
        )}

        {city && activeTab === "calendario" && (
          <CalendarTab
            key={city.id}
            cityId={city.id}
            cityName={city.name}
            selectedDate={selectedDate}
            today={today}
            farmacias={farmaciasToLocate}
            onPickDate={pickDateFromCalendar}
          />
        )}

        {activeTab === "hoy" && (
          <>
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
          </>
        )}

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

      <TabBar active={activeTab} onChange={changeTab} />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </main>
  );
}

export default App;
