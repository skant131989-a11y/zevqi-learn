import { spawn } from "node:child_process";
/**
 * Opens a local dashboard link in the default browser. Only ever used for the http://127.0.0.1 address `zevqi ui` prints,
 * and the address is checked first, so nothing else can be launched through it.
 */
const LOCAL_URL = /^http:\/\/127\.0\.0\.1:\d{2,5}\/[A-Za-z0-9_\-./?=]*$/;
/** Opening a browser is skipped for --no-open, ZEVQI_NO_OPEN, CI, and sessions with no display (SSH without X forwarding). */
export function shouldOpenBrowser(flags, env = process.env) {
    if (flags["no-open"])
        return false;
    if (env.ZEVQI_NO_OPEN)
        return false;
    if (env.CI)
        return false;
    if (process.platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY)
        return false;
    return true;
}
export function openBrowser(url) {
    if (!LOCAL_URL.test(url))
        return false;
    try {
        const child = process.platform === "win32"
            ? spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore", windowsHide: true })
            : spawn(process.platform === "darwin" ? "open" : "xdg-open", [url], { detached: true, stdio: "ignore" });
        child.on("error", () => undefined); // a missing opener must never crash the dashboard
        child.unref();
        return true;
    }
    catch {
        return false;
    }
}
