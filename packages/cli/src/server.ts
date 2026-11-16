import crypto from "node:crypto";
import http from "node:http";
import { loadProject } from "./config.js";
import { complete, getLesson, knowledgeMap, listLessons, type Lesson } from "./lessons.js";
import { syncLesson } from "./quiz.js";
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
.bar{height:8px;border-radius:99px;background:#e3e5ea;overflow:hidden}.bar i{display:block;height:100%;background:var(--lime)}
`;

function page(title: string, body: string, tab: string, token: string): string {
  const tabs: [string, string][] = [["", "Lessons"], ["map", "Knowledge map"]];
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(title)} · zlearn</title><style>${CSS}</style></head><body><main>
<h1>zlearn</h1><div class="muted">Understand what your agent wrote.</div>
<nav>${tabs.map(([p, l]) => `<a class="${tab === p ? "on" : ""}" href="/${p}?t=${token}">${l}</a>`).join("")}</nav>${body}</main></body></html>`;
}

function badge(l: Lesson) {
  return `<span class="pill p-${l.status}">${l.status}${l.status !== "pending" && l.total ? ` ${l.correct}/${l.total}` : ""}</span>`;
}

function home(root: string, token: string): string {
  const lessons = listLessons(root);
  if (lessons.length === 0) return page("Lessons", `<div class="card">No lessons yet. After your agent edits files and finishes a turn, a lesson shows up here.</div>`, "", token);
  const rows = lessons
    .slice(0, 50)
    .map((l) => `<div class="card"><div>${badge(l)} <span class="muted">${h(timeAgo(l.createdAt))} · ${h(l.repo)}</span></div>
<p style="margin:8px 0 6px">${h(l.summary.slice(0, 220))}${l.summary.length > 220 ? "…" : ""}</p>
<div class="muted">${l.changedFiles.slice(0, 4).map((f) => `<code>${h(f)}</code>`).join(" ")}${l.changedFiles.length > 4 ? ` +${l.changedFiles.length - 4} more` : ""}</div>
<p style="margin:10px 0 0"><a href="/lesson/${l.id}?t=${token}">${l.status === "pending" ? "Take the quiz →" : "Review →"}</a></p></div>`)
    .join("");
  const open = lessons.filter((l) => l.status === "pending").length;
  return page("Lessons", `<p><b>${open}</b> waiting for review.</p>${rows}`, "", token);
}

function lessonPage(l: Lesson, token: string): string {
  const files = l.files.map((f) => `<tr><td><code>${h(f.path)}</code></td><td>${h(f.note)}</td></tr>`).join("");
  const qs = l.questions
    .map((q, i) => `<div class="card"><b>${i + 1}. ${h(q.q)}</b>${q.options.map((o, n) => `<label class="opt"><input type="radio" name="q${i}" value="${n}" ${l.status !== "pending" ? "disabled" : ""}> ${h(o)}</label>`).join("")}<div class="muted why" id="why${i}"></div></div>`)
    .join("");
  const script = `
const id=${JSON.stringify(l.id)},token=${JSON.stringify(token)},answers=${JSON.stringify(l.questions.map((q) => q.answer))},whys=${JSON.stringify(l.questions.map((q) => q.why))};
document.getElementById('go').onclick=async()=>{
 const picks=answers.map((_,i)=>{const r=document.querySelector('input[name=q'+i+']:checked');return r?Number(r.value):-1});
 if(picks.includes(-1)){alert('Answer every question first.');return}
 let correct=0;picks.forEach((p,i)=>{const ok=p===answers[i];if(ok)correct++;document.getElementById('why'+i).innerHTML=(ok?'✅ Correct. ':'❌ Not quite. ')+whys[i]});
 const r=await fetch('/api/answer?t='+token,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,correct})});
 const j=await r.json();document.getElementById('result').textContent=j.status==='passed'?'Passed '+correct+'/'+answers.length+'.':correct+'/'+answers.length+'. Re-read the summary and try again from the terminal: zlearn learn';
 document.getElementById('go').disabled=true};`;
  return page("Lesson", `<p><a href="/?t=${token}">← All lessons</a></p><div class="card">${badge(l)} <span class="muted">${h(timeAgo(l.createdAt))}</span><h2 style="margin-top:8px">What changed</h2><p>${h(l.summary)}</p><table>${files}</table></div>
<h2>Quick check</h2>${qs}${l.status === "pending" ? `<p><button id="go">Check my answers</button></p><p id="result" class="muted"></p><script>${script}</script>` : `<p class="muted">Already completed.</p>`}`, "", token);
}

function mapPage(root: string, token: string): string {
  const rows = knowledgeMap(root)
    .map((f) => {
      const pct = f.changes ? Math.round((f.passed / f.changes) * 100) : 0;
      return `<tr><td><code>${h(f.path)}</code></td><td>${f.changes}</td><td style="width:140px"><div class="bar"><i style="width:${pct}%"></i></div></td><td>${pct}%</td><td>${f.open ? `<span class="pill p-pending">${f.open} open</span>` : ""}</td></tr>`;
    })
    .join("");
  return page("Knowledge map", `<p class="muted">How much of each AI-changed file you have actually reviewed. Files with open lessons are the ones nobody has checked yet.</p><div class="card"><table><tr><th>File</th><th>AI changes</th><th>Understood</th><th></th><th></th></tr>${rows || `<tr><td colspan=5 class="muted">Nothing yet.</td></tr>`}</table></div>`, "map", token);
}

export function startServer(root: string, port: number, onReady: (url: string) => void): http.Server {
  const token = crypto.randomBytes(12).toString("hex"); // keeps other websites and local processes from posting answers
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const host = (req.headers.host ?? "").split(":")[0];
    if (host !== "127.0.0.1" && host !== "localhost") {
      res.writeHead(403).end("Forbidden");
      return;
    }
    if (url.searchParams.get("t") !== token) {
      res.writeHead(403, { "content-type": "text/plain" }).end("Open the link printed by `zlearn ui`.");
      return;
    }
    const send = (code: number, type: string, body: string) => res.writeHead(code, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" }).end(body);
    if (req.method === "POST" && url.pathname === "/api/answer") {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", async () => {
        try {
          const { id, correct } = JSON.parse(raw) as { id: string; correct: number };
          const lesson = getLesson(root, id);
          if (!lesson || lesson.status !== "pending") return send(404, "application/json", JSON.stringify({ error: "not found" }));
          const cfg = loadProject(root);
          const done = complete(root, lesson, Math.max(0, Math.min(lesson.questions.length, Number(correct) || 0)), cfg.passRatio);
          await syncLesson(done, cfg.share);
          send(200, "application/json", JSON.stringify({ status: done.status }));
        } catch {
          send(400, "application/json", JSON.stringify({ error: "bad request" }));
        }
      });
      return;
    }
    if (url.pathname === "/") return send(200, "text/html; charset=utf-8", home(root, token));
    if (url.pathname === "/map") return send(200, "text/html; charset=utf-8", mapPage(root, token));
    const m = url.pathname.match(/^\/lesson\/(l_[a-f0-9]+)$/);
    if (m) {
      const lesson = getLesson(root, m[1]);
      return lesson ? send(200, "text/html; charset=utf-8", lessonPage(lesson, token)) : send(404, "text/plain", "Not found");
    }
    send(404, "text/plain", "Not found");
  });
  server.listen(port, "127.0.0.1", () => onReady(`http://127.0.0.1:${port}/?t=${token}`));
  return server;
}
