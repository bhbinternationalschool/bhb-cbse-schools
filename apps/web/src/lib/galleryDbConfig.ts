export function galleryDualWriteDbEnabled(): boolean {
  const flag = process.env.GALLERY_DUAL_WRITE_DB?.trim().toLowerCase();
  if (flag === "false" || flag === "0") return false;
  return true;
}

export function galleryReadFromDbEnabled(): boolean {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_GALLERY_READ_FROM_DB === "true";
  }
  return process.env.GALLERY_READ_FROM_DB === "true";
}
