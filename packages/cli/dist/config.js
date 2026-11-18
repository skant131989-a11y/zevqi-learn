import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readJson, writeJson } from "./util.js";
import { envVar } from "./env.js";
export const DEFAULT_PROJECT = { gate: "warn", share: "scores", passRatio: 2 / 3, maxFiles: 12 };
export function globalDir() {
    return envVar("HOME") || path.join(os.homedir(), ".zlearn");
}
export function globalConfigPath() {
    return path.join(globalDir(), "config.json");
}
export function loadGlobal() {
    return readJson(globalConfigPath(), {});
}
export function saveGlobal(cfg) {
    writeJson(globalConfigPath(), cfg, 0o600);
}
export function projectDir(root) {
    return path.join(root, ".zlearn");
}
export function loadProject(root) {
    return { ...DEFAULT_PROJECT, ...readJson(path.join(projectDir(root), "config.json"), {}) };
}
export function saveProject(root, cfg) {
    writeJson(path.join(projectDir(root), "config.json"), cfg);
}
export function apiKey(cfg) {
    return envVar("API_KEY") || (cfg.provider === "openai" ? process.env.OPENAI_API_KEY : process.env.ANTHROPIC_API_KEY) || cfg.apiKey || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY;
}
export function providerOf(cfg) {
    if (cfg.provider)
        return cfg.provider;
    if (envVar("PROVIDER") === "openai")
        return "openai";
    if (!process.env.ANTHROPIC_API_KEY && process.env.OPENAI_API_KEY)
        return "openai";
    return "anthropic";
}
export function ensureGitignore(root) {
    const file = path.join(root, ".gitignore");
    const line = ".zlearn/";
    let text = "";
    try {
        text = fs.readFileSync(file, "utf8");
    }
    catch {
        // no .gitignore yet
    }
    if (!text.split(/\r?\n/).some((l) => l.trim() === line || l.trim() === ".zlearn")) {
        fs.writeFileSync(file, text + (text && !text.endsWith("\n") ? "\n" : "") + line + "\n");
    }
}
