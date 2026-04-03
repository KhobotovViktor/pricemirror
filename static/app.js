// Furniture Monitor Admin JS - SPA Edition

document.addEventListener('DOMContentLoaded', () => {
    // 0. Initial Load 
    loadDashboardStats();
    loadSettings();
    
    // Default section
    const lastSection = localStorage.getItem('activeSection') || 'our-products';
    switchSection(lastSection);

    // 1. Add Product Form
    const productForm = document.getElementById('productForm');
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
            
            statusDiv.innerHTML = '<span style="color: var(--accent);">Определяем магазин...</span>';
            
            try {
                const response = await fetch('/api/mappings', {
                    method: 'POST',
                    body: formData
                });
                
                if (response.ok) {
                    const data = await response.json();
                    statusDiv.innerHTML = `<span style="color: var(--success);">✓ Успешно! Магазин: <strong>${data.store_name}</strong></span>`;
                    mappingForm.reset();
                    loadDashboardStats(); 
                } else {
                    const err = await response.json();
                    const msg = typeof err.detail === 'string' ? err.detail : JSON.stringify(err);
                    statusDiv.innerHTML = `<span style="color: #ef4444;">⚠ Ошибка: ${msg}</span>`;
                }
            } catch (err) {
                console.error(err);
                statusDiv.innerHTML = '<span style="color: #ef4444;">⚠ Ошибка при подключении к серверу</span>';
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

    // 4. Search Logics
    initSearch('catalogSearch', '.product-item');
    initSearch('competitorSearch', '.competitor-row');

    // Close analytics modal on click outside
    window.onclick = (e) => {
        const modal = document.getElementById('analyticsModal');
        if (modal && e.target === modal) {
            closeAnalytics();
        }
    };
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
            item.style.display = text.includes(query) ? (itemSelector.includes('row') ? 'table-row' : 'flex') : 'none';
        });
    });
}

// --- Competitor Section Logic ---

async function loadStores() {
    try {
        const response = await fetch('/api/stores');
        if (!response.ok) return;
        const stores = await response.json();
        const select = document.getElementById('storeFilter');
        if (!select) return;

        select.innerHTML = '<option value="all">Все магазины</option>';
        stores.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s.id;
            opt.textContent = s.name;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error('Stores Load Error:', err);
    }
}

window.filterCompetitors = () => {
    const storeId = document.getElementById('storeFilter').value;
    const rows = document.querySelectorAll('.competitor-row');
    
    rows.forEach(row => {
        if (storeId === 'all' || row.dataset.store === storeId) {
            row.style.display = 'table-row';
        } else {
            row.style.display = 'none';
        }
    });
}

async function loadCompetitorProducts() {
    const tableBody = document.getElementById('competitorsTableBody');
    if (!tableBody) return;

    tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem; opacity: 0.5;">Загрузка...</td></tr>';
    
    try {
        const response = await fetch('/api/competitor_products/all');
        if (!response.ok) throw new Error('Failed to fetch');
        const data = await response.json();

        tableBody.innerHTML = '';
        data.forEach(item => {
            const row = document.createElement('tr');
            row.className = 'competitor-row';
            row.dataset.store = item.store_id;

            const diff = item.competitor_price ? (item.our_price - item.competitor_price) : 0;
            const diffColor = diff > 0 ? '#f87171' : (diff < 0 ? '#34d399' : 'inherit');
            
            row.innerHTML = `
                <td>
                    <div style="font-weight: 600;">${item.our_product_name}</div>
                    <div style="font-size: 0.75rem; opacity: 0.5;">${item.store_name}</div>
                </td>
                <td style="max-width: 200px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
                    <a href="${item.url}" target="_blank" style="color: var(--accent); font-size: 0.85rem;">${item.url}</a>
                </td>
                <td style="text-align: right; font-weight: 700;">${item.our_price.toLocaleString()} ₽</td>
                <td style="text-align: right; font-weight: 700;">${item.competitor_price ? item.competitor_price.toLocaleString() + ' ₽' : '—'}</td>
                <td style="text-align: right; font-weight: 800; color: ${diffColor};">
                    ${diff > 0 ? '+' : ''}${diff.toLocaleString()} ₽
                </td>
            `;
            tableBody.appendChild(row);
        });
    } catch (err) {
        console.error('Competitor Load Error:', err);
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 2rem; color: #f87171;">Ошибка загрузки данных</td></tr>';
    }
}

// --- Statistics & Charts ---

let priceChart = null;
let globalTrendChart = null;

async function loadGlobalTrend() {
    const canvas = document.getElementById('globalTrendChart');
    if (!canvas) return;

    try {
        const response = await fetch('/api/dashboard/history');
        if (!response.ok) return;
        const data = await response.json();
        
        const ctx = canvas.getContext('2d');
        const labels = data.map(d => new Date(d.date).toLocaleDateString());
        const values = data.map(d => d.avg_price);

        if (globalTrendChart) globalTrendChart.destroy();

        globalTrendChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Ср. цена рынка (₽)',
                    data: values,
                    borderColor: '#22d3ee',
                    backgroundColor: 'rgba(34, 211, 238, 0.05)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4,
                    pointBackgroundColor: '#22d3ee'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                    x: { ticks: { color: '#94a3b8' }, grid: { display: false } }
                }
            }
        });
    } catch (err) {
        console.error('Trend Chart Error:', err);
    }
}

// --- Batch Management Logic ---

window.updateBatchBar = () => {
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
    updateBatchBar();
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

async function handleDelete(btn) {
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

async function runScraper(productId, btn) {
    if (btn) {
        btn.innerText = '⏳';
        btn.disabled = true;
    }

    try {
        const response = await fetch(`/api/scrape/${productId}`, { method: 'POST' });
        const data = await response.json();
        
        if (response.ok) {
            alert('Сбор цен запущен в фоновом режиме. Результаты появятся в аналитике через 1-2 минуты.');
        } else {
            alert('Ошибка: ' + (data.detail || 'Не удалось запустить сбор'));
        }
    } catch (err) {
        console.error(err);
        alert('Ошибка связи с сервером');
    } finally {
        if (btn) {
            btn.innerText = '🔄';
            btn.disabled = false;
        }
    }
}

async function viewAnalytics(productId) {
    const section = document.getElementById('analyticsSection');
    const badge = document.getElementById('recommendationBadge');
    
    if (!section) return; // In new layout, it might be inside the 'our-products' section
    
    section.style.display = 'block';
    section.scrollIntoView({ behavior: 'smooth' });
    
    showLoading("Загрузка аналитики...");
    try {
        const response = await fetch(`/api/analytics/${productId}`);
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Ошибка сервера');
        }
        const data = await response.json();
        
        document.getElementById('analyticsTitle').innerText = `Аналитика: ${data.our_product.name}`;
        document.getElementById('ourPriceBadge').innerText = `${(data.our_product.current_price || 0).toLocaleString()} ₽`;
        document.getElementById('avgCompBadge').innerText = `${(data.avg_price || 0).toLocaleString()} ₽`;
        document.getElementById('minCompBadge').innerText = `${(data.min_competitor || 0).toLocaleString()} ₽`;
        
        if (data.recommendation) {
            badge.innerText = data.recommendation.text;
            const isWarning = data.recommendation.type === 'decrease';
            badge.style.background = isWarning ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)';
            badge.style.color = isWarning ? '#f87171' : '#34d399';
        }

        renderChart(data);
        renderHistoryTable(data.history);
        
    } catch (err) {
        console.error('Analytics Error:', err);
        alert('Ошибка: ' + err.message);
    } finally {
        hideLoading();
    }
}

function renderHistoryTable(history) {
    const tableBody = document.getElementById('historyTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    
    history.forEach(entry => {
        const date = new Date(entry.date).toLocaleString([], {
            day: '2-digit', month: '2-digit', year: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
        
        const row = document.createElement('tr');
        row.style.borderBottom = '1px solid var(--glass)';
        row.innerHTML = `
            <td style="padding: 0.8rem; opacity: 0.8;">${date}</td>
            <td style="padding: 0.8rem; font-weight: 600;">${entry.store}</td>
            <td style="padding: 0.8rem; text-align: right; color: var(--accent); font-weight: 800;">
                ${entry.price.toLocaleString()} ₽
            </td>
        `;
        tableBody.appendChild(row);
    });
}

function renderChart(data) {
    const canvas = document.getElementById('priceChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (priceChart) priceChart.destroy();
    
    if (!data.history || data.history.length === 0) {
        ctx.font = '14px sans-serif';
        ctx.fillStyle = '#94a3b8';
        ctx.textAlign = 'center';
        ctx.fillText('История цен пока не собрана...', 200, 75);
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
                    borderColor: '#22d3ee',
                    backgroundColor: 'rgba(34, 211, 238, 0.1)',
                    fill: true,
                    tension: 0.4
                },
                {
                    label: 'Наша цена',
                    data: labels.map(() => data.our_product.current_price),
                    borderColor: '#6366f1',
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            plugins: {
                legend: { labels: { color: 'white' } }
            },
            scales: {
                y: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } },
                x: { ticks: { color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' } }
            }
        }
    });
}

// --- Utilities ---

function showLoading(text = "Обработка...") {
    const loader = document.getElementById('loader');
    if (loader) {
        loader.querySelector('.loading-text').textContent = text;
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
        if (els.statAtRisk) {
            els.statAtRisk.innerText = data.at_risk;
            els.statAtRisk.style.color = data.at_risk > 0 ? '#f87171' : '#34d399';
        }
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

// Bridge functions for clean HTML (since they are referenced in onclick/oninput)
window.handleScrape = (btn) => runScraper(btn.getAttribute('data-id'), btn);
window.handleAnalytics = (btn) => viewAnalytics(btn.getAttribute('data-id'));
window.handleProductDelete = (btn) => handleDelete(btn);
window.closeAnalytics = () => {
    const s = document.getElementById('analyticsSection');
    if (s) s.style.display = 'none';
}
window.downloadReport = () => window.location.href = '/api/export';
