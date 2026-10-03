/**
 * This device's location, once — for a QR screen proving it is inside the
 * school (see validateScreenLocation). Browser only.
 */
export type DeviceLocation = { lat: number; lng: number; accuracyM: number };

export function readDeviceLocation(timeoutMs = 20_000): Promise<DeviceLocation | { error: string }> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve({ error: "This browser cannot share its location — the punch QR needs it." });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy }),
      (e) =>
        resolve({
          error:
            e.code === e.PERMISSION_DENIED
              ? "Location is blocked for this site. Allow location in the browser, then try again — the punch QR is shown only inside the school."
              : "Could not get this device's location. Turn on Wi-Fi / GPS and try again.",
        }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}
