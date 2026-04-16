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
let config = { mainFile: 'index.js', modules: '', containerName: 'kuro-node-v18' };

if (fs.existsSync('config.json')) {
    config = JSON.parse(fs.readFileSync('config.json'));
}

const storage = multer.diskStorage({
    destination: './bots',
    filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

// --- API System Stats ---
app.get('/system-stats', (req, res) => {
    const totalMem = (os.totalmem() / 1024 / 1024).toFixed(0);
    const usedMem = ((os.totalmem() - os.freemem()) / 1024 / 1024).toFixed(0);
    res.json({
        status: runningProcess ? 'RUNNING' : 'OFFLINE',
        cpu: (os.loadavg()[0] * 10).toFixed(1),
        ramUsed: usedMem,
        ramTotal: totalMem
    });
});

// --- Logic Run (With Docker Pull Simulation) ---
app.post('/run', async (req, res) => {
    if (runningProcess) return res.redirect('/console');
    
    consoleLogs = [
        `<span class="text-blue-400">[DOCKER] Pulling image: ${config.containerName}...</span>`,
        `<span class="text-zinc-500">Status: Image is up to date for ${config.containerName}</span>`,
        `<span class="text-blue-400">[DOCKER] Creating container...</span>`,
        `<span class="text-purple-400">[SYSTEM] Mounting volumes and setting environment...</span>`
    ];

    setTimeout(() => {
        const botPath = path.join(__dirname, 'bots', config.mainFile);
        if (fs.existsSync(botPath)) {
            consoleLogs.push(`<span class="text-green-400">[SUCCESS] Container Started. Output below:</span>`);
            consoleLogs.push(`-----------------------------------------------`);
            runningProcess = spawn('node', [botPath]);
            runningProcess.stdout.on('data', (d) => consoleLogs.push(`${d}`));
            runningProcess.stderr.on('data', (d) => consoleLogs.push(`<span class="text-red-400">[ERR] ${d}</span>`));
            runningProcess.on('close', () => { runningProcess = null; });
        } else {
            consoleLogs.push(`<span class="text-red-500">[ERR] Main file ${config.mainFile} not found!</span>`);
        }
    }, 2000);
    
    res.redirect('/console');
});

app.post('/stop', (req, res) => {
    if (runningProcess) {
        runningProcess.kill();
        runningProcess = null;
        consoleLogs.push(`<span class="text-orange-400">[DOCKER] Container terminated.</span>`);
    }
    res.redirect('/console');
});

app.post('/save-startup', (req, res) => {
    config.mainFile = req.body.mainFile;
    config.modules = req.body.modules;
    config.containerName = req.body.containerName || 'kuro-node-v18';
    fs.writeFileSync('config.json', JSON.stringify(config));
    
    if (config.modules) {
        try {
            const mods = config.modules.replace(/,/g, ' ');
            execSync(`npm install ${mods}`);
        } catch (e) { console.error(e); }
    }
    res.redirect('/startup');
});

// --- UI Layout (Deep Amethyst Theme) ---
const layout = (content, active) => `
<!DOCTYPE html>
<html lang="th">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>KURO ULTRA | Dashboard</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap');
        body { background-color: #0a0a0c; color: #e2e8f0; font-family: 'JetBrains Mono', monospace; }
        .sidebar { transition: transform 0.3s ease; transform: translateX(-100%); z-index: 1000; }
        .sidebar.active { transform: translateX(0); }
        .glass { background: rgba(20, 20, 25, 0.8); backdrop-filter: blur(12px); border: 1px solid rgba(139, 92, 246, 0.2); }
        .btn-purple { background: linear-gradient(135deg, #8b5cf6, #6d28d9); transition: 0.3s; }
        .btn-purple:hover { opacity: 0.9; box-shadow: 0 0 15px rgba(139, 92, 246, 0.4); }
        .custom-scroll::-webkit-scrollbar { width: 5px; }
        .custom-scroll::-webkit-scrollbar-thumb { background: #2d2d35; border-radius: 10px; }
        .nav-link.active { border-left: 4px solid #8b5cf6; background: rgba(139, 92, 246, 0.1); color: #a78bfa; }
    </style>
</head>
<body class="flex flex-col h-screen overflow-hidden">

    <div id="loader" class="fixed inset-0 bg-black/90 z-[2000] hidden flex-col items-center justify-center gap-4">
        <div class="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
        <p class="text-purple-400 text-xs font-bold animate-pulse">DEPLOYING CHANGES...</p>
    </div>

    <header class="p-4 glass flex justify-between items-center px-6 border-b border-purple-900/20">
        <div class="flex items-center gap-4">
            <button onclick="document.getElementById('side').classList.toggle('active')" class="text-purple-400"><i class="fas fa-bars-staggered"></i></button>
            <h1 class="font-black text-xl tracking-tighter">KURO<span class="text-purple-500 italic">ULTRA</span></h1>
        </div>
        <div class="flex items-center gap-6">
            <div class="text-right hidden sm:block">
                <p class="text-[8px] text-zinc-500 font-bold uppercase">CPU Usage</p>
                <p id="cpu-stat" class="text-xs font-bold text-purple-400">0.0%</p>
            </div>
            <div id="status-dot" class="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_10px_red]"></div>
        </div>
    </header>

    <div id="side" class="sidebar fixed top-0 bottom-0 left-0 w-72 glass flex flex-col p-6 shadow-2xl">
        <div class="flex justify-between items-center mb-10">
            <span class="text-xs font-bold text-zinc-600 tracking-widest">NAVIGATION</span>
            <button onclick="document.getElementById('side').classList.remove('active')" class="text-zinc-500"><i class="fas fa-xmark"></i></button>
        </div>
        <nav class="space-y-2">
            <a href="/console" class="nav-link block p-4 rounded-xl transition ${active==='console'?'active':''}"><i class="fas fa-terminal mr-3"></i> Console</a>
            <a href="/files" class="nav-link block p-4 rounded-xl transition ${active==='files'?'active':''}"><i class="fas fa-folder-tree mr-3"></i> File Manager</a>
            <a href="/startup" class="nav-link block p-4 rounded-xl transition ${active==='startup'?'active':''}"><i class="fas fa-rocket mr-3"></i> Startup Config</a>
        </nav>
        <div class="mt-auto p-4 bg-purple-900/10 rounded-2xl border border-purple-900/20">
            <p class="text-[10px] text-purple-400 font-bold mb-1">DOCKER ENGINE</p>
            <p class="text-[9px] text-zinc-500 uppercase">Running: v24.0.7</p>
        </div>
    </div>

    <main class="flex-1 overflow-y-auto p-4 md:p-8">${content}</main>

    <script>
        setInterval(() => {
            fetch('/system-stats').then(r => r.json()).then(d => {
                document.getElementById('cpu-stat').innerText = d.cpu + '%';
                const dot = document.getElementById('status-dot');
                if(d.status === 'RUNNING') {
                    dot.className = 'w-3 h-3 rounded-full bg-green-500 shadow-[0_0_10px_#22c55e]';
                } else {
                    dot.className = 'w-3 h-3 rounded-full bg-red-500 shadow-[0_0_10px_red]';
                }
            });
        }, 2000);
    </script>
</body>
</html>
`;

// --- Pages ---
app.get('/', (req, res) => res.redirect('/console'));

app.get('/console', (req, res) => {
    const html = `
    <div class="max-w-5xl mx-auto space-y-6">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <form action="/run" method="POST"><button class="w-full btn-purple text-white py-4 rounded-2xl font-bold text-sm shadow-xl">START ENGINE</button></form>
            <form action="/stop" method="POST"><button class="w-full bg-zinc-900 border border-zinc-800 text-zinc-400 py-4 rounded-2xl font-bold text-sm">STOP CONTAINER</button></form>
        </div>
        <div class="glass rounded-[32px] p-6 h-[60vh] flex flex-col relative overflow-hidden">
            <div class="flex justify-between items-center mb-4 border-b border-zinc-800 pb-4">
                <span class="text-[10px] font-bold text-purple-500 uppercase tracking-widest">Container Console Log</span>
                <i class="fas fa-circle text-[8px] text-purple-900"></i>
            </div>
            <div id="logs" class="flex-1 overflow-y-auto custom-scroll text-[11px] font-medium leading-relaxed text-zinc-400 space-y-1"></div>
        </div>
    </div>
    <script>
        setInterval(() => {
            fetch('/get-logs').then(r => r.text()).then(t => {
                const l = document.getElementById('logs');
                l.innerHTML = t;
                l.scrollTop = l.scrollHeight;
            });
        }, 1500);
    </script>`;
    res.send(layout(html, 'console'));
});

app.get('/files', (req, res) => {
    const files = fs.readdirSync('./bots');
    const html = `
    <div class="max-w-5xl mx-auto glass rounded-[32px] overflow-hidden">
        <div class="p-6 border-b border-zinc-800 flex justify-between items-center bg-white/5">
            <h2 class="font-bold text-sm">/home/container</h2>
            <form action="/upload" method="POST" enctype="multipart/form-data" class="flex gap-2">
                <input type="file" name="botFile" class="text-xs text-zinc-500">
                <button class="bg-purple-600 px-4 py-1 rounded-lg text-xs font-bold">Upload</button>
            </form>
        </div>
        <div class="divide-y divide-zinc-800/50">
            ${files.map(f => `
                <div class="p-4 flex justify-between items-center hover:bg-white/5 transition px-8">
                    <div class="flex items-center gap-3">
                        <i class="far fa-file-code text-purple-500"></i>
                        <span class="text-sm font-medium text-zinc-300">${f}</span>
                    </div>
                    <div class="flex gap-6">
                        <a href="/edit-page/${f}" class="text-zinc-500 hover:text-blue-400 transition"><i class="fas fa-pencil-alt text-xs"></i></a>
                        <a href="/delete/${f}" class="text-zinc-500 hover:text-red-500 transition"><i class="fas fa-trash-alt text-xs"></i></a>
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
    <div class="max-w-6xl mx-auto flex flex-col h-[80vh] glass rounded-[32px] overflow-hidden">
        <div class="p-6 border-b border-zinc-800 flex justify-between items-center">
            <div class="flex items-center gap-3">
                <i class="fas fa-code text-purple-500"></i>
                <span class="font-bold text-sm text-zinc-400">${req.params.name}</span>
            </div>
            <button onclick="saveFile()" class="btn-purple px-8 py-2 rounded-full text-xs font-bold text-white shadow-lg">SAVE FILE</button>
        </div>
        <textarea id="editor" class="flex-1 p-8 text-sm font-mono outline-none resize-none bg-black/40 text-purple-100/80 leading-relaxed custom-scroll" spellcheck="false">${code}</textarea>
    </div>
    <script>
        function saveFile() {
            document.getElementById('loader').classList.remove('hidden');
            const content = document.getElementById('editor').value;
            fetch('/save-file', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ name: '${req.params.name}', content: content })
            }).then(() => {
                setTimeout(() => window.location.href = '/files', 800);
            });
        }
    </script>`;
    res.send(layout(html, 'files'));
});

app.get('/startup', (req, res) => {
    const html = `
    <div class="max-w-2xl mx-auto glass rounded-[40px] p-10 mt-6 shadow-2xl">
        <h2 class="text-lg font-bold mb-8 text-purple-400"><i class="fas fa-rocket mr-3"></i>Container Settings</h2>
        <form action="/save-startup" method="POST" class="space-y-8" onsubmit="document.getElementById('loader').classList.remove('hidden')">
            <div class="space-y-2">
                <label class="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Main Execution File</label>
                <input type="text" name="mainFile" value="${config.mainFile}" class="w-full bg-black/40 border border-zinc-800 p-4 rounded-2xl outline-none focus:border-purple-500 transition shadow-inner text-sm" placeholder="index.js">
            </div>
            <div class="space-y-2">
                <label class="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Node Modules (Comma Separated)</label>
                <input type="text" name="modules" value="${config.modules}" class="w-full bg-black/40 border border-zinc-800 p-4 rounded-2xl outline-none focus:border-purple-500 text-sm" placeholder="discord.js, axios, dotenv">
            </div>
            <div class="space-y-2">
                <label class="text-[10px] font-bold text-zinc-500 uppercase tracking-widest ml-1">Docker Image Name</label>
                <input type="text" name="containerName" value="${config.containerName}" class="w-full bg-black/40 border border-zinc-800 p-4 rounded-2xl outline-none focus:border-purple-500 text-sm">
            </div>
            <button class="w-full btn-purple py-5 rounded-3xl font-bold text-sm shadow-2xl shadow-purple-900/20 transition-transform active:scale-95">SAVE & RE-DEPLOY</button>
        </form>
    </div>`;
    res.send(layout(html, 'startup'));
});

// Helper Functions
app.post('/save-file', (req, res) => {
    fs.writeFileSync(path.join(__dirname, 'bots', req.body.name), req.body.content);
    res.json({ success: true });
});
app.post('/upload', upload.single('botFile'), (req, res) => res.redirect('/files'));
app.get('/delete/:name', (req, res) => {
    fs.unlinkSync(path.join(__dirname, 'bots', req.params.name));
    res.redirect('/files');
});
app.get('/get-logs', (req, res) => res.send(consoleLogs.join('<br>')));

app.listen(port, () => console.log('KURO ULTRA v5 DEPLOYED'));
