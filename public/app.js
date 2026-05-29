  <script type="module">
    import * as THREE from 'three';
    import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
    import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

    // ========== DATA ==========
    const COLORS = { concept:'#ff4d6d', user:'#4dabf7', feedback:'#ffa94d', project:'#69db7c', reference:'#b47ae0' };
    const NODE_SIZES = { xl: 0.9, lg: 0.6, md: 0.4, sm: 0.28 };

    const EDIT_DATA_KEY = 'mem-viz-edit-v4';

    let memData = await (async function loadData() {
      try {
        const res = await fetch('/api/memories');
        if (res.ok) {
          const d = await res.json();
          if (d && d.nodes) return d;
        }
      } catch(e) { console.warn('mem-viz: Backend unavailable, trying localStorage...'); }
      try {
        const saved = localStorage.getItem(EDIT_DATA_KEY);
        if (saved) { const p = JSON.parse(saved); if (Array.isArray(p) && p.length) return { nodes: p, skipped: [] }; }
      } catch(e2) {}
      return { nodes: [], skipped: [] };
    })();
    let nodes = memData.nodes;
    let skippedFiles = memData.skipped || [];
    let userNodeId = (nodes.find(n => n.isUserProfile) || {}).id || null;
    let edges = [];
    let edgeMap = new Map();
    function rebuildEdges() {
      edges = [];
      nodes.forEach(n => (n.outgoing||[]).forEach(tid => { if (nodes.find(x => x.id === tid)) edges.push({ from: n.id, to: tid }); }));
      edgeMap = new Map();
      edges.forEach(e => {
        if (!edgeMap.has(e.from)) edgeMap.set(e.from, new Set());
        if (!edgeMap.has(e.to)) edgeMap.set(e.to, new Set());
        edgeMap.get(e.from).add(e.to);
        edgeMap.get(e.to).add(e.from);
      });
    }
    function saveData() {
      localStorage.setItem(EDIT_DATA_KEY, JSON.stringify(nodes));
      rebuildEdges();
    }
    async function apiPatch(id, updates) {
      try {
        await fetch('/api/memory/' + encodeURIComponent(id), {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates)
        });
      } catch(e) { console.warn('Server sync failed:', e); }
    }
    async function apiPost(body) {
      try {
        await fetch('/api/memory', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      } catch(e) { console.warn('Server create failed:', e); }
    }
    async function apiDelete(id) {
      try {
        await fetch('/api/memory/' + encodeURIComponent(id), { method: 'DELETE' });
      } catch(e) { console.warn('Server delete failed:', e); }
    }
    rebuildEdges();
	    document.getElementById('badge').textContent = nodes.length + ' memories';
	    if (skippedFiles.length) {
	      const skipEl = document.createElement('span');
	      skipEl.id = 'skipped-badge';
	      skipEl.textContent = ' (' + skippedFiles.length + ' skipped)';
	      skipEl.style.cssText = 'cursor:pointer;color:rgba(255,255,255,0.3);border-bottom:1px dashed rgba(255,255,255,0.15)';
	      skipEl.title = 'Click to view skipped files';
	      skipEl.addEventListener('click', openSkipped);
	      document.getElementById('badge').after(skipEl);
	    }

    // ========== SHARED UI ==========
    const overlay = document.getElementById('overlay');
    const detailContent = document.getElementById('detail-content');
    const closeBtn = document.getElementById('close-btn');
    const badge = document.getElementById('badge');
    const searchInput = document.getElementById('search-input');

	    // ---- 2D force-directed layout (力导向布局) ----
	    const STORAGE_KEY = 'mem-viz-edit-circular-v2';
	    const nodePositions2D = new Map();

	    (function initLayout() {
	      // Try loading saved layout first
	      const saved = localStorage.getItem(STORAGE_KEY);
	      if (saved) {
	        try {
	          const parsed = JSON.parse(saved);
	          let allFound = true;
	          nodes.forEach(n => {
	            if (parsed[n.id]) {
	              nodePositions2D.set(n.id, [parsed[n.id].x, parsed[n.id].y]);
	            } else {
	              allFound = false;
	            }
	          });
	          if (allFound) return;
	        } catch(e) {}
	        nodePositions2D.clear();
	      }

		      // Multi-ring layout by type (core at center, types on different rings)
		      (function computeLayout() {
		        const pos = {};
		        const centerId = userNodeId || 'april-sonnet-profile'; pos[centerId] = { x:50, y:50 };
		        const typeRingR = { user: 15, feedback: 22, project: 30, reference: 38, concept: 18 };
		        const groups = {};
		        nodes.filter(n => n.id !== (userNodeId || 'april-sonnet-profile')).forEach(n => {
		          if (!groups[n.type]) groups[n.type] = [];
		          groups[n.type].push(n);
		        });
		        const types = Object.keys(groups);
		        types.forEach((type, ti) => {
		          const group = groups[type];
		          const count = group.length;
		          const R = typeRingR[type] || 28;
		          let a = -Math.PI/2 + ti * 0.5;
		          const step = (2 * Math.PI) / count;
		          group.forEach(n => {
		            pos[n.id] = { x:50 + Math.cos(a)*R, y:50 + Math.sin(a)*R };
		            a += step;
		          });
		        });
		        nodes.forEach(n => nodePositions2D.set(n.id, [pos[n.id].x, pos[n.id].y]));
		        const toSave = {};
		        nodePositions2D.forEach((p, id) => { toSave[id] = { x: p[0], y: p[1] }; });
		        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
		      })();
	    })();

    function openDetail(id) {
      const n = nodes.find(x => x.id === id);
      if (!n) return;
      editingNodeId = id;
      const color = COLORS[n.type];
      const outLinks = (n.outgoing||[]).map(tid => {
        const t = nodes.find(x => x.id === tid);
        return t ? `<span class="tag" data-id="${t.id}"><span class="dir">→</span>${t.label}</span>` : '';
      }).join('');
      const inLinks = (n.incoming||[]).map(tid => {
        const t = nodes.find(x => x.id === tid);
        return t ? `<span class="tag" data-id="${t.id}"><span class="dir">←</span>${t.label}</span>` : '';
      }).join('');
      let linksHtml = outLinks + inLinks || '<span style="color:rgba(255,255,255,0.15);font-size:13px">No connections</span>';
      detailContent.innerHTML = `
        <span class="dc-type-badge" style="background:${color}15;color:${color}">${n.type}</span>
        <div class="dc-title">${n.label}</div>
        ${n.desc ? `<div class="dc-sub">${n.desc}</div>` : ''}
        <div class="dc-section"><div class="dc-section-label">Properties</div>
          <div class="dc-grid">
            <div class="row"><span class="k">name</span><span class="v">${n.id}</span></div>
            <div class="row"><span class="k">type</span><span class="v"><span class="dot" style="background:${color}"></span>${n.type}</span></div>
            <div class="row"><span class="k">links</span><span class="v">${(n.outgoing||[]).length} out · ${(n.incoming||[]).length} in</span></div>
            ${n.desc ? `<div class="row"><span class="k">description</span><span class="v">${n.desc}</span></div>` : ''}
          </div>
        </div>
        <div class="dc-section"><div class="dc-section-label">Content</div>
          <div class="dc-body">${n.body}</div>
        </div>
        <div class="dc-section"><div class="dc-section-label">Connections</div>
          <div class="dc-tags">${linksHtml}</div>
        </div>`;
      detailContent.querySelectorAll('.tag[data-id]').forEach(el => {
        el.addEventListener('click', function() { const tid = this.dataset.id; overlay.classList.remove('open'); setTimeout(() => openDetail(tid), 150); });
      });
      overlay.classList.add('open');
    }
    closeBtn.addEventListener('click', () => overlay.classList.remove('open'));
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('open'); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') overlay.classList.remove('open'); });
    setTimeout(() => { document.getElementById('graph-hint').classList.add('faded'); }, 5000);

    // ========== FILTER ==========
    let searchQuery = '';
    let filterType = 'all';
    searchInput.addEventListener('input', function() { searchQuery = this.value; applyGlobalFilter(); });
    document.querySelectorAll('.cf-btn').forEach(b => {
      b.addEventListener('click', function() {
        document.querySelectorAll('.cf-btn').forEach(x => x.classList.remove('active'));
        this.classList.add('active');
        filterType = this.dataset.ctype;
        applyGlobalFilter();
      });
    });


	    // ===== EDITING FUNCTIONS =====
	    let editingNodeId = null;

	    // ---- Context Menu ----
	    const ctxMenu = document.getElementById('context-menu');
	    function showContextMenu(x, y, id) {
	      editingNodeId = id;
	      ctxMenu.style.left = x + 'px';
	      ctxMenu.style.top = y + 'px';
	      ctxMenu.classList.add('open');
	    }
	    function hideCtx() { ctxMenu.classList.remove('open'); }
	    document.addEventListener('click', hideCtx);
	    ctxMenu.addEventListener('contextmenu', e => e.preventDefault());

	    document.querySelectorAll('.context-menu .mi').forEach(item => {
	      item.addEventListener('click', function(e) {
	        e.stopPropagation();
	        const action = this.dataset.action;
	        hideCtx();
	        if (action === 'edit-prop') openEditProp(editingNodeId);
	        else if (action === 'edit-body') openEditBody(editingNodeId);
	        else if (action === 'delete') openDeleteConfirm(editingNodeId);
	      });
	    });

	    // ---- Edit Properties ----
	    function openEditProp(id) {
      document.getElementById("edit-title").textContent = "Edit Properties";
      document.getElementById("edit-id-field").style.display = "none";
	      const n = nodes.find(x => x.id === id);
	      if (!n) return;
	      document.getElementById('edit-name').value = n.label || '';
	      document.getElementById('edit-desc').value = n.desc || '';
	      document.getElementById('edit-type').value = n.type || 'concept';
	      editingNodeId = id;
	      document.getElementById('edit-overlay').classList.add('open');
	    }
	    document.getElementById('edit-cancel').addEventListener('click', () => {
	      document.getElementById('edit-overlay').classList.remove('open');
	      document.getElementById('edit-id-field').style.display = 'none';
	    });
	    document.getElementById('edit-save').addEventListener('click', () => {
	      const n = nodes.find(x => x.id === editingNodeId);
	      if (!n) {
	        // Add new node
	        const id = document.getElementById('edit-id').value.trim();
	        if (!id) return;
	        if (nodes.find(x => x.id === id)) return;
	        const label = document.getElementById('edit-name').value || id;
	        const desc = document.getElementById('edit-desc').value;
	        const type = document.getElementById('edit-type').value;
	        nodes.push({ id, label, desc, type, size:'md',
	          body:'<span class="en">New node.</span><span class="zh">新节点。</span>',
	          outgoing:[], incoming:[]
	        });
	        saveData();
	        apiPost({ id, label, desc, type, body: 'New node.' });
	        document.getElementById('edit-overlay').classList.remove('open');
	        document.getElementById('edit-id-field').style.display = 'none';
	        location.reload();
	        return;
	      }
	      n.label = document.getElementById('edit-name').value || n.id;
	      n.desc = document.getElementById('edit-desc').value;
	      n.type = document.getElementById('edit-type').value;
	      saveData();
	      apiPatch(n.id, { label: n.label, desc: n.desc, type: n.type });
	      document.getElementById('edit-overlay').classList.remove('open');
	      nodeEls2D.forEach((el, id) => {
	        const nd = nodes.find(x => x.id === id);
	        if (nd) el.querySelector('.g2-label').textContent = nd.label;
	      });
	      overlay.classList.remove('open');
	    });

	    // ---- Edit Body ----
	    function openEditBody(id) {
	      const n = nodes.find(x => x.id === id);
	      if (!n) return;
	      document.getElementById('body-editor').value = n.body || '';
	      editingNodeId = id;
	      document.getElementById('body-overlay').classList.add('open');
	    }
	    document.getElementById('body-cancel').addEventListener('click', () => {
	      document.getElementById('body-overlay').classList.remove('open');
	    });
	    document.getElementById('body-save').addEventListener('click', () => {
	      const n = nodes.find(x => x.id === editingNodeId);
	      if (!n) return;
	      n.body = document.getElementById('body-editor').value;
	      saveData();
	      apiPatch(n.id, { body: n.body });
	      document.getElementById('body-overlay').classList.remove('open');
	      overlay.classList.remove('open');
	    });

	    // ---- Delete ----
	    function openDeleteConfirm(id) {
	      const n = nodes.find(x => x.id === id);
	      if (!n) return;
	      document.getElementById('delete-msg').textContent = `Delete "${n.label}"? This will remove the node and its connections.`;
	      editingNodeId = id;
	      document.getElementById('delete-overlay').classList.add('open');
	    }
	    document.getElementById('delete-cancel').addEventListener('click', () => {
	      document.getElementById('delete-overlay').classList.remove('open');
	    });
	    document.getElementById('delete-confirm').addEventListener('click', () => {
	      const id = editingNodeId;
	      nodes = nodes.filter(n => n.id !== id);
	      saveData();
	      apiDelete(id);
	      document.getElementById('delete-overlay').classList.remove('open');
	      overlay.classList.remove('open');
	      location.reload();
	    });

		    // ---- History button in detail card ----
		    document.getElementById('dc-history-btn').addEventListener('click', async () => {
		      const id = editingNodeId;
		      if (!id) return;
		      const list = document.getElementById('history-list');
		      list.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:30px;font-size:13px;">Loading...</p>';
		      document.getElementById('history-overlay').classList.add('open');
		      try {
		        const res = await fetch('/api/backups/' + encodeURIComponent(id));
		        const backups = await res.json();
		        list.innerHTML = '';
		        if (!backups.length) {
		          list.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:30px;font-size:13px;">No backup history yet.</p>';
		        } else {
		          backups.forEach(b => {
		            const item = document.createElement('div');
		            item.style.cssText = 'padding:12px 14px;border-radius:10px;margin-bottom:6px;border:1px solid rgba(255,255,255,0.04);background:rgba(255,255,255,0.02);display:flex;align-items:center;justify-content:space-between;';
		            const ts = b.ts.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, '$1-$2-$3 $4:$5:$6');
		            item.innerHTML = '<span style="font-size:13px;color:rgba(255,255,255,0.6);font-family:monospace;">' + ts + '</span>' +
		              '<span style="display:flex;gap:6px;">' +
		              '<button class="view-bak-btn" style="padding:4px 12px;border-radius:6px;border:none;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.5);cursor:pointer;font-size:12px;">View</button>' +
		              '<button class="restore-bak-btn" style="padding:4px 12px;border-radius:6px;border:none;background:rgba(255,77,109,0.12);color:#ff6b6b;cursor:pointer;font-size:12px;">Restore</button>' +
		              '</span>';
		            item.querySelector('.view-bak-btn').addEventListener('click', async () => {
		              try {
		                const r2 = await fetch('/api/backup/' + encodeURIComponent(id) + '/' + encodeURIComponent(b.ts));
		                const txt = await r2.text();
		                document.getElementById('bakcontent-body').textContent = txt;
		                document.getElementById('bakcontent-overlay').classList.add('open');
		              } catch(e) {}
		            });
		            item.querySelector('.restore-bak-btn').addEventListener('click', async () => {
		              if (!confirm('Restore backup from ' + ts + '?')) return;
		              try {
		                await fetch('/api/backup/restore/' + encodeURIComponent(id) + '/' + encodeURIComponent(b.ts), { method: 'POST' });
		                document.getElementById('history-overlay').classList.remove('open');
		                overlay.classList.remove('open');
		                location.reload();
		              } catch(e) {}
		            });
		            list.appendChild(item);
		          });
		        }
		      } catch(e) {
		        list.innerHTML = '<p style="color:#ff6b6b;text-align:center;padding:30px;font-size:13px;">Failed to load history.</p>';
		      }
		    });
		    document.getElementById('history-close').addEventListener('click', () => {
		      document.getElementById('history-overlay').classList.remove('open');
		    });
		    document.getElementById('bakcontent-close').addEventListener('click', () => {
		      document.getElementById('bakcontent-overlay').classList.remove('open');
		    });

		    // ---- Edit button in detail card ----
		    document.getElementById('dc-edit-btn').addEventListener('click', () => {
		      if (editingNodeId) openEditProp(editingNodeId);
		    });

	    // ---- Skipped Files ----
	    function openSkipped() {
	      const list = document.getElementById('skipped-list');
	      list.innerHTML = '';
	      if (!skippedFiles.length) {
	        list.innerHTML = '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:30px;font-size:13px;">No skipped files.</p>';
	      } else {
	        skippedFiles.forEach(s => {
	          const item = document.createElement('div');
	          item.style.cssText = 'padding:12px 14px;border-radius:10px;margin-bottom:6px;border:1px solid rgba(255,255,255,0.04);background:rgba(255,255,255,0.02);';
	          item.innerHTML = '<div style="font-size:14px;color:rgba(255,255,255,0.8);font-family:monospace;">' + s.file + '</div>' +
	            '<div style="font-size:12px;color:rgba(255,255,255,0.3);margin-top:4px;">' + (s.reason || 'Unknown') + '</div>';
	          list.appendChild(item);
	        });
	      }
	      document.getElementById('skipped-overlay').classList.add('open');
	    }
	    document.getElementById('skipped-close').addEventListener('click', () => {
	      document.getElementById('skipped-overlay').classList.remove('open');
	    })
		document.getElementById('trace-close').addEventListener('click', clear2DTrace);;

	    // Close modals on overlay click
	    ['edit-overlay', 'body-overlay', 'delete-overlay', 'skipped-overlay', 'history-overlay', 'bakcontent-overlay'].forEach(key => {
	      const el = document.getElementById(key);
	      el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
	    });

	    // ---- Rebuild 3D scene if nodes changed (reload) ----
	    // For now, close detail card overlay on edit to keep things simple

    // ===================================================================
    //  3D MODE - Three.js (星图)
    // ===================================================================
    const container3d = document.getElementById('three-container');
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1117);

    const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(20, 14, 36);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container3d.appendChild(renderer.domElement);

    const labelRenderer = new CSS2DRenderer();
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0';
    labelRenderer.domElement.style.left = '0';
    labelRenderer.domElement.style.pointerEvents = 'none';
    container3d.appendChild(labelRenderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 3;
    controls.maxDistance = 80;
    controls.target.set(0, 1.8, 0);

    // Grid
    const gridHelper = new THREE.GridHelper(48, 32, 0x1a1a2e, 0x1a1a2e);
    gridHelper.position.y = -5;
    scene.add(gridHelper);
    const grid2 = new THREE.GridHelper(48, 32, 0x1a1a2e, 0x1a1a2e);
    grid2.position.y = -4.95;
    grid2.rotation.y = Math.PI / 4;
    grid2.material.transparent = true;
    grid2.material.opacity = 0.5;
    scene.add(grid2);

    // Stars
    const starGeo = new THREE.BufferGeometry();
    const starCount = 800;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      starPos[i*3] = (Math.random() - 0.5) * 100;
      starPos[i*3+1] = (Math.random() - 0.5) * 60;
      starPos[i*3+2] = (Math.random() - 0.5) * 100;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({ color: 0x555577, size: 0.06, transparent: true, opacity: 0.5 });
    scene.add(new THREE.Points(starGeo, starMat));

    // Center glow
    const glowTex = (() => {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,255,255,0.5)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.1)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    const cGlowMat = new THREE.SpriteMaterial({
      map: glowTex, color: new THREE.Color(0xff4d6d),
      transparent: true, blending: THREE.AdditiveBlending,
      opacity: 0.08, depthWrite: false,
    });
    const cGlow = new THREE.Sprite(cGlowMat);
    cGlow.scale.set(10, 10, 1);
    cGlow.position.set(0, 1.8, 0);
    scene.add(cGlow);

    // ---- 3D Layout (垂直堆叠圆盘) ----
    const nodePositions3D = new Map();
    const yOff = 1.8;
    const typeConfig = {
      user:      { r: 6,  y: -4 },
      feedback:  { r: 8,  y: -2 },
      concept:   { r: 6,  y: 0 },
      project:   { r: 10, y: 2 },
      reference: { r: 12, y: 4 },
    };

    (function compute3D() {
      const groups = {};
      nodes.forEach(n => { if (!groups[n.type]) groups[n.type] = []; groups[n.type].push(n); });
      const types = Object.keys(groups);

      types.forEach(type => {
        const group = groups[type];
        const count = group.length;
        if (count === 0) return;
        const cfg = typeConfig[type] || { r: 8, y: 0 };
        const R = cfg.r;
        const yPos = cfg.y + yOff;
        let a = -Math.PI / 2 + (types.indexOf(type) * 0.5);
        const step = (2 * Math.PI) / count;

        group.forEach(node => {
          nodePositions3D.set(node.id, new THREE.Vector3(
            Math.cos(a) * R,
            yPos,
            Math.sin(a) * R
          ));
          a += step;
        });
      });

      if (userNodeId) nodePositions3D.set(userNodeId, new THREE.Vector3(0, yOff, 0));
    })();

    // ---- 3D Heatmap (connection-based sizing/brightness) ----
    const connCount3D = new Map();
    let maxConn3D = 1;
    nodes.forEach(n => {
      const c = (n.outgoing?.length || 0) + (n.incoming?.length || 0);
      connCount3D.set(n.id, c);
      if (c > maxConn3D) maxConn3D = c;
    });

    // ---- 3D Nodes ----
    const nodeData3D = new Map();
    nodes.forEach(n => {
      const isCore = n.id === userNodeId;
      const col = isCore ? new THREE.Color(0xffffff) : new THREE.Color(COLORS[n.type]);
      const conns = connCount3D.get(n.id) || 0;
      const t = maxConn3D > 0 ? Math.min(conns / maxConn3D, 1) : 0; // 0=cold, 1=hottest
      const minR = 0.18, maxR = 1.0;
      const r = isCore ? 1.2 : minR + t * (maxR - minR);
      const p = nodePositions3D.get(n.id);
      if (!p) return;

      const geo = new THREE.SphereGeometry(r, 24, 24);
      const mat = new THREE.MeshStandardMaterial({
        color: col, emissive: col, emissiveIntensity: isCore ? 0.5 : 0.04 + t * 0.56,
        roughness: 0.3, metalness: isCore ? 0.2 : 0.1,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(p);
      mesh.userData.nodeId = n.id;
      scene.add(mesh);

      const gMat = new THREE.SpriteMaterial({
        map: glowTex, color: col, transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
        opacity: isCore ? 1.0 : 0.08 + t * 0.92,
      });
      const glow = new THREE.Sprite(gMat);
      const glowScale = isCore ? 4 : 3 + t * 5;
      glow.scale.set(r * glowScale, r * glowScale, 1);
      glow.position.copy(p);
      scene.add(glow);

      const labelEl = document.createElement('div');
      labelEl.className = 'label-3d' + (isCore ? ' core' : '') + (conns === 0 ? ' cold' : '');
      labelEl.textContent = n.label;
      const label = new CSS2DObject(labelEl);
      label.position.set(p.x, p.y - r * 1.6, p.z);
      scene.add(label);

      nodeData3D.set(n.id, { mesh, glow, label, mat, gMat, r, basePos: p.clone(), scale: 1, targetScale: 1, connections: conns, baseEmissive: mat.emissiveIntensity, baseGlowOpacity: gMat.opacity });
    });

    // ---- 3D Edges ----
    const edgeObjects3D = [];
    edges.forEach(e => {
      const a = nodePositions3D.get(e.from);
      const b = nodePositions3D.get(e.to);
      if (!a || !b) return;
      const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
      const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false });
      const line = new THREE.Line(geo, mat);
      scene.add(line);
      edgeObjects3D.push({ line, geo, mat, from: e.from, to: e.to });
    });

    // ---- 3D Hover ----
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let hoveredId3d = null;
    function get3DMeshes() { return Array.from(nodeData3D.values()).map(d => d.mesh); }
    renderer.domElement.addEventListener('pointermove', e => { pointer.x = (e.clientX / innerWidth) * 2 - 1; pointer.y = -(e.clientY / innerHeight) * 2 + 1; });
    renderer.domElement.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      if (connectMode && currentMode === '3d') {
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(get3DMeshes());
        if (hits.length > 0) {
          const id = hits[0].object.userData.nodeId;
          if (!connectActive3D) {
            connectActive3D = id;
            const d = nodeData3D.get(id);
            if (d) d.mesh.material.emissiveIntensity = 1.0;
          } else {
            if (id !== connectActive3D) doConnect(connectActive3D, id);
            const d = nodeData3D.get(connectActive3D);
            if (d) d.mesh.material.emissiveIntensity = 0.2;
            connectActive3D = null;
          }
        } else if (connectActive3D) {
          const d = nodeData3D.get(connectActive3D);
          if (d) d.mesh.material.emissiveIntensity = 0.2;
          connectActive3D = null;
        }
        return;
      }
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(get3DMeshes());
      if (hits.length > 0) { const id = hits[0].object.userData.nodeId; if (id) openDetail(id); }
    });
	    renderer.domElement.addEventListener('contextmenu', e => {
	      e.preventDefault();
	      pointer.x = (e.clientX / innerWidth) * 2 - 1;
	      pointer.y = -(e.clientY / innerHeight) * 2 + 1;
	      raycaster.setFromCamera(pointer, camera);
	      const hits = raycaster.intersectObjects(get3DMeshes());
	      if (hits.length > 0) { const id = hits[0].object.userData.nodeId; if (id) showContextMenu(e.clientX, e.clientY, id); }
	    });
    renderer.domElement.style.cursor = 'pointer';

    function update3DHover() {
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(get3DMeshes());
      let newHover = null;
      if (hits.length > 0) newHover = hits[0].object.userData.nodeId;
      if (newHover === hoveredId3d) return;
      if (hoveredId3d) { const d = nodeData3D.get(hoveredId3d); if (d) { d.mesh.material.emissiveIntensity = d.baseEmissive; d.glow.material.opacity = d.baseGlowOpacity; d.targetScale = 1; } }
      hoveredId3d = newHover;
      if (hoveredId3d) { const d = nodeData3D.get(hoveredId3d); if (d) { d.mesh.material.emissiveIntensity = 0.8; d.glow.material.opacity = 1.2; d.targetScale = 1.3; } }
      const connected = new Set();
      if (hoveredId3d) { const ids = edgeMap.get(hoveredId3d); if (ids) ids.forEach(id => connected.add(id)); connected.add(hoveredId3d); }
      edgeObjects3D.forEach(({ mat, from, to }) => {
        if (!hoveredId3d) { mat.opacity = 0.08; mat.color.setHex(0xffffff); }
        else if (from === hoveredId3d || to === hoveredId3d) { mat.opacity = 0.5; mat.color.setHex(0xff4d6d); }
        else { mat.opacity = 0.01; }
      });
    }

    // ---- 3D Filter ----
    function apply3DFilter() {
      const q = searchQuery.trim().toLowerCase();
      let visible = 0;
      nodeData3D.forEach((d, id) => {
        const n = nodes.find(x => x.id === id);
        if (!n) return;
        const tm = filterType === 'all' || n.type === filterType;
        const sm = !q || n.label.toLowerCase().includes(q) || n.id.includes(q) || (n.desc && n.desc.includes(q));
        const show = tm && sm;
        d.mesh.visible = show; d.glow.visible = show; d.label.visible = show;
        if (show) visible++;
      });
      edgeObjects3D.forEach(({ line, from, to }) => {
        line.visible = nodeData3D.get(from)?.mesh.visible && nodeData3D.get(to)?.mesh.visible;
      });
      badge.textContent = `${visible} memories`;
      const skipBadge = document.getElementById('skipped-badge');
      if (skipBadge) skipBadge.textContent = ` (${skippedFiles.length} skipped)`;
    }

    // ===================================================================
    //  2D MODE - DOM / SVG (经典版)
    // ===================================================================
    const g2Svg = document.getElementById('g2-svg');
    const g2Nodes = document.getElementById('g2-nodes');

    // Build edges SVG - deduplicate bidirectional
    const drawnEdges = new Set();
    const edgeSvgs = [];

    edges.forEach(e => {
      const key = [e.from, e.to].sort().join('|');
      if (drawnEdges.has(key)) return;
      drawnEdges.add(key);
      const pa = nodePositions2D.get(e.from), pb = nodePositions2D.get(e.to);
      if (!pa || !pb) return;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', pa[0] + '%');
      line.setAttribute('y1', pa[1] + '%');
      line.setAttribute('x2', pb[0] + '%');
      line.setAttribute('y2', pb[1] + '%');
      line.setAttribute('marker-end', 'url(#arrow-default)');
      line.dataset.from = e.from;
      line.dataset.to = e.to;
      g2Svg.appendChild(line);
      edgeSvgs.push({ el: line, from: e.from, to: e.to });
    });

    // Edge lookup map for O(1) trace
    const edgeLookup2D = new Map();
    edgeSvgs.forEach(({ el, from, to }) => {
      const k1 = from + '|' + to;
      const k2 = to + '|' + from;
      edgeLookup2D.set(k1, el);
      edgeLookup2D.set(k2, el);
    });

    // Node label lookup
    const nodeLabelMap = new Map();
    nodes.forEach(n => nodeLabelMap.set(n.id, n.label));

    // ---- 2D Trace (引用溯源) ----
    let tracedNodeId = null;
    function trace2DChain(id, depth = 3) {
      const traced = new Set();
      const outgoing = [];
      const incoming = [];
      function walkOut(nid, d) {
        if (d <= 0) return;
        const n = nodes.find(x => x.id === nid);
        if (!n || !n.outgoing) return;
        n.outgoing.forEach(oid => {
          if (!traced.has(oid)) {
            traced.add(oid);
            outgoing.push({ from: nid, to: oid });
            walkOut(oid, d - 1);
          }
        });
      }
      function walkIn(nid, d) {
        if (d <= 0) return;
        nodes.forEach(n => {
          if (n.outgoing && n.outgoing.includes(nid) && !traced.has(n.id)) {
            traced.add(n.id);
            incoming.push({ from: n.id, to: nid });
            walkIn(n.id, d - 1);
          }
        });
      }
      traced.add(id);
      walkOut(id, depth);
      walkIn(id, depth);
      return { traced, outgoing, incoming };
    }

    function clear2DTrace() {
      if (!tracedNodeId) return;
      tracedNodeId = null;
      document.getElementById('trace-panel').classList.remove('visible');
      document.getElementById('trace-body').innerHTML = '';
      edgeLookup2D.forEach(el => {
        el.classList.remove('edge-trace', 'edge-trace-in');
        el.setAttribute('marker-end', 'url(#arrow-default)');
      });
      nodeEls2D.forEach(el => el.classList.remove('node-trace', 'node-trace-out', 'node-trace-in'));
    }

    function show2DTrace(id) {
      if (id === tracedNodeId) return;
      clear2DTrace();
      const result = trace2DChain(id, 3);
      if (result.outgoing.length === 0 && result.incoming.length === 0) return;
      tracedNodeId = id;

      // Highlight edges (O(1) via lookup map)
      result.outgoing.forEach(({ from, to }) => {
        const el = edgeLookup2D.get(from + '|' + to);
        if (el) { el.classList.add('edge-trace'); el.setAttribute('marker-end', 'url(#arrow-trace)'); }
      });
      result.incoming.forEach(({ from, to }) => {
        const el = edgeLookup2D.get(from + '|' + to);
        if (el) { el.classList.add('edge-trace-in'); el.setAttribute('marker-end', 'url(#arrow-trace-in)'); }
      });

      // Highlight trace nodes
      const srcLabel = nodeLabelMap.get(id) || id;
      result.traced.forEach(nid => {
        const el = nodeEls2D.get(nid);
        if (!el) return;
        el.classList.add('node-trace');
        if (result.outgoing.some(e => e.to === nid)) el.classList.add('node-trace-out');
        if (result.incoming.some(e => e.from === nid)) el.classList.add('node-trace-in');
      });

      // Build panel content
      let html = '';
      result.incoming.forEach(({ from }) => {
        const lbl = nodeLabelMap.get(from);
        if (lbl) html += '<div class="tp-item tp-in"><span class="tp-arrow">←</span><span class="tp-label">' + lbl + '</span></div>';
      });
      if (srcLabel) html += '<div class="tp-item" style="color:rgba(255,255,255,0.9);font-weight:600"><span class="tp-arrow" style="color:transparent">·</span><span class="tp-label">' + srcLabel + '</span></div>';
      result.outgoing.forEach(({ to }) => {
        const lbl = nodeLabelMap.get(to);
        if (lbl) html += '<div class="tp-item tp-out"><span class="tp-arrow">→</span><span class="tp-label">' + lbl + '</span></div>';
      });
      document.getElementById('trace-body').innerHTML = html;
      document.getElementById('trace-panel').classList.add('visible');
    }

    // Build node elements
    const nodeEls2D = new Map();

    nodes.forEach(n => {
      const p = nodePositions2D.get(n.id);
      if (!p) return;
      const sizeClass = n.size || 'md';
      const offset = { xl:15, lg:10, md:7, sm:5 }[sizeClass] || 7;
      const el = document.createElement('div');
      el.className = `g2-node ${n.type} g2-${sizeClass}${n.id === userNodeId ? ' core' : ''}`;
      el.dataset.id = n.id;
      el.style.left = `calc(${p[0]}% - ${offset}px)`;
      el.style.top = `calc(${p[1]}% - ${offset}px)`;
      el.innerHTML = `<span class="g2-label">${n.id === (userNodeId || 'april-sonnet-profile') ? '✦ ' : ''}${n.label}</span>`;
      el.addEventListener('click', () => {
        if (didDrag) { didDrag = false; return; }
        if (connectMode && currentMode === '2d') {
          if (!connectSrc) {
            connectSrc = n.id;
            el.classList.add('connect-src');
          } else if (connectSrc === n.id) {
            el.classList.remove('connect-src');
            connectSrc = null;
          } else {
            document.querySelector('.connect-src')?.classList.remove('connect-src');
            doConnect(connectSrc, n.id);
            connectSrc = null;
          }
          return;
        }
        openDetail(n.id);
      });
      el.addEventListener('mouseenter', () => on2DHover(n.id));
      el.addEventListener('mouseleave', on2DLeave);
	      el.addEventListener('contextmenu', function(e) { e.preventDefault(); showContextMenu(e.clientX, e.clientY, n.id); });
      g2Nodes.appendChild(el);
      nodeEls2D.set(n.id, el);
    });

    function on2DHover(id) {
      show2DTrace(id);
      const connected = new Set();
      edges.forEach(ed => {
        if (ed.from === id) connected.add(ed.to);
        if (ed.to === id) connected.add(ed.from);
      });
      edgeSvgs.forEach(({ el, from, to }) => {
        const f = from, t = to;
        if ((f === id && connected.has(t)) || (t === id && connected.has(f))) {
          el.classList.add('edge-highlight');
          el.classList.remove('edge-dim');
        } else {
          el.classList.remove('edge-highlight');
          el.classList.add('edge-dim');
        }
      });
      nodeEls2D.forEach((el, nid) => {
        if (nid !== id && !connected.has(nid)) {
          el.classList.add('node-dim');
        }
      });
    }

    function on2DLeave() {
      clear2DTrace();
      edgeSvgs.forEach(({ el }) => el.classList.remove('edge-highlight', 'edge-dim'));
      nodeEls2D.forEach(el => el.classList.remove('node-dim'));
    }

    // ---- 2D Filter ----
    function apply2DFilter() {
      clear2DTrace();
      const q = searchQuery.trim().toLowerCase();
      let visible = 0;
      nodeEls2D.forEach((el, id) => {
        const n = nodes.find(x => x.id === id);
        if (!n) return;
        const tm = filterType === 'all' || n.type === filterType;
        const sm = !q || n.label.toLowerCase().includes(q) || n.id.includes(q) || (n.desc && n.desc.includes(q));
        const show = tm && sm;
        el.style.display = show ? '' : 'none';
        if (show) visible++;
      });
      edgeSvgs.forEach(({ el, from, to }) => {
        const fv = nodeEls2D.get(from)?.style.display !== 'none';
        const tv = nodeEls2D.get(to)?.style.display !== 'none';
        el.style.display = (fv && tv) ? '' : 'none';
      });
      badge.textContent = `${visible} memories`;
    }

    // ---- 2D Zoom & Drag ----
    const g2Stage = document.getElementById('g2-stage');
    let g2Scale = 1, g2PanX = 0, g2PanY = 0;
    let g2Dragging = false, g2StartX, g2StartY;

    g2Stage.addEventListener('wheel', e => {
      if (currentMode !== '2d') return;
      e.preventDefault();
      const rect = g2Stage.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const ns = Math.max(0.15, Math.min(8, g2Scale * factor));
      g2PanX = mx - (mx - g2PanX) * ns / g2Scale;
      g2PanY = my - (my - g2PanY) * ns / g2Scale;
      g2Scale = ns;
      g2Stage.style.transform = `translate(${g2PanX}px,${g2PanY}px) scale(${g2Scale})`;
    }, { passive: false });

    g2Stage.addEventListener('mousedown', e => {
      if (currentMode !== '2d') return;
      if (e.target.closest('.g2-node') || e.target.tagName === 'line') return;
      g2Dragging = true; g2StartX = e.clientX - g2PanX; g2StartY = e.clientY - g2PanY;
      g2Stage.classList.add('dragging');
    });
    document.addEventListener('mousemove', e => {
      if (!g2Dragging) return;
      g2PanX = e.clientX - g2StartX; g2PanY = e.clientY - g2StartY;
      g2Stage.style.transform = `translate(${g2PanX}px,${g2PanY}px) scale(${g2Scale})`;
    });
    document.addEventListener('mouseup', () => {
      if (!g2Dragging) return;
      g2Dragging = false; g2Stage.classList.remove('dragging');
    });

    // Touch support for 2D
    let lastTouchDist = 0;
    g2Stage.addEventListener('touchstart', e => {
      if (currentMode !== '2d') return;
      if (e.target.closest('.g2-node')) return;
      if (e.touches.length === 1) {
        g2Dragging = true; g2StartX = e.touches[0].clientX - g2PanX; g2StartY = e.touches[0].clientY - g2PanY;
        g2Stage.classList.add('dragging');
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        lastTouchDist = Math.hypot(dx, dy);
      }
    }, { passive: true });
    g2Stage.addEventListener('touchmove', e => {
      if (currentMode !== '2d') return;
      if (e.touches.length === 1 && g2Dragging) {
        g2PanX = e.touches[0].clientX - g2StartX; g2PanY = e.touches[0].clientY - g2StartY;
        g2Stage.style.transform = `translate(${g2PanX}px,${g2PanY}px) scale(${g2Scale})`;
      } else if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        if (lastTouchDist > 0) {
          const factor = dist / lastTouchDist;
          const ns = Math.max(0.15, Math.min(8, g2Scale * factor));
          const rect = g2Stage.getBoundingClientRect();
          const mx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
          const my = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;
          g2PanX = mx - (mx - g2PanX) * ns / g2Scale;
          g2PanY = my - (my - g2PanY) * ns / g2Scale;
          g2Scale = ns;
          g2Stage.style.transform = `translate(${g2PanX}px,${g2PanY}px) scale(${g2Scale})`;
        }
        lastTouchDist = dist;
      }
    }, { passive: true });
    g2Stage.addEventListener('touchend', () => { g2Dragging = false; g2Stage.classList.remove('dragging'); lastTouchDist = 0; }, { passive: true });

    // ===================================================================
    //  VIEW TOGGLE
    // ===================================================================
    let currentMode = 'cards';
    const graph2d = document.getElementById('graph-2d');
    const chartPanel = document.getElementById('chart-panel');
    const healthPanel = document.getElementById('health-panel');
    const cardView = document.getElementById('card-view');
    const cardToolbar = document.getElementById('card-toolbar');

    function deactivateViews() {
      ['btn-cards','btn-3d','btn-2d','btn-chart','btn-health'].forEach(id =>
        document.getElementById(id).classList.remove('active'));
      container3d.style.display = 'none';
      graph2d.style.display = 'none';
      chartPanel.style.display = 'none';
      healthPanel.style.display = 'none';
      cardToolbar.style.display = 'none';
      cardView.style.display = 'none';
      document.getElementById('heatmap-legend').classList.remove('visible');
    }

    function applyGlobalFilter() {
      if (currentMode === '3d') apply3DFilter();
      else if (currentMode === '2d') apply2DFilter();
      else if (currentMode === 'cards') renderCards();
      else if (currentMode === 'health') renderHealth();
    }

    document.getElementById('btn-cards').addEventListener('click', () => {
      if (currentMode === 'cards') return;
      currentMode = 'cards';
      deactivateViews();
      document.getElementById('btn-cards').classList.add('active');
      cardToolbar.style.display = 'flex';
      cardView.style.display = '';
      renderCards();
    });
    document.getElementById('btn-3d').addEventListener('click', () => {
      if (currentMode === '3d') return;
      currentMode = '3d';
      deactivateViews();
      document.getElementById('btn-3d').classList.add('active');
      container3d.style.display = 'block';
      document.getElementById('heatmap-legend').classList.add('visible');
      camera.position.set(20, 14, 36);
      controls.target.set(0, 1.8, 0);
      controls.update();
      apply3DFilter();
    });
    document.getElementById('btn-2d').addEventListener('click', () => {
      if (currentMode === '2d') return;
      currentMode = '2d';
      deactivateViews();
      document.getElementById('btn-2d').classList.add('active');
      graph2d.style.display = 'block';
      g2Scale = 1; g2PanX = 0; g2PanY = 0;
      g2Stage.style.transform = '';
      apply2DFilter();
    });
    document.getElementById('btn-chart').addEventListener('click', () => {
      if (currentMode === 'chart') return;
      currentMode = 'chart';
      deactivateViews();
      document.getElementById('btn-chart').classList.add('active');
      chartPanel.style.display = 'block';
      renderCharts();
    });
    document.getElementById('btn-health').addEventListener('click', () => {
      if (currentMode === 'health') return;
      currentMode = 'health';
      deactivateViews();
      document.getElementById('btn-health').classList.add('active');
      healthPanel.style.display = 'block';
      renderHealth();
    });

    // ===================================================================
    //  CONNECT MODE (Drag-to-connect)
    // ===================================================================
    let connectMode = false;
    let connectSrc = null;
    let connectActive3D = null;

    function doConnect(fromId, toId) {
      if (fromId === toId) return;
      const src = nodes.find(n => n.id === fromId);
      if (!src) return;
      if ((src.outgoing||[]).includes(toId)) return;
      if (!src.outgoing) src.outgoing = [];
      src.outgoing.push(toId);
      const tgt = nodes.find(n => n.id === toId);
      if (tgt) {
        if (!tgt.incoming) tgt.incoming = [];
        if (!tgt.incoming.includes(fromId)) tgt.incoming.push(fromId);
      }
      rebuildEdges();
      rebuild2DEdges();
      rebuild3DEdges();
      apiPatch(fromId, { addLinks: [toId] });
      apiPatch(toId, { addLinks: [fromId] });
    }

    function rebuild2DEdges() {
      g2Svg.innerHTML = '';
      edgeSvgs.length = 0;
      drawnEdges.clear();
      edges.forEach(e => {
        const key = [e.from, e.to].sort().join('|');
        if (drawnEdges.has(key)) return;
        drawnEdges.add(key);
        const pa = nodePositions2D.get(e.from), pb = nodePositions2D.get(e.to);
        if (!pa || !pb) return;
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', pa[0] + '%');
        line.setAttribute('y1', pa[1] + '%');
        line.setAttribute('x2', pb[0] + '%');
        line.setAttribute('y2', pb[1] + '%');
        line.dataset.from = e.from;
        line.dataset.to = e.to;
        g2Svg.appendChild(line);
        edgeSvgs.push({ el: line, from: e.from, to: e.to });
      });
    }

    function rebuild3DEdges() {
      edgeObjects3D.forEach(({line}) => scene.remove(line));
      edgeObjects3D.length = 0;
      edges.forEach(e => {
        const a = nodePositions3D.get(e.from);
        const b = nodePositions3D.get(e.to);
        if (!a || !b) return;
        const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
        const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, depthWrite: false });
        const line = new THREE.Line(geo, mat);
        scene.add(line);
        edgeObjects3D.push({ line, geo, mat, from: e.from, to: e.to });
      });
    }

    function cancelConnect() {
      connectSrc = null;
      connectActive3D = null;
      document.querySelectorAll('.connect-src').forEach(el => el.classList.remove('connect-src'));
    }

    // ---- Toggle ----
    document.getElementById('btn-connect').addEventListener('click', function() {
      connectMode = !connectMode;
      this.classList.toggle('active');
      document.body.classList.toggle('connect-mode', connectMode);
      if (!connectMode) { cancelConnect(); }
      document.getElementById('graph-hint').textContent = connectMode
        ? 'Connect mode: click a node, then click another to link'
        : 'Drag to rotate · Scroll to zoom · Click a node to inspect';
      document.getElementById('graph-hint').classList.remove('faded');
    });

    // ---- 2D click to connect ----
    g2Nodes.addEventListener('click', e => {
      if (!connectMode || currentMode !== '2d') return;
      if (!e.target.closest('.g2-node') && connectSrc) {
        document.querySelector('.connect-src')?.classList.remove('connect-src');
        connectSrc = null;
      }
    });

    // ===================================================================
    // ===================================================================
    //  DRAG, DISCONNECT, ADD NODE
    // ===================================================================
    let didDrag = false;
    let dragNode = null;
    let dragStartX = 0, dragStartY = 0;
    const DRAG_THRESHOLD = 5;

    // ---- 2D Node Dragging ----
    g2Nodes.addEventListener('mousedown', e => {
      if (connectMode || currentMode !== '2d' || e.button !== 0) return;
      const nodeEl = e.target.closest('.g2-node');
      if (!nodeEl) return;
      dragNode = nodeEl.dataset.id;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      didDrag = false;
    });

    document.addEventListener('mousemove', e => {
      if (!dragNode || currentMode !== '2d') return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      if (Math.hypot(dx, dy) > DRAG_THRESHOLD) {
        didDrag = true;
        const rect = g2Stage.getBoundingClientRect();
        const stageX = (e.clientX - g2PanX) / g2Scale;
        const stageY = (e.clientY - g2PanY) / g2Scale;
        const pctX = Math.max(0, Math.min(100, (stageX / rect.width) * 100));
        const pctY = Math.max(0, Math.min(100, (stageY / rect.height) * 100));
        const n = nodes.find(x => x.id === dragNode);
        if (n) {
          const sizeClass = n.size || 'md';
          const offset = { xl:15, lg:10, md:7, sm:5 }[sizeClass] || 7;
          nodePositions2D.set(dragNode, [pctX, pctY]);
          const el = nodeEls2D.get(dragNode);
          if (el) {
            el.style.left = 'calc(' + pctX + '% - ' + offset + 'px)';
            el.style.top = 'calc(' + pctY + '% - ' + offset + 'px)';
          }
          rebuild2DEdges();
        }
      }
    });

    document.addEventListener('mouseup', () => {
      if (!dragNode) return;
      if (didDrag) {
        const toSave = {};
        nodePositions2D.forEach((p, id) => { toSave[id] = { x: p[0], y: p[1] }; });
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
      }
      dragNode = null;
    });

    // ---- Disconnect ----
    function openDisconnect(id) {
      const nd = nodes.find(x => x.id === id);
      if (!nd) return;
      const list = document.getElementById('disconnect-list');
      list.innerHTML = '';
      const connected = [...new Set([...(nd.outgoing||[]), ...(nd.incoming||[])])];
      if (connected.length === 0) {
        list.innerHTML = '<p style="color:rgba(255,255,255,0.3);font-size:13px;text-align:center;padding:20px;">No connections to remove.</p>';
      } else {
        connected.forEach(tid => {
          const t = nodes.find(x => x.id === tid);
          if (!t) return;
          const item = document.createElement('div');
          item.className = 'disconnect-item';
          item.innerHTML = '<span style="color:' + (COLORS[t.type]||'#fff') + '">●</span> ' + t.label;
          item.addEventListener('click', () => {
            removeEdge(id, tid);
            openDisconnect(id);
          });
          list.appendChild(item);
        });
      }
      editingNodeId = id;
      document.getElementById('disconnect-overlay').classList.add('open');
    }

    function removeEdge(aId, bId) {
      const ids = [aId, bId];
      ids.forEach(id => {
        const nd = nodes.find(n => n.id === id);
        if (nd) {
          if (nd.outgoing) nd.outgoing = nd.outgoing.filter(x => x !== bId && x !== aId);
          if (nd.incoming) nd.incoming = nd.incoming.filter(x => x !== bId && x !== aId);
        }
      });
      saveData();
      rebuild2DEdges();
      rebuild3DEdges();
      apiPatch(aId, { removeLinks: [bId] });
      apiPatch(bId, { removeLinks: [aId] });
    }

    document.getElementById('disconnect-cancel').addEventListener('click', () => {
      document.getElementById('disconnect-overlay').classList.remove('open');
    });
    document.getElementById('disconnect-overlay').addEventListener('click', e => {
      if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
    });

    // ---- Hook into existing context menu for disconnect ----
    document.querySelectorAll('.context-menu .mi[data-action="disconnect"]').forEach(item => {
      item.addEventListener('click', function(e) {
        e.stopPropagation();
        hideCtx();
        openDisconnect(editingNodeId);
      });
    });

    // ---- Add Node button ----
    document.getElementById('btn-add').addEventListener('click', () => {
      document.getElementById('edit-title').textContent = 'Add Node';
      document.getElementById('edit-id-field').style.display = '';
      document.getElementById('edit-id').value = '';
      document.getElementById('edit-name').value = '';
      document.getElementById('edit-desc').value = '';
      document.getElementById('edit-type').value = 'concept';
      editingNodeId = null;
      document.getElementById('edit-overlay').classList.add('open');
    });

    //  RENDER LOOP (3D only)
    // ===================================================================
    function animate() {
      requestAnimationFrame(animate);
      controls.update();
      update3DHover();
      const t = Date.now() * 0.001;
      cGlowMat.opacity = 0.06 + Math.sin(t * 0.8) * 0.03;

      // Hovered node's connected edges pulse
      if (hoveredId3d) {
        edgeObjects3D.forEach(({ mat, from, to }) => {
          if (from === hoveredId3d || to === hoveredId3d) {
            mat.opacity = 0.3 + Math.sin(t * 3) * 0.2;
          }
        });
      }

      // Smooth scale + glow + label
      nodeData3D.forEach((d, id) => {
        if (!d.mesh.visible) return;
        // Smooth scale transition
        d.scale += (d.targetScale - d.scale) * 0.06;
        d.mesh.scale.setScalar(d.scale);
        // Glow + label
        const isHov = id === hoveredId3d;
        d.glow.material.opacity = (isHov ? 1.2 : 0.6) + Math.sin(t * 1.2 + id.length) * 0.08;
        d.label.element.style.color = isHov ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.45)';
      });

      renderer.render(scene, camera);
      labelRenderer.render(scene, camera);
    }

    animate();

    // Initial view: cards
    container3d.style.display = 'none';
    cardToolbar.style.display = 'flex';
    cardView.style.display = '';
    renderCards();

    // ===================================================================
    //  CHARTS
    // ===================================================================
    let chartInstances = {};

    function computeStats() {
      const typeCount = {};
      const typeIncoming = {};
      const typeOutgoing = {};
      const connCount = [];
      let totalEdges = 0;
      nodes.forEach(n => {
        const t = n.type || 'unknown';
        typeCount[t] = (typeCount[t] || 0) + 1;
        const out = n.outgoing?.length || 0;
        const inc = n.incoming?.length || 0;
        typeOutgoing[t] = (typeOutgoing[t] || 0) + out;
        typeIncoming[t] = (typeIncoming[t] || 0) + inc;
        const total = out + inc;
        if (total > 0) connCount.push({ label: n.label || n.id, total, out, inc });
        totalEdges += out;
      });
      connCount.sort((a, b) => b.total - a.total);
      return { typeCount, typeIncoming, typeOutgoing, connCount: connCount.slice(0, 10), totalEdges };
    }

    function renderCharts() {
      // Destroy old charts
      Object.values(chartInstances).forEach(c => { try { c.destroy(); } catch(e) {} });
      chartInstances = {};

      const stats = computeStats();

      // ── Overview stats ──
      const types = Object.keys(stats.typeCount).sort();
      const typeColors = { concept:'#ff4d6d', user:'#4dabf7', feedback:'#ffa94d', project:'#69db7c', reference:'#b47ae0' };
      const typeLabels = { concept:'Concept', user:'User', feedback:'Feedback', project:'Project', reference:'Reference' };

      let html = '<div class="stat-item"><div class="stat-num">' + nodes.length + '</div><div class="stat-label">Total Nodes</div></div>';
      html += '<div class="stat-item"><div class="stat-num">' + stats.totalEdges + '</div><div class="stat-label">Total Connections</div></div>';
      html += '<div class="stat-item"><div class="stat-num">' + skippedFiles.length + '</div><div class="stat-label">Skipped Files</div></div>';
      types.forEach(t => {
        html += '<div class="stat-item stat-' + t + '"><div class="stat-num">' + stats.typeCount[t] + '</div><div class="stat-label">' + (typeLabels[t] || t) + '</div></div>';
      });
      document.getElementById('stats-grid').innerHTML = html;

      // ── Type distribution (doughnut) ──
      const ctx1 = document.getElementById('chart-type').getContext('2d');
      chartInstances.type = new Chart(ctx1, {
        type: 'doughnut',
        data: {
          labels: types.map(t => typeLabels[t] || t),
          datasets: [{
            data: types.map(t => stats.typeCount[t]),
            backgroundColor: types.map(t => typeColors[t] || 'rgba(255,255,255,0.3)'),
            borderColor: 'rgba(13,17,23,0.8)',
            borderWidth: 3
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: true,
          plugins: {
            legend: { position: 'right', labels: { color: 'rgba(255,255,255,0.6)', padding: 16, font: { size: 12 } } }
          }
        }
      });

      // ── Top connected nodes (horizontal bar) ──
      const ctx2 = document.getElementById('chart-topconn').getContext('2d');
      const topLabels = stats.connCount.map(c => c.label.length > 18 ? c.label.slice(0, 16) + '…' : c.label);
      chartInstances.topconn = new Chart(ctx2, {
        type: 'bar',
        data: {
          labels: topLabels,
          datasets: [{
            label: 'Connections',
            data: stats.connCount.map(c => c.total),
            backgroundColor: 'rgba(77,171,247,0.7)',
            borderColor: '#4dabf7',
            borderWidth: 1,
            borderRadius: 4
          }]
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: true,
          plugins: { legend: { display: false } },
          scales: {
            x: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.4)' } },
            y: { grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.6)', font: { size: 11 } } }
          }
        }
      });

      // ── Connection flow by type (stacked bar) ──
      const ctx3 = document.getElementById('chart-flow').getContext('2d');
      chartInstances.flow = new Chart(ctx3, {
        type: 'bar',
        data: {
          labels: types.map(t => typeLabels[t] || t),
          datasets: [
            { label: 'Outgoing', data: types.map(t => stats.typeOutgoing[t] || 0), backgroundColor: 'rgba(77,171,247,0.7)', borderColor: '#4dabf7', borderWidth: 1 },
            { label: 'Incoming', data: types.map(t => stats.typeIncoming[t] || 0), backgroundColor: 'rgba(105,219,124,0.7)', borderColor: '#69db7c', borderWidth: 1 }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: true,
          plugins: {
            legend: { position: 'top', labels: { color: 'rgba(255,255,255,0.6)', padding: 12, font: { size: 11 } } }
          },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.6)' } },
            y: { stacked: true, beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(255,255,255,0.4)' } }
          }
        }
      });
    }

    // ===================================================================
    //  HEALTH PANEL
    // ===================================================================
    function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

    function renderHealth() {
      fetch('/api/health').then(r => r.json()).then(h => {
        if (h.error) { document.getElementById('health-overview').innerHTML = '<div class="health-empty">Error: ' + esc(h.error) + '</div>'; return; }
        const overall = h.overall || 0;
        const color = overall >= 90 ? '#69db7c' : overall >= 70 ? '#ffa94d' : '#ff6b6b';
        const circumference = 2 * Math.PI * 48;
        const offset = circumference - (overall / 100) * circumference;
        document.getElementById('health-overview').innerHTML =
          '<div class="health-ring"><svg viewBox="0 0 120 120">' +
          '<circle class="bg" cx="60" cy="60" r="48"/>' +
          '<circle class="arc" cx="60" cy="60" r="48" stroke="' + color + '" stroke-dasharray="' + circumference + '" stroke-dashoffset="' + offset + '"/>' +
          '</svg><div class="center"><span style="color:' + color + '">' + overall + '</span><span class="pct">%</span></div></div>' +
          '<div class="health-legend">' +
          '<div class="hl"><span class="dot" style="background:#4dabf7"></span> Validate: ' + h.validate + '%</div>' +
          '<div class="hl"><span class="dot" style="background:#69db7c"></span> Links: ' + h.links + '%</div>' +
          '<div class="hl"><span class="dot" style="background:#ffa94d"></span> Orphans: ' + h.orphans + '%</div>' +
          '</div>';
        document.getElementById('health-overall-pct').textContent = overall + '%';
        document.getElementById('health-overall-bar').style.width = overall + '%';
        document.getElementById('health-overall-bar').style.background = color;
        document.getElementById('health-val-pct').textContent = h.validate + '%';
        document.getElementById('health-val-bar').style.width = h.validate + '%';
        document.getElementById('health-link-pct').textContent = h.links + '%';
        document.getElementById('health-link-bar').style.width = h.links + '%';
        document.getElementById('health-orph-pct').textContent = h.orphans + '%';
        document.getElementById('health-orph-bar').style.width = h.orphans + '%';

        document.getElementById('health-broken-list').innerHTML = (h.brokenLinks && h.brokenLinks.length)
          ? h.brokenLinks.map(l => '<div class="health-list-item issue"><span class="tag">✗</span>' + esc(l) + '</div>').join('')
          : '<div class="health-empty">No issues ✓</div>';

        document.getElementById('health-orphans-list').innerHTML = (h.orphansList && h.orphansList.length)
          ? h.orphansList.map(o => '<div class="health-list-item warn"><span class="tag">○</span>' + esc(o.id) + ' <span style="color:rgba(255,255,255,0.3);font-size:11px">' + esc(o.file) + '</span></div>').join('')
          : '<div class="health-empty">No issues ✓</div>';

        document.getElementById('health-val-issues').innerHTML = (h.validateIssues && h.validateIssues.length)
          ? h.validateIssues.map(l => '<div class="health-list-item issue"><span class="tag">✗</span>' + esc(l) + '</div>').join('')
          : '<div class="health-empty">No issues ✓</div>';
      }).catch(e => {
        document.getElementById('health-overview').innerHTML = '<div class="health-empty">Failed to load: ' + esc(e.message) + '</div>';
      });
    }

    // ===================================================================
    //  CARDS
    // ===================================================================
    function renderCards() {
      const q = searchQuery.trim().toLowerCase();
      let html = '';
      let visible = 0;
      nodes.forEach(n => {
        const tm = filterType === 'all' || n.type === filterType;
        const sm = !q || n.label.toLowerCase().includes(q) || n.id.includes(q) || (n.desc && n.desc.toLowerCase().includes(q));
        if (!tm || !sm) return;
        visible++;
        const connCount = (n.outgoing?.length || 0) + (n.incoming?.length || 0);
        const color = COLORS[n.type] || '#888';
        const bar = connCount > 0 ? '═'.repeat(Math.min(connCount, 10)) : '';
        html += '<div class="card-item" data-cid="' + n.id + '">' +
          '<div class="card-type" style="background:' + color + '">' + n.type + '</div>' +
          '<div class="card-name">' + n.label + '</div>' +
          (n.desc ? '<div class="card-desc">' + n.desc + '</div>' : '') +
          '<div class="card-meta">' +
          '<span class="card-conn" style="color:' + color + '">' +
          (bar ? '<span class="card-conn-bar" style="width:' + Math.min(connCount * 6, 60) + 'px"></span>' : '') +
          connCount + ' connections</span>' +
          '</div></div>';
      });
      document.getElementById('card-grid').innerHTML = html ||
        '<div class="card-empty">' + (q ? 'No memories matching "' + q + '"' : 'No memories yet') + '</div>';
      document.getElementById('card-count-text').textContent = visible + ' memories';
      document.getElementById('badge').textContent = nodes.length + ' memories';

      // Click to open detail
      document.querySelectorAll('.card-item[data-cid]').forEach(el => {
        el.addEventListener('click', function() { openDetail(this.dataset.cid); });
      });
    }

    // ── SSE auto-refresh ──
    if (typeof EventSource !== 'undefined') {
      const es = new EventSource('/api/events');
      let sseTimer = null;
      es.addEventListener('refresh', function() {
        if (sseTimer) return;
        sseTimer = setTimeout(function() {
          es.close();
          document.getElementById('badge').textContent += ' (reloading...)';
          setTimeout(function() { location.reload(); }, 300);
        }, 500);
      });
    }

    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
      labelRenderer.setSize(window.innerWidth, window.innerHeight);
    });
  </script>
