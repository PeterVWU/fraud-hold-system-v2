import type { Env } from "./types";
import { sha256Hex } from "./verification";

const COOKIE_NAME = "fraud_review_session";
const SESSION_TTL_SECONDS = 8 * 60 * 60;

export async function createStaffSessionCookie(env: Env, password: string, now: Date): Promise<string | null> {
  if (!env.STAFF_REVIEW_PASSWORD || !env.STAFF_SESSION_SECRET) {
    return null;
  }
  if (!(await timingSafeEqual(password, env.STAFF_REVIEW_PASSWORD))) {
    return null;
  }
  const expiresAt = Math.floor(now.getTime() / 1000) + SESSION_TTL_SECONDS;
  const payload = `${expiresAt}`;
  const signature = await sign(env.STAFF_SESSION_SECRET, payload);
  return `${COOKIE_NAME}=${payload}.${signature}; Path=/staff; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}`;
}

export async function isStaffRequest(request: Request, env: Env, now: Date): Promise<boolean> {
  if (!env.STAFF_SESSION_SECRET) {
    return false;
  }
  const value = readCookie(request, COOKIE_NAME);
  if (!value) {
    return false;
  }
  const [expiresAtRaw, signature] = value.split(".");
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt < Math.floor(now.getTime() / 1000) || !signature) {
    return false;
  }
  const expected = await sign(env.STAFF_SESSION_SECRET, expiresAtRaw);
  return timingSafeEqual(signature, expected);
}

export function clearStaffSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/staff; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function sign(secret: string, payload: string): Promise<string> {
  return sha256Hex(`${secret}:${payload}`);
}

async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const aHash = await sha256Hex(a);
  const bHash = await sha256Hex(b);
  if (aHash.length !== bHash.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < aHash.length; i += 1) {
    diff |= aHash.charCodeAt(i) ^ bHash.charCodeAt(i);
  }
  return diff === 0;
}

function readCookie(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) {
    return null;
  }
  for (const part of cookie.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === name) {
      return rawValue.join("=");
    }
  }
  return null;
}
