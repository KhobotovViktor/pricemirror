// Furniture Monitor Admin JS - PREMIUM Feedback Style
// Synchronized with new style.css and admin.html structure

document.addEventListener('DOMContentLoaded', () => {
    // 0. Initial Load 
    loadDashboardStats();
    loadSettings();
    
    // Default section
    const lastSection = localStorage.getItem('activeSection') || 'our-products';
    switchSection(lastSection);

    // 1. Add Product Form
    const productForm = document.getElementById('productForm');
    const urlInput = document.getElementById('productUrlInput');
    const priceInput = document.getElementById('productPriceInput');
    const syncStatus = document.getElementById('priceSyncStatus');

    if (urlInput && priceInput) {
        let lastUrl = "";
        const handleUrlChange = async () => {
            const url = urlInput.value.trim();
            if (url === lastUrl) return;
            lastUrl = url;

            const isOurStore = url.includes('alleyadoma.ru');
            
            // Standard state
            priceInput.disabled = isOurStore;
            if (syncStatus) {
                syncStatus.style.display = isOurStore ? 'inline-flex' : 'none';
                syncStatus.innerHTML = '<i class="fa-solid fa-sync fa-spin"></i> Авто';
                syncStatus.style.color = "var(--primary)";
            }
            
            if (isOurStore && url.length > 20) {
                // If it's our store, fetch price immediately
                priceInput.placeholder = "Получаем актуальную цену...";
                priceInput.style.background = "var(--bg-soft)";
                
                try {
                    const response = await fetch(`/api/scrape/preview?url=${encodeURIComponent(url)}`, {credentials: 'include'});
                    if (response.ok) {
                        const data = await response.json();
                        if (data.price) {
                            priceInput.value = data.price;
                            priceInput.placeholder = "";
                            if (syncStatus) {
                                syncStatus.innerHTML = '<i class="fa-solid fa-check-circle"></i> Готово';
                                syncStatus.style.color = "var(--success)";
                            }
                        } else {
                            priceInput.placeholder = "Цена не найдена, введите вручную";
                            priceInput.disabled = false;
                            if (syncStatus) {
                                syncStatus.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Ошибка';
                                syncStatus.style.color = "var(--danger)";
                            }
                        }
                    }
                } catch (err) {
                    console.error("Preview error:", err);
                    priceInput.disabled = false;
                }
            } else if (!isOurStore) {
                priceInput.placeholder = "49990";
                priceInput.style.background = "white";
                priceInput.title = "";
                priceInput.disabled = false;
            }
        };

        urlInput.addEventListener('input', () => {
            if (urlInput.value.includes('alleyadoma.ru')) {
                // Debounce simple
                setTimeout(handleUrlChange, 500);
            } else {
                handleUrlChange();
            }
        });
        urlInput.addEventListener('change', handleUrlChange);
        urlInput.addEventListener('paste', () => setTimeout(handleUrlChange, 100));
    }

    if (productForm) {
        productForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(productForm);
            
            try {
                const response = await fetch('/api/products', {
                    method: 'POST',
                    body: formData
                });
                
                if (response.ok) {
                    alert('Товар успешно добавлен!');
                    location.reload(); 
                } else {
                    const err = await response.json();
                    alert('Ошибка: ' + (err.detail || 'Неизвестная ошибка'));
                }
            } catch (err) {
                console.error(err);
                alert('Не удалось связаться с сервером');
            }
        });
    }

    // 2. Mapping Form
    const mappingForm = document.getElementById('mappingForm');
    const statusDiv = document.getElementById('mappingStatus');
    
    if (mappingForm) {
        mappingForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(mappingForm);
            
            statusDiv.innerHTML = '<span style="color: var(--primary); font-weight: 600;"><i class="fa-solid fa-spinner fa-spin"></i> Определяем магазин...</span>';
            
            try {
                const response = await fetch('/api/mappings', {
                    method: 'POST',
                    body: formData
                });
                
                if (response.ok) {
                    const data = await response.json();
                    statusDiv.innerHTML = `<span style="color: var(--success); font-weight: 600;"><i class="fa-solid fa-check-circle"></i> ✓ Успешно! Магазин: <strong>${data.store_name}</strong></span>`;
                    mappingForm.reset();
                    loadDashboardStats(); 
                } else {
                    const err = await response.json();
                    const msg = typeof err.detail === 'string' ? err.detail : JSON.stringify(err);
                    statusDiv.innerHTML = `<span style="color: var(--danger); font-weight: 600;"><i class="fa-solid fa-triangle-exclamation"></i> ⚠ Ошибка: ${msg}</span>`;
                }
            } catch (err) {
                console.error(err);
                statusDiv.innerHTML = '<span style="color: var(--danger);">⚠ Ошибка при подключении к серверу</span>';
            }
        });
    }

    // 3. Settings Form Logic
    const settingsForm = document.getElementById('settingsForm');
    if (settingsForm) {
        settingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const settings = {
                telegram_bot_token: document.getElementById('set_telegram_bot_token').value,
                telegram_chat_id: document.getElementById('set_telegram_chat_id').value,
                scan_interval_hours: document.getElementById('set_scan_interval_hours').value
            };

            try {
                const response = await fetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(settings)
                });
                
                if (response.ok) {
                    alert('Настройки успешно сохранены!');
                } else {
                    alert('Ошибка при сохранении настроек');
                }
            } catch (err) {
                console.error(err);
                alert('Не удалось сохранить настройки');
            }
        });
    }

    // 4. Search & Filter Logics
    const catalogSearch = document.getElementById('catalogSearch');
    const categoryFilter = document.getElementById('categoryFilter');
    
    if (catalogSearch) catalogSearch.addEventListener('input', handleProductFilter);
    if (categoryFilter) categoryFilter.addEventListener('change', handleProductFilter);
    
    initSearch('competitorSearch', '.competitor-row');
    
    // 5. Modal Overlay Close
    const overlay = document.getElementById('modalOverlay');
    if (overlay) {
        overlay.onclick = () => closeAnalytics();
    }
});

// --- SPA Logic ---

window.switchSection = (sectionId) => {
    // Hide all sections
    document.querySelectorAll('.content-section').forEach(s => s.classList.remove('active'));
    // Show target
    const target = document.getElementById(`section-${sectionId}`);
    if (target) target.classList.add('active');

    // Update Sidebar
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const activeLink = document.querySelector(`.nav-link[onclick*="${sectionId}"]`);
    if (activeLink) activeLink.classList.add('active');

    // Store state
    localStorage.setItem('activeSection', sectionId);

    // Initializations for specific sections
    if (sectionId === 'statistics') loadGlobalTrend();
    if (sectionId === 'competitors') {
        loadStores();
        loadCompetitorProducts();
    }
}

function initSearch(inputId, itemSelector) {
    const input = document.getElementById(inputId);
    if (!input) return;

    input.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase();
        document.querySelectorAll(itemSelector).forEach(item => {
            const text = item.innerText.toLowerCase();
            item.style.display = text.includes(query) ? 'flex' : 'none';
        });
    });
}

function handleProductFilter() {
    const query = document.getElementById('catalogSearch')?.value.toLowerCase() || '';
    const categoryId = document.getElementById('categoryFilter')?.value || 'all';
    const statusFilter = document.getElementById('statusFilter')?.value || 'all';

    document.querySelectorAll('#productList .product-item').forEach(item => {
        const name = item.dataset.name || '';
        const itemCategory = item.dataset.category || '';
        const itemStatus = item.dataset.status || 'neutral';

        const matchesSearch = name.includes(query);
        const matchesCategory = (categoryId === 'all' || itemCategory === categoryId);
        const matchesStatus = (statusFilter === 'all' || itemStatus === statusFilter);

        item.style.display = (matchesSearch && matchesCategory && matchesStatus) ? 'flex' : 'none';
    });
}

// --- Competitor Section Logic ---

async function loadStores() {
    try {
        const response = await fetch('/api/stores');
        if (!response.ok) return;
        const stores = await response.json();
        const select = document.getElementById('competitorStoreFilter');
        if (!select) return;

        select.innerHTML = '<option value="all">Все магазины</option>';
        stores.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            select.appendChild(opt);
        });

        select.onchange = () => filterCompetitors();
    } catch (err) {
        console.error('Stores Load Error:', err);
    }
}

function filterCompetitors() {
    const storeId = document.getElementById('competitorStoreFilter').value;
    const priceFilter = document.getElementById('competitorPriceFilter')?.value || 'all';
    const categoryId = document.getElementById('competitorCategoryFilter')?.value || 'all';
    const query = document.getElementById('competitorSearch')?.value.toLowerCase() || '';
    const items = document.querySelectorAll('.competitor-product-item');

    items.forEach(item => {
        const storeMatch = storeId === 'all' || item.dataset.store === storeId;
        const priceMatch = priceFilter === 'all' || item.dataset.priceStatus === priceFilter;
        const categoryMatch = categoryId === 'all' || item.dataset.category === categoryId;
        const nameMatch = !query || (item.dataset.name || '').includes(query);
        item.style.display = (storeMatch && priceMatch && categoryMatch && nameMatch) ? 'flex' : 'none';
    });
}

async function loadCompetitorProducts() {
    const listContainer = document.getElementById('competitorLinksList');
    if (!listContainer) return;

    listContainer.innerHTML = '<div style="text-align: center; padding: 3rem; opacity: 0.5;"><i class="fa-solid fa-circle-notch fa-spin"></i> Загрузка...</div>';
    
    try {
        const response = await fetch('/api/competitor_products/all');
        if (!response.ok) throw new Error('Failed to fetch');
        const data = await response.json();

        listContainer.innerHTML = '';
        if (data.length === 0) {
            listContainer.innerHTML = '<p style="text-align: center; padding: 3rem; color: var(--text-muted);">Ссылки пока не добавлены</p>';
            return;
        }

        data.forEach(item => {
            const div = document.createElement('div');
            div.className = 'product-item competitor-product-item';
            div.dataset.store = item.store_id;
            div.dataset.id = item.id;
            div.dataset.category = item.category_id ?? '';
            div.dataset.name = (item.our_product_name || '').toLowerCase();

            const diff = item.competitor_price ? (item.our_price - item.competitor_price) : 0;
            const diffClass = diff > 0 ? 'status-danger' : (diff < 0 ? 'status-success' : '');

            // Price status for filtering
            let priceStatus = 'unknown';
            if (item.competitor_price) {
                if (diff > 0) priceStatus = 'higher';
                else if (diff < 0) priceStatus = 'lower';
                else priceStatus = 'equal';
            }
            div.dataset.priceStatus = priceStatus;
            
            div.innerHTML = `
                <div style="display: flex; align-items: center; gap: 1rem; flex-grow: 1;">
                    <input type="checkbox" class="competitor-checkbox" data-id="${item.id}" onclick="event.stopPropagation(); window.updateCompetitorBatchBar();" style="width: 1.15rem; height: 1.15rem; cursor: pointer; accent-color: var(--primary);">
                    <div>
                        <div style="font-weight: 700; color: var(--text-main);">${item.our_product_name}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: 600; text-transform: uppercase;">
                             ${item.store_name} • <a href="${item.url}" target="_blank" style="color: var(--primary); text-decoration: none;">Открыть ссылку <i class="fa-solid fa-external-link" style="font-size: 0.6rem;"></i></a>
                        </div>
                    </div>
                </div>
                <div style="text-align: right; margin-right: 1.5rem;">
                    <div class="price" style="color: var(--text-muted); font-size: 0.9rem; font-weight: 500;">Наш: ${item.our_price.toLocaleString()} ₽</div>
                    <div class="price">${item.competitor_price ? item.competitor_price.toLocaleString() + ' ₽' : 'Сбор...'}</div>
                </div>
                <div style="display: flex; align-items: center; gap: 0.75rem; width: 160px; justify-content: flex-end;">
                     <div class="status-pill ${item.competitor_price ? diffClass : ''}" style="min-width: 100px; justify-content: center; ${!item.competitor_price ? 'opacity: 0.5;' : ''}">
                        ${item.competitor_price ? (diff > 0 ? '+' : '') + diff.toLocaleString() + ' ₽' : 'Ожидание'}
                    </div>
                    <button class="secondary refresh-mapping-btn" onclick="refreshMapping(${item.id}, this)" title="Обновить цену" style="padding: 0.5rem; border-radius: 50%; width: 34px; height: 34px; display: flex; align-items: center; justify-content: center;">
                        <i class="fa-solid fa-rotate"></i>
                    </button>
                </div>
            `;
            listContainer.appendChild(div);
        });
        window.updateCompetitorBatchBar();
    } catch (err) {
        console.error('Competitor Load Error:', err);
        listContainer.innerHTML = '<p style="text-align: center; padding: 3rem; color: var(--danger);">Ошибка при загрузке данных мониторинга</p>';
    }
}

// --- Statistics & Charts ---

let priceChart = null;
let globalTrendChart = null;
let avgPriceChart = null;
let trendChartInstance = null;
let coverageDonutInstance = null;
let _analyticsData = null; // cached data from /api/analytics/full

const REPORT_COLORS = [
    '#6366f1', '#a855f7', '#ec4899', '#f43f5e', '#f97316',
    '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
    '#8b5cf6', '#d946ef', '#f59e0b', '#10b981', '#0ea5e9',
];

function switchReportTab(tabId) {
    document.querySelectorAll('.report-panel').forEach(p => p.style.display = 'none');
    document.querySelectorAll('.report-tab').forEach(t => {
        t.style.background = 'var(--glass-bg)';
        t.style.color = 'var(--text-main)';
    });
    const panel = document.getElementById('report-' + tabId);
    const tab = document.getElementById('tab-' + tabId);
    if (panel) panel.style.display = 'block';
    if (tab) { tab.style.background = 'var(--primary)'; tab.style.color = 'white'; }

    // Render on first switch
    if (tabId === 'avg-price') renderAvgPriceReport();
    if (tabId === 'heatmap') renderHeatmap();
    if (tabId === 'trend') renderTrendReport();
    if (tabId === 'risk') renderRiskReport();
    if (tabId === 'coverage') renderCoverageReport();
}

async function loadAnalyticsData() {
    if (_analyticsData) return _analyticsData;
    try {
        const resp = await fetch('/api/analytics/full');
        if (!resp.ok) throw new Error('Failed to load analytics');
        _analyticsData = await resp.json();
        // Populate category filters
        const cats = _analyticsData.categories || [];
        ['avgPriceCategoryFilter', 'heatmapCategoryFilter', 'trendCategoryFilter'].forEach(id => {
            const sel = document.getElementById(id);
            if (!sel) return;
            sel.innerHTML = '<option value="">Все категории</option>' +
                cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        });
        // Populate store checkboxes for Report 1
        const storeDiv = document.getElementById('avgPriceStoreFilter');
        if (storeDiv) {
            const stores = _analyticsData.stores || [];
            storeDiv.innerHTML =
                `<label style="font-size:0.78rem;display:inline-flex;align-items:center;gap:3px;cursor:pointer;white-space:nowrap;"><input type="checkbox" value="our" checked onchange="renderAvgPriceReport()"> Аллея Дома</label>` +
                stores.map(s =>
                    `<label style="font-size:0.78rem;display:inline-flex;align-items:center;gap:3px;cursor:pointer;white-space:nowrap;"><input type="checkbox" value="${s.id}" checked onchange="renderAvgPriceReport()"> ${s.name}</label>`
                ).join('');
        }
        return _analyticsData;
    } catch (err) {
        console.error('Analytics data error:', err);
        return null;
    }
}

async function loadStatisticsSection() {
    await loadAnalyticsData();
    renderAvgPriceReport();
}

// ---- REPORT 1: Average Price by Category (horizontal bar) ----

async function renderAvgPriceReport() {
    const data = await loadAnalyticsData();
    if (!data) return;

    const catFilter = document.getElementById('avgPriceCategoryFilter')?.value;
    const storeDiv = document.getElementById('avgPriceStoreFilter');
    const selectedStores = storeDiv ?
        Array.from(storeDiv.querySelectorAll('input:checked')).map(cb => cb.value) : [];

    const includeOur = selectedStores.includes('our');
    const storeIds = selectedStores.filter(s => s !== 'our').map(Number);

    // Filter products by category
    let products = data.products;
    if (catFilter) products = products.filter(p => String(p.category_id) === catFilter);

    // Build: { storeName: [prices] }
    const storePrices = {};
    if (includeOur) storePrices['Аллея Дома'] = [];

    for (const s of data.stores) {
        if (storeIds.includes(s.id)) storePrices[s.name] = [];
    }

    for (const p of products) {
        if (includeOur && p.current_price) storePrices['Аллея Дома'].push(p.current_price);
        for (const m of p.mappings) {
            if (storeIds.includes(m.store_id) && m.last_price) {
                const name = m.store_name;
                if (!storePrices[name]) storePrices[name] = [];
                storePrices[name].push(m.last_price);
            }
        }
    }

    const labels = [];
    const values = [];
    const colors = [];
    let ci = 0;
    for (const [name, prices] of Object.entries(storePrices)) {
        if (prices.length === 0) continue;
        labels.push(name);
        values.push(Math.round(prices.reduce((a, b) => a + b, 0) / prices.length));
        colors.push(name === 'Аллея Дома' ? '#6366f1' : REPORT_COLORS[(ci++) % REPORT_COLORS.length]);
    }

    const canvas = document.getElementById('avgPriceChart');
    if (!canvas) return;
    if (avgPriceChart) avgPriceChart.destroy();

    avgPriceChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Средняя цена (₽)',
                data: values,
                backgroundColor: colors.map(c => c + 'cc'),
                borderColor: colors,
                borderWidth: 2,
                borderRadius: 6,
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: { backgroundColor: '#1e293b', padding: 12, cornerRadius: 8 }
            },
            scales: {
                x: {
                    ticks: { color: '#64748b', font: { weight: '600' }, callback: v => v.toLocaleString() + ' ₽' },
                    grid: { color: '#f1f5f9' }
                },
                y: {
                    ticks: { color: '#334155', font: { weight: '700', size: 13 } },
                    grid: { display: false }
                }
            }
        }
    });
}

// ---- REPORT 2: Heatmap ----

async function renderHeatmap() {
    const data = await loadAnalyticsData();
    if (!data) return;

    const catFilter = document.getElementById('heatmapCategoryFilter')?.value;
    let products = data.products.filter(p => p.current_price && p.has_price);
    if (catFilter) products = products.filter(p => String(p.category_id) === catFilter);

    // Collect all store IDs that have mappings
    const storeSet = new Set();
    for (const p of products) for (const m of p.mappings) if (m.last_price) storeSet.add(m.store_id);
    const storeIds = [...storeSet];
    const storeNames = {};
    for (const s of data.stores) storeNames[s.id] = s.name;

    if (products.length === 0 || storeIds.length === 0) {
        document.getElementById('heatmapContainer').innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:2rem;">Нет данных для отображения</p>';
        return;
    }

    let html = '<table style="width:100%;border-collapse:collapse;font-size:0.8rem;">';
    html += '<thead><tr><th style="text-align:left;padding:0.5rem;border-bottom:2px solid var(--border-soft);min-width:200px;">Товар</th>';
    for (const sid of storeIds) {
        html += `<th style="padding:0.5rem;border-bottom:2px solid var(--border-soft);text-align:center;min-width:100px;font-size:0.75rem;">${storeNames[sid] || sid}</th>`;
    }
    html += '</tr></thead><tbody>';

    for (const p of products) {
        html += `<tr><td style="padding:0.5rem 0.5rem;border-bottom:1px solid var(--border-soft);font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:250px;" title="${p.name}">${p.name}</td>`;
        for (const sid of storeIds) {
            const m = p.mappings.find(m => m.store_id === sid && m.last_price);
            if (!m) {
                html += '<td style="padding:0.4rem;text-align:center;border-bottom:1px solid var(--border-soft);background:#f1f5f9;color:#94a3b8;">—</td>';
            } else {
                const diff = ((p.current_price - m.last_price) / p.current_price * 100);
                let bg, color;
                if (diff > 3) { bg = '#fef2f2'; color = '#dc2626'; }      // we are more expensive
                else if (diff < -3) { bg = '#f0fdf4'; color = '#16a34a'; } // we are cheaper
                else { bg = '#fffbeb'; color = '#d97706'; }                // roughly equal
                html += `<td style="padding:0.4rem;text-align:center;border-bottom:1px solid var(--border-soft);background:${bg};color:${color};font-weight:700;">${diff > 0 ? '+' : ''}${diff.toFixed(1)}%</td>`;
            }
        }
        html += '</tr>';
    }
    html += '</tbody></table>';
    document.getElementById('heatmapContainer').innerHTML = html;
}

// ---- REPORT 3: Price Trend by Category ----

async function renderTrendReport() {
    const data = await loadAnalyticsData();
    if (!data) return;

    const catFilter = document.getElementById('trendCategoryFilter')?.value;

    // Get product IDs in this category
    let productIds = null;
    if (catFilter) {
        productIds = new Set(data.products.filter(p => String(p.category_id) === catFilter).map(p => p.id));
    }

    // Build datasets from trend data, filtered by category products
    // trend: { storeId: { store_name, data: { date: avg_price } } }
    const datasets = [];
    let allDates = new Set();
    let ci = 0;

    // Add "our" average trend
    if (data.products.length > 0) {
        const ourByDay = {};
        for (const p of data.products) {
            if (productIds && !productIds.has(p.id)) continue;
            if (!p.current_price) continue;
            // We don't have daily our-price history, so show as flat line
        }
    }

    for (const [sid, sdata] of Object.entries(data.trend)) {
        // If filtering by category, we need to check if this store has products in category
        // Since trend is aggregated across all products per store, we show all stores
        // (the /api/analytics/full already provides store-level daily data)
        const dates = Object.keys(sdata.data);
        dates.forEach(d => allDates.add(d));

        const color = REPORT_COLORS[ci % REPORT_COLORS.length];
        datasets.push({
            label: sdata.store_name,
            data: dates.map(d => ({ x: d, y: sdata.data[d] })),
            borderColor: color,
            backgroundColor: color + '15',
            fill: false,
            tension: 0.3,
            pointRadius: 3,
            pointBorderWidth: 2,
            pointBackgroundColor: '#fff',
            pointBorderColor: color,
        });
        ci++;
    }

    allDates = [...allDates].sort();

    const canvas = document.getElementById('trendChart');
    if (!canvas) return;
    if (trendChartInstance) trendChartInstance.destroy();

    trendChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: allDates.map(d => new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })),
            datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { usePointStyle: true, padding: 16, font: { size: 12, weight: '600' } } },
                tooltip: { backgroundColor: '#1e293b', padding: 12, cornerRadius: 8, mode: 'index', intersect: false }
            },
            scales: {
                y: { ticks: { color: '#64748b', font: { weight: '600' }, callback: v => v.toLocaleString() + ' ₽' }, grid: { color: '#f1f5f9' } },
                x: { ticks: { color: '#64748b', font: { weight: '600' } }, grid: { display: false } }
            }
        }
    });
}

// ---- REPORT 4: Risk Zone ----

async function renderRiskReport() {
    const data = await loadAnalyticsData();
    if (!data) return;

    const riskProducts = data.products
        .filter(p => p.current_price && p.min_comp_price && p.current_price > p.min_comp_price)
        .map(p => ({
            ...p,
            gap: Math.round(p.current_price - p.min_comp_price),
            gapPct: ((p.current_price - p.min_comp_price) / p.current_price * 100).toFixed(1),
            recommended: Math.round(p.min_comp_price * 0.99),
            cheapestStore: (p.mappings.find(m => m.last_price === p.min_comp_price) || {}).store_name || '—',
        }))
        .sort((a, b) => b.gap - a.gap);

    if (riskProducts.length === 0) {
        document.getElementById('riskTableContainer').innerHTML = '<p style="color:var(--success);text-align:center;padding:2rem;font-weight:600;">Все цены конкурентоспособны</p>';
        return;
    }

    let html = '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
    html += '<thead><tr style="border-bottom:2px solid var(--border-soft);">';
    html += '<th style="text-align:left;padding:0.7rem;">Товар</th>';
    html += '<th style="text-align:right;padding:0.7rem;">Наша цена</th>';
    html += '<th style="text-align:right;padding:0.7rem;">Мин. конкурента</th>';
    html += '<th style="text-align:left;padding:0.7rem;">Магазин</th>';
    html += '<th style="text-align:right;padding:0.7rem;">Разрыв</th>';
    html += '<th style="text-align:right;padding:0.7rem;">%</th>';
    html += '<th style="text-align:right;padding:0.7rem;">Рекоменд.</th>';
    html += '</tr></thead><tbody>';

    for (const p of riskProducts) {
        html += '<tr style="border-bottom:1px solid var(--border-soft);">';
        html += `<td style="padding:0.6rem;font-weight:600;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${p.name}">${p.name}</td>`;
        html += `<td style="padding:0.6rem;text-align:right;font-weight:700;">${p.current_price.toLocaleString()} ₽</td>`;
        html += `<td style="padding:0.6rem;text-align:right;color:var(--success);font-weight:700;">${p.min_comp_price.toLocaleString()} ₽</td>`;
        html += `<td style="padding:0.6rem;font-size:0.8rem;">${p.cheapestStore}</td>`;
        html += `<td style="padding:0.6rem;text-align:right;color:var(--danger);font-weight:700;">+${p.gap.toLocaleString()} ₽</td>`;
        html += `<td style="padding:0.6rem;text-align:right;color:var(--danger);font-weight:700;">+${p.gapPct}%</td>`;
        html += `<td style="padding:0.6rem;text-align:right;color:var(--primary);font-weight:700;">${p.recommended.toLocaleString()} ₽</td>`;
        html += '</tr>';
    }
    html += '</tbody></table>';
    document.getElementById('riskTableContainer').innerHTML = html;
}

// ---- REPORT 5: Coverage ----

async function renderCoverageReport() {
    const data = await loadAnalyticsData();
    if (!data) return;

    const total = data.products.length;
    const withMapping = data.products.filter(p => p.has_mapping).length;
    const withPrice = data.products.filter(p => p.has_price).length;
    const stale = data.products.filter(p => p.is_stale).length;
    const noMapping = total - withMapping;

    // Donut chart
    const canvas = document.getElementById('coverageDonut');
    if (canvas) {
        if (coverageDonutInstance) coverageDonutInstance.destroy();
        coverageDonutInstance = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['С актуальной ценой', 'Устаревшие данные', 'Без привязки'],
                datasets: [{
                    data: [withPrice - stale, stale, noMapping],
                    backgroundColor: ['#22c55e', '#f97316', '#e2e8f0'],
                    borderWidth: 0,
                    hoverOffset: 6,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '65%',
                plugins: {
                    legend: { position: 'bottom', labels: { usePointStyle: true, padding: 12, font: { size: 11, weight: '600' } } },
                }
            }
        });
    }

    // Store coverage table
    const storeCoverage = {};
    for (const s of data.stores) storeCoverage[s.id] = { name: s.name, count: 0, withPrice: 0 };
    for (const p of data.products) {
        for (const m of p.mappings) {
            if (storeCoverage[m.store_id]) {
                storeCoverage[m.store_id].count++;
                if (m.last_price) storeCoverage[m.store_id].withPrice++;
            }
        }
    }

    let html = '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
    html += '<thead><tr style="border-bottom:2px solid var(--border-soft);">';
    html += '<th style="text-align:left;padding:0.7rem;">Магазин</th>';
    html += '<th style="text-align:right;padding:0.7rem;">Привязано</th>';
    html += '<th style="text-align:right;padding:0.7rem;">С ценой</th>';
    html += '<th style="text-align:right;padding:0.7rem;">Покрытие</th>';
    html += '</tr></thead><tbody>';

    for (const sc of Object.values(storeCoverage).sort((a, b) => b.count - a.count)) {
        const pct = total > 0 ? (sc.count / total * 100).toFixed(0) : 0;
        const pctBar = `<div style="background:var(--border-soft);border-radius:4px;height:8px;width:80px;display:inline-block;vertical-align:middle;margin-left:6px;"><div style="background:var(--primary);border-radius:4px;height:100%;width:${Math.min(pct, 100)}%;"></div></div>`;
        html += '<tr style="border-bottom:1px solid var(--border-soft);">';
        html += `<td style="padding:0.6rem;font-weight:600;">${sc.name}</td>`;
        html += `<td style="padding:0.6rem;text-align:right;">${sc.count}</td>`;
        html += `<td style="padding:0.6rem;text-align:right;">${sc.withPrice}</td>`;
        html += `<td style="padding:0.6rem;text-align:right;">${pct}% ${pctBar}</td>`;
        html += '</tr>';
    }
    html += '</tbody></table>';
    document.getElementById('coverageTableContainer').innerHTML = html;
}

// Legacy: global trend (replaced by tab-based reports but kept for loadDashboardStats)
async function loadGlobalTrend() {
    // Now handled by loadStatisticsSection
    await loadStatisticsSection();
}

// --- Batch Management Logic ---

window.updateCompetitorBatchBar = () => {
    const checkboxes = document.querySelectorAll('.competitor-checkbox:checked');
    const toolbar = document.getElementById('batchScrapeToolbar');
    const label = document.getElementById('selectedCountLabel');
    const selectAll = document.getElementById('selectAllCompetitors');

    if (toolbar) {
        toolbar.style.display = checkboxes.length > 0 ? 'flex' : 'none';
    }
    if (label) {
        label.innerText = `Выбрано: ${checkboxes.length}`;
    }
    
    // Update select all state visually
    const total = document.querySelectorAll('.competitor-checkbox').length;
    if (selectAll && total > 0) {
        selectAll.checked = checkboxes.length === total;
        selectAll.indeterminate = checkboxes.length > 0 && checkboxes.length < total;
    }
};

window.handleBatchScrape = async () => {
    const ids = Array.from(document.querySelectorAll('.competitor-checkbox:checked')).map(cb => parseInt(cb.dataset.id));
    if (ids.length === 0) return;

    try {
        const response = await fetch('/api/scrape/mappings/batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: ids })
        });
        
        if (response.ok) {
            alert(`🎉 Запущено обновление для ${ids.length} ссылок. Цены обновятся в ближайшее время.`);
            // Uncheck all and refresh list in background
            document.querySelectorAll('.competitor-checkbox').forEach(cb => cb.checked = false);
            window.updateCompetitorBatchBar();
        } else {
            alert('Ошибка при запуске массового обновления');
        }
    } catch (err) {
        console.error('Batch error:', err);
    }
};

window.refreshMapping = async (id, btn) => {
    const icon = btn.querySelector('i');
    icon.classList.add('fa-spin');
    btn.disabled = true;

    try {
        const response = await fetch(`/api/scrape/mapping/${id}`, { method: 'POST' });
        if (response.ok) {
            // Give it time then revert icon but leave price to async worker
            setTimeout(() => {
                icon.classList.remove('fa-spin');
                btn.disabled = false;
                loadCompetitorProducts(); // Refetch to show the new price
            }, 3000);
        } else {
            icon.classList.remove('fa-spin');
            btn.disabled = false;
            alert('Ошибка при запуске обновления');
        }
    } catch (err) {
        icon.classList.remove('fa-spin');
        btn.disabled = false;
        console.error('Refresh error:', err);
    }
};

window.refreshOurProduct = async (id, btn) => {
    const icon = btn.querySelector('i');
    icon.classList.add('fa-spin');
    btn.disabled = true;

    try {
        const response = await fetch(`/api/scrape/our-product/${id}`, { method: 'POST' });
        if (response.ok) {
            setTimeout(() => {
                icon.classList.remove('fa-spin');
                btn.disabled = false;
                location.reload(); // Refresh to show our updated price
            }, 3000);
        } else {
            icon.classList.remove('fa-spin');
            btn.disabled = false;
            alert('Ошибка при запуске обновления вашей цены');
        }
    } catch (err) {
        icon.classList.remove('fa-spin');
        btn.disabled = false;
        console.error('Our product refresh error:', err);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // ... preexisting listeners ...
    
    const selectAll = document.getElementById('selectAllCompetitors');
    if (selectAll) {
        selectAll.addEventListener('change', (e) => {
            document.querySelectorAll('.competitor-checkbox').forEach(cb => {
                cb.checked = e.target.checked;
            });
            window.updateCompetitorBatchBar();
        });
    }
});
window.updateProductBatchBar = () => {
    const bar = document.getElementById('batchActions');
    const checkboxes = document.querySelectorAll('.product-checkbox:checked');
    const count = checkboxes.length;
    
    if (bar) {
        if (count > 0) {
            bar.style.display = 'flex';
            document.getElementById('selectedCount').textContent = `Выбрано: ${count} тов.`;
        } else {
            bar.style.display = 'none';
        }
    }
}

window.clearSelection = () => {
    document.querySelectorAll('.product-checkbox').forEach(cb => cb.checked = false);
    updateProductBatchBar();
}

window.handleBatchDelete = async () => {
    const checkboxes = document.querySelectorAll('.product-checkbox:checked');
    const ids = Array.from(checkboxes).map(cb => {
        const item = cb.closest('.product-item');
        return parseInt(item.dataset.id);
    });

    if (!confirm(`Вы уверены, что хотите удалить ${ids.length} товаров и всю их историю?`)) return;

    showLoading("Удаление товаров...");
    try {
        const response = await fetch('/api/products/batch-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids })
        });

        if (response.ok) {
            alert('Товары успешно удалены!');
            location.reload();
        } else {
            alert('Ошибка при массовом удалении');
        }
    } catch (err) {
        console.error(err);
        alert('Не удалось связаться с сервером');
    } finally {
        hideLoading();
    }
}
// --- Product Actions ---

async function deleteProductById(btn) {
    const id = btn.getAttribute('data-id');
    const name = btn.getAttribute('data-name');
    
    if (confirm(`Вы уверены, что хотите удалить товар "${name}" и всю историю его цен?`)) {
        showLoading("Удаление товара...");
        try {
            const response = await fetch(`/api/products/${id}`, { method: 'DELETE' });
            if (response.ok) {
                btn.closest('.product-item').remove();
                loadDashboardStats();
            } else {
                const err = await response.json();
                alert('Ошибка при удалении: ' + (err.detail || 'Неизвестная ошибка'));
            }
        } catch (err) {
            console.error(err);
            alert('Не удалось связаться с сервером');
        } finally {
            hideLoading();
        }
    }
}

async function displayProductAnalytics(productId) {
    const section = document.getElementById('analyticsSection');
    const overlay = document.getElementById('modalOverlay');
    const badge = document.getElementById('recommendationBadge');
    
    if (!section) return; 
    
    section.style.display = 'block';
    if (overlay) overlay.style.display = 'block';
    section.scrollTop = 0;
    
    showLoading("Загрузка аналитики...");
    try {
        const response = await fetch(`/api/analytics/${productId}`);
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Ошибка сервера');
        }
        const data = await response.json();
        
        document.getElementById('analyticsTitle').innerText = data.our_product.name;
        document.getElementById('ourPriceBadge').innerText = `${(data.our_product.current_price || 0).toLocaleString()} ₽`;
        document.getElementById('minCompBadge').innerText = `${(data.min_competitor || 0).toLocaleString()} ₽`;
        
        if (data.recommendation) {
            badge.innerText = data.recommendation.text;
            const isWarning = data.recommendation.type === 'decrease';
            badge.className = isWarning ? 'status-pill status-danger' : 'status-pill status-success';
        }

        renderChart(data);
    } catch (err) {
        console.error('Analytics Error:', err);
        alert('Ошибка: ' + err.message);
    } finally {
        hideLoading();
    }
}

function renderChart(data) {
    const canvas = document.getElementById('priceChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (priceChart) priceChart.destroy();
    
    if (!data.history || data.history.length === 0) {
        ctx.font = '600 14px Inter';
        ctx.fillStyle = '#64748b';
        ctx.textAlign = 'center';
        ctx.fillText('Сбор истории цен...', canvas.width/2, canvas.height/2);
        return;
    }

    const sortedHistory = [...data.history].sort((a, b) => new Date(a.date) - new Date(b.date));
    const labels = sortedHistory.map(h => new Date(h.date).toLocaleDateString());
    const prices = sortedHistory.map(h => h.price);

    priceChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Цена конкурентов',
                    data: prices,
                    borderColor: '#a855f7',
                    backgroundColor: 'rgba(168, 85, 247, 0.05)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4,
                    pointBackgroundColor: '#ffffff',
                    pointBorderColor: '#a855f7'
                },
                {
                    label: 'Наша цена',
                    data: labels.map(() => data.our_product.current_price),
                    borderColor: '#6366f1',
                    borderDash: [8, 4],
                    pointRadius: 0,
                    fill: false,
                    borderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { 
                    position: 'bottom',
                    labels: { color: '#64748b', font: { weight: '600' } } 
                }
            },
            scales: {
                y: { ticks: { color: '#64748b' }, grid: { color: '#f1f5f9' } },
                x: { ticks: { color: '#64748b' }, grid: { display: false } }
            }
        }
    });
}

// --- Utilities ---

function showLoading(text = "Обработка данных...") {
    const loader = document.getElementById('loader');
    if (loader) {
        loader.querySelector('div[style*="font-weight: 700"]').textContent = text;
        loader.style.display = 'flex';
    }
}

function hideLoading() {
    const loader = document.getElementById('loader');
    if (loader) loader.style.display = 'none';
}

async function loadDashboardStats() {
    try {
        const response = await fetch('/api/dashboard/stats');
        const data = await response.json();
        
        const els = {
            statTotal: document.getElementById('statTotal'),
            statAtRisk: document.getElementById('statAtRisk'),
            statAvgGap: document.getElementById('statAvgGap'),
            statLastSync: document.getElementById('statLastSync')
        };

        if (els.statTotal) els.statTotal.innerText = data.total_products;
        if (els.statAtRisk) els.statAtRisk.innerText = data.at_risk;
        if (els.statAvgGap) els.statAvgGap.innerText = `${data.avg_gap.toLocaleString()} ₽`;
        if (els.statLastSync) els.statLastSync.innerText = data.last_sync;
        
    } catch (err) {
        console.error('Failed to load dashboard stats:', err);
    }
}

async function loadSettings() {
    try {
        const response = await fetch('/api/settings');
        const data = await response.json();
        
        const els = {
            token: document.getElementById('set_telegram_bot_token'),
            chat: document.getElementById('set_telegram_chat_id'),
            interval: document.getElementById('set_scan_interval_hours')
        };

        if (els.token) els.token.value = data.telegram_bot_token || '';
        if (els.chat) els.chat.value = data.telegram_chat_id || '';
        if (els.interval) els.interval.value = data.scan_interval_hours || '12';
    } catch (err) {
        console.error('Failed to load settings:', err);
    }
}

// Bridge functions
window.handleAnalytics = (btn) => displayProductAnalytics(btn.getAttribute('data-id'));
window.handleDelete = (btn) => deleteProductById(btn);
window.closeAnalytics = () => {
    const s = document.getElementById('analyticsSection');
    const o = document.getElementById('modalOverlay');
    if (s) s.style.display = 'none';
    if (o) o.style.display = 'none';
}
