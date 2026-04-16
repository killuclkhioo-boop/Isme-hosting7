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

// สร้างโฟลเดอร์เก็บไฟล์บอท
if (!fs.existsSync('./bots')) fs.mkdirSync('./bots');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'kuro-exclusive-secret',
    resave: false,
    saveUninitialized: true
}));

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

// --- Middleware: Auth ---
const checkAuth = (req, res, next) => {
    if (req.session.loggedIn) next();
    else res.redirect('/login');
};

// --- API System Stats (Real-time) ---
app.get('/system-stats', async (req, res) => {
    if (runningProcess && runningProcess.pid) {
        try {
            const stats = await pidusage(runningProcess.pid);
            res.json({
                status: 'RUNNING',
                cpu: stats.cpu.toFixed(1),
                ramUsed: (stats.memory / 1024 / 1024).toFixed(1),
                uptime: Math.floor(stats.elapsed / 1000) + 's'
            });
        } catch (e) {
            res.json({ status: 'OFFLINE', cpu: 0, ramUsed: 0, uptime: '0s' });
        }
    } else {
        res.json({ status: 'OFFLINE', cpu: 0, ramUsed: 0, uptime: '0s' });
    }
});

// --- Layout UI (Black & White Minimal) ---
const layout = (content, active) => `
<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>KURO | PANEL</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Geist+Mono:wght@300;400;700&display=swap');
        body { background: #000; color: #fff; font-family: 'Geist Mono', monospace; }
        .glass { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); }
        .active-tab { color: #fff; border-bottom: 2px solid #fff; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: #222; border-radius: 10px; }
    </style>
</head>
<body class="flex flex-col h-screen overflow-hidden">
    <header class="p-6 border-b border-white/5 flex justify-between items-center px-12">
        <h1 class="font-black text-xl tracking-tighter">KURO<span class="font-thin text-zinc-500">HOST</span></h1>
        <nav class="flex gap-10 text-[10px] font-bold tracking-[0.2em]">
            <a href="/console" class="${active==='console'?'active-tab':'opacity-30 hover:opacity-100'} pb-1">CONSOLE</a>
            <a href="/files" class="${active==='files'?'active-tab':'opacity-30 hover:opacity-100'} pb-1">FILES</a>
            <a href="/startup" class="${active==='startup'?'active-tab':'opacity-30 hover:opacity-100'} pb-1">STARTUP</a>
            <a href="/logout" class="opacity-30 hover:text-red-500">LOGOUT</a>
        </nav>
    </header>
    <main class="flex-1 overflow-y-auto p-8 custom-scroll">${content}</main>
    <script>
        setInterval(() => {
            fetch('/system-stats').then(r => r.json()).then(d => {
                if(document.getElementById('c-cpu')) {
                    document.getElementById('c-cpu').innerText = d.cpu + '%';
                    document.getElementById('c-ram').innerText = d.ramUsed + 'MB';
                    document.getElementById('c-up').innerText = d.uptime;
                }
            });
        }, 1500);
    </script>
</body>
</html>
`;

// --- Routes: Login System ---
app.get('/login', (req, res) => {
    res.send(`
    <body style="background:#000; color:#fff; font-family:sans-serif; display:flex; align-items:center; justify-content:center; height:100vh; margin:0;">
        <form action="/login" method="POST" style="width:320px; text-align:center; padding:40px; border:1px solid #111; border-radius:20px;">
            <h2 style="font-weight:900; letter-spacing:-1px; margin-bottom:40px;">KURO LOGIN</h2>
            <input type="text" name="user" placeholder="USERNAME" style="width:100%; padding:15px; background:#0a0a0a; border:1px solid #222; color:#fff; margin-bottom:15px; border-radius:12px; font-size:12px;">
            <input type="password" name="pass" placeholder="PASSWORD" style="width:100%; padding:15px; background:#0a0a0a; border:1px solid #222; color:#fff; margin-bottom:25px; border-radius:12px; font-size:12px;">
            <button style="width:100%; padding:15px; background:#fff; color:#000; border:none; font-weight:bold; border-radius:12px; cursor:pointer; font-size:12px;">ENTER PANEL</button>
        </form>
    </body>`);
});

app.post('/login', (req, res) => {
    const { user, pass } = req.body;
    if (user === 'ADMINSTRATOR' && pass === 'RONALDO17') {
        req.session.loggedIn = true;
        res.redirect('/console');
    } else {
        res.send("<script>alert('Access Denied'); window.location='/login';</script>");
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// --- Dashboard ---
app.get('/', checkAuth, (req, res) => res.redirect('/console'));

app.get('/console', checkAuth, (req, res) => {
    const html = `
    <div class="max-w-6xl mx-auto space-y-6">
        <div class="glass rounded-3xl overflow-hidden flex flex-col h-72">
            <div class="p-4 border-b border-white/5 bg-white/5 flex justify-between px-8">
                <span class="text-[9px] font-bold opacity-30 tracking-widest">REALTIME_TERMINAL</span>
                <div class="flex gap-6">
                    <form action="/run" method="POST"><button class="text-[9px] font-bold hover:text-white transition opacity-50 hover:opacity-100">RUN PROCESS</button></form>
                    <form action="/stop" method="POST"><button class="text-[9px] font-bold text-red-500 hover:text-red-400 transition">TERMINATE</button></form>
                </div>
            </div>
            <div id="logs" class="flex-1 p-8 text-[11px] font-mono text-zinc-500 overflow-y-auto leading-relaxed"></div>
        </div>

        <div class="grid grid-cols-3 gap-6">
            <div class="glass p-10 rounded-3xl border-white/5">
                <p class="text-[8px] opacity-30 mb-3 tracking-widest uppercase">Process CPU</p>
                <h2 id="c-cpu" class="text-3xl font-light">0.0%</h2>
            </div>
            <div class="glass p-10 rounded-3xl border-white/5">
                <p class="text-[8px] opacity-30 mb-3 tracking-widest uppercase">Physical RAM</p>
                <h2 id="c-ram" class="text-3xl font-light">0MB</h2>
            </div>
            <div class="glass p-10 rounded-3xl border-white/5">
                <p class="text-[8px] opacity-30 mb-3 tracking-widest uppercase">Uptime</p>
                <h2 id="c-up" class="text-3xl font-light">0s</h2>
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
        }, 1000);
    </script>`;
    res.send(layout(html, 'console'));
});

// --- File Manager (With Upload & Create) ---
app.get('/files', checkAuth, (req, res) => {
    const files = fs.readdirSync('./bots');
    const html = `
    <div class="max-w-5xl mx-auto space-y-8">
        <div class="flex justify-between items-center border-b border-white/10 pb-8">
            <h2 class="text-xl font-bold tracking-tighter">Container Files</h2>
            <div class="flex gap-6 items-center">
                <form action="/create-file" method="POST" class="flex gap-2 border-r border-white/10 pr-6">
                    <input type="text" name="name" placeholder="filename.js" class="bg-transparent border-b border-white/20 text-[10px] outline-none">
                    <button class="text-[10px] font-bold opacity-50 hover:opacity-100">+</button>
                </form>
                <form action="/upload" method="POST" enctype="multipart/form-data" class="flex gap-4">
                    <input type="file" name="botFile" class="text-[9px] opacity-20">
                    <button class="bg-white text-black px-6 py-1.5 rounded-full text-[9px] font-black uppercase">Upload</button>
                </form>
            </div>
        </div>
        <div class="grid grid-cols-1 gap-2">
            ${files.map(f => `
                <div class="glass p-5 rounded-2xl flex justify-between items-center px-10 hover:bg-white/5 transition group">
                    <span class="text-xs font-medium text-zinc-400 group-hover:text-white transition">${f}</span>
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

app.get('/edit-page/:name', checkAuth, (req, res) => {
    const code = fs.readFileSync(path.join(__dirname, 'bots', req.params.name), 'utf8');
    const html = `
    <div class="max-w-6xl mx-auto h-[75vh] flex flex-col glass rounded-[40px] overflow-hidden">
        <div class="p-6 border-b border-white/5 flex justify-between items-center px-10 bg-white/5">
            <span class="text-xs font-mono opacity-40">${req.params.name}</span>
            <button onclick="save()" class="bg-white text-black px-10 py-2 rounded-full text-[10px] font-black uppercase">Save Content</button>
        </div>
        <textarea id="editor" class="flex-1 p-12 bg-transparent text-zinc-400 font-mono text-xs outline-none resize-none leading-relaxed" spellcheck="false">${code}</textarea>
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

app.get('/startup', checkAuth, (req, res) => {
    const html = `
    <div class="max-w-2xl mx-auto glass rounded-[50px] p-16 mt-6">
        <h2 class="text-[10px] font-black opacity-20 tracking-[0.5em] mb-12 uppercase">Container Configuration</h2>
        <form action="/save-startup" method="POST" class="space-y-10">
            <div class="space-y-3">
                <label class="text-[9px] font-bold opacity-30 ml-2">MAIN SCRIPT FILE</label>
                <input type="text" name="mainFile" value="${config.mainFile}" class="w-full bg-white/5 border border-white/10 p-5 rounded-2xl outline-none focus:border-white/30 text-[12px]">
            </div>
            <div class="space-y-3">
                <label class="text-[9px] font-bold opacity-30 ml-2">DEPENDENCIES (Comma separated)</label>
                <input type="text" name="modules" value="${config.modules}" class="w-full bg-white/5 border border-white/10 p-5 rounded-2xl outline-none focus:border-white/30 text-[12px]" placeholder="discord.js, axios">
            </div>
            <button class="w-full bg-white text-black py-5 rounded-3xl font-black text-[11px] uppercase tracking-widest">Update & Install Modules</button>
        </form>
    </div>`;
    res.send(layout(html, 'startup'));
});

// --- Action Logic ---
app.post('/run', checkAuth, (req, res) => {
    if (runningProcess) return res.redirect('/console');
    const botPath = path.join(__dirname, 'bots', config.mainFile);
    if (fs.existsSync(botPath)) {
        consoleLogs = [`[DOCKER] Container initialized.\n[SYSTEM] Executing ${config.mainFile}...`];
        
        // แก้ไข PATH เพื่อให้หา Node Modules เจอ
        const env = Object.assign({}, process.env);
        env.NODE_PATH = path.join(__dirname, 'node_modules');

        runningProcess = spawn('node', [botPath], { env: env });
        
        runningProcess.stdout.on('data', (d) => consoleLogs.push(`${d}`));
        runningProcess.stderr.on('data', (d) => consoleLogs.push(`[ERROR] ${d}`));
        runningProcess.on('close', () => { runningProcess = null; });
    }
    res.redirect('/console');
});

app.post('/stop', checkAuth, (req, res) => {
    if (runningProcess) {
        runningProcess.kill();
        runningProcess = null;
        consoleLogs.push(`[SYSTEM] Container stopped by Administrator.`);
    }
    res.redirect('/console');
});

app.post('/save-startup', checkAuth, (req, res) => {
    config.mainFile = req.body.mainFile;
    config.modules = req.body.modules;
    fs.writeFileSync('config.json', JSON.stringify(config));
    
    if (config.modules) {
        const m = config.modules.replace(/,/g, ' ');
        try {
            consoleLogs.push(`[NPM] Installing dependencies: ${m}...`);
            execSync(`npm install ${m}`);
            consoleLogs.push(`[NPM] Successfully installed modules.`);
        } catch (e) {
            consoleLogs.push(`[NPM ERROR] ${e.message}`);
        }
    }
    res.redirect('/startup');
});

app.post('/create-file', checkAuth, (req, res) => {
    if(req.body.name) fs.writeFileSync(path.join(__dirname, 'bots', req.body.name), '// KURO New File');
    res.redirect('/files');
});

app.post('/save-file', checkAuth, (req, res) => {
    fs.writeFileSync(path.join(__dirname, 'bots', req.body.name), req.body.content);
    res.json({ success: true });
});

app.post('/upload', checkAuth, upload.single('botFile'), (req, res) => res.redirect('/files'));
app.get('/delete/:name', checkAuth, (req, res) => {
    fs.unlinkSync(path.join(__dirname, 'bots', req.params.name));
    res.redirect('/files');
});
app.get('/get-logs', checkAuth, (req, res) => res.send(consoleLogs.join('\n')));

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
    `);
});
