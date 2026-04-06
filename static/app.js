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
        urlInput.addEventListener('input', () => {
            const isOurStore = urlInput.value.includes('alleyadoma.ru');
            priceInput.disabled = isOurStore;
            syncStatus.style.display = isOurStore ? 'inline-flex' : 'none';
            
            if (isOurStore) {
                priceInput.placeholder = "Автосинхронизация включена";
                priceInput.style.background = "var(--bg-soft)";
            } else {
                priceInput.placeholder = "49990";
                priceInput.style.background = "white";
            }
        });
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
    
    document.querySelectorAll('.product-item').forEach(item => {
        const name = item.dataset.name || '';
        const itemCategory = item.dataset.category || '';
        
        const matchesSearch = name.includes(query);
        const matchesCategory = (categoryId === 'all' || itemCategory === categoryId);
        
        item.style.display = (matchesSearch && matchesCategory) ? 'flex' : 'none';
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
    const items = document.querySelectorAll('.competitor-product-item'); // Assuming we use a similar class to product-item
    
    items.forEach(item => {
        if (storeId === 'all' || item.dataset.store === storeId) {
            item.style.display = 'flex';
        } else {
            item.style.display = 'none';
        }
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

            const diff = item.competitor_price ? (item.our_price - item.competitor_price) : 0;
            const diffClass = diff > 0 ? 'status-danger' : (diff < 0 ? 'status-success' : '');
            
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
                    borderColor: '#6366f1',
                    backgroundColor: 'rgba(99, 102, 241, 0.05)',
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4,
                    pointBackgroundColor: '#ffffff',
                    pointBorderColor: '#6366f1',
                    pointBorderWidth: 2
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { 
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: '#1e293b',
                        padding: 12,
                        cornerRadius: 8,
                        titleFont: { size: 14, weight: 'bold' }
                    }
                },
                scales: {
                    y: { 
                        ticks: { color: '#64748b', font: { weight: '600' } }, 
                        grid: { color: '#f1f5f9' } 
                    },
                    x: { 
                        ticks: { color: '#64748b', font: { weight: '600' } }, 
                        grid: { display: false } 
                    }
                }
            }
        });
    } catch (err) {
        console.error('Trend Chart Error:', err);
    }
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
            // Give it 1 second then revert icon but leave price to async worker
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
