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

// --- SERVER SIDE CACHE LOGIC ---

// Initialize cache file if it doesn't exist
if (!fs.existsSync(CACHE_FILE)) {
    fs.writeFileSync(CACHE_FILE, JSON.stringify({ completed: [] }));
}

// Helper to read cache
const getCache = () => {
    try {
        const data = fs.readFileSync(CACHE_FILE);
        return JSON.parse(data);
    } catch (e) {
        return { completed: [] };
    }
};

// Helper to write cache
const saveCache = (data) => {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
};

// --- API ENDPOINTS ---

// 1. Get Batches (Proxy)
app.get('/api/batches', async (req, res) => {
    try {
        const response = await axios.get(`${API_BASE}/batches`);
        res.json(response.data);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch batches' });
    }
});

// 2. Get FULL Batch Data (Server-Side Aggregation)
// This does the "Eager Loading" on the server
app.get('/api/batch-full/:batchId', async (req, res) => {
    const { batchId } = req.params;
    
    try {
        // A. Get Subjects
        const subRes = await axios.get(`${API_BASE}/batches/${batchId}`);
        const subjects = subRes.data.data || [];

        // B. Parallel Fetching of all content
        // We map every subject to 3 requests (lectures, notes, dpps)
        const allContentPromises = subjects.map(async (subject) => {
            const types = ['lectures', 'notes', 'dpps'];
            
            const typePromises = types.map(async (type) => {
                try {
                    const url = `${API_BASE}/${batchId}/subjects/${subject.id}/${type}`;
                    const r = await axios.get(url);
                    return (r.data.data || []).map(item => ({
                        ...item,
                        _subjectName: subject.name,
                        _type: type
                    }));
                } catch (e) {
                    return [];
                }
            });

            const results = await Promise.all(typePromises);
            return results.flat();
        });

        const nestedResults = await Promise.all(allContentPromises);
        const flatResults = nestedResults.flat();

        res.json({ data: flatResults });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to aggregate batch data' });
    }
});

// 3. Get User Progress (Read Cache)
app.get('/api/progress', (req, res) => {
    const cache = getCache();
    res.json(cache.completed);
});

// 4. Mark Done (Write Cache)
app.post('/api/mark-done', (req, res) => {
    const { id } = req.body;
    if (!id) return res.status(400).send('Missing ID');

    const cache = getCache();
    if (!cache.completed.includes(id)) {
        cache.completed.push(id);
        saveCache(cache);
    }
    res.json({ success: true, completed: cache.completed });
});

// 5. Mark Undone (Write Cache)
app.post('/api/mark-undone', (req, res) => {
    const { id } = req.body;
    const cache = getCache();
    cache.completed = cache.completed.filter(item => item !== id);
    saveCache(cache);
    res.json({ success: true, completed: cache.completed });
});

// --- SERVE FRONTEND (HTML) ---
app.get('/', (req, res) => {
    res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Smarterz | Server Tracker</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    
    <style>
        :root {
            --primary: #8b5cf6; --secondary: #06b6d4; --success: #10b981;
            --bg-dark: #09090b; --bg-surface: #18181b; --border: rgba(255, 255, 255, 0.08);
            --text-main: #fafafa; --text-muted: #a1a1aa;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Plus Jakarta Sans', sans-serif; background-color: var(--bg-dark); color: var(--text-main); min-height: 100vh; }
        
        /* Layout */
        header {
            position: sticky; top: 0; z-index: 100; background: rgba(9, 9, 11, 0.95);
            border-bottom: 1px solid var(--border); padding: 1rem 5%;
            display: flex; align-items: center; justify-content: space-between;
        }
        .brand {
            font-family: 'Outfit', sans-serif; font-size: 1.5rem; font-weight: 700;
            background: linear-gradient(135deg, #8b5cf6 0%, #3b82f6 100%);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent; cursor: pointer;
        }
        
        /* Toggle Switch */
        .settings-area { display: flex; align-items: center; gap: 10px; font-size: 0.9rem; }
        .switch { position: relative; display: inline-block; width: 40px; height: 22px; }
        .switch input { opacity: 0; width: 0; height: 0; }
        .slider {
            position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0;
            background-color: #333; transition: .4s; border-radius: 34px;
        }
        .slider:before {
            position: absolute; content: ""; height: 16px; width: 16px; left: 3px; bottom: 3px;
            background-color: white; transition: .4s; border-radius: 50%;
        }
        input:checked + .slider { background-color: var(--primary); }
        input:checked + .slider:before { transform: translateX(18px); }

        main { padding: 2rem 5%; max-width: 1200px; margin: 0 auto; }

        /* Grid & Cards */
        .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 24px; }
        .card {
            background: var(--bg-surface); border: 1px solid var(--border); border-radius: 16px;
            overflow: hidden; cursor: pointer; transition: 0.3s;
        }
        .card:hover { transform: translateY(-5px); border-color: var(--primary); }
        .card-img { width: 100%; aspect-ratio: 16/9; object-fit: cover; background: #222; }
        .card-body { padding: 1.25rem; }

        /* Dashboard */
        .dash-tabs { display: flex; gap: 15px; border-bottom: 1px solid var(--border); margin-bottom: 20px; }
        .dash-tab {
            padding: 10px 20px; background: transparent; border: none; color: var(--text-muted);
            font-size: 1.1rem; cursor: pointer; border-bottom: 2px solid transparent;
        }
        .dash-tab.active { color: white; border-bottom-color: var(--primary); }

        /* Subject Groups */
        .subject-group { margin-bottom: 15px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-surface); }
        .subject-header { padding: 15px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
        .subject-header:hover { background: rgba(255,255,255,0.02); }
        .subject-content { display: none; padding: 0; border-top: 1px solid var(--border); }
        .subject-group.open .subject-content { display: block; }

        /* Items */
        .content-item {
            display: flex; justify-content: space-between; align-items: center;
            padding: 12px 20px; border-bottom: 1px solid rgba(255,255,255,0.03);
        }
        .content-item:last-child { border-bottom: none; }
        .item-icon { color: var(--secondary); margin-right: 10px; width: 20px; text-align: center; }
        
        .btn {
            padding: 6px 14px; border-radius: 6px; border: none; font-size: 0.8rem; cursor: pointer; font-weight: 600;
        }
        .btn-done { background: var(--primary); color: white; }
        .btn-undo { background: rgba(239, 68, 68, 0.2); color: #f87171; }
        
        .loading { text-align: center; padding: 40px; color: var(--text-muted); }
        .hidden { display: none !important; }

        #toast {
            position: fixed; bottom: 30px; left: 50%; transform: translateX(-50%);
            background: var(--success); color: white; padding: 10px 20px; border-radius: 20px;
            display: none; box-shadow: 0 10px 20px rgba(0,0,0,0.3); z-index: 999;
        }
    </style>
</head>
<body>

    <header>
        <div class="brand" onclick="location.reload()">Smarterz <span style="font-weight:300; font-size:0.7em;">| Server</span></div>
        <div class="settings-area">
            <span>Auto Copy Link</span>
            <label class="switch">
                <input type="checkbox" id="copyToggle" checked>
                <span class="slider"></span>
            </label>
        </div>
    </header>

    <main id="app">
        </main>

    <div id="toast">Action Completed</div>

    <script>
        const app = {
            completedIds: [],
            currentData: [],
            
            init: async () => {
                // Load Toggle State
                const savedToggle = localStorage.getItem('autoCopy');
                if(savedToggle !== null) document.getElementById('copyToggle').checked = (savedToggle === 'true');

                document.getElementById('copyToggle').addEventListener('change', (e) => {
                    localStorage.setItem('autoCopy', e.target.checked);
                });

                await app.fetchProgress();
                app.loadBatches();
            },

            // 1. Fetch Server-Side Progress
            fetchProgress: async () => {
                try {
                    const res = await fetch('/api/progress');
                    app.completedIds = await res.json();
                } catch(e) { console.error("Cache load failed"); }
            },

            // 2. Load Batches
            loadBatches: async () => {
                const container = document.getElementById('app');
                container.innerHTML = '<div class="loading"><i class="fas fa-spinner fa-spin"></i> Loading Batches...</div>';
                
                const res = await fetch('/api/batches');
                const json = await res.json();
                
                let html = '<div class="grid">';
                (json.data || []).forEach(b => {
                    html += \`
                        <div class="card" onclick='app.loadBatchDetail("\${b.id}", "\${b.name}")'>
                            <img src="\${b.imageUrl}" class="card-img">
                            <div class="card-body"><h3>\${b.name}</h3></div>
                        </div>\`;
                });
                container.innerHTML = html + '</div>';
            },

            // 3. Load Full Batch (Server Aggregation)
            loadBatchDetail: async (id, name) => {
                const container = document.getElementById('app');
                container.innerHTML = \`<div class="loading">
                    <h2>Loading \${name}...</h2>
                    <p>Fetching all lectures, notes, and DPPs from server...</p>
                    <br><i class="fas fa-circle-notch fa-spin fa-2x"></i>
                </div>\`;

                try {
                    const res = await fetch(\`/api/batch-full/\${id}\`);
                    const json = await res.json();
                    app.currentData = json.data;
                    app.renderDashboard(name);
                } catch(e) {
                    container.innerHTML = '<div class="loading" style="color:red">Failed to load batch data.</div>';
                }
            },

            renderDashboard: (name) => {
                const pending = app.currentData.filter(i => !app.completedIds.includes(i.id));
                const completed = app.currentData.filter(i => app.completedIds.includes(i.id));

                const container = document.getElementById('app');
                container.innerHTML = \`
                    <h2 style="margin-bottom:20px">\${name}</h2>
                    <div class="dash-tabs">
                        <button class="dash-tab active" onclick="app.switchTab('pending')">Pending (\${pending.length})</button>
                        <button class="dash-tab" onclick="app.switchTab('completed')">Completed (\${completed.length})</button>
                    </div>
                    <div id="view-pending">\${app.renderList(pending, false)}</div>
                    <div id="view-completed" class="hidden">\${app.renderList(completed, true)}</div>
                \`;
            },

            renderList: (items, isCompleted) => {
                if(!items.length) return '<div class="loading">No items found here.</div>';
                
                // Group by Subject
                const groups = {};
                items.forEach(i => {
                    if(!groups[i._subjectName]) groups[i._subjectName] = [];
                    groups[i._subjectName].push(i);
                });

                let html = '';
                Object.keys(groups).sort().forEach(sub => {
                    html += \`
                        <div class="subject-group">
                            <div class="subject-header" onclick="this.parentElement.classList.toggle('open')">
                                <strong>\${sub}</strong>
                                <i class="fas fa-chevron-down"></i>
                            </div>
                            <div class="subject-content">
                                \${groups[sub].map(item => {
                                    const icon = item._type === 'lectures' ? 'fa-play' : (item._type === 'notes' ? 'fa-file' : 'fa-pencil');
                                    // Escape quotes for onclick
                                    const safeTitle = (item.title||item.name||'').replace(/'/g, "\\'");
                                    const safeUrl = (item.url||item.originalUrl||'').replace(/'/g, "\\'");

                                    return \`
                                        <div class="content-item">
                                            <div style="flex:1">
                                                <i class="fas \${icon} item-icon"></i> \${item.title || item.name}
                                                <span style="font-size:0.7em; color:#666; margin-left:10px; text-transform:uppercase">\${item._type}</span>
                                            </div>
                                            \${isCompleted 
                                                ? \`<button class="btn btn-undo" onclick="app.markUndone('\${item.id}')">Undo</button>\` 
                                                : \`<button class="btn btn-done" onclick="app.markDone('\${item.id}', '\${safeTitle}', '\${safeUrl}')">Done</button>\`
                                            }
                                        </div>\`;
                                }).join('')}
                            </div>
                        </div>\`;
                });
                return html;
            },

            switchTab: (tab) => {
                document.querySelectorAll('.dash-tab').forEach(b => b.classList.remove('active'));
                event.target.classList.add('active');
                document.getElementById('view-pending').classList.add('hidden');
                document.getElementById('view-completed').classList.add('hidden');
                document.getElementById('view-'+tab).classList.remove('hidden');
            },

            markDone: async (id, title, url) => {
                // 1. Check Copy Toggle
                if(document.getElementById('copyToggle').checked) {
                    app.copyLink(title, url);
                }

                // 2. Server Call
                await fetch('/api/mark-done', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ id })
                });

                // 3. UI Update (Optimistic)
                app.completedIds.push(id);
                app.renderDashboard(document.querySelector('h2').innerText); // Re-render current view
            },

            markUndone: async (id) => {
                await fetch('/api/mark-undone', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ id })
                });
                app.completedIds = app.completedIds.filter(x => x !== id);
                app.renderDashboard(document.querySelector('h2').innerText);
            },

            copyLink: (title, rawUrl) => {
                let finalUrl = rawUrl;
                if (/\/(\\d+)_(\\d+)\\.m3u8$/.test(finalUrl)) finalUrl = finalUrl.replace(/\/(\\d+)_(\\d+)\\.m3u8$/, "/index_1.m3u8");
                if (finalUrl.includes('.m3u8')) finalUrl = \`https://smarterz.netlify.app/player?url=\${encodeURIComponent(finalUrl)}\`;
                
                navigator.clipboard.writeText(\`\${title}: \${finalUrl}\`);
                app.showToast('Copied & Marked Done!');
            },

            showToast: (msg) => {
                const t = document.getElementById('toast');
                t.innerText = msg;
                t.style.display = 'block';
                setTimeout(()=>t.style.display='none', 2000);
            }
        };

        app.init();
    </script>
</body>
</html>
    `);
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
