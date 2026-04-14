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
    const syncStatus = document.getElementById('priceSyncStatus');

    // Auto-fetch price from URL on paste/change (background scrape on submit)
    if (urlInput && syncStatus) {
        let lastUrl = "";
        const handleUrlChange = async () => {
            const url = urlInput.value.trim();
            if (url === lastUrl) return;
            lastUrl = url;

            const isOurStore = url.includes('alleyadoma.ru');
            
            if (isOurStore && url.length > 20) {
                syncStatus.style.display = 'block';
                syncStatus.innerHTML = '<i class="fa-solid fa-sync fa-spin"></i> Цена будет получена автоматически после сохранения';
                syncStatus.style.color = "var(--primary)";
            } else {
                syncStatus.style.display = 'none';
            }
        };

        urlInput.addEventListener('input', () => setTimeout(handleUrlChange, 300));
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
    if (sectionId === 'statistics') {
        loadStatisticsSection();
    }
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
    document.querySelectorAll('.report-panel').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.report-tab').forEach(t => t.classList.remove('active'));
    const panel = document.getElementById('report-' + tabId);
    const tab = document.getElementById('tab-' + tabId);
    if (panel) panel.classList.add('active');
    if (tab) tab.classList.add('active');

    // Render on first switch
    if (tabId === 'avg-price') renderAvgPriceReport();
    if (tabId === 'heatmap') renderHeatmap();
    if (tabId === 'trend') renderTrendReport();
    if (tabId === 'risk') renderRiskReport();
    if (tabId === 'coverage') renderCoverageReport();
}

async function loadAnalyticsData(forceReload) {
    if (_analyticsData && !forceReload) return _analyticsData;
    try {
        const resp = await fetch('/api/analytics/full', { credentials: 'include' });
        if (!resp.ok) {
            console.error('Analytics API error:', resp.status, resp.statusText);
            const body = await resp.text();
            console.error('Response body:', body.substring(0, 500));
            return null;
        }
        _analyticsData = await resp.json();
        console.log('Analytics data loaded:', _analyticsData.categories?.length, 'cats,', _analyticsData.products?.length, 'products,', _analyticsData.stores?.length, 'stores');
        _populateAnalyticsFilters();
        return _analyticsData;
    } catch (err) {
        console.error('Analytics data error:', err);
        return null;
    }
}

function _populateAnalyticsFilters() {
    if (!_analyticsData) return;
    const cats = _analyticsData.categories || [];
    console.log('Populating filters with', cats.length, 'categories');
    ['avgPriceCategoryFilter', 'heatmapCategoryFilter', 'trendCategoryFilter'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) { console.warn('Filter element not found:', id); return; }
        const currentVal = sel.value;
        sel.innerHTML = '<option value="">Все товарные группы</option>' +
            cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
        if (currentVal) sel.value = currentVal; // restore selection
    });
    // Populate store checkboxes for Report 1
    const storeDiv = document.getElementById('avgPriceStoreFilter');
    if (storeDiv) {
        const stores = _analyticsData.stores || [];
        if (storeDiv.children.length === 0) {
            storeDiv.innerHTML =
                `<label style="font-size:0.78rem;display:inline-flex;align-items:center;gap:3px;cursor:pointer;white-space:nowrap;"><input type="checkbox" value="our" checked onchange="renderAvgPriceReport()"> Аллея Дома</label>` +
                stores.map(s =>
                    `<label style="font-size:0.78rem;display:inline-flex;align-items:center;gap:3px;cursor:pointer;white-space:nowrap;"><input type="checkbox" value="${s.id}" checked onchange="renderAvgPriceReport()"> ${s.name}</label>`
                ).join('');
        }
    }
}

async function loadStatisticsSection() {
    const data = await loadAnalyticsData(true); // force reload
    if (!data) {
        console.error('Failed to load analytics data for statistics section');
        return;
    }
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

    // Build color lookup from API data
    const storeColorMap = {};
    for (const s of data.stores) storeColorMap[s.name] = s.color || '#64748b';
    const ourColor = data.our_store_color || '#6366f1';

    const labels = [];
    const values = [];
    const colors = [];
    for (const [name, prices] of Object.entries(storePrices)) {
        if (prices.length === 0) continue;
        labels.push(name);
        values.push(Math.round(prices.reduce((a, b) => a + b, 0) / prices.length));
        colors.push(name === 'Аллея Дома' ? ourColor : (storeColorMap[name] || '#64748b'));
    }

    const canvas = document.getElementById('avgPriceChart');
    if (!canvas) return;
    if (avgPriceChart) avgPriceChart.destroy();

    // Dynamic height: ensure enough space for each bar label
    const barHeight = 48; // px per bar
    const minHeight = 350;
    const dynamicHeight = Math.max(minHeight, labels.length * barHeight + 60);
    canvas.parentElement.style.minHeight = dynamicHeight + 'px';
    canvas.parentElement.style.height = dynamicHeight + 'px';

    // Plugin to draw price labels inside bars
    const barLabelPlugin = {
        id: 'avgPriceBarLabels',
        afterDatasetsDraw(chart) {
            const { ctx } = chart;
            const meta = chart.getDatasetMeta(0);
            if (!meta || !meta.data) return;
            meta.data.forEach((bar, i) => {
                const value = chart.data.datasets[0].data[i];
                if (!value) return;
                const barWidth = bar.width;
                const text = value.toLocaleString('ru-RU') + ' \u20BD';
                ctx.save();
                ctx.font = 'bold 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
                const textWidth = ctx.measureText(text).width;
                const padding = 10;
                // Place label inside bar if it fits, otherwise outside
                if (barWidth > textWidth + padding * 2) {
                    ctx.fillStyle = '#fff';
                    ctx.textAlign = 'right';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(text, bar.x - padding, bar.y);
                } else {
                    ctx.fillStyle = '#334155';
                    ctx.textAlign = 'left';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(text, bar.x + 6, bar.y);
                }
                ctx.restore();
            });
        }
    };

    avgPriceChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels,
            datasets: [{
                label: 'Средняя цена (\u20BD)',
                data: values,
                backgroundColor: colors.map(c => c + 'cc'),
                borderColor: colors,
                borderWidth: 2,
                borderRadius: 6,
            }]
        },
        plugins: [barLabelPlugin],
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            layout: {
                padding: { left: 12, right: 60 }
            },
            plugins: {
                legend: { display: false },
                tooltip: { backgroundColor: '#1e293b', padding: 12, cornerRadius: 8 }
            },
            scales: {
                x: {
                    ticks: { color: '#64748b', font: { weight: '600' }, callback: v => v.toLocaleString() + ' \u20BD' },
                    grid: { color: '#f1f5f9' }
                },
                y: {
                    ticks: {
                        color: '#334155',
                        font: { weight: '700', size: 13 },
                        autoSkip: false,
                        maxRotation: 0,
                        padding: 8,
                        callback: function(value) {
                            const label = this.getLabelForValue(value);
                            return label;
                        }
                    },
                    grid: { display: false },
                    afterFit: function(scaleInstance) {
                        scaleInstance.width = Math.max(scaleInstance.width, 180);
                    }
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

    // Build store color lookup
    const storeColorById = {};
    for (const s of data.stores) storeColorById[String(s.id)] = s.color || '#64748b';

    // Add "our" store average as a reference line if we have price history
    const ourProducts = data.products.filter(p => {
        if (productIds && !productIds.has(p.id)) return false;
        return p.current_price;
    });
    if (ourProducts.length > 0) {
        // Collect all dates first to build a flat reference line
        for (const [sid, sdata] of Object.entries(data.trend)) {
            Object.keys(sdata.data).forEach(d => allDates.add(d));
        }
        const sortedDates = [...allDates].sort();
        if (sortedDates.length > 0) {
            const ourAvg = Math.round(ourProducts.reduce((s, p) => s + p.current_price, 0) / ourProducts.length);
            const ourColor = data.our_store_color || '#6366f1';
            datasets.push({
                label: 'Аллея Дома (средняя)',
                data: sortedDates.map(d => ({ x: d, y: ourAvg })),
                borderColor: ourColor,
                backgroundColor: ourColor + '08',
                borderWidth: 3,
                borderDash: [8, 4],
                fill: false,
                tension: 0,
                pointRadius: 0,
                pointHitRadius: 8,
                pointHoverRadius: 5,
                pointHoverBackgroundColor: ourColor,
                pointHoverBorderColor: '#fff',
                pointHoverBorderWidth: 2,
                order: 0, // draw on top
            });
        }
    }

    for (const [sid, sdata] of Object.entries(data.trend)) {
        const dates = Object.keys(sdata.data);
        dates.forEach(d => allDates.add(d));

        const color = storeColorById[sid] || REPORT_COLORS[ci % REPORT_COLORS.length];
        datasets.push({
            label: sdata.store_name,
            data: dates.map(d => ({ x: d, y: sdata.data[d] })),
            borderColor: color,
            backgroundColor: color + '12',
            fill: true,
            borderWidth: 2.5,
            tension: 0.35,
            pointRadius: 0,
            pointHitRadius: 10,
            pointHoverRadius: 6,
            pointHoverBackgroundColor: color,
            pointHoverBorderColor: '#fff',
            pointHoverBorderWidth: 2,
            order: 1,
        });
        ci++;
    }

    allDates = [...allDates].sort();

    if (datasets.length === 0 || allDates.length === 0) {
        const canvas = document.getElementById('trendChart');
        if (canvas) {
            if (trendChartInstance) trendChartInstance.destroy();
            trendChartInstance = null;
            canvas.parentElement.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:3rem;">Нет данных для отображения</p><canvas id="trendChart"></canvas>';
        }
        return;
    }

    const canvas = document.getElementById('trendChart');
    if (!canvas) return;
    if (trendChartInstance) trendChartInstance.destroy();

    // Crosshair vertical line plugin (local to this chart)
    const crosshairPlugin = {
        id: 'trendCrosshair',
        afterDraw(chart) {
            if (chart.tooltip && chart.tooltip._active && chart.tooltip._active.length) {
                const x = chart.tooltip._active[0].element.x;
                const yAxis = chart.scales.y;
                const ctx = chart.ctx;
                ctx.save();
                ctx.beginPath();
                ctx.moveTo(x, yAxis.top);
                ctx.lineTo(x, yAxis.bottom);
                ctx.lineWidth = 1;
                ctx.strokeStyle = '#94a3b8';
                ctx.setLineDash([4, 4]);
                ctx.stroke();
                ctx.restore();
            }
        }
    };

    trendChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'line',
        data: {
            labels: allDates.map(d => {
                const dt = new Date(d);
                return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' });
            }),
            datasets
        },
        plugins: [crosshairPlugin],
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            hover: {
                mode: 'index',
                intersect: false,
            },
            layout: {
                padding: { top: 8, right: 12, bottom: 4 }
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        pointStyle: 'circle',
                        padding: 20,
                        font: { size: 12, weight: '600' },
                        generateLabels: function(chart) {
                            return chart.data.datasets.map((ds, i) => ({
                                text: ds.label,
                                fillStyle: ds.borderColor,
                                strokeStyle: ds.borderColor,
                                lineWidth: ds.borderDash ? 2 : 0,
                                lineDash: ds.borderDash || [],
                                pointStyle: ds.borderDash ? 'line' : 'circle',
                                hidden: !chart.isDatasetVisible(i),
                                datasetIndex: i,
                            }));
                        }
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleFont: { size: 13, weight: '700' },
                    bodyFont: { size: 12 },
                    padding: 14,
                    cornerRadius: 10,
                    boxPadding: 6,
                    usePointStyle: true,
                    callbacks: {
                        label: function(ctx) {
                            const value = ctx.parsed.y;
                            if (value == null) return null;
                            return ' ' + ctx.dataset.label + ':  ' + value.toLocaleString('ru-RU') + ' \u20BD';
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: false,
                    ticks: {
                        color: '#64748b',
                        font: { weight: '600', size: 11 },
                        callback: v => v.toLocaleString('ru-RU') + ' \u20BD',
                        maxTicksLimit: 8,
                    },
                    grid: {
                        color: '#f1f5f9',
                        drawBorder: false,
                    },
                    border: { display: false },
                },
                x: {
                    ticks: {
                        color: '#64748b',
                        font: { weight: '600', size: 11 },
                        maxRotation: 0,
                        autoSkip: true,
                        maxTicksLimit: 15,
                    },
                    grid: { display: false },
                    border: { display: false },
                }
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
    
    section.classList.add('active');
    if (overlay) overlay.classList.add('active');
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

    // Group history by store, collect color per store
    const storeData = {};
    const storeColorMap = {};
    const allDates = new Set();
    for (const h of sortedHistory) {
        const store = h.store || 'Конкурент';
        if (!storeData[store]) storeData[store] = {};
        if (h.color) storeColorMap[store] = h.color;
        const day = new Date(h.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
        allDates.add(day);
        storeData[store][day] = h.price;
    }

    const labels = [...allDates];
    const ourColor = data.our_store_color || '#6366f1';

    // Fallback colors if API didn't provide
    const fallbackColors = [
        '#a855f7', '#ec4899', '#f97316', '#22c55e', '#06b6d4',
        '#3b82f6', '#eab308', '#14b8a6', '#f43f5e', '#8b5cf6',
    ];
    const datasets = [];
    let ci = 0;
    for (const [store, dayPrices] of Object.entries(storeData)) {
        const color = storeColorMap[store] || fallbackColors[ci % fallbackColors.length];
        datasets.push({
            label: store,
            data: labels.map(d => dayPrices[d] ?? null),
            borderColor: color,
            backgroundColor: color + '10',
            fill: false,
            tension: 0.4,
            pointRadius: 4,
            pointBackgroundColor: '#ffffff',
            pointBorderColor: color,
            pointBorderWidth: 2,
            spanGaps: true,
        });
        ci++;
    }

    // Add "Наша цена" — historical data if available, flat line otherwise
    const ourPriceHistory = data.our_price_history || [];
    if (ourPriceHistory.length > 0) {
        // Build day→price map from our history
        const ourDayPrices = {};
        for (const r of ourPriceHistory) {
            const day = new Date(r.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
            ourDayPrices[day] = r.price; // latest wins per day
        }
        // Also ensure all our history dates are in the labels
        for (const r of ourPriceHistory) {
            const day = new Date(r.date).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
            if (!allDates.has(day)) allDates.add(day);
        }
        // Re-sort labels after adding our dates
        const sortedLabels = [...allDates].sort((a, b) => {
            const [dA, mA] = a.split('.').map(Number);
            const [dB, mB] = b.split('.').map(Number);
            return (mA - mB) || (dA - dB);
        });
        // Rebuild labels array in-place
        labels.length = 0;
        sortedLabels.forEach(l => labels.push(l));

        // Forward-fill our prices (carry last known value)
        let lastKnown = data.our_product.current_price;
        const ourData = labels.map(d => {
            if (ourDayPrices[d] !== undefined) lastKnown = ourDayPrices[d];
            return lastKnown;
        });
        datasets.push({
            label: 'Наша цена (Аллея Дома)',
            data: ourData,
            borderColor: ourColor,
            backgroundColor: ourColor + '10',
            fill: false,
            tension: 0.4,
            pointRadius: 3,
            pointBackgroundColor: '#ffffff',
            pointBorderColor: ourColor,
            pointBorderWidth: 2,
            borderWidth: 2.5,
        });
    } else {
        // Flat dashed line fallback
        datasets.push({
            label: 'Наша цена',
            data: labels.map(() => data.our_product.current_price),
            borderColor: ourColor,
            borderDash: [8, 4],
            pointRadius: 0,
            fill: false,
            borderWidth: 2
        });
    }

    priceChart = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { 
                    position: 'bottom',
                    labels: { 
                        color: '#64748b', 
                        font: { weight: '600', size: 11 },
                        usePointStyle: true,
                        padding: 14,
                    } 
                },
                tooltip: {
                    backgroundColor: '#1e293b',
                    padding: 12,
                    cornerRadius: 8,
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function(context) {
                            return ` ${context.dataset.label}: ${context.parsed.y?.toLocaleString()} ₽`;
                        }
                    }
                }
            },
            scales: {
                y: { 
                    ticks: { color: '#64748b', callback: v => v.toLocaleString() + ' ₽' }, 
                    grid: { color: '#f1f5f9' } 
                },
                x: { ticks: { color: '#64748b' }, grid: { display: false } }
            }
        }
    });
}

// --- Utilities ---

function showLoading(text = "Обработка данных...") {
    const loader = document.getElementById('loader');
    if (loader) {
        const spinnerText = loader.querySelector('.spinner-text');
        if (spinnerText) spinnerText.textContent = text;
        loader.classList.add('active');
    }
}

function hideLoading() {
    const loader = document.getElementById('loader');
    if (loader) loader.classList.remove('active');
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
            interval: document.getElementById('set_scan_interval_hours'),
            b24Url: document.getElementById('set_b24_webhook_url'),
            b24Chat: document.getElementById('set_b24_chat_id')
        };

        if (els.token) els.token.value = data.telegram_bot_token || '';
        if (els.chat) els.chat.value = data.telegram_chat_id || '';
        if (els.interval) els.interval.value = data.scan_interval_hours || '12';
        if (els.b24Url) els.b24Url.value = data.b24_webhook_url || '';
        if (els.b24Chat) els.b24Chat.value = data.b24_chat_id || '182735';

        // Load our store color
        const ourPicker = document.getElementById('ourStoreColorPicker');
        if (ourPicker && data.our_store_color) ourPicker.value = data.our_store_color;
    } catch (err) {
        console.error('Failed to load settings:', err);
    }
    loadStoreColors();
}

async function loadStoreColors() {
    const container = document.getElementById('storeColorList');
    if (!container) return;
    try {
        const resp = await fetch('/api/stores', { credentials: 'include' });
        if (!resp.ok) return;
        const stores = await resp.json();
        container.innerHTML = stores.map(s => `
            <div style="display:flex;align-items:center;gap:1rem;padding:0.6rem 0;border-bottom:1px solid var(--border-soft);">
                <input type="color" value="${s.color || '#64748b'}" id="storeColor_${s.id}" style="width:36px;height:36px;border:2px solid var(--border-soft);border-radius:var(--radius-sm);cursor:pointer;padding:2px;">
                <div style="flex:1;"><div style="font-weight:700;font-size:0.95rem;">${s.name}</div><div style="font-size:0.75rem;color:var(--text-muted);">${s.domain}</div></div>
                <button onclick="saveStoreColor(${s.id})" class="secondary" style="padding:0.4rem 1rem;font-size:0.8rem;">Сохранить</button>
            </div>
        `).join('');
    } catch (err) { console.error('Store colors error:', err); }
}

async function saveStoreColor(storeId) {
    const picker = document.getElementById('storeColor_' + storeId);
    if (!picker) return;
    const fd = new FormData();
    fd.append('color', picker.value);
    try {
        const r = await fetch(`/api/stores/${storeId}/color`, { method: 'PUT', body: fd, credentials: 'include' });
        if (r.ok) { _analyticsData = null; alert('Цвет сохранён'); }
        else alert('Ошибка сохранения');
    } catch (e) { alert('Ошибка: ' + e.message); }
}

async function saveOurStoreColor() {
    const picker = document.getElementById('ourStoreColorPicker');
    if (!picker) return;
    const fd = new FormData();
    fd.append('color', picker.value);
    try {
        const r = await fetch('/api/settings/our-color', { method: 'PUT', body: fd, credentials: 'include' });
        if (r.ok) { _analyticsData = null; alert('Цвет сохранён'); }
        else alert('Ошибка сохранения');
    } catch (e) { alert('Ошибка: ' + e.message); }
}

// Bridge functions
window.handleAnalytics = (btn) => displayProductAnalytics(btn.getAttribute('data-id'));
window.handleDelete = (btn) => deleteProductById(btn);
window.closeAnalytics = () => {
    const s = document.getElementById('analyticsSection');
    const o = document.getElementById('modalOverlay');
    if (s) s.classList.remove('active');
    if (o) o.classList.remove('active');
}

// Analytics report bridges (called from onclick in admin.html)
window.switchReportTab = switchReportTab;
window.renderAvgPriceReport = renderAvgPriceReport;
window.renderHeatmap = renderHeatmap;
window.renderTrendReport = renderTrendReport;
window.renderRiskReport = renderRiskReport;
window.renderCoverageReport = renderCoverageReport;
window.saveStoreColor = saveStoreColor;
window.saveOurStoreColor = saveOurStoreColor;

// --- Mobile Sidebar ---

window.toggleMobileSidebar = () => {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const burger = document.getElementById('burgerBtn');
    if (!sidebar) return;
    const isOpen = sidebar.classList.toggle('open');
    if (overlay) overlay.classList.toggle('active', isOpen);
    if (burger) {
        const icon = burger.querySelector('i');
        if (icon) {
            icon.className = isOpen ? 'fa-solid fa-xmark' : 'fa-solid fa-bars';
        }
    }
};

// Close sidebar on nav click (mobile)
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', () => {
            if (window.innerWidth <= 768) {
                const sidebar = document.querySelector('.sidebar');
                const overlay = document.getElementById('sidebarOverlay');
                const burger = document.getElementById('burgerBtn');
                if (sidebar) sidebar.classList.remove('open');
                if (overlay) overlay.classList.remove('active');
                if (burger) {
                    const icon = burger.querySelector('i');
                    if (icon) icon.className = 'fa-solid fa-bars';
                }
            }
        });
    });
});

// --- Bitrix24 Integration ---

window.saveBitrix24Settings = async () => {
    const webhookUrl = document.getElementById('set_b24_webhook_url')?.value || '';
    const chatId = document.getElementById('set_b24_chat_id')?.value || '';
    const resultDiv = document.getElementById('b24TestResult');

    if (!webhookUrl) {
        if (resultDiv) {
            resultDiv.innerHTML = '<span style="color: var(--danger);"><i class="fa-solid fa-triangle-exclamation"></i> Укажите Webhook URL</span>';
        }
        return;
    }

    try {
        const response = await fetch('/api/settings/bitrix24', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ b24_webhook_url: webhookUrl, b24_chat_id: chatId })
        });

        if (response.ok) {
            if (resultDiv) {
                resultDiv.innerHTML = '<span style="color: var(--success);"><i class="fa-solid fa-check-circle"></i> Сохранено</span>';
            }
        } else {
            if (resultDiv) {
                resultDiv.innerHTML = '<span style="color: var(--danger);"><i class="fa-solid fa-xmark-circle"></i> Ошибка сохранения</span>';
            }
        }
    } catch (err) {
        console.error('B24 save error:', err);
        if (resultDiv) {
            resultDiv.innerHTML = '<span style="color: var(--danger);">Ошибка соединения</span>';
        }
    }
};

window.testBitrix24 = async () => {
    const resultDiv = document.getElementById('b24TestResult');
    if (resultDiv) {
        resultDiv.innerHTML = '<span style="color: var(--primary);"><i class="fa-solid fa-spinner fa-spin"></i> Отправка тестового сообщения...</span>';
    }

    try {
        const response = await fetch('/api/bitrix24/test', { method: 'POST' });
        const data = await response.json();

        if (resultDiv) {
            if (data.status === 'success') {
                resultDiv.innerHTML = `<span style="color: var(--success);"><i class="fa-solid fa-check-circle"></i> ${data.message}</span>`;
            } else {
                resultDiv.innerHTML = `<span style="color: var(--danger);"><i class="fa-solid fa-triangle-exclamation"></i> ${data.message}</span>`;
            }
        }
    } catch (err) {
        console.error('B24 test error:', err);
        if (resultDiv) {
            resultDiv.innerHTML = '<span style="color: var(--danger);">Ошибка соединения с сервером</span>';
        }
    }
};

// --- PDF Report (client-side) ---

// Report titles mapping
const REPORT_TITLES = {
    'avg-price': 'Средняя цена группы товаров',
    'heatmap': 'Тепловая карта ценовых разрывов',
    'trend': 'Динамика цен по товарной группе (30 дней)',
    'risk': 'Товары в зоне риска',
    'coverage': 'Покрытие мониторинга'
};

async function downloadReportPdf(reportId) {
    const now = new Date().toLocaleString('ru-RU');
    const title = REPORT_TITLES[reportId] || 'Отчёт';

    let contentHtml = '';

    if (reportId === 'avg-price') {
        // Convert chart canvas to image
        const canvas = document.getElementById('avgPriceChart');
        if (canvas) {
            const imgData = canvas.toDataURL('image/png', 1.0);
            contentHtml = `<img src="${imgData}" style="max-width:100%;height:auto;">`;
        } else {
            contentHtml = '<p>График не найден</p>';
        }
    } else if (reportId === 'heatmap') {
        const container = document.getElementById('heatmapContainer');
        const legend = document.querySelector('#report-heatmap .heatmap-legend');
        if (container) {
            contentHtml = container.innerHTML;
            if (legend) contentHtml += '<div style="margin-top:16px;">' + legend.innerHTML + '</div>';
        } else {
            contentHtml = '<p>Данные не найдены</p>';
        }
    } else if (reportId === 'trend') {
        const canvas = document.getElementById('trendChart');
        if (canvas) {
            const imgData = canvas.toDataURL('image/png', 1.0);
            contentHtml = `<img src="${imgData}" style="max-width:100%;height:auto;">`;
        } else {
            contentHtml = '<p>График не найден</p>';
        }
    } else if (reportId === 'risk') {
        const container = document.getElementById('riskTableContainer');
        if (container) {
            contentHtml = container.innerHTML;
        } else {
            contentHtml = '<p>Данные не найдены</p>';
        }
    } else if (reportId === 'coverage') {
        const canvas = document.getElementById('coverageDonut');
        const table = document.getElementById('coverageTableContainer');
        let parts = [];
        if (canvas) {
            const imgData = canvas.toDataURL('image/png', 1.0);
            parts.push(`<div style="text-align:center;margin-bottom:24px;"><img src="${imgData}" style="max-width:400px;height:auto;"></div>`);
        }
        if (table) {
            parts.push(table.innerHTML);
        }
        contentHtml = parts.join('') || '<p>Данные не найдены</p>';
    }

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Price Mirror - ${title}</title>
<style>
    @media print {
        body { margin: 0; padding: 20px; }
        .no-print { display: none !important; }
        @page { size: A4 ${reportId === 'heatmap' || reportId === 'risk' ? 'landscape' : 'portrait'}; margin: 15mm; }
    }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0f172a; background: #fff; padding: 30px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .subtitle { color: #64748b; font-size: 13px; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; }
    thead th { padding: 8px; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #e2e8f0; }
    td { padding: 6px 8px; border-bottom: 1px solid #e2e8f0; font-size: 12px; }
    img { display: block; margin: 0 auto; }
    .print-btn { position: fixed; top: 20px; right: 20px; padding: 10px 24px; background: #6366f1; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer; z-index: 100; }
</style>
</head><body>
<button class="no-print print-btn" onclick="window.print()"><i class="fa-solid fa-print"></i> Печать / Сохранить PDF</button>
<h1>Price Mirror — ${title}</h1>
<div class="subtitle">Сформирован: ${now} &bull; Аллея Дома (alleyadoma.ru)</div>
${contentHtml}
</body></html>`;

    const w = window.open('', '_blank');
    if (w) {
        w.document.write(html);
        w.document.close();
    } else {
        alert('Браузер заблокировал всплывающее окно. Разрешите popup для этого сайта.');
    }
}

window.downloadReportPdf = downloadReportPdf;

async function generatePdfReport() {
    const data = await loadAnalyticsData();
    if (!data) {
        alert('Не удалось загрузить данные для отчёта');
        return;
    }

    const now = new Date().toLocaleString('ru-RU');
    const riskProducts = data.products
        .filter(p => p.current_price && p.min_comp_price && p.current_price > p.min_comp_price)
        .sort((a, b) => (b.current_price - b.min_comp_price) - (a.current_price - a.min_comp_price));

    const total = data.products.length;
    const atRisk = riskProducts.length;
    const withMapping = data.products.filter(p => p.has_mapping).length;
    const withPrice = data.products.filter(p => p.has_price).length;

    let rows = '';
    for (const p of data.products) {
        const our = p.current_price ? p.current_price.toLocaleString('ru-RU') : '—';
        const comp = p.min_comp_price ? p.min_comp_price.toLocaleString('ru-RU') : '—';
        const diff = (p.current_price && p.min_comp_price) ? Math.round(p.current_price - p.min_comp_price) : null;
        const diffStr = diff !== null ? (diff > 0 ? '+' + diff.toLocaleString('ru-RU') : diff.toLocaleString('ru-RU')) : '—';
        const diffColor = diff === null ? '#64748b' : diff > 0 ? '#dc2626' : diff < 0 ? '#16a34a' : '#64748b';
        const store = p.mappings?.length > 0
            ? (p.mappings.find(m => m.last_price === p.min_comp_price) || {}).store_name || '—'
            : '—';
        rows += `<tr>
            <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;font-size:12px;">${p.name}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;font-size:12px;">${p.category_name}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;font-size:12px;">${our} &#8381;</td>
            <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;font-size:12px;">${comp} &#8381;</td>
            <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:center;font-size:11px;">${store}</td>
            <td style="padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:right;font-weight:700;color:${diffColor};font-size:12px;">${diffStr} &#8381;</td>
        </tr>`;
    }

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Price Mirror - Отчёт</title>
<style>
    @media print {
        body { margin: 0; padding: 20px; }
        .no-print { display: none !important; }
        @page { size: A4 landscape; margin: 15mm; }
    }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: #0f172a; background: #fff; padding: 30px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .subtitle { color: #64748b; font-size: 13px; margin-bottom: 20px; }
    .stats { display: flex; gap: 16px; margin-bottom: 24px; }
    .stat-card { flex: 1; padding: 14px; border: 1px solid #e2e8f0; border-radius: 8px; }
    .stat-card .label { font-size: 11px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
    .stat-card .value { font-size: 22px; font-weight: 800; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; }
    thead th { padding: 8px; text-align: left; font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 2px solid #e2e8f0; }
    .print-btn { position: fixed; top: 20px; right: 20px; padding: 10px 24px; background: #6366f1; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer; z-index: 100; }
</style>
</head><body>
<button class="no-print print-btn" onclick="window.print()"><i class="fa-solid fa-print"></i> Печать / Сохранить PDF</button>
<h1>Price Mirror — Отчёт по ценам</h1>
<div class="subtitle">Сформирован: ${now} &bull; Аллея Дома (alleyadoma.ru)</div>
<div class="stats">
    <div class="stat-card"><div class="label">Всего товаров</div><div class="value">${total}</div></div>
    <div class="stat-card" style="border-left:3px solid #ef4444;"><div class="label">В зоне риска</div><div class="value" style="color:#ef4444;">${atRisk}</div></div>
    <div class="stat-card"><div class="label">С привязкой</div><div class="value">${withMapping}</div></div>
    <div class="stat-card"><div class="label">С ценой конкурента</div><div class="value">${withPrice}</div></div>
</div>
<table>
<thead><tr>
    <th>Товар</th><th style="text-align:right;">Товарная группа</th><th style="text-align:right;">Наша цена</th>
    <th style="text-align:right;">Мин. конкурента</th><th style="text-align:center;">Магазин</th><th style="text-align:right;">Разница</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>
</body></html>`;

    const w = window.open('', '_blank');
    if (w) {
        w.document.write(html);
        w.document.close();
    } else {
        alert('Браузер заблокировал всплывающее окно. Разрешите popup для этого сайта.');
    }
}

window.generatePdfReport = generatePdfReport;

// --- Dark Mode ---

window.toggleTheme = () => {
    const html = document.documentElement;
    const isDark = html.getAttribute('data-theme') === 'dark';
    html.setAttribute('data-theme', isDark ? 'light' : 'dark');
    localStorage.setItem('theme', isDark ? 'light' : 'dark');
    // Update toggle icon
    const icon = document.querySelector('#themeToggle i');
    if (icon) icon.className = isDark ? 'fa-solid fa-moon' : 'fa-solid fa-sun';
};

// Apply saved theme on load
(function() {
    const saved = localStorage.getItem('theme');
    if (saved === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        document.addEventListener('DOMContentLoaded', () => {
            const icon = document.querySelector('#themeToggle i');
            if (icon) icon.className = 'fa-solid fa-sun';
        });
    }
})();
