import { NextResponse } from "next/server";

export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "bad_request"
  | "conflict"
  | "upgrade_required"
  /** Every child of this parent's family is inactive — the app is closed to them. */
  | "family_inactive"
  | "server_error";

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function apiOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function apiErr(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          details: error.details,
        },
      },
      { status: error.status },
    );
  }
  console.error("[api/v1]", error);
  return NextResponse.json(
    {
      ok: false,
      error: {
        code: "server_error",
        message: "Internal server error",
      },
    },
    { status: 500 },
  );
}
