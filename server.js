const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const os = require('os');

const app = express();
const port = process.env.PORT || 3000;

if (!fs.existsSync('./bots')) fs.mkdirSync('./bots');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

let runningProcess = null;
let consoleLogs = [];
let config = { mainFile: 'index.js', modules: '' };

if (fs.existsSync('config.json')) {
    config = JSON.parse(fs.readFileSync('config.json'));
}

const storage = multer.diskStorage({
    destination: './bots',
    filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

// --- System Stats ---
app.get('/system-stats', (req, res) => {
    const totalMem = (os.totalmem() / 1024 / 1024).toFixed(0);
    const usedMem = ((os.totalmem() - os.freemem()) / 1024 / 1024).toFixed(0);
    res.json({
        status: runningProcess ? 'RUNNING' : 'OFFLINE',
        cpu: (os.loadavg()[0] * 10).toFixed(1),
        ramUsed: usedMem,
        ramTotal: totalMem,
        disk: '1.2GB / 5GB',
        uptime: Math.floor(os.uptime() / 3600) + 'h ' + Math.floor((os.uptime() % 3600) / 60) + 'm'
    });
});

// --- Layout UI (Minimal Black & White) ---
const layout = (content, active) => `
<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>KURO | Minimal Host</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Geist+Mono:wght@100..900&display=swap');
        body { background-color: #000; color: #fff; font-family: 'Geist Mono', monospace; }
        .glass { background: rgba(255, 255, 255, 0.03); border: 1px solid rgba(255, 255, 255, 0.1); backdrop-filter: blur(10px); }
        .nav-link.active { background: #fff; color: #000; font-weight: bold; }
        .custom-scroll::-webkit-scrollbar { height: 4px; width: 4px; }
        .custom-scroll::-webkit-scrollbar-thumb { background: #333; border-radius: 10px; }
    </style>
</head>
<body class="flex flex-col h-screen overflow-hidden">
    <header class="p-5 border-b border-white/10 flex justify-between items-center px-10">
        <div class="flex items-center gap-8">
            <h1 class="text-lg font-black tracking-tighter uppercase">Kuro<span class="font-thin">Shiro</span></h1>
            <nav class="flex gap-2">
                <a href="/console" class="text-[10px] px-4 py-2 rounded-full transition ${active==='console'?'nav-link active':'hover:bg-white/5'}">CONSOLE</a>
                <a href="/files" class="text-[10px] px-4 py-2 rounded-full transition ${active==='files'?'nav-link active':'hover:bg-white/5'}">FILES</a>
                <a href="/startup" class="text-[10px] px-4 py-2 rounded-full transition ${active==='startup'?'nav-link active':'hover:bg-white/5'}">STARTUP</a>
            </nav>
        </div>
        <div id="status-tag" class="text-[9px] px-3 py-1 rounded-full border border-white/20">IDLE</div>
    </header>

    <main class="flex-1 overflow-y-auto p-6 md:p-10 custom-scroll">${content}</main>

    <script>
        setInterval(() => {
            fetch('/system-stats').then(r => r.json()).then(d => {
                const tag = document.getElementById('status-tag');
                tag.innerText = d.status;
                tag.style.borderColor = d.status === 'RUNNING' ? '#fff' : 'rgba(255,255,255,0.2)';
                
                if(document.getElementById('cpu-val')) {
                    document.getElementById('cpu-val').innerText = d.cpu + '%';
                    document.getElementById('ram-val').innerText = d.ramUsed + 'MB / ' + d.ramTotal + 'MB';
                    document.getElementById('disk-val').innerText = d.disk;
                    document.getElementById('uptime-val').innerText = d.uptime;
                }
            });
        }, 2000);
    </script>
</body>
</html>
`;

// --- Routes ---
app.get('/', (req, res) => res.redirect('/console'));

app.get('/console', (req, res) => {
    const html = `
    <div class="max-w-6xl mx-auto space-y-6">
        <div class="glass rounded-2xl overflow-hidden flex flex-col h-64">
            <div class="p-3 border-b border-white/5 flex justify-between px-6 bg-white/5">
                <span class="text-[9px] font-bold opacity-50 uppercase tracking-widest">System Output Terminal</span>
                <div class="flex gap-2">
                    <form action="/run" method="POST"><button class="text-[9px] font-bold hover:text-green-400">RUN</button></form>
                    <span class="opacity-20">|</span>
                    <form action="/stop" method="POST"><button class="text-[9px] font-bold hover:text-red-400">STOP</button></form>
                </div>
            </div>
            <div id="logs" class="flex-1 p-6 overflow-y-auto custom-scroll text-[11px] leading-relaxed text-zinc-400 font-mono"></div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div class="glass p-6 rounded-2xl">
                <p class="text-[8px] opacity-40 mb-2">CPU LOAD</p>
                <p id="cpu-val" class="text-xl font-light font-mono">0.0%</p>
            </div>
            <div class="glass p-6 rounded-2xl">
                <p class="text-[8px] opacity-40 mb-2">MEMORY USAGE</p>
                <p id="ram-val" class="text-xl font-light font-mono text-xs">0MB / 0MB</p>
            </div>
            <div class="glass p-6 rounded-2xl">
                <p class="text-[8px] opacity-40 mb-2">DISK SPACE</p>
                <p id="disk-val" class="text-xl font-light font-mono">0.0GB</p>
            </div>
            <div id="uptime-box" class="glass p-6 rounded-2xl">
                <p class="text-[8px] opacity-40 mb-2">UPTIME</p>
                <p id="uptime-val" class="text-xl font-light font-mono">0h 0m</p>
            </div>
        </div>
    </div>
    <script>
        setInterval(() => {
            fetch('/get-logs').then(r => r.text()).then(t => {
                const l = document.getElementById('logs');
                l.innerHTML = t.split('\\n').join('<br>');
                l.scrollTop = l.scrollHeight;
            });
        }, 1500);
    </script>`;
    res.send(layout(html, 'console'));
});

app.get('/files', (req, res) => {
    const files = fs.readdirSync('./bots');
    const html = `
    <div class="max-w-4xl mx-auto space-y-6">
        <div class="flex justify-between items-center px-4">
            <h2 class="text-xs font-bold tracking-widest opacity-50">FILE MANAGER</h2>
            <div class="flex gap-4">
                <form action="/create-file" method="POST" class="flex gap-2">
                    <input type="text" name="name" placeholder="new_file.js" class="bg-transparent border-b border-white/20 text-[10px] outline-none px-2">
                    <button class="text-[10px] hover:underline">+</button>
                </form>
            </div>
        </div>
        
        <div class="glass rounded-2xl overflow-hidden divide-y divide-white/5">
            <div class="p-4 bg-white/[0.02] flex justify-between items-center px-8">
                <span class="text-[10px] opacity-40 italic">File list</span>
                <form action="/upload" method="POST" enctype="multipart/form-data" class="flex gap-4 items-center">
                    <input type="file" name="botFile" class="text-[9px] opacity-50">
                    <button class="bg-white text-black text-[9px] px-4 py-1 rounded-full font-bold">UPLOAD</button>
                </form>
            </div>
            ${files.map(f => `
                <div class="p-5 flex justify-between items-center hover:bg-white/[0.02] transition px-8 group">
                    <div class="flex items-center gap-4">
                        <i class="far fa-file text-zinc-600 group-hover:text-white transition"></i>
                        <span class="text-xs font-medium">${f}</span>
                    </div>
                    <div class="flex gap-6 opacity-0 group-hover:opacity-100 transition">
                        <a href="/edit-page/${f}" class="text-zinc-500 hover:text-white"><i class="fas fa-pencil-alt text-xs"></i></a>
                        <a href="/delete/${f}" class="text-zinc-500 hover:text-red-500"><i class="fas fa-trash-alt text-xs"></i></a>
                    </div>
                </div>
            `).join('')}
        </div>
    </div>`;
    res.send(layout(html, 'files'));
});

app.get('/edit-page/:name', (req, res) => {
    const code = fs.readFileSync(path.join(__dirname, 'bots', req.params.name), 'utf8');
    const html = `
    <div class="max-w-6xl mx-auto flex flex-col h-[75vh] glass rounded-2xl overflow-hidden">
        <div class="p-6 border-b border-white/5 flex justify-between items-center bg-white/5">
            <span class="text-xs font-bold">${req.params.name}</span>
            <button onclick="save()" class="bg-white text-black px-8 py-2 rounded-full text-[10px] font-bold">SAVE CHANGES</button>
        </div>
        <textarea id="editor" class="flex-1 p-10 bg-transparent text-zinc-400 font-mono text-sm outline-none resize-none custom-scroll" spellcheck="false">${code}</textarea>
    </div>
    <script>
        function save() {
            const content = document.getElementById('editor').value;
            fetch('/save-file', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ name: '${req.params.name}', content: content })
            }).then(() => window.location.href = '/files');
        }
    </script>`;
    res.send(layout(html, 'files'));
});

app.get('/startup', (req, res) => {
    const html = `
    <div class="max-w-xl mx-auto glass rounded-3xl p-10 mt-6">
        <h2 class="text-xs font-bold mb-10 tracking-widest opacity-40">STARTUP CONFIGURATION</h2>
        <form action="/save-startup" method="POST" class="space-y-8">
            <div class="space-y-2">
                <label class="text-[9px] opacity-40 ml-1">MAIN EXECUTION FILE</label>
                <input type="text" name="mainFile" value="${config.mainFile}" class="w-full bg-white/5 border border-white/10 p-4 rounded-xl outline-none focus:border-white/40 transition text-xs">
            </div>
            <div class="space-y-2">
                <label class="text-[9px] opacity-40 ml-1">DEPENDENCIES (COMMA SEPARATED)</label>
                <input type="text" name="modules" value="${config.modules}" class="w-full bg-white/5 border border-white/10 p-4 rounded-xl outline-none focus:border-white/40 text-xs" placeholder="discord.js, axios">
            </div>
            <button class="w-full bg-white text-black py-4 rounded-xl font-bold text-xs shadow-xl shadow-white/5">SAVE & INSTALL</button>
        </form>
    </div>`;
    res.send(layout(html, 'startup'));
});

// --- Actions ---
app.post('/run', (req, res) => {
    if (runningProcess) return res.redirect('/console');
    const botPath = path.join(__dirname, 'bots', config.mainFile);
    if (fs.existsSync(botPath)) {
        consoleLogs = [`[SYSTEM] Booting: ${config.mainFile}`];
        runningProcess = spawn('node', [botPath]);
        runningProcess.stdout.on('data', (d) => consoleLogs.push(`${d}`));
        runningProcess.stderr.on('data', (d) => consoleLogs.push(`[ERROR] ${d}`));
        runningProcess.on('close', () => { runningProcess = null; });
    }
    res.redirect('/console');
});

app.post('/stop', (req, res) => {
    if (runningProcess) { runningProcess.kill(); runningProcess = null; consoleLogs.push(`[SYSTEM] Container stopped.`); }
    res.redirect('/console');
});

app.post('/save-startup', (req, res) => {
    config.mainFile = req.body.mainFile; config.modules = req.body.modules;
    fs.writeFileSync('config.json', JSON.stringify(config));
    if (config.modules) {
        try { execSync(`npm install ${config.modules.replace(/,/g, ' ')}`); } catch (e) {}
    }
    res.redirect('/startup');
});

app.post('/create-file', (req, res) => {
    if(req.body.name) fs.writeFileSync(path.join(__dirname, 'bots', req.body.name), '// New File');
    res.redirect('/files');
});

app.post('/save-file', (req, res) => {
    fs.writeFileSync(path.join(__dirname, 'bots', req.body.name), req.body.content);
    res.json({ success: true });
});

app.post('/upload', upload.single('botFile'), (req, res) => res.redirect('/files'));
app.get('/delete/:name', (req, res) => {
    fs.unlinkSync(path.join(__dirname, 'bots', req.params.name));
    res.redirect('/files');
});
app.get('/get-logs', (req, res) => res.send(consoleLogs.join('\n')));

app.listen(port, () => {
    console.log(`
=============================================================================
  _  __  _    _  _____    ____        _____  _    _  _____  _____    ____
 | |/ / | |  | ||  __ \  / __ \      / ____|| |  | ||_   _||  __ \  / __ \
 | ' /  | |  | || |__) || |  | |    | (___  | |__| |  | |  | |__) || |  | |
 |  <   | |  | ||  _  / | |  | |     \\___ \\ |  __  |  | |  |  _  / | |  | |
 | . \\  | |__| || | \\ \\ | |__| |     ____) || |  | || _ |_ | | \\ \\ | |__| |
 |_|\\_\\  \\____/ |_|  \\_\\ \\____/     |_____/ |_|  |_||_____||_|  \\_\\ \\____/
=============================================================================
KURO SHIRO MINIMAL V6 READY AT PORT ${port}
    `);
});
