import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJson, writeJson } from "./util.js";

export type Gate = "off" | "warn" | "block";
export type Share = "scores" | "summaries";

export type GlobalConfig = {
  provider?: "anthropic" | "openai";
  model?: string;
  baseUrl?: string;
  apiKey?: string; // optional; prefer environment variables
  team?: { server: string; key: string; email: string; name?: string };
};

export type ProjectConfig = {
  gate: Gate; // what happens when you commit with un-reviewed AI changes
  share: Share; // what leaves your machine for the team dashboard
  passRatio: number; // share of correct answers needed to pass a lesson
  maxFiles: number;
};

export const DEFAULT_PROJECT: ProjectConfig = { gate: "warn", share: "scores", passRatio: 2 / 3, maxFiles: 12 };

export function globalDir(): string {
  return process.env.ZLEARN_HOME || path.join(os.homedir(), ".zlearn");
}

export function globalConfigPath(): string {
  return path.join(globalDir(), "config.json");
}

export function loadGlobal(): GlobalConfig {
  return readJson<GlobalConfig>(globalConfigPath(), {});
}

export function saveGlobal(cfg: GlobalConfig) {
  writeJson(globalConfigPath(), cfg, 0o600);
}

export function projectDir(root: string): string {
  return path.join(root, ".zlearn");
}

export function loadProject(root: string): ProjectConfig {
  return { ...DEFAULT_PROJECT, ...readJson<Partial<ProjectConfig>>(path.join(projectDir(root), "config.json"), {}) };
}

export function saveProject(root: string, cfg: ProjectConfig) {
  writeJson(path.join(projectDir(root), "config.json"), cfg);
}

export function apiKey(cfg: GlobalConfig): string | undefined {
  return process.env.ZLEARN_API_KEY || (cfg.provider === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY) || cfg.apiKey || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
}

export function providerOf(cfg: GlobalConfig): "anthropic" | "openai" {
  if (cfg.provider) return cfg.provider;
  if (process.env.ZLEARN_PROVIDER === "openai") return "openai";
  if (!process.env.ANTHROPIC_API_KEY && process.env.OPENAI_API_KEY) return "openai";
  return "anthropic";
}

export function ensureGitignore(root: string) {
  const file = path.join(root, ".gitignore");
  const line = ".zlearn/";
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    // no .gitignore yet
  }
  if (!text.split(/\r?\n/).some((l) => l.trim() === line || l.trim() === ".zlearn")) {
    fs.writeFileSync(file, text + (text && !text.endsWith("\n") ? "\n" : "") + line + "\n");
  }
}
