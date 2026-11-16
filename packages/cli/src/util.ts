import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// Colour is on only for a real terminal, and never when NO_COLOR is set (https://no-color.org) or FORCE_COLOR=0.
const colourOn = (): boolean => {
  if (process.env.NO_COLOR !== undefined && process.env.NO_COLOR !== "") return false;
  if (process.env.FORCE_COLOR === "0") return false;
  if (process.env.FORCE_COLOR) return true;
  return Boolean(process.stdout.isTTY);
};
const paint = (code: string) => (s: string) => (colourOn() ? `\x1b[${code}m${s}\x1b[0m` : s);

export const c = {
  bold: paint("1"),
  dim: paint("2"),
  green: paint("32"),
  red: paint("31"),
  yellow: paint("33"),
  cyan: paint("36"),
};

export class CliError extends Error {
  constructor(message: string, readonly code = 1, readonly hint?: string) {
    super(message);
  }
}

export function uid(prefix = ""): string {
  return prefix + crypto.randomBytes(6).toString("hex");
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Atomic write (temp file + rename), so a crash never leaves half a JSON file behind. */
export function writeJson(file: string, data: unknown, mode?: number) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}

export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/** Reads a secret without echoing it. Falls back to one line of piped input when stdin is not a terminal. */
export async function readSecret(prompt: string): Promise<string> {
  process.stderr.write(prompt);
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    const text = await readStdin();
    process.stderr.write("\n");
    return text.split(/\r?\n/)[0]?.trim() ?? "";
  }
  return new Promise((resolve, reject) => {
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const done = (err?: Error) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stderr.write("\n");
      err ? reject(err) : resolve(value.trim());
    };
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") return done();
        if (ch === "\u0003") return done(new CliError("Cancelled.", 130));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else if (ch >= " ") value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
}

export function timeAgo(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/** Masks a secret for display: first 6 characters, never the rest. */
export function mask(secret: string | undefined): string {
  return secret ? `${secret.slice(0, 6)}…` : "(not set)";
}

/** Throws a CliError; the entry point prints it and sets the exit code. */
export function fail(message: string, code = 1, hint?: string): never {
  throw new CliError(message, code, hint);
}
