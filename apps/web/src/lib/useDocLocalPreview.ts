"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Preview URL for a doc-upload row. The server proxy URL
 * (/api/documents/{subject}/{id}/{docKey}) only resolves once the record
 * is actually saved — it reads driveFileId from the DB, and the upload
 * route deliberately doesn't write there (Phase 3 of
 * docs/GOOGLE_DRIVE_DOCUMENTS_PLAN.md). Without this, the moment between
 * "uploaded" and "saved" shows a broken image / dead link. Holds a local
 * object URL for whatever was just uploaded in this session instead.
 */
export function useDocLocalPreview(fileUrl: string, uploadedAt: string) {
  const [localPreview, setLocalPreview] = useState<{
    key: string;
    url: string;
  } | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  function setFromFile(file: File, key: string) {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(file);
    objectUrlRef.current = url;
    setLocalPreview({ key, url });
  }

  function clear() {
    if (objectUrlRef.current) {
      URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = null;
    }
    setLocalPreview(null);
  }

  const hasFile = !!fileUrl;
  const cacheBustedUrl =
    hasFile && uploadedAt
      ? `${fileUrl}${fileUrl.includes("?") ? "&" : "?"}t=${encodeURIComponent(uploadedAt)}`
      : fileUrl;
  const key = hasFile ? `${fileUrl}|${uploadedAt}` : "";
  const viewUrl =
    localPreview && localPreview.key === key ? localPreview.url : cacheBustedUrl;

  return { viewUrl, previewKey: key, setFromFile, clear };
}
