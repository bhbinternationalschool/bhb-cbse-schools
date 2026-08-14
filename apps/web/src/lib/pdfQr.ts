import QRCode from "qrcode";

/** PNG data URL for a QR code encoding `payload` — shared by idCardsPdf.ts and admitCardPdf.ts. */
export async function qrDataUrlFor(payload: string): Promise<string> {
  return QRCode.toDataURL(payload, { margin: 0, width: 200 });
}
