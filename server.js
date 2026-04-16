const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');
const os = require('os');
const session = require('express-session');
const pidusage = require('pidusage');

const app = express();
const port = process.env.PORT || 3000;

if (!fs.existsSync('./bots')) fs.mkdirSync('./bots');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: 'kuro-secret-key-999',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // อยู่ได้ 1 วัน
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

// --- Middleware: ป้องกันการแอบเข้าหน้าอื่น ---
const checkAuth = (req, res, next) => {
    if (req.session.loggedIn) next();
    else res.redirect('/login');
};

// --- API: Get Real Stats ---
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
            res.json({ status: 'ERROR', cpu: 0, ramUsed: 0, uptime: '0s' });
        }
    } else {
        res.json({ status: 'OFFLINE', cpu: 0, ramUsed: 0, uptime: '0s' });
    }
});

// --- UI Layout ---
const layout = (content, active) => `
<!DOCTYPE html>
<html>
<head>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>KURO | SYSTEM</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css">
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;700&display=swap');
        body { background: #000; color: #eee; font-family: 'Inter', sans-serif; }
        .glass { background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); }
        .nav-active { border-bottom: 2px solid white; color: white; }
    </style>
</head>
<body class="min-h-screen flex flex-col">
    <header class="p-6 border-b border-white/5 flex justify-between items-center px-10">
        <h1 class="font-bold tracking-tighter text-lg uppercase">KURO<span class="font-light opacity-50">CONTROL</span></h1>
        <nav class="flex gap-8 text-[10px] font-bold tracking-widest">
            <a href="/console" class="pb-1 ${active==='console'?'nav-active':'opacity-40 hover:opacity-100'}">CONSOLE</a>
            <a href="/files" class="pb-1 ${active==='files'?'nav-active':'opacity-40 hover:opacity-100'}">FILES</a>
            <a href="/startup" class="pb-1 ${active==='startup'?'nav-active':'opacity-40 hover:opacity-100'}">STARTUP</a>
            <a href="/logout" class="opacity-40 hover:text-red-500">LOGOUT</a>
        </nav>
    </header>
    <main class="flex-1 p-6 md:p-12 overflow-y-auto">${content}</main>
    <script>
        setInterval(() => {
            fetch('/system-stats').then(r => r.json()).then(d => {
                if(document.getElementById('cpu')) {
                    document.getElementById('cpu').innerText = d.cpu + '%';
                    document.getElementById('ram').innerText = d.ramUsed + ' MB';
                    document.getElementById('uptime').innerText = d.uptime;
                }
            });
        }, 2000);
    </script>
</body>
</html>
`;

// --- Routes: Authentication ---
app.get('/login', (req, res) => {
    res.send(`
    <body style="background:#000; color:#fff; font-family:sans-serif; display:flex; align-items:center; justify-content:center; height:100vh;">
        <form action="/login" method="POST" style="width:300px; text-align:center;">
            <h1 style="font-weight:900; letter-spacing:-1px; margin-bottom:30px;">KURO SYSTEM</h1>
            <input type="text" name="user" placeholder="USERNAME" style="width:100%; padding:15px; background:#111; border:1px solid #222; color:#fff; margin-bottom:10px; border-radius:10px; outline:none;">
            <input type="password" name="pass" placeholder="PASSWORD" style="width:100%; padding:15px; background:#111; border:1px solid #222; color:#fff; margin-bottom:20px; border-radius:10px; outline:none;">
            <button style="width:100%; padding:15px; background:#fff; color:#000; border:none; font-weight:bold; border-radius:10px; cursor:pointer;">LOGIN</button>
        </form>
    </body>`);
});

app.post('/login', (req, res) => {
    const { user, pass } = req.body;
    if (user === 'ADMINSTRATOR' && pass === 'RONALDO17') {
        req.session.loggedIn = true;
        res.redirect('/console');
    } else {
        res.send("<script>alert('Wrong Credentials'); window.location='/login';</script>");
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/login');
});

// --- Routes: Dashboard (Protected) ---
app.get('/', checkAuth, (req, res) => res.redirect('/console'));

app.get('/console', checkAuth, (req, res) => {
    const html = `
    <div class="max-w-5xl mx-auto space-y-6">
        <div class="glass rounded-3xl overflow-hidden h-64 flex flex-col">
            <div class="p-4 border-b border-white/5 flex justify-between px-8 bg-white/5">
                <span class="text-[9px] font-bold opacity-30 tracking-[0.2em]">TERMINAL_OUTPUT</span>
                <div class="flex gap-4">
                    <form action="/run" method="POST"><button class="text-[9px] font-bold text-white hover:opacity-50">RUN</button></form>
                    <form action="/stop" method="POST"><button class="text-[9px] font-bold text-red-500 hover:opacity-50">STOP</button></form>
                </div>
            </div>
            <div id="logs" class="flex-1 p-6 text-[11px] font-mono text-zinc-500 overflow-y-auto"></div>
        </div>
        <div class="grid grid-cols-3 gap-6">
            <div class="glass p-8 rounded-3xl text-center">
                <p class="text-[8px] opacity-30 mb-2 uppercase tracking-widest">CPU Process</p>
                <h3 id="cpu" class="text-2xl font-light">0.0%</h3>
            </div>
            <div class="glass p-8 rounded-3xl text-center">
                <p class="text-[8px] opacity-30 mb-2 uppercase tracking-widest">RAM Usage</p>
                <h3 id="ram" class="text-2xl font-light">0 MB</h3>
            </div>
            <div class="glass p-8 rounded-3xl text-center">
                <p class="text-[8px] opacity-30 mb-2 uppercase tracking-widest">Active Time</p>
                <h3 id="uptime" class="text-2xl font-light">0s</h3>
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
        }, 1500);
    </script>`;
    res.send(layout(html, 'console'));
});

app.get('/files', checkAuth, (req, res) => {
    const files = fs.readdirSync('./bots');
    const html = `
    <div class="max-w-4xl mx-auto space-y-8">
        <div class="flex justify-between items-end border-b border-white/5 pb-6">
            <h2 class="text-xl font-light tracking-tight">File Manager</h2>
            <form action="/upload" method="POST" enctype="multipart/form-data" class="flex gap-4">
                <input type="file" name="botFile" class="text-[10px] opacity-30">
                <button class="bg-white text-black px-6 py-1 rounded-full text-[10px] font-bold">UPLOAD</button>
            </form>
        </div>
        <div class="space-y-2">
            ${files.map(f => `
                <div class="glass p-5 rounded-2xl flex justify-between items-center px-10 hover:bg-white/[0.04] transition">
                    <span class="text-xs font-medium opacity-70">${f}</span>
                    <div class="flex gap-6">
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
        <div class="p-6 border-b border-white/5 flex justify-between items-center bg-white/5 px-10">
            <span class="text-xs opacity-50 font-mono">${req.params.name}</span>
            <button onclick="save()" class="bg-white text-black px-8 py-2 rounded-full text-[10px] font-bold">SAVE</button>
        </div>
        <textarea id="editor" class="flex-1 p-10 bg-transparent text-zinc-400 font-mono text-xs outline-none resize-none" spellcheck="false">${code}</textarea>
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
    <div class="max-w-xl mx-auto glass rounded-[40px] p-12 mt-6">
        <h2 class="text-xs font-bold mb-10 opacity-30 tracking-[0.3em]">STARTUP_CONFIG</h2>
        <form action="/save-startup" method="POST" class="space-y-8">
            <div class="space-y-2">
                <label class="text-[9px] opacity-30 ml-2">MAIN_FILE</label>
                <input type="text" name="mainFile" value="${config.mainFile}" class="w-full bg-white/5 border border-white/10 p-4 rounded-2xl outline-none focus:border-white/30 text-xs">
            </div>
            <div class="space-y-2">
                <label class="text-[9px] opacity-30 ml-2">DEPENDENCIES (Comma separated)</label>
                <input type="text" name="modules" value="${config.modules}" class="w-full bg-white/5 border border-white/10 p-4 rounded-2xl outline-none focus:border-white/30 text-xs">
            </div>
            <button class="w-full bg-white text-black py-4 rounded-2xl font-bold text-xs">SAVE & REBUILD</button>
        </form>
    </div>`;
    res.send(layout(html, 'startup'));
});

// --- Action Logic ---
app.post('/run', checkAuth, (req, res) => {
    if (runningProcess) return res.redirect('/console');
    const botPath = path.join(__dirname, 'bots', config.mainFile);
    if (fs.existsSync(botPath)) {
        consoleLogs = [`[SYSTEM] Launching ${config.mainFile}...`];
        runningProcess = spawn('node', [botPath]);
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
        consoleLogs.push(`[SYSTEM] Process terminated.`);
    }
    res.redirect('/console');
});

app.post('/save-startup', checkAuth, (req, res) => {
    config.mainFile = req.body.mainFile;
    config.modules = req.body.modules;
    fs.writeFileSync('config.json', JSON.stringify(config));
    if (config.modules) {
        const m = config.modules.replace(/,/g, ' ');
        exec(`npm install ${m}`, (err) => {
            if(!err) consoleLogs.push(`[NPM] Installed: ${m}`);
        });
    }
    res.redirect('/startup');
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

app.listen(port, () => console.log('KURO ULTIMATE RUNNING'));
