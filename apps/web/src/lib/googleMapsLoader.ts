type GoogleMapsNamespace = {
  Map: new (
    el: HTMLElement,
    opts: Record<string, unknown>,
  ) => {
    fitBounds: (b: unknown) => void;
  };
  Marker: new (opts: Record<string, unknown>) => { setMap: (m: unknown) => void };
  LatLngBounds: new () => {
    extend: (p: { lat: number; lng: number }) => void;
  };
  SymbolPath: { CIRCLE: unknown };
};

declare global {
  interface Window {
    google?: { maps: GoogleMapsNamespace };
  }
}

let loadPromise: Promise<GoogleMapsNamespace> | null = null;

export function loadGoogleMaps(apiKey: string): Promise<GoogleMapsNamespace> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Maps only available in browser"));
  }
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.google?.maps) resolve(window.google.maps);
      else reject(new Error("Google Maps failed to load"));
    };
    script.onerror = () => reject(new Error("Google Maps script blocked"));
    document.head.appendChild(script);
  });

  return loadPromise;
}
