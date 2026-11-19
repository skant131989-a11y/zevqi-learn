import crypto from "node:crypto";
import http from "node:http";
import { loadProject } from "./config.js";
import { complete, getLesson, knowledgeMap, listLessons, setResponse } from "./lessons.js";
import { syncLesson } from "./quiz.js";
import { progressLine, reviewProgress } from "./progress.js";
import { escapeHtml as h, timeAgo } from "./util.js";
const CSS = `
:root{--ink:#101216;--fog:#f4f5f7;--line:#e3e5ea;--violet:#5b4bff;--lime:#c8f135;--slate:#5b6270}
*{box-sizing:border-box}body{margin:0;background:var(--fog);color:var(--ink);font:16px/1.55 system-ui,Segoe UI,sans-serif}
main{max-width:860px;margin:0 auto;padding:28px 18px 80px}
h1{font-size:28px;margin:0 0 4px}h2{font-size:18px;margin:28px 0 10px}
nav{display:flex;gap:14px;margin:10px 0 22px}nav a{color:var(--slate);text-decoration:none;font-weight:600}nav a.on{color:var(--ink);border-bottom:3px solid var(--lime)}
.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin:10px 0}
.pill{display:inline-block;border-radius:99px;padding:2px 10px;font-size:12px;font-weight:700}
.p-pending{background:#fff1e6;color:#b45309}.p-passed{background:#e8f9c6;color:#3d5a00}.p-failed{background:#fde8e8;color:#9b1c1c}
.muted{color:var(--slate);font-size:14px}code{background:#eef0f3;border-radius:6px;padding:1px 6px;font-size:13px}
button{border:0;border-radius:99px;background:var(--violet);color:#fff;font-weight:700;padding:10px 20px;cursor:pointer;font-size:15px}
label.opt{display:block;border:1px solid var(--line);border-radius:12px;padding:10px 12px;margin:8px 0;cursor:pointer;background:#fff}
label.opt:hover{border-color:var(--violet)}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:8px 6px;border-bottom:1px solid var(--line);font-size:14px}
.kind{display:inline-block;background:var(--ink);color:#fff;border-radius:6px;padding:1px 7px;font-size:11px;font-weight:700;margin-right:6px;text-transform:uppercase;letter-spacing:.04em}ul.pts{margin:6px 0 0;padding-left:20px}.pts li{margin:3px 0}textarea,input[type=text]{width:100%;border:1px solid var(--line);border-radius:10px;padding:8px 10px;font:inherit}
.bar{height:8px;border-radius:99px;background:#e3e5ea;overflow:hidden}.bar i{display:block;height:100%;background:var(--lime)}
`;
function page(title, body, tab, token) {
    const tabs = [["", "Lessons"], ["map", "Knowledge map"]];
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(title)} · Zevqi</title><style>${CSS}</style></head><body><main>
<h1>Zevqi</h1><div class="muted">Understand what your agent wrote.</div>
<nav>${tabs.map(([p, l]) => `<a class="${tab === p ? "on" : ""}" href="/${p}?t=${token}">${l}</a>`).join("")}</nav>${body}</main></body></html>`;
}
function badge(l) {
    return `<span class="pill p-${l.status}">${l.status}${l.status !== "pending" && l.total ? ` ${l.correct}/${l.total}` : ""}</span>`;
}
function home(root, token) {
    const lessons = listLessons(root);
    if (lessons.length === 0)
        return page("Lessons", `<div class="card">No lessons yet. After your agent edits files and finishes a turn, a lesson shows up here.</div>`, "", token);
    const rows = lessons
        .slice(0, 50)
        .map((l) => `<div class="card"><div>${badge(l)} <span class="muted">${h(timeAgo(l.createdAt))} · ${h(l.repo)}</span></div>
<p style="margin:8px 0 6px">${h(l.summary.slice(0, 220))}${l.summary.length > 220 ? "…" : ""}</p>
<div class="muted">${l.changedFiles.slice(0, 4).map((f) => `<code>${h(f)}</code>`).join(" ")}${l.changedFiles.length > 4 ? ` +${l.changedFiles.length - 4} more` : ""}</div>
<p style="margin:10px 0 0"><a href="/lesson/${l.id}?t=${token}">${l.status === "pending" ? "Take the quiz →" : "Review →"}</a></p></div>`)
        .join("");
    const open = lessons.filter((l) => l.status === "pending").length;
    const line = progressLine(reviewProgress(root));
    return page("Lessons", `<p><b>${open}</b> waiting for review.${line ? ` <span class="muted">${h(line)}</span>` : ""}</p>${rows}`, "", token);
}
function lessonPage(l, token, nextId = null) {
    const files = l.files.map((f) => `<tr><td><code>${h(f.path)}</code></td><td>${h(f.note)}</td></tr>`).join("");
    const points = (title, items) => (items?.length ? `<h2 style="margin-top:14px;font-size:15px">${h(title)}</h2><ul class="pts">${items.map((x) => `<li>${h(x)}</li>`).join("")}</ul>` : "");
    const qs = l.questions
        .map((q, i) => `<div class="card">${q.kind ? `<span class="kind">${h(q.kind)}</span>` : ""}<b>${i + 1}. ${h(q.q)}</b>${q.options.map((o, n) => `<label class="opt"><input type="radio" name="q${i}" value="${n}" ${l.status !== "pending" ? "disabled" : ""}> ${h(o)}</label>`).join("")}<div class="muted why" id="why${i}"></div></div>`)
        .join("");
    const script = `
const id=${JSON.stringify(l.id)},token=${JSON.stringify(token)},answers=${JSON.stringify(l.questions.map((q) => q.answer))},whys=${JSON.stringify(l.questions.map((q) => q.why))};
document.getElementById('go').onclick=async()=>{
 const picks=answers.map((_,i)=>{const r=document.querySelector('input[name=q'+i+']:checked');return r?Number(r.value):-1});
 if(picks.includes(-1)){alert('Answer every question first.');return}
 let correct=0;picks.forEach((p,i)=>{const ok=p===answers[i];if(ok)correct++;document.getElementById('why'+i).innerHTML=(ok?'✅ Correct. ':'❌ Not quite. ')+whys[i]});
 const r=await fetch('/api/answer?t='+token,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,correct,response:(document.querySelector('input[name=call]:checked')||{}).value||'understood',note:(document.getElementById('note')||{}).value||''})});
 const j=await r.json();const res=document.getElementById('result');
 res.textContent=(j.status==='passed'?'Passed '+correct+'/'+answers.length+'.':correct+'/'+answers.length+'. Re-read the summary, then retake it by running zevqi in a terminal.')+(j.line?' '+j.line:'');
 const next=document.createElement('a');next.style.fontWeight='700';next.style.marginLeft='6px';
 if(j.nextId){next.href='/lesson/'+j.nextId+'?t='+token;next.textContent='Next lesson →'}else{next.href='/map?t='+token;next.textContent='See your knowledge map →'}
 res.appendChild(next);
 document.getElementById('go').disabled=true};`;
    return page("Lesson", `<p><a href="/?t=${token}">← All lessons</a></p><div class="card">${badge(l)} <span class="muted">${h(timeAgo(l.createdAt))}</span><h2 style="margin-top:8px">What changed</h2><p>${h(l.summary)}</p><table>${files}</table>${points("Decisions in the code", l.decisions)}${points("It depends on", l.depends)}${points("What could break", l.risks)}</div>
<h2>Quick check</h2>${qs}${l.status === "pending" ? `<div class="card" id="callbox"><b>Do you feel you understand this change?</b><p class="muted" style="margin:4px 0 8px">A score is not the same as understanding. If you are not sure, say so. It will not count as evidence for your team until you follow up.</p><label class="opt"><input type="radio" name="call" value="understood" checked> Yes, I understand it</label><label class="opt"><input type="radio" name="call" value="clarify"> I need clarification</label><label class="opt"><input type="radio" name="call" value="investigate"> I need to investigate further</label><input type="text" id="note" maxlength="300" placeholder="What is unclear? Optional" style="margin-top:6px"></div><p><button id="go">Check my answers</button></p><p id="result" class="muted"></p><script>${script}</script>` : `<p class="muted">Already completed. ${nextId ? `<a href="/lesson/${nextId}?t=${token}"><b>Next lesson →</b></a>` : `<a href="/map?t=${token}"><b>See your knowledge map →</b></a>`}</p>`}`, "", token);
}
function mapPage(root, token) {
    const rows = knowledgeMap(root)
        .map((f) => {
        const pct = f.changes ? Math.round((f.passed / f.changes) * 100) : 0;
        return `<tr><td><code>${h(f.path)}</code></td><td>${f.changes}</td><td style="width:140px"><div class="bar"><i style="width:${pct}%"></i></div></td><td>${pct}%</td><td>${f.open ? `<span class="pill p-pending">${f.open} open</span>` : ""}</td></tr>`;
    })
        .join("");
    return page("Knowledge map", `<p class="muted">How much of each AI-changed file you have actually reviewed. Files with open lessons are the ones nobody has checked yet.</p><div class="card"><table><tr><th>File</th><th>AI changes</th><th>Understood</th><th></th><th></th></tr>${rows || `<tr><td colspan=5 class="muted">Nothing yet.</td></tr>`}</table></div>`, "map", token);
}
export function startServer(root, port, onReady, opts = {}) {
    const token = crypto.randomBytes(12).toString("hex"); // keeps other websites and local processes from posting answers
    const server = http.createServer((req, res) => {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        const host = (req.headers.host ?? "").split(":")[0];
        if (host !== "127.0.0.1" && host !== "localhost") {
            res.writeHead(403).end("Forbidden");
            return;
        }
        if (url.searchParams.get("t") !== token) {
            res.writeHead(403, { "content-type": "text/plain" }).end("Open the link printed by `zevqi ui`.");
            return;
        }
        const send = (code, type, body) => res.writeHead(code, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" }).end(body);
        if (req.method === "POST" && url.pathname === "/api/answer") {
            let raw = "";
            req.on("data", (d) => (raw += d));
            req.on("end", async () => {
                try {
                    const { id, correct, response, note } = JSON.parse(raw);
                    const lesson = getLesson(root, id);
                    if (!lesson || lesson.status !== "pending")
                        return send(404, "application/json", JSON.stringify({ error: "not found" }));
                    const cfg = loadProject(root);
                    let done = complete(root, lesson, Math.max(0, Math.min(lesson.questions.length, Number(correct) || 0)), cfg.passRatio);
                    if (response === "understood" || response === "clarify" || response === "investigate")
                        done = setResponse(root, done, response, typeof note === "string" ? note : undefined);
                    await syncLesson(done, cfg.share);
                    const progress = reviewProgress(root);
                    send(200, "application/json", JSON.stringify({ status: done.status, line: progressLine(progress), nextId: progress.nextId, progress }));
                }
                catch {
                    send(400, "application/json", JSON.stringify({ error: "bad request" }));
                }
            });
            return;
        }
        if (url.pathname === "/")
            return send(200, "text/html; charset=utf-8", home(root, token));
        if (url.pathname === "/map")
            return send(200, "text/html; charset=utf-8", mapPage(root, token));
        const m = url.pathname.match(/^\/lesson\/(l_[a-f0-9]+)$/);
        if (m) {
            const lesson = getLesson(root, m[1]);
            return lesson ? send(200, "text/html; charset=utf-8", lessonPage(lesson, token, reviewProgress(root).nextId)) : send(404, "text/plain", "Not found");
        }
        send(404, "text/plain", "Not found");
    });
    // With the default port, a busy 4317 (another project's dashboard, say) moves on to the next free one instead of failing.
    const attempts = Math.max(1, opts.tries ?? 1);
    const listen = (p, left) => {
        server.once("error", (e) => {
            if (e.code === "EADDRINUSE" && left > 1)
                return listen(p + 1, left - 1);
            if (opts.onError)
                return opts.onError(e, p);
            throw e;
        });
        server.listen(p, "127.0.0.1", () => {
            server.removeAllListeners("error");
            onReady(`http://127.0.0.1:${p}/?t=${token}`);
        });
    };
    listen(port, attempts);
    return server;
}
/** The address of one page on a running dashboard, from the base address `startServer` reports. */
export function pageUrl(base, pathname) {
    return base.replace("/?t=", `${pathname}?t=`);
}
