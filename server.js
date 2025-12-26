const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_FILE = path.join(__dirname, 'cache.json');
const API_BASE = "https://theeduverse.xyz/api";

app.use(cors());
app.use(express.json());

// --- CACHE MANAGEMENT ---
if (!fs.existsSync(CACHE_FILE)) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ completed: [] }));
}

const getCache = () => {
    try {
        return JSON.parse(fs.readFileSync(CACHE_FILE));
    } catch (e) {
        return { completed: [] };
    }
};

const saveCache = (data) => {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
};

// --- SERVER SIDE API ENDPOINTS ---

app.get('/api/batches', async (req, res) => {
    try {
        const response = await axios.get(`${API_BASE}/batches`);
        res.json(response.data);
    } catch (error) {
        console.error("Error fetching batches:", error.message);
        res.status(500).json({ error: 'Failed to fetch batches' });
    }
});

app.get('/api/batch-full/:batchId', async (req, res) => {
    const { batchId } = req.params;
    try {
        const subRes = await axios.get(`${API_BASE}/batches/${batchId}`);
        const subjects = subRes.data.data || [];

        const allPromises = subjects.map(async (subject) => {
            const types = ['lectures', 'notes', 'dpps'];
            const typeResults = await Promise.all(types.map(async (type) => {
                try {
                    const r = await axios.get(`${API_BASE}/${batchId}/subjects/${subject.id}/${type}`);
                    return (r.data.data || []).map(item => ({
                        ...item,
                        _subjectName: subject.name,
                        _type: type
                    }));
                } catch (e) { return []; }
            }));
            return typeResults.flat();
        });

        const nestedResults = await Promise.all(allPromises);
        res.json({ data: nestedResults.flat() });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch batch details' });
    }
});

app.get('/api/progress', (req, res) => res.json(getCache().completed));

app.post('/api/mark-done', (req, res) => {
    const { id } = req.body;
    const cache = getCache();
    if (!cache.completed.includes(id)) {
        cache.completed.push(id);
        saveCache(cache);
    }
    res.json({ success: true });
});

app.post('/api/mark-undone', (req, res) => {
    const { id } = req.body;
    const cache = getCache();
    cache.completed = cache.completed.filter(item => item !== id);
    saveCache(cache);
    res.json({ success: true });
});

// --- FRONTEND UI ---
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Smarterz | Server</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
        :root { --p: #8b5cf6; --bg: #09090b; --s: #18181b; --b: #27272a; --t: #fafafa; --tm: #a1a1aa; }
        body { font-family: 'Inter', sans-serif; background: var(--bg); color: var(--t); margin: 0; line-height: 1.5; }
        header { position: sticky; top: 0; background: rgba(9,9,11,0.9); backdrop-filter: blur(8px); padding: 15px 5%; border-bottom: 1px solid var(--b); display: flex; justify-content: space-between; align-items: center; z-index: 10; }
        .logo { font-weight: 700; font-size: 1.2rem; cursor: pointer; color: var(--p); }
        .toggle-box { display: flex; align-items: center; gap: 8px; font-size: 0.85rem; color: var(--tm); }
        main { padding: 20px 5%; max-width: 900px; margin: 0 auto; }
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 15px; }
        .card { background: var(--s); border: 1px solid var(--b); border-radius: 12px; padding: 15px; cursor: pointer; transition: 0.2s; }
        .card:hover { border-color: var(--p); transform: translateY(-2px); }
        .tabs { display: flex; gap: 20px; border-bottom: 1px solid var(--b); margin-bottom: 20px; }
        .tab { padding: 10px 5px; cursor: pointer; color: var(--tm); border-bottom: 2px solid transparent; }
        .tab.active { color: var(--t); border-bottom-color: var(--p); }
        .group { background: var(--s); border-radius: 10px; margin-bottom: 10px; overflow: hidden; border: 1px solid var(--b); }
        .group-h { padding: 12px 15px; background: rgba(255,255,255,0.03); cursor: pointer; font-weight: 600; display: flex; justify-content: space-between; }
        .item { padding: 10px 15px; border-top: 1px solid var(--b); display: flex; justify-content: space-between; align-items: center; font-size: 0.9rem; }
        .btn { padding: 6px 12px; border-radius: 6px; border: none; font-weight: 600; cursor: pointer; font-size: 0.75rem; }
        .btn-done { background: var(--p); color: #fff; }
        .btn-undo { background: #3f3f46; color: #d4d4d8; }
        .hidden { display: none !important; }
        .loading { text-align: center; padding: 50px; color: var(--tm); }
    </style>
</head>
<body>
    <header>
        <div class="logo" onclick="location.reload()">SMARTERZ</div>
        <div class="toggle-box">
            Auto-Copy <input type="checkbox" id="copyToggle" checked>
        </div>
    </header>

    <main id="app">
        <div class="loading">Initializing...</div>
    </main>

    <script>
        let state = { completed: [], allData: [], currentBatch: '' };

        async function init() {
            const copySaved = localStorage.getItem('copyToggle');
            if (copySaved !== null) document.getElementById('copyToggle').checked = copySaved === 'true';
            document.getElementById('copyToggle').onchange = (e) => localStorage.setItem('copyToggle', e.target.checked);
            
            await fetchProgress();
            showBatches();
        }

        async function fetchProgress() {
            const r = await fetch('/api/progress');
            state.completed = await r.json();
        }

        async function showBatches() {
            const app = document.getElementById('app');
            app.innerHTML = '<div class="loading">Fetching Batches...</div>';
            const r = await fetch('/api/batches');
            const json = await r.json();
            
            let html = '<div class="grid">';
            json.data.forEach(b => {
                html += \`<div class="card" onclick="loadBatch('\${b.id}', '\${b.name.replace(/'/g, "")}')">
                    <div style="font-weight:600">\${b.name}</div>
                </div>\`;
            });
            app.innerHTML = html + '</div>';
        }

        async function loadBatch(id, name) {
            state.currentBatch = name;
            const app = document.getElementById('app');
            app.innerHTML = \`<div class="loading">Loading all content for \${name}...<br><small>This may take a few seconds.</small></div>\`;
            const r = await fetch('/api/batch-full/' + id);
            const json = await r.json();
            state.allData = json.data;
            renderDashboard();
        }

        function renderDashboard() {
            const pending = state.allData.filter(i => !state.completed.includes(i.id));
            const done = state.allData.filter(i => state.completed.includes(i.id));
            
            document.getElementById('app').innerHTML = \`
                <h2 style="margin-bottom:5px">\${state.currentBatch}</h2>
                <div class="tabs">
                    <div class="tab active" id="tabP" onclick="switchTab('P')">Pending (\${pending.length})</div>
                    <div class="tab" id="tabD" onclick="switchTab('D')">Completed (\${done.length})</div>
                </div>
                <div id="viewP">\${renderList(pending, false)}</div>
                <div id="viewD" class="hidden">\${renderList(done, true)}</div>
            \`;
        }

        function renderList(items, isDone) {
            if (items.length === 0) return '<div class="loading">Nothing here.</div>';
            const groups = {};
            items.forEach(i => {
                if (!groups[i._subjectName]) groups[i._subjectName] = [];
                groups[i._subjectName].push(i);
            });

            return Object.keys(groups).map(sub => \`
                <div class="group">
                    <div class="group-h" onclick="this.nextElementSibling.classList.toggle('hidden')">
                        \${sub} <span>\${groups[sub].length}</span>
                    </div>
                    <div>
                        \${groups[sub].map(i => \`
                            <div class="item">
                                <div>
                                    <div style="font-size:0.8rem; color:var(--tm); text-transform:uppercase;">\${i._type}</div>
                                    \${i.title || i.name}
                                </div>
                                \${isDone 
                                    ? \`<button class="btn btn-undo" onclick="markUndone('\${i.id}')">Undo</button>\`
                                    : \`<button class="btn btn-done" onclick="markDone('\${i.id}', \\\`\${(i.title||i.name).replace(/'/g,"")}\\\`, '\${i.url || i.originalUrl}')">Done</button>\`
                                }
                            </div>
                        \`).join('')}
                    </div>
                </div>
            \`).join('');
        }

        function switchTab(type) {
            document.getElementById('viewP').classList.toggle('hidden', type === 'D');
            document.getElementById('viewD').classList.toggle('hidden', type === 'P');
            document.getElementById('tabP').classList.toggle('active', type === 'P');
            document.getElementById('tabD').classList.toggle('active', type === 'D');
        }

        async function markDone(id, title, url) {
            if (document.getElementById('copyToggle').checked) {
                let finalUrl = url;
                if (finalUrl.includes('.m3u8')) {
                    finalUrl = 'https://smarterz.netlify.app/player?url=' + encodeURIComponent(finalUrl);
                }
                navigator.clipboard.writeText(title + ': ' + finalUrl);
            }
            await fetch('/api/mark-done', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });
            state.completed.push(id);
            renderDashboard();
        }

        async function markUndone(id) {
            await fetch('/api/mark-undone', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });
            state.completed = state.completed.filter(x => x !== id);
            renderDashboard();
        }

        init();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => console.log('Server running on port ' + PORT));
