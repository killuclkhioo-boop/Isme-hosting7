const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const os = require('os');
const session = require('express-session');
const pidusage = require('pidusage');

const app = express();
const port = process.env.PORT || 3000;

if (!fs.existsSync('./bots')) fs.mkdirSync('./bots');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'kuro-247-secret',
    resave: false,
    saveUninitialized: true
}));

let runningProcess = null;
let consoleLogs = [];
let config = { mainFile: 'index.js', modules: '' };
let isAlwaysOn = false; // ตัวควบคุมระบบ 24 ชม.

if (fs.existsSync('config.json')) {
    config = JSON.parse(fs.readFileSync('config.json'));
}

const checkAuth = (req, res, next) => {
    if (req.session.loggedIn) next();
    else res.redirect('/login');
};

// --- Real-time Stats API ---
app.get('/system-stats', async (req, res) => {
    if (runningProcess && runningProcess.pid) {
        try {
            const stats = await pidusage(runningProcess.pid);
            res.json({
                status: 'RUNNING 24/7',
                cpu: stats.cpu.toFixed(1),
                ramUsed: (stats.memory / 1024 / 1024).toFixed(1),
                uptime: Math.floor(stats.elapsed / 1000) + 's'
            });
        } catch (e) {
            res.json({ status: 'RESTARTING', cpu: 0, ramUsed: 0, uptime: '0s' });
        }
    } else {
        res.json({ status: 'OFFLINE', cpu: 0, ramUsed: 0, uptime: '0s' });
    }
});

// --- UI Dashboard ---
const layout = (content, active) => `
<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>KURO | 24/7 PANEL</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');
        body { background: #000; color: #fff; font-family: 'JetBrains Mono', monospace; }
        .glass { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.08); }
        .neon-green { background: #00ff66; color: #000; box-shadow: 0 0 25px rgba(0, 255, 102, 0.5); }
        .neon-red { background: #ff3333; color: #fff; box-shadow: 0 0 25px rgba(255, 51, 51, 0.5); }
        .active-nav { color: #fff; border-bottom: 2px solid #fff; opacity: 1; }
    </style>
</head>
<body class="flex flex-col h-screen overflow-hidden">
    <header class="p-6 border-b border-white/5 flex justify-between items-center px-10">
        <h1 class="font-bold tracking-tighter text-lg uppercase">KURO<span class="opacity-20 italic">24-7</span></h1>
        <nav class="flex gap-8 text-[10px] font-bold tracking-widest">
            <a href="/console" class="${active==='console'?'active-nav':'opacity-40'} pb-1">CONSOLE</a>
            <a href="/files" class="${active==='files'?'active-nav':'opacity-40'} pb-1">FILES</a>
            <a href="/startup" class="${active==='startup'?'active-nav':'opacity-40'} pb-1">STARTUP</a>
        </nav>
    </header>
    <main class="flex-1 overflow-y-auto p-5 md:p-10">${content}</main>
</body>
</html>
`;

// --- Authentication ---
app.get('/login', (req, res) => {
    res.send(`
    <body style="background:#000; color:#fff; display:flex; align-items:center; justify-content:center; height:100vh; margin:0; font-family:sans-serif;">
        <form action="/login" method="POST" style="width:320px; text-align:center; padding:50px; border:1px solid #111; border-radius:40px;">
            <h2 style="letter-spacing:10px; margin-bottom:40px; font-weight:100;">LOGIN</h2>
            <input type="text" name="user" placeholder="ADMINSTRATOR" style="width:100%; padding:15px; background:#0a0a0a; border:1px solid #222; color:#fff; margin-bottom:15px; border-radius:15px; outline:none; font-size:11px; text-align:center;">
            <input type="password" name="pass" placeholder="••••••••" style="width:100%; padding:15px; background:#0a0a0a; border:1px solid #222; color:#fff; margin-bottom:30px; border-radius:15px; outline:none; font-size:11px; text-align:center;">
            <button style="width:100%; padding:15px; background:#fff; color:#000; border:none; font-weight:bold; border-radius:15px; cursor:pointer; letter-spacing:2px;">ENTER</button>
        </form>
    </body>`);
});

app.post('/login', (req, res) => {
    if (req.body.user === 'ADMINSTRATOR' && req.body.pass === 'RONALDO17') {
        req.session.loggedIn = true;
        res.redirect('/console');
    } else {
        res.send("<script>alert('Denied'); window.location='/login';</script>");
    }
});

// --- Console & Control ---
app.get('/console', checkAuth, (req, res) => {
    const html = `
    <div class="max-w-5xl mx-auto space-y-6">
        <div class="glass rounded-[2.5rem] overflow-hidden flex flex-col h-80">
            <div class="p-5 border-b border-white/5 bg-white/[0.03] flex justify-between px-10 items-center">
                <span class="text-[8px] font-bold opacity-30 tracking-[0.4em]">SYSTEM_RUNNING_24H</span>
                <div class="flex gap-4">
                    <form action="/run" method="POST"><button class="neon-green px-8 py-2 rounded-full text-[10px] font-black uppercase transition-all active:scale-95">Start Bot</button></form>
                    <form action="/stop" method="POST"><button class="neon-red px-8 py-2 rounded-full text-[10px] font-black uppercase transition-all active:scale-95">Stop Bot</button></form>
                </div>
            </div>
            <div id="logs" class="flex-1 p-8 text-[11px] font-mono text-zinc-500 overflow-y-auto leading-loose"></div>
        </div>

        <div class="grid grid-cols-3 gap-6">
            <div class="glass p-10 rounded-[3rem] text-center">
                <p class="text-[8px] opacity-20 mb-3 tracking-widest">REAL_CPU</p>
                <h2 id="st-cpu" class="text-3xl font-bold tracking-tighter">0.0%</h2>
            </div>
            <div class="glass p-10 rounded-[3rem] text-center">
                <p class="text-[8px] opacity-20 mb-3 tracking-widest">REAL_RAM</p>
                <h2 id="st-ram" class="text-3xl font-bold tracking-tighter">0MB</h2>
            </div>
            <div class="glass p-10 rounded-[3rem] text-center">
                <p class="text-[8px] opacity-20 mb-3 tracking-widest">SESSION_TIME</p>
                <h2 id="st-up" class="text-3xl font-bold tracking-tighter">0s</h2>
            </div>
        </div>
    </div>
    <script>
        setInterval(() => {
            fetch('/get-logs').then(r => r.text()).then(t => {
                const l = document.getElementById('logs');
                l.innerText = t;
                l.scrollTop = l.scrollHeight;
            });
            fetch('/system-stats').then(r => r.json()).then(d => {
                document.getElementById('st-cpu').innerText = d.cpu + '%';
                document.getElementById('st-ram').innerText = d.ramUsed + 'MB';
                document.getElementById('st-up').innerText = d.uptime;
            });
        }, 1000);
    </script>`;
    res.send(layout(html, 'console'));
});

// --- Core Engine: 24/7 Logic ---
function executeBot() {
    if (!isAlwaysOn) return;
    
    const botPath = path.join(__dirname, 'bots', config.mainFile);
    if (!fs.existsSync(botPath)) {
        consoleLogs.push(`[ERROR] File ${config.mainFile} not found!`);
        isAlwaysOn = false;
        return;
    }

    consoleLogs.push(`[24/7] Booting sequence initiated...`);
    
    const env = Object.assign({}, process.env);
    env.NODE_PATH = path.join(__dirname, 'node_modules');

    runningProcess = spawn('node', [botPath], { env: env });
    
    runningProcess.stdout.on('data', (d) => consoleLogs.push(`${d}`));
    runningProcess.stderr.on('data', (d) => consoleLogs.push(`[LOGS] ${d}`));
    
    runningProcess.on('close', (code) => {
        runningProcess = null;
        if (isAlwaysOn) {
            consoleLogs.push(`[CRASH_PROTECT] บอทหยุดทำงาน (Code: ${code})... กำลังรีสตาร์ทใหม่ใน 3 วินาที`);
            setTimeout(executeBot, 3000);
        }
    });
}

app.post('/run', checkAuth, (req, res) => {
    if (!runningProcess) {
        isAlwaysOn = true;
        executeBot();
    }
    res.redirect('/console');
});

app.post('/stop', checkAuth, (req, res) => {
    isAlwaysOn = false;
    if (runningProcess) {
        runningProcess.kill();
        runningProcess = null;
        consoleLogs.push(`[MANUAL] System stopped by administrator.`);
    }
    res.redirect('/console');
});

// --- File & Startup (Simplified) ---
app.get('/files', checkAuth, (req, res) => {
    const files = fs.readdirSync('./bots');
    const html = `<div class="max-w-4xl mx-auto space-y-4">
        <div class="flex justify-between p-4"><h2 class="text-xs opacity-30">FILES</h2>
        <form action="/upload" method="POST" enctype="multipart/form-data" class="flex gap-2">
            <input type="file" name="botFile" class="text-[9px] opacity-20">
            <button class="bg-white text-black px-4 py-1 rounded-full text-[9px] font-bold">UPLOAD</button>
        </form></div>
        ${files.map(f => `<div class="glass p-5 rounded-3xl flex justify-between px-10">
            <span class="text-xs opacity-60">${f}</span>
            <div class="flex gap-5">
                <a href="/edit-page/${f}" class="opacity-30 hover:opacity-100 italic text-[10px]">Edit</a>
                <a href="/delete/${f}" class="text-red-900 hover:text-red-500 italic text-[10px]">Delete</a>
            </div>
        </div>`).join('')}
    </div>`;
    res.send(layout(html, 'files'));
});

app.get('/edit-page/:name', checkAuth, (req, res) => {
    const code = fs.readFileSync(path.join(__dirname, 'bots', req.params.name), 'utf8');
    const html = `<div class="max-w-6xl mx-auto glass rounded-[3rem] overflow-hidden flex flex-col h-[70vh]">
        <div class="p-6 bg-white/5 flex justify-between items-center px-10">
            <span class="text-[10px] opacity-20">${req.params.name}</span>
            <button onclick="save()" class="bg-white text-black px-10 py-2 rounded-full text-[10px] font-bold">SAVE</button>
        </div>
        <textarea id="editor" class="flex-1 p-10 bg-transparent text-zinc-500 font-mono text-xs outline-none resize-none leading-relaxed">${code}</textarea>
    </div>
    <script>
        function save() {
            fetch('/save-file', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ name: '${req.params.name}', content: document.getElementById('editor').value })
            }).then(() => window.location.href = '/files');
        }
    </script>`;
    res.send(layout(html, 'files'));
});

app.get('/startup', checkAuth, (req, res) => {
    const html = `<div class="max-w-xl mx-auto glass rounded-[4rem] p-16 mt-10">
        <form action="/save-startup" method="POST" class="space-y-10">
            <div><label class="text-[9px] opacity-20 ml-2">MAIN_ENTRY_FILE</label>
            <input type="text" name="mainFile" value="${config.mainFile}" class="w-full bg-white/5 border border-white/10 p-4 rounded-2xl outline-none text-xs"></div>
            <div><label class="text-[9px] opacity-20 ml-2">ADD_MODULES</label>
            <input type="text" name="modules" value="${config.modules}" class="w-full bg-white/5 border border-white/10 p-4 rounded-2xl outline-none text-xs" placeholder="discord.js, axios"></div>
            <button class="w-full bg-white text-black py-5 rounded-3xl font-bold text-[10px] tracking-widest">DEPLOY CHANGES</button>
        </form>
    </div>`;
    res.send(layout(html, 'startup'));
});

// --- API Helpers ---
app.post('/save-startup', checkAuth, (req, res) => {
    config.mainFile = req.body.mainFile; config.modules = req.body.modules;
    fs.writeFileSync('config.json', JSON.stringify(config));
    if (config.modules) { try { execSync(`npm install ${config.modules.replace(/,/g, ' ')}`); } catch (e) {} }
    res.redirect('/startup');
});
app.post('/save-file', checkAuth, (req, res) => { fs.writeFileSync(path.join(__dirname, 'bots', req.body.name), req.body.content); res.json({ success: true }); });
app.post('/upload', checkAuth, upload.single('botFile'), (req, res) => res.redirect('/files'));
app.get('/delete/:name', checkAuth, (req, res) => { fs.unlinkSync(path.join(__dirname, 'bots', req.params.name)); res.redirect('/files'); });
app.get('/get-logs', checkAuth, (req, res) => res.send(consoleLogs.join('\n')));

// --- KEEP ALIVE LOGIC (Render No-Sleep) ---
setInterval(() => {
    if (process.env.RENDER_EXTERNAL_HOSTNAME) {
        require('https').get(`https://${process.env.RENDER_EXTERNAL_HOSTNAME}/system-stats`);
    }
}, 4 * 60 * 1000); // ยิงหาตัวเองทุก 4 นาที

app.listen(port, () => {
    console.log("KURO 24/7 SYSTEM ONLINE");
});
