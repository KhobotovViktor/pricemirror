// Furniture Monitor Admin JS - PREMIUM Feedback Style
// Synchronized with new style.css and admin.html structure

// CSRF helper: inject X-CSRF-Token header into all mutating fetch requests
const _origFetch = window.fetch;
window.fetch = function(url, options = {}) {
    if (options.method && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(options.method.toUpperCase())) {
        if (!options.headers) options.headers = {};
        // Support both Headers object and plain object
        if (options.headers instanceof Headers) {
            if (!options.headers.has('x-csrf-token')) {
                options.headers.set('x-csrf-token', window.__CSRF_TOKEN__ || '');
            }
        } else {
            if (!options.headers['x-csrf-token']) {
                options.headers['x-csrf-token'] = window.__CSRF_TOKEN__ || '';
            }
        }
    }
    return _origFetch.call(this, url, options);
};

document.addEventListener('DOMContentLoaded', () => {
    // 0. Initial Load 
    initCustomDropdowns();
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

// --- Custom Dropdown Component ---
// Converts <select class="form-select"> into custom styled popups
// Keeps a hidden <select> in sync for form submissions and JS value reading

let _activeDropdown = null;
let _activeDropdownPanel = null;

function _closeAllDropdowns(e) {
    if (_activeDropdown) {
        const dd = _activeDropdown;
        const panel = _activeDropdownPanel;
        // Check if click is inside the wrapper OR the detached panel
        if (!dd.contains(e?.target) && !(panel && panel.contains(e?.target))) {
            dd.classList.remove('open');
            // Hide the panel (it's on body)
            if (panel) panel.style.display = 'none';
            _activeDropdown = null;
            _activeDropdownPanel = null;
        }
    }
}

document.addEventListener('click', _closeAllDropdowns);

function initCustomDropdowns() {
    document.querySelectorAll('select.form-select:not([data-dd-init])').forEach(sel => {
        sel.setAttribute('data-dd-init', '1');
        _buildCustomDropdown(sel);
    });
}

function _buildCustomDropdown(sel) {
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-dropdown';
    // Inside a form-group or card, fill width
    const parentGroup = sel.closest('.form-group');
    if (parentGroup) {
        wrapper.style.display = 'block';
        wrapper.style.width = '100%';
    } else if (sel.style.minWidth) {
        wrapper.style.minWidth = sel.style.minWidth;
    }

    // Copy classes from parent icon wrapper if present
    const iconWrapper = sel.closest('.form-input-icon');

    // Build trigger
    const currentOpt = sel.options[sel.selectedIndex];
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-dropdown-trigger';
    trigger.setAttribute('tabindex', '0');
    trigger.innerHTML = `<span class="dd-label">${currentOpt ? currentOpt.textContent : ''}</span><i class="fa-solid fa-chevron-down dd-icon"></i>`;

    // Build panel
    const panel = document.createElement('div');
    panel.className = 'custom-dropdown-panel';

    // Search box for dropdowns with many options
    const optCount = sel.options.length;
    let searchInput = null;
    if (optCount > 8) {
        const searchWrap = document.createElement('div');
        searchWrap.className = 'custom-dropdown-search';
        searchInput = document.createElement('input');
        searchInput.type = 'text';
        searchInput.placeholder = 'Поиск...';
        searchWrap.appendChild(searchInput);
        panel.appendChild(searchWrap);
    }

    // Build options
    const optList = document.createElement('div');
    optList.className = 'dd-option-list';
    _renderDdOptions(sel, optList);
    panel.appendChild(optList);

    wrapper.appendChild(trigger);
    wrapper.appendChild(panel);

    // Hide original select
    sel.style.display = 'none';
    sel.parentNode.insertBefore(wrapper, sel);
    wrapper.appendChild(sel); // move select inside wrapper

    // If was inside form-input-icon, hide the absolute-positioned icon
    if (iconWrapper) {
        const icon = iconWrapper.querySelector(':scope > i');
        if (icon) {
            icon.style.display = 'none';
        }
    }

    // Events
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = wrapper.classList.contains('open');
        _closeAllDropdowns();
        if (!isOpen) {
            wrapper.classList.add('open');
            _activeDropdown = wrapper;
            _activeDropdownPanel = panel;
            // Move panel to body to avoid transform-containing-block issues (e.g. inside modals)
            if (panel.parentNode !== document.body) {
                document.body.appendChild(panel);
            }
            panel.style.display = 'block';
            _positionPanel(wrapper, trigger, panel);
            if (searchInput) { searchInput.value = ''; _filterDdOptions(optList, ''); searchInput.focus(); }
            // Scroll selected into view
            const selected = optList.querySelector('.dd-option.selected');
            if (selected) selected.scrollIntoView({ block: 'nearest' });
        }
    });

    if (searchInput) {
        searchInput.addEventListener('input', () => _filterDdOptions(optList, searchInput.value));
        searchInput.addEventListener('click', e => e.stopPropagation());
    }

    optList.addEventListener('click', (e) => {
        const opt = e.target.closest('.dd-option');
        if (!opt) return;
        const val = opt.dataset.value;
        sel.value = val;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        trigger.querySelector('.dd-label').textContent = opt.textContent;
        // Update selected state
        optList.querySelectorAll('.dd-option').forEach(o => o.classList.toggle('selected', o.dataset.value === val));
        wrapper.classList.remove('open');
        panel.style.display = 'none';
        _activeDropdown = null;
        _activeDropdownPanel = null;
    });

    // Store reference for dynamic updates
    wrapper._ddSelect = sel;
    wrapper._ddTrigger = trigger;
    wrapper._ddOptList = optList;
    sel._ddWrapper = wrapper;
}

function _renderDdOptions(sel, optList) {
    optList.innerHTML = '';
    Array.from(sel.options).forEach(o => {
        const div = document.createElement('div');
        div.className = 'dd-option' + (o.selected ? ' selected' : '');
        div.dataset.value = o.value;
        div.textContent = o.textContent;
        optList.appendChild(div);
    });
}

function _filterDdOptions(optList, query) {
    const q = query.toLowerCase();
    let visible = 0;
    optList.querySelectorAll('.dd-option').forEach(o => {
        const match = !q || o.textContent.toLowerCase().includes(q);
        o.classList.toggle('hidden', !match);
        if (match) visible++;
    });
    // Show/hide empty state
    let empty = optList.querySelector('.dd-empty');
    if (visible === 0) {
        if (!empty) { empty = document.createElement('div'); empty.className = 'dd-empty'; empty.textContent = 'Ничего не найдено'; optList.appendChild(empty); }
        empty.style.display = '';
    } else if (empty) {
        empty.style.display = 'none';
    }
}

function _positionPanel(wrapper, trigger, panel) {
    const rect = trigger.getBoundingClientRect();
    const maxW = window.innerWidth - 16;
    panel.style.width = Math.min(Math.max(rect.width, 180), maxW) + 'px';
    // Try below
    let top = rect.bottom + 4;
    let left = rect.left;
    // Clamp right edge
    if (left + panel.offsetWidth > window.innerWidth - 8) {
        left = window.innerWidth - panel.offsetWidth - 8;
    }
    if (left < 8) left = 8;
    // If below overflows, show above
    if (top + 280 > window.innerHeight) {
        top = Math.max(8, rect.top - Math.min(panel.scrollHeight + 8, 284));
    }
    panel.style.top = top + 'px';
    panel.style.left = left + 'px';
}

// Refresh a custom dropdown when its <select> options change dynamically
function refreshCustomDropdown(selectEl) {
    const wrapper = selectEl._ddWrapper;
    if (!wrapper) return;
    // Rebuild options, respecting disabled/hidden ones
    const optList = wrapper._ddOptList;
    optList.innerHTML = '';
    Array.from(selectEl.options).forEach(o => {
        if (o.disabled || o.style.display === 'none') return;
        const div = document.createElement('div');
        div.className = 'dd-option' + (o.selected ? ' selected' : '');
        div.dataset.value = o.value;
        div.textContent = o.textContent;
        optList.appendChild(div);
    });
    const currentOpt = (selectEl.selectedIndex >= 0) ? selectEl.options[selectEl.selectedIndex] : null;
    const label = (currentOpt && !currentOpt.disabled) ? currentOpt.textContent : '';
    wrapper._ddTrigger.querySelector('.dd-label').textContent = label;
}

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

        // Populate store filter
        const select = document.getElementById('competitorStoreFilter');
        if (select) {
            select.innerHTML = '<option value="all">Все магазины</option>';
            stores.forEach(s => {
                const opt = document.createElement('option');
                opt.value = s.id;
                opt.textContent = s.name;
                select.appendChild(opt);
            });
            select.onchange = () => filterCompetitors();
            refreshCustomDropdown(select);
        }

        // Populate location filter with unique locations
        const locSelect = document.getElementById('competitorLocationFilter');
        if (locSelect) {
            const locations = [...new Set(stores.map(s => s.location).filter(Boolean))].sort();
            locSelect.innerHTML = '<option value="all">Все расположения</option>';
            locations.forEach(loc => {
                const opt = document.createElement('option');
                opt.value = loc;
                opt.textContent = loc;
                locSelect.appendChild(opt);
            });
            locSelect.onchange = () => filterCompetitors();
            refreshCustomDropdown(locSelect);
        }
    } catch (err) {
        console.error('Stores Load Error:', err);
    }
}

function filterCompetitors() {
    const storeId = document.getElementById('competitorStoreFilter').value;
    const location = document.getElementById('competitorLocationFilter')?.value || 'all';
    const priceFilter = document.getElementById('competitorPriceFilter')?.value || 'all';
    const categoryId = document.getElementById('competitorCategoryFilter')?.value || 'all';
    const query = document.getElementById('competitorSearch')?.value.toLowerCase() || '';
    const items = document.querySelectorAll('.competitor-product-item');

    items.forEach(item => {
        const storeMatch = storeId === 'all' || item.dataset.store === storeId;
        const locationMatch = location === 'all' || item.dataset.location === location;
        const priceMatch = priceFilter === 'all' || item.dataset.priceStatus === priceFilter;
        const categoryMatch = categoryId === 'all' || item.dataset.category === categoryId;
        const nameMatch = !query || (item.dataset.name || '').includes(query);
        item.style.display = (storeMatch && locationMatch && priceMatch && categoryMatch && nameMatch) ? 'flex' : 'none';
    });
}

async function loadCompetitorProducts() {
    const listContainer = document.getElementById('competitorLinksList');
    if (!listContainer) return;

    listContainer.innerHTML = Array(5).fill('<div class="skeleton-row"><div class="skeleton skeleton-circle"></div><div class="skeleton-lines"><div class="skeleton skeleton-line skeleton-line--medium"></div><div class="skeleton skeleton-line skeleton-line--short"></div></div><div class="skeleton skeleton-line--price skeleton"></div></div>').join('');
    
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
            div.dataset.location = item.store_location || '';

            const diff = item.competitor_price ? (item.our_price - item.competitor_price) : 0;
            const diffClass = diff > 0 ? 'status-danger' : (diff < 0 ? 'status-success' : '');

            // Color for "our price" label — matches diff direction
            const ourPriceColor = !item.competitor_price ? 'var(--text-muted)' :
                diff > 0 ? 'var(--danger)' : diff < 0 ? 'var(--success)' : 'var(--warning)';

            // Price status for filtering
            let priceStatus = 'unknown';
            if (item.competitor_price) {
                if (diff > 0) priceStatus = 'higher';
                else if (diff < 0) priceStatus = 'lower';
                else priceStatus = 'equal';
            }
            div.dataset.priceStatus = priceStatus;
            
            div.innerHTML = `
                <div class="comp-card">
                    <div class="comp-header">
                        <div class="comp-header-text">
                            <div class="comp-name">${item.our_product_name}</div>
                            <div class="comp-meta">
                                <span class="comp-store">${item.store_name}</span>
                                <a href="${item.url}" target="_blank" class="comp-link">Открыть ссылку <i class="fa-solid fa-arrow-up-right-from-square"></i></a>
                            </div>
                        </div>
                        <button class="comp-delete-btn" onclick="deleteMapping(${item.id}, this)" title="Удалить сопоставление">
                            <i class="fa-solid fa-trash-can"></i>
                        </button>
                    </div>
                    <div class="comp-footer">
                        <div class="comp-prices-grid">
                            <div class="comp-price-block">
                                <span class="comp-price-label">Наша цена</span>
                                <span class="comp-price-value" style="color:${ourPriceColor}">${item.our_price.toLocaleString()} \u20BD</span>
                            </div>
                            <div class="comp-price-block">
                                <span class="comp-price-label">Цена конкурента</span>
                                <span class="comp-price-value">${item.competitor_price ? item.competitor_price.toLocaleString() + ' \u20BD' : 'Сбор...'}</span>
                            </div>
                            <div class="comp-price-block">
                                <span class="comp-price-label">Отклонение</span>
                                <div class="status-pill ${item.competitor_price ? diffClass : ''}" style="${!item.competitor_price ? 'opacity:0.5;' : ''}">
                                    ${item.competitor_price ? (diff > 0 ? '+' : '') + diff.toLocaleString() + ' \u20BD' : 'Ожидание'}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
            listContainer.appendChild(div);
        });
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
    if (tabId === 'sync') renderSyncStatusReport();
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
        // Refresh custom dropdown if initialized
        refreshCustomDropdown(sel);
    });
    // Populate store checkboxes for Report 1
    const storeDiv = document.getElementById('avgPriceStoreFilter');
    if (storeDiv) {
        const stores = _analyticsData.stores || [];
        if (storeDiv.children.length === 0) {
            storeDiv.innerHTML =
                `<label style="font-size:0.78rem;display:inline-flex;align-items:center;gap:3px;cursor:pointer;white-space:nowrap;"><input type="checkbox" value="our" checked onchange="renderAvgPriceReport()"> Аллея Мебели</label>` +
                stores.map(s =>
                    `<label data-location="${s.location || ''}" style="font-size:0.78rem;display:inline-flex;align-items:center;gap:3px;cursor:pointer;white-space:nowrap;"><input type="checkbox" value="${s.id}" checked onchange="renderAvgPriceReport()"> ${s.name}</label>`
                ).join('');
        }
    }

    // Populate location filters for all 3 analytics reports
    const stores = _analyticsData.stores || [];
    const locations = [...new Set(stores.map(s => s.location).filter(Boolean))].sort();
    ['avgPriceLocationFilter', 'heatmapLocationFilter', 'trendLocationFilter'].forEach(id => {
        const sel = document.getElementById(id);
        if (!sel) return;
        const currentVal = sel.value;
        sel.innerHTML = '<option value="">Все расположения</option>' +
            locations.map(l => `<option value="${l}">${l}</option>`).join('');
        if (currentVal) sel.value = currentVal;
        refreshCustomDropdown(sel);
    });
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
    const locationFilter = document.getElementById('avgPriceLocationFilter')?.value || '';
    const storeDiv = document.getElementById('avgPriceStoreFilter');

    // Show/hide store checkboxes based on location filter
    if (storeDiv && locationFilter) {
        storeDiv.querySelectorAll('label[data-location]').forEach(lbl => {
            lbl.style.display = lbl.dataset.location === locationFilter ? '' : 'none';
        });
    } else if (storeDiv) {
        storeDiv.querySelectorAll('label[data-location]').forEach(lbl => { lbl.style.display = ''; });
    }

    const selectedStores = storeDiv ?
        Array.from(storeDiv.querySelectorAll('input:checked'))
            .filter(cb => {
                if (cb.value === 'our') return true;
                if (!locationFilter) return true;
                return cb.closest('label')?.dataset.location === locationFilter;
            })
            .map(cb => cb.value) : [];

    const includeOur = selectedStores.includes('our');
    const storeIds = selectedStores.filter(s => s !== 'our').map(Number);

    // Filter products by category
    let products = data.products;
    if (catFilter) products = products.filter(p => String(p.category_id) === catFilter);

    // Build: { storeName: [prices] }
    const storePrices = {};
    if (includeOur) storePrices['Аллея Мебели'] = [];

    for (const s of data.stores) {
        if (storeIds.includes(s.id)) storePrices[s.name] = [];
    }

    for (const p of products) {
        if (includeOur && p.current_price) storePrices['Аллея Мебели'].push(p.current_price);
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

    // Build rows array for sorting
    let rows = [];
    for (const [name, prices] of Object.entries(storePrices)) {
        if (prices.length === 0) continue;
        rows.push({
            name,
            value: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
            color: name === 'Аллея Мебели' ? ourColor : (storeColorMap[name] || '#64748b'),
        });
    }

    // Apply sort
    const sortBy = document.getElementById('avgPriceSortBy')?.value || 'price-desc';
    rows.sort((a, b) => {
        if (sortBy === 'price-desc') return b.value - a.value;
        if (sortBy === 'price-asc')  return a.value - b.value;
        if (sortBy === 'name-asc')   return a.name.localeCompare(b.name, 'ru');
        if (sortBy === 'name-desc')  return b.name.localeCompare(a.name, 'ru');
        return 0;
    });

    // Pin "Аллея Мебели" to top if checkbox checked
    const pinOur = document.getElementById('avgPricePinOur')?.checked;
    if (pinOur) {
        const ourIdx = rows.findIndex(r => r.name === 'Аллея Мебели');
        if (ourIdx > 0) rows.unshift(rows.splice(ourIdx, 1)[0]);
    }

    const labels = rows.map(r => r.name);
    const values = rows.map(r => r.value);
    const colors = rows.map(r => r.color);

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
    const locationFilter = document.getElementById('heatmapLocationFilter')?.value || '';
    let products = data.products.filter(p => p.current_price && p.has_price);
    if (catFilter) products = products.filter(p => String(p.category_id) === catFilter);

    // Build allowed store IDs (filtered by location)
    const allowedStoreIds = new Set(
        data.stores
            .filter(s => !locationFilter || s.location === locationFilter)
            .map(s => s.id)
    );

    // Collect store IDs that have mappings AND pass location filter
    const storeSet = new Set();
    for (const p of products) for (const m of p.mappings) if (m.last_price && allowedStoreIds.has(m.store_id)) storeSet.add(m.store_id);
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

function onTrendPeriodChange() {
    const preset = document.getElementById('trendPeriodPreset')?.value;
    const customEl = document.getElementById('trendCustomRange');
    if (customEl) customEl.style.setProperty('display', preset === 'custom' ? 'flex' : 'none', 'important');
    if (preset !== 'custom') renderTrendReport();
}

async function renderTrendReport() {
    const baseData = await loadAnalyticsData();
    if (!baseData) return;

    const catFilter = document.getElementById('trendCategoryFilter')?.value;
    const locationFilter = document.getElementById('trendLocationFilter')?.value || '';
    const preset = document.getElementById('trendPeriodPreset')?.value || '30';

    // Build query params for trend endpoint
    let trendUrl = '/api/analytics/trend';
    if (preset === 'custom') {
        const df = document.getElementById('trendDateFrom')?.value;
        const dt = document.getElementById('trendDateTo')?.value;
        if (!df || !dt) return; // wait for both dates
        trendUrl += `?date_from=${df}&date_to=${dt}`;
    } else {
        trendUrl += `?days=${preset}`;
    }

    let trendData;
    try {
        const resp = await fetch(trendUrl, { credentials: 'include' });
        if (!resp.ok) return;
        trendData = await resp.json();
    } catch (e) { console.error('Trend fetch error:', e); return; }

    const trend = trendData.trend || {};
    // Use stores from trend response (has colors); merge location field from baseData stores
    const baseStoreMap = {};
    for (const s of (baseData.stores || [])) baseStoreMap[String(s.id)] = s;
    const trendStores = (trendData.stores || []).map(s => ({ ...s, ...(baseStoreMap[String(s.id)] || {}) }));

    // Get product IDs in this category
    let productIds = null;
    if (catFilter) {
        productIds = new Set(baseData.products.filter(p => String(p.category_id) === catFilter).map(p => p.id));
    }

    // Build allowed store IDs (filtered by location)
    const allowedTrendStores = new Set(
        trendStores
            .filter(s => !locationFilter || s.location === locationFilter)
            .map(s => String(s.id))
    );

    // Build datasets from trend data, filtered by category products
    // trend: { storeId: { store_name, data: { date: avg_price } } }
    const datasets = [];
    let ci = 0;

    // Build store color lookup
    const storeColorById = {};
    for (const s of trendStores) storeColorById[String(s.id)] = s.color || '#64748b';

    // --- First pass: collect ALL dates so every dataset is positionally aligned ---
    const allDatesSet = new Set();
    for (const [, sdata] of Object.entries(trend)) {
        Object.keys(sdata.data).forEach(d => allDatesSet.add(d));
    }
    const allDates = [...allDatesSet].sort();

    // Add "our" store average as a flat reference line across all dates
    const ourProducts = baseData.products.filter(p => {
        if (productIds && !productIds.has(p.id)) return false;
        return p.current_price;
    });
    if (ourProducts.length > 0 && allDates.length > 0) {
        const ourAvg = Math.round(ourProducts.reduce((s, p) => s + p.current_price, 0) / ourProducts.length);
        const ourColor = baseData.our_store_color || '#6366f1';
        datasets.push({
            label: 'Аллея Мебели (средняя)',
            data: allDates.map(() => ourAvg),
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
            order: 0,
        });
    }

    // --- Second pass: build competitor datasets using positional arrays ---
    for (const [sid, sdata] of Object.entries(trend)) {
        if (!allowedTrendStores.has(sid)) continue;

        const color = storeColorById[sid] || REPORT_COLORS[ci % REPORT_COLORS.length];
        datasets.push({
            label: sdata.store_name,
            // Positional array aligned to allDates; null for missing dates (no data gap)
            data: allDates.map(d => sdata.data[d] ?? null),
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

    // Summary cards above the table
    const summaryDiv = document.getElementById('coverageSummary');
    if (summaryDiv) {
        const covPct = total > 0 ? Math.round(withPrice / total * 100) : 0;
        summaryDiv.innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:0.82rem;">
                <div style="padding:10px 12px;background:var(--bg-surface);border-radius:var(--radius-md);border:1px solid var(--border-soft);">
                    <div style="color:var(--text-muted);font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.03em;">Наших товаров</div>
                    <div style="font-size:1.35rem;font-weight:800;color:var(--text);margin-top:2px;">${total}</div>
                </div>
                <div style="padding:10px 12px;background:var(--bg-surface);border-radius:var(--radius-md);border:1px solid var(--border-soft);">
                    <div style="color:var(--text-muted);font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.03em;">С привязкой</div>
                    <div style="font-size:1.35rem;font-weight:800;color:var(--primary);margin-top:2px;">${withMapping}</div>
                </div>
                <div style="padding:10px 12px;background:var(--bg-surface);border-radius:var(--radius-md);border:1px solid var(--border-soft);">
                    <div style="color:var(--text-muted);font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.03em;">С актуальной ценой</div>
                    <div style="font-size:1.35rem;font-weight:800;color:#22c55e;margin-top:2px;">${withPrice}</div>
                </div>
                <div style="padding:10px 12px;background:var(--bg-surface);border-radius:var(--radius-md);border:1px solid var(--border-soft);">
                    <div style="color:var(--text-muted);font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.03em;">Покрытие</div>
                    <div style="font-size:1.35rem;font-weight:800;color:var(--text);margin-top:2px;">${covPct}%</div>
                </div>
            </div>`;
    }

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
    html += `<th style="text-align:right;padding:0.7rem;">Покрытие (из ${total})</th>`;
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

// ---- REPORT 6: Sync Status ----

async function renderSyncStatusReport() {
    const container = document.getElementById('syncStatusContainer');
    if (!container) return;
    container.innerHTML = '<p style="color:var(--text-muted);padding:1rem;">Загрузка...</p>';

    let rows;
    try {
        const resp = await fetch('/api/analytics/sync-status', { credentials: 'include' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        rows = await resp.json();
    } catch (e) {
        container.innerHTML = '<p style="color:var(--danger)">Ошибка загрузки данных</p>';
        return;
    }

    function statusBadge(hoursAgo) {
        if (hoursAgo === null || hoursAgo === undefined) {
            return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:0.75rem;font-weight:700;background:#f1f5f9;color:#64748b;">Нет данных</span>';
        }
        if (hoursAgo <= 24) {
            return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:0.75rem;font-weight:700;background:#dcfce7;color:#16a34a;"><i class="fa-solid fa-circle-check"></i> Актуально</span>';
        }
        if (hoursAgo <= 168) {
            return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:0.75rem;font-weight:700;background:#fef3c7;color:#d97706;"><i class="fa-solid fa-clock"></i> Устарело</span>';
        }
        return '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:0.75rem;font-weight:700;background:#fee2e2;color:#dc2626;"><i class="fa-solid fa-triangle-exclamation"></i> Давно</span>';
    }

    function timeAgoText(hoursAgo) {
        if (hoursAgo === null || hoursAgo === undefined) return '—';
        if (hoursAgo < 1) return 'менее часа назад';
        if (hoursAgo < 24) return `${Math.round(hoursAgo)} ч. назад`;
        const days = Math.floor(hoursAgo / 24);
        const hrs = Math.round(hoursAgo % 24);
        return hrs > 0 ? `${days} д. ${hrs} ч. назад` : `${days} д. назад`;
    }

    // Summary stats
    const total = rows.length;
    const fresh = rows.filter(r => r.hours_ago !== null && r.hours_ago <= 24).length;
    const stale = rows.filter(r => r.hours_ago !== null && r.hours_ago > 24 && r.hours_ago <= 168).length;
    const old = rows.filter(r => r.hours_ago !== null && r.hours_ago > 168).length;
    const noData = rows.filter(r => r.hours_ago === null).length;

    const summaryHtml = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin-bottom:24px;">
            <div style="padding:14px 16px;background:var(--bg-surface);border-radius:var(--radius-md);border:1px solid var(--border-soft);">
                <div style="color:var(--text-muted);font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.03em;">Всего магазинов</div>
                <div style="font-size:1.6rem;font-weight:800;color:var(--text);margin-top:4px;">${total}</div>
            </div>
            <div style="padding:14px 16px;background:var(--bg-surface);border-radius:var(--radius-md);border:1px solid var(--border-soft);">
                <div style="color:var(--text-muted);font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.03em;">Актуальных</div>
                <div style="font-size:1.6rem;font-weight:800;color:#16a34a;margin-top:4px;">${fresh}</div>
            </div>
            <div style="padding:14px 16px;background:var(--bg-surface);border-radius:var(--radius-md);border:1px solid var(--border-soft);">
                <div style="color:var(--text-muted);font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.03em;">Устаревших (1–7 дн.)</div>
                <div style="font-size:1.6rem;font-weight:800;color:#d97706;margin-top:4px;">${stale}</div>
            </div>
            <div style="padding:14px 16px;background:var(--bg-surface);border-radius:var(--radius-md);border:1px solid var(--border-soft);">
                <div style="color:var(--text-muted);font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.03em;">Давно (>7 дн.)</div>
                <div style="font-size:1.6rem;font-weight:800;color:#dc2626;margin-top:4px;">${old}</div>
            </div>
            <div style="padding:14px 16px;background:var(--bg-surface);border-radius:var(--radius-md);border:1px solid var(--border-soft);">
                <div style="color:var(--text-muted);font-weight:600;font-size:0.72rem;text-transform:uppercase;letter-spacing:0.03em;">Нет данных</div>
                <div style="font-size:1.6rem;font-weight:800;color:#94a3b8;margin-top:4px;">${noData}</div>
            </div>
        </div>`;

    // Table
    const rowsHtml = rows.map(r => {
        const isOur = r.type === 'our';
        const rowStyle = isOur ? 'background:var(--bg-surface);font-weight:600;' : '';
        const nameCell = isOur
            ? `<td style="padding:10px 14px;${rowStyle}"><span style="display:inline-flex;align-items:center;gap:6px;"><i class="fa-solid fa-store" style="color:var(--primary);font-size:0.85rem;"></i>${r.name}</span></td>`
            : `<td style="padding:10px 14px;">${r.name}</td>`;
        return `<tr style="${rowStyle}border-bottom:1px solid var(--border-soft);">
            ${nameCell}
            <td style="padding:10px 14px;color:var(--text-muted);font-size:0.85rem;">${r.location}</td>
            <td style="padding:10px 14px;font-variant-numeric:tabular-nums;">${r.last_sync || '<span style="color:var(--text-muted)">—</span>'}</td>
            <td style="padding:10px 14px;color:var(--text-muted);font-size:0.85rem;">${timeAgoText(r.hours_ago)}</td>
            <td style="padding:10px 14px;text-align:center;font-weight:700;">${r.product_count}</td>
            <td style="padding:10px 14px;">${statusBadge(r.hours_ago)}</td>
        </tr>`;
    }).join('');

    const tableHtml = `
        <div style="overflow-x:auto;">
            <table style="width:100%;border-collapse:collapse;font-size:0.875rem;">
                <thead>
                    <tr style="border-bottom:2px solid var(--border);">
                        <th style="padding:10px 14px;text-align:left;color:var(--text-muted);font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;font-weight:700;">Магазин</th>
                        <th style="padding:10px 14px;text-align:left;color:var(--text-muted);font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;font-weight:700;">Расположение</th>
                        <th style="padding:10px 14px;text-align:left;color:var(--text-muted);font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;font-weight:700;">Последняя синхронизация</th>
                        <th style="padding:10px 14px;text-align:left;color:var(--text-muted);font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;font-weight:700;">Давность</th>
                        <th style="padding:10px 14px;text-align:center;color:var(--text-muted);font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;font-weight:700;">Товаров</th>
                        <th style="padding:10px 14px;text-align:left;color:var(--text-muted);font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em;font-weight:700;">Статус</th>
                    </tr>
                </thead>
                <tbody>${rowsHtml}</tbody>
            </table>
        </div>`;

    container.innerHTML = summaryHtml + tableHtml;
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

// Category change popup
let _activeCategoryPopup = null;

function closeCategoryPopup() {
    if (_activeCategoryPopup) {
        _activeCategoryPopup.remove();
        _activeCategoryPopup = null;
    }
    document.removeEventListener('click', _closeCategoryPopupOutside);
}

function _closeCategoryPopupOutside(e) {
    if (_activeCategoryPopup && !_activeCategoryPopup.contains(e.target) && !e.target.closest('.category-edit-wrapper button')) {
        closeCategoryPopup();
    }
}

function _positionPopup(popup, anchorEl) {
    // Position popup near anchor, ensuring it stays on screen
    const rect = anchorEl.getBoundingClientRect();
    popup.style.position = 'fixed';
    popup.style.maxWidth = (window.innerWidth - 16) + 'px';
    // Try below-right first
    let top = rect.bottom + 6;
    let left = rect.right - Math.min(220, window.innerWidth - 16);
    // Clamp left
    if (left < 8) left = 8;
    if (left + 240 > window.innerWidth) left = window.innerWidth - 248;
    // If below would overflow, show above
    if (top + 280 > window.innerHeight) {
        top = Math.max(8, rect.top - 286);
    }
    popup.style.top = top + 'px';
    popup.style.left = left + 'px';
}

async function handleCategoryEdit(btn) {
    const productId = btn.getAttribute('data-id');
    const currentCatId = btn.getAttribute('data-category');

    // Close any open popup
    closeCategoryPopup();

    // Get categories from the hidden original select
    const catSrc = document.getElementById('categoryFilter');
    const options = catSrc
        ? Array.from(catSrc.querySelectorAll('option')).filter(o => o.value !== 'all' && o.value !== '')
        : [];
    if (options.length === 0) return;

    // Build popup
    const popup = document.createElement('div');
    popup.className = 'category-popup';
    popup.innerHTML = `
        <div class="category-popup-title">Товарная группа</div>
        ${options.map(o => `
            <div class="category-popup-item${String(o.value) === String(currentCatId) ? ' active' : ''}" data-value="${o.value}">
                ${o.textContent}
            </div>
        `).join('')}
    `;

    document.body.appendChild(popup);
    _activeCategoryPopup = popup;
    _positionPopup(popup, btn);

    // Handle selection
    popup.querySelectorAll('.category-popup-item').forEach(item => {
        item.addEventListener('click', async () => {
            const newCatId = item.dataset.value;
            if (String(newCatId) === String(currentCatId)) {
                closeCategoryPopup();
                return;
            }
            closeCategoryPopup();
            try {
                const resp = await fetch(`/api/products/${productId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    credentials: 'include',
                    body: JSON.stringify({ category_id: parseInt(newCatId) })
                });
                if (resp.ok) {
                    const productItem = btn.closest('.product-item');
                    if (productItem) {
                        productItem.dataset.category = newCatId;
                        const newName = options.find(o => o.value === newCatId)?.textContent || '';
                        const meta = productItem.querySelector('.product-meta');
                        if (meta) {
                            meta.innerHTML = meta.innerHTML.replace(/^[^&]*&bull;/, newName + ' &bull;');
                        }
                    }
                    btn.setAttribute('data-category', newCatId);
                } else {
                    const err = await resp.json();
                    alert('Ошибка: ' + (err.detail || 'Не удалось обновить'));
                }
            } catch (e) {
                alert('Ошибка сети: ' + e.message);
            }
        });
    });

    // Close on outside click (delayed to avoid immediate trigger)
    setTimeout(() => document.addEventListener('click', _closeCategoryPopupOutside), 10);
}

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
            label: 'Наша цена (Аллея Мебели)',
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

        // Animated counter
        function animateValue(el, end, suffix = '') {
            if (!el) return;
            const start = parseInt(el.innerText) || 0;
            const diff = end - start;
            if (diff === 0) { el.innerText = end + suffix; return; }
            const duration = 600;
            const steps = 30;
            const stepTime = duration / steps;
            let step = 0;
            const timer = setInterval(() => {
                step++;
                const val = Math.round(start + diff * (step / steps));
                el.innerText = val.toLocaleString('ru-RU') + suffix;
                if (step >= steps) {
                    clearInterval(timer);
                    el.innerText = end.toLocaleString('ru-RU') + suffix;
                    el.setAttribute('data-animate', '1');
                }
            }, stepTime);
        }

        animateValue(els.statTotal, data.total_products);
        animateValue(els.statAtRisk, data.at_risk);
        animateValue(els.statAvgGap, data.avg_gap, ' \u20BD');
        if (els.statLastSync) els.statLastSync.innerText = data.last_sync;

        // Update sidebar badges
        const badgeProducts = document.getElementById('navBadgeProducts');
        const badgeCompetitors = document.getElementById('navBadgeCompetitors');
        if (badgeProducts) badgeProducts.textContent = data.total_products || '0';
        if (badgeCompetitors) badgeCompetitors.textContent = data.total_mappings || '—';
        
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
    loadCompetitors();
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
window.handleCategoryEdit = handleCategoryEdit;

// Delete a competitor mapping
async function deleteMapping(mappingId, btn) {
    if (!confirm('Удалить это сопоставление? Все данные о ценах конкурента для этой связки будут удалены.')) return;
    const row = btn.closest('.competitor-product-item');
    if (row) row.style.opacity = '0.4';
    try {
        const resp = await fetch(`/api/mappings/${mappingId}`, { method: 'DELETE', credentials: 'include' });
        if (resp.ok) {
            if (row) { row.style.transition = 'all .3s'; row.style.maxHeight = '0'; row.style.opacity = '0'; row.style.overflow = 'hidden'; row.style.padding = '0'; row.style.margin = '0'; setTimeout(() => row.remove(), 300); }
            loadDashboardStats();
        } else {
            const err = await resp.json();
            alert('Ошибка: ' + (err.detail || 'Не удалось удалить'));
            if (row) row.style.opacity = '1';
        }
    } catch (e) {
        alert('Ошибка сети: ' + e.message);
        if (row) row.style.opacity = '1';
    }
}
window.deleteMapping = deleteMapping;

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
window.onTrendPeriodChange = onTrendPeriodChange;
window.renderRiskReport = renderRiskReport;
window.renderCoverageReport = renderCoverageReport;
window.renderSyncStatusReport = renderSyncStatusReport;
window.saveStoreColor = saveStoreColor;
window.saveOurStoreColor = saveOurStoreColor;

// --- XML Import ---

let _xmlParsedOffers = []; // parsed from server

async function handleXmlUpload() {
    const fileInput = document.getElementById('xmlFileInput');
    const statusDiv = document.getElementById('xmlUploadStatus');
    if (!fileInput || !fileInput.files.length) {
        if (statusDiv) statusDiv.innerHTML = '<span style="color:var(--danger);">Выберите XML-файл</span>';
        return;
    }

    const btn = document.getElementById('xmlUploadBtn');
    if (btn) btn.disabled = true;
    if (statusDiv) statusDiv.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Загрузка...';

    const formData = new FormData();
    formData.append('file', fileInput.files[0]);

    try {
        const resp = await fetch('/api/products/import-xml', {
            method: 'POST',
            credentials: 'include',
            body: formData
        });
        const data = await resp.json();
        if (!resp.ok) {
            if (statusDiv) statusDiv.innerHTML = `<span style="color:var(--danger);">${data.detail || 'Ошибка'}</span>`;
            return;
        }

        _xmlParsedOffers = data.offers || [];
        if (statusDiv) statusDiv.innerHTML = `<span style="color:var(--success);">Найдено товаров: ${_xmlParsedOffers.length}</span>`;

        // Populate XML category filter
        const xmlCats = {};
        for (const o of _xmlParsedOffers) {
            if (o.xml_category_name) xmlCats[o.xml_category_id] = o.xml_category_name;
        }
        const catFilter = document.getElementById('xmlCategoryFilter');
        if (catFilter) {
            catFilter.innerHTML = '<option value="">Все группы</option>' +
                Object.entries(xmlCats).map(([id, name]) => `<option value="${id}">${name}</option>`).join('');
            refreshCustomDropdown(catFilter);
        }

        renderXmlPreview();
        document.getElementById('xmlImportModal').style.display = 'flex';
    } catch (e) {
        if (statusDiv) statusDiv.innerHTML = `<span style="color:var(--danger);">Ошибка: ${e.message}</span>`;
    } finally {
        if (btn) btn.disabled = false;
    }
}

function renderXmlPreview() {
    const container = document.getElementById('xmlPreviewList');
    if (!container) return;

    if (_xmlParsedOffers.length === 0) {
        container.innerHTML = '<p style="text-align:center;padding:2rem;color:var(--text-muted);">Нет товаров</p>';
        updateXmlSelectedCount();
        return;
    }

    // Build category options HTML from global categories list
    const cats = window.__CATEGORIES__ || [];
    const catOptionsHtml = cats.map(c => `<option value="${c.id}">${c.name}</option>`).join('');

    let html = '<table style="width:100%;border-collapse:collapse;font-size:0.82rem;">';
    html += '<thead><tr style="border-bottom:2px solid var(--border-soft);position:sticky;top:0;background:var(--bg-card);z-index:1;">';
    html += '<th style="padding:8px;width:30px;"></th>';
    html += '<th style="padding:8px;text-align:left;">Название</th>';
    html += '<th style="padding:8px;text-align:left;min-width:100px;">Группа (XML)</th>';
    html += '<th style="padding:8px;text-align:left;min-width:140px;">Товарная группа</th>';
    html += '</tr></thead><tbody>';

    for (let i = 0; i < _xmlParsedOffers.length; i++) {
        const o = _xmlParsedOffers[i];
        const resolvedId = o.resolved_category_id || '';

        html += `<tr class="xml-offer-row" data-index="${i}" data-xml-cat="${o.xml_category_id || ''}" data-name="${(o.name || '').toLowerCase()}" style="border-bottom:1px solid var(--border-soft);">`;
        html += `<td style="padding:6px 8px;"><input type="checkbox" class="xml-offer-checkbox" data-index="${i}" checked onchange="updateXmlSelectedCount()"></td>`;
        html += `<td style="padding:6px 8px;font-weight:600;" title="${o.url}">${o.name}</td>`;
        html += `<td style="padding:6px 8px;font-size:0.75rem;color:var(--text-muted);">${o.xml_category_name || '—'}</td>`;
        html += `<td style="padding:6px 8px;font-size:0.75rem;">`;
        html += `<select class="xml-row-category" data-index="${i}" style="width:100%;padding:4px 6px;border:1px solid var(--border);border-radius:var(--radius-sm);background:var(--bg-surface);color:var(--text-primary);font-size:0.75rem;">`;
        html += `<option value="">— по умолчанию —</option>`;
        html += catOptionsHtml.replace(
            resolvedId ? `value="${resolvedId}"` : '____NOMATCH____',
            resolvedId ? `value="${resolvedId}" selected` : '____NOMATCH____'
        );
        html += `</select>`;
        html += `</td>`;
        html += '</tr>';
    }

    html += '</tbody></table>';
    container.innerHTML = html;

    // Bind category change to update internal data
    container.querySelectorAll('.xml-row-category').forEach(sel => {
        sel.addEventListener('change', function() {
            const idx = parseInt(this.dataset.index);
            const offer = _xmlParsedOffers[idx];
            if (offer) {
                const val = this.value ? parseInt(this.value) : null;
                offer.resolved_category_id = val;
                offer.resolved_category_name = val ? (cats.find(c => c.id === val)?.name || '') : '';
            }
        });
    });

    updateXmlSelectedCount();
}

function filterXmlPreview() {
    const catVal = document.getElementById('xmlCategoryFilter')?.value || '';
    const searchVal = (document.getElementById('xmlSearchFilter')?.value || '').toLowerCase();

    document.querySelectorAll('.xml-offer-row').forEach(row => {
        const matchesCat = !catVal || row.dataset.xmlCat === catVal;
        const matchesSearch = !searchVal || row.dataset.name.includes(searchVal);
        row.style.display = (matchesCat && matchesSearch) ? '' : 'none';
    });
}

function toggleXmlSelectAll(checked) {
    document.querySelectorAll('.xml-offer-row').forEach(row => {
        if (row.style.display !== 'none') {
            const cb = row.querySelector('.xml-offer-checkbox');
            if (cb) cb.checked = checked;
        }
    });
    updateXmlSelectedCount();
}

function updateXmlSelectedCount() {
    const total = document.querySelectorAll('.xml-offer-row:not([style*="display: none"])').length;
    const checked = document.querySelectorAll('.xml-offer-row:not([style*="display: none"]) .xml-offer-checkbox:checked').length;
    const counter = document.getElementById('xmlSelectedCount');
    if (counter) counter.textContent = `${checked} из ${total}`;
}

function closeXmlImportModal() {
    document.getElementById('xmlImportModal').style.display = 'none';
    const resultDiv = document.getElementById('xmlImportResultStatus');
    if (resultDiv) resultDiv.innerHTML = '';
}

async function confirmXmlImport() {
    const fallbackCategoryId = parseInt(document.getElementById('xmlImportCategorySelect')?.value);
    const skipDuplicates = document.getElementById('xmlSkipDuplicates')?.checked ?? true;
    const btn = document.getElementById('xmlConfirmBtn');
    const resultDiv = document.getElementById('xmlImportResultStatus');

    // Collect selected indices
    const selectedProducts = [];
    document.querySelectorAll('.xml-offer-checkbox:checked').forEach(cb => {
        const idx = parseInt(cb.dataset.index);
        const offer = _xmlParsedOffers[idx];
        if (offer) {
            selectedProducts.push({
                name: offer.name,
                url: offer.url,
                category_id: offer.resolved_category_id || fallbackCategoryId
            });
        }
    });

    if (selectedProducts.length === 0) {
        if (resultDiv) resultDiv.innerHTML = '<span style="color:var(--danger);">Не выбрано ни одного товара</span>';
        return;
    }

    if (btn) btn.disabled = true;
    if (resultDiv) resultDiv.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Импорт ${selectedProducts.length} товаров...`;

    try {
        const resp = await fetch('/api/products/import-xml/confirm', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ products: selectedProducts, skip_duplicates: skipDuplicates })
        });
        const data = await resp.json();
        if (resp.ok) {
            if (resultDiv) resultDiv.innerHTML = `<span style="color:var(--success);font-weight:700;"><i class="fa-solid fa-check-circle"></i> ${data.message}</span>`;
            // Reload page after short delay to show new products
            setTimeout(() => location.reload(), 1500);
        } else {
            if (resultDiv) resultDiv.innerHTML = `<span style="color:var(--danger);">${data.detail || 'Ошибка'}</span>`;
        }
    } catch (e) {
        if (resultDiv) resultDiv.innerHTML = `<span style="color:var(--danger);">Ошибка: ${e.message}</span>`;
    } finally {
        if (btn) btn.disabled = false;
    }
}

window.handleXmlUpload = handleXmlUpload;
window.filterXmlPreview = filterXmlPreview;
window.toggleXmlSelectAll = toggleXmlSelectAll;
window.updateXmlSelectedCount = updateXmlSelectedCount;
window.closeXmlImportModal = closeXmlImportModal;
window.confirmXmlImport = confirmXmlImport;

// --- Mapping Category Filter + Search ---

function filterMappingProducts() {
    const catId = document.getElementById('mappingCategoryFilter')?.value || 'all';
    const query = (document.getElementById('mappingProductSearch')?.value || '').toLowerCase().trim();
    const sel = document.getElementById('productSelect');
    if (!sel) return;

    // Filter options in the hidden <select>
    Array.from(sel.options).forEach(opt => {
        const optCat = opt.getAttribute('data-category') || '';
        const optName = opt.textContent.toLowerCase();
        const matchesCat = (catId === 'all' || optCat === catId);
        const matchesSearch = !query || optName.includes(query);
        const show = matchesCat && matchesSearch;
        opt.style.display = show ? '' : 'none';
        opt.disabled = !show;
    });

    // Select first visible option, or clear if none
    const firstVisible = Array.from(sel.options).find(o => !o.disabled);
    if (firstVisible) {
        sel.value = firstVisible.value;
    } else {
        sel.selectedIndex = -1;
    }

    // Refresh the custom dropdown
    refreshCustomDropdown(sel);
}

function updateXmlFileName(input) {
    const label = document.getElementById('xmlFileName');
    if (label) {
        label.textContent = input.files.length ? input.files[0].name : 'Выберите файл';
        label.style.color = input.files.length ? 'var(--text-primary)' : '';
        label.style.fontWeight = input.files.length ? '600' : '';
    }
}

window.filterMappingProducts = filterMappingProducts;
window.updateXmlFileName = updateXmlFileName;

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

// --- Telegram Test ---
window.testTelegram = async () => {
    const resultDiv = document.getElementById('telegramTestResult');
    if (resultDiv) {
        resultDiv.innerHTML = '<span style="color: var(--primary);"><i class="fa-solid fa-spinner fa-spin"></i> Отправка тестового сообщения в Telegram...</span>';
    }

    try {
        const response = await fetch('/api/telegram/test', { method: 'POST' });
        const data = await response.json();

        if (resultDiv) {
            if (data.status === 'success') {
                resultDiv.innerHTML = `<span style="color: var(--success);"><i class="fa-solid fa-check-circle"></i> ${data.message}</span>`;
            } else {
                resultDiv.innerHTML = `<span style="color: var(--danger);"><i class="fa-solid fa-triangle-exclamation"></i> ${data.message}</span>`;
            }
        }
    } catch (err) {
        console.error('Telegram test error:', err);
        if (resultDiv) {
            resultDiv.innerHTML = '<span style="color: var(--danger);">Ошибка соединения с сервером</span>';
        }
    }
};

// --- User Management ---

async function loadUsers() {
    const container = document.getElementById('usersList');
    if (!container) return;
    try {
        const resp = await fetch('/api/users');
        const users = await resp.json();
        if (!Array.isArray(users) || users.length === 0) {
            container.innerHTML = '<p class="text-muted text-sm" style="padding:12px;">Пользователи не найдены. Используется режим совместимости (system_settings).</p>';
            return;
        }
        let html = '<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">';
        html += '<thead><tr style="border-bottom:2px solid var(--border);">';
        html += '<th style="padding:8px;text-align:left;">Имя</th>';
        html += '<th style="padding:8px;text-align:left;">Логин</th>';
        html += '<th style="padding:8px;text-align:center;">Роль</th>';
        html += '<th style="padding:8px;text-align:center;">Статус</th>';
        html += '<th style="padding:8px;text-align:right;">Действия</th>';
        html += '</tr></thead><tbody>';
        for (const u of users) {
            const roleClass = u.role === 'admin' ? 'color:var(--primary);font-weight:700;' : 'color:var(--text-secondary);';
            const statusBadge = u.is_active
                ? '<span style="color:var(--success);font-weight:600;">Активен</span>'
                : '<span style="color:var(--text-tertiary);">Отключён</span>';
            html += `<tr style="border-bottom:1px solid var(--border-soft);">`;
            html += `<td style="padding:8px;font-weight:600;">${u.display_name}</td>`;
            html += `<td style="padding:8px;color:var(--text-muted);">${u.username}</td>`;
            html += `<td style="padding:8px;text-align:center;"><span style="${roleClass}">${u.role}</span></td>`;
            html += `<td style="padding:8px;text-align:center;">${statusBadge}</td>`;
            html += `<td style="padding:8px;text-align:right;">`;
            if (u.is_active) {
                html += `<button class="btn btn-secondary btn-sm" style="font-size:0.7rem;padding:3px 8px;" onclick="window.toggleUser(${u.id}, false)">Отключить</button>`;
            } else {
                html += `<button class="btn btn-primary btn-sm" style="font-size:0.7rem;padding:3px 8px;" onclick="window.toggleUser(${u.id}, true)">Включить</button>`;
            }
            html += ` <button class="btn btn-secondary btn-sm" style="font-size:0.7rem;padding:3px 8px;color:var(--danger);" onclick="window.deleteUser(${u.id}, '${u.display_name}')"><i class="fa-solid fa-trash-can"></i></button>`;
            html += `</td></tr>`;
        }
        html += '</tbody></table>';
        container.innerHTML = html;
    } catch (err) {
        console.error('Load users error:', err);
        if (container) container.innerHTML = '<p class="text-muted text-sm" style="padding:12px;">Таблица пользователей не создана. Создайте таблицу app_user в Supabase.</p>';
    }
}

window.createUser = async () => {
    const username = document.getElementById('newUserLogin')?.value?.trim();
    const displayName = document.getElementById('newUserDisplayName')?.value?.trim();
    const password = document.getElementById('newUserPassword')?.value;
    const role = document.getElementById('newUserRole')?.value || 'manager';
    const resultDiv = document.getElementById('userCreateResult');

    if (!username || !displayName || !password || password.length < 4) {
        if (resultDiv) resultDiv.innerHTML = '<span style="color:var(--danger);">Заполните все поля (пароль мин. 4 символа)</span>';
        return;
    }

    try {
        const resp = await fetch('/api/users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, display_name: displayName, password, role })
        });
        const data = await resp.json();
        if (resp.ok && data.status === 'success') {
            if (resultDiv) resultDiv.innerHTML = `<span style="color:var(--success);"><i class="fa-solid fa-check-circle"></i> ${data.message}</span>`;
            document.getElementById('newUserLogin').value = '';
            document.getElementById('newUserDisplayName').value = '';
            document.getElementById('newUserPassword').value = '';
            loadUsers();
        } else {
            if (resultDiv) resultDiv.innerHTML = `<span style="color:var(--danger);">${data.detail || data.message || 'Ошибка'}</span>`;
        }
    } catch (err) {
        if (resultDiv) resultDiv.innerHTML = '<span style="color:var(--danger);">Ошибка соединения</span>';
    }
};

window.toggleUser = async (id, activate) => {
    try {
        await fetch(`/api/users/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: activate })
        });
        loadUsers();
    } catch (err) { console.error(err); }
};

window.deleteUser = async (id, name) => {
    if (!confirm(`Удалить пользователя "${name}"?`)) return;
    try {
        await fetch(`/api/users/${id}`, { method: 'DELETE' });
        loadUsers();
    } catch (err) { console.error(err); }
};

// Load users when settings section is shown
const _origSwitchSection = window.switchSection;
if (typeof _origSwitchSection === 'function') {
    window.switchSection = function(sectionId) {
        _origSwitchSection(sectionId);
        if (sectionId === 'settings') { loadUsers(); loadCompetitors(); }
    };
}

// --- Competitor Management ---

const STORE_LOCATIONS = [
    'Торговая сеть', 'Архангельск', 'Вологда', 'Белозерск', 'Грязовец',
    'Иваново', 'Кинешма', 'Коряжма', 'Котлас', 'Няндома', 'Сокол',
    'Тейково', 'Тотьма', 'Тутаев', 'Фурманов', 'Череповец', 'Ярославль'
];

function locationSelect(selectedValue, idAttr) {
    return `<select class="form-select" ${idAttr}>
        ${STORE_LOCATIONS.map(l => `<option value="${l}"${l === selectedValue ? ' selected' : ''}>${l}</option>`).join('')}
    </select>`;
}

async function loadCompetitors() {
    const container = document.getElementById('competitorsList');
    if (!container) return;
    try {
        const resp = await fetch('/api/stores', { credentials: 'include' });
        if (!resp.ok) return;
        const stores = await resp.json();
        if (!stores.length) { container.innerHTML = '<p class="text-muted text-sm">Нет конкурентов</p>'; return; }
        let html = `<table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
            <thead><tr style="border-bottom:2px solid var(--border-soft);">
                <th style="padding:6px 4px;text-align:left;color:var(--text-muted);font-weight:600;width:32px;">ID</th>
                <th style="padding:6px 4px;text-align:left;color:var(--text-muted);font-weight:600;">Название</th>
                <th style="padding:6px 4px;text-align:left;color:var(--text-muted);font-weight:600;">Домен</th>
                <th style="padding:6px 4px;text-align:left;color:var(--text-muted);font-weight:600;">Расположение</th>
                <th style="padding:6px 4px;width:80px;"></th>
            </tr></thead><tbody>`;
        for (const s of stores) {
            html += `<tr style="border-bottom:1px solid var(--border-soft);" id="storeRow_${s.id}">
                <td style="padding:6px 4px;color:var(--text-muted);">#${s.id}</td>
                <td style="padding:6px 4px;"><input class="form-input" id="storeName_${s.id}" value="${s.name}" style="font-size:0.8rem;padding:3px 6px;height:28px;"></td>
                <td style="padding:6px 4px;"><input class="form-input" id="storeDomain_${s.id}" value="${s.domain}" style="font-size:0.8rem;padding:3px 6px;height:28px;"></td>
                <td style="padding:6px 4px;">${locationSelect(s.location || 'Торговая сеть', `id="storeLoc_${s.id}"`)}</td>
                <td style="padding:6px 4px;white-space:nowrap;">
                    <button class="btn btn-primary btn-sm" style="font-size:0.7rem;padding:3px 8px;margin-right:4px;" onclick="window.saveCompetitor(${s.id})"><i class="fa-solid fa-floppy-disk"></i></button>
                    <button class="btn btn-secondary btn-sm" style="font-size:0.7rem;padding:3px 8px;color:var(--danger);" onclick="window.deleteCompetitor(${s.id}, '${s.name.replace(/'/g, "\\'")}')"><i class="fa-solid fa-trash-can"></i></button>
                </td>
            </tr>`;
        }
        html += '</tbody></table>';
        container.innerHTML = html;
        initCustomDropdowns();
    } catch (err) { console.error('Competitors load error:', err); }
}

window.createCompetitor = async () => {
    const name = document.getElementById('newStoreName')?.value?.trim();
    const domain = document.getElementById('newStoreDomain')?.value?.trim();
    const location = document.getElementById('newStoreLocation')?.value || 'Торговая сеть';
    const resultDiv = document.getElementById('competitorCreateResult');
    if (!name || !domain) {
        if (resultDiv) resultDiv.innerHTML = '<span style="color:var(--danger);">Заполните название и домен</span>';
        return;
    }
    try {
        const r = await fetch('/api/stores', {
            method: 'POST', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, domain, location })
        });
        const data = await r.json();
        if (r.ok && data.status === 'success') {
            if (resultDiv) resultDiv.innerHTML = `<span style="color:var(--success);">Конкурент "${name}" добавлен</span>`;
            document.getElementById('newStoreName').value = '';
            document.getElementById('newStoreDomain').value = '';
            document.getElementById('newStoreLocation').value = 'Торговая сеть';
            loadCompetitors();
            loadStoreColors();
        } else {
            if (resultDiv) resultDiv.innerHTML = `<span style="color:var(--danger);">${data.detail || data.message || 'Ошибка'}</span>`;
        }
    } catch (e) {
        if (resultDiv) resultDiv.innerHTML = `<span style="color:var(--danger);">Ошибка: ${e.message}</span>`;
    }
};

window.saveCompetitor = async (id) => {
    const name = document.getElementById(`storeName_${id}`)?.value?.trim();
    const domain = document.getElementById(`storeDomain_${id}`)?.value?.trim();
    const location = document.getElementById(`storeLoc_${id}`)?.value || 'Торговая сеть';
    if (!name || !domain) { alert('Название и домен не могут быть пустыми'); return; }
    try {
        const r = await fetch(`/api/stores/${id}`, {
            method: 'PUT', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, domain, location })
        });
        const data = await r.json();
        if (r.ok) { loadStoreColors(); }
        else alert(data.detail || 'Ошибка сохранения');
    } catch (e) { alert('Ошибка: ' + e.message); }
};

window.deleteCompetitor = async (id, name) => {
    if (!confirm(`Удалить конкурента "${name}"?\nЭто невозможно, если к нему привязаны товары.`)) return;
    try {
        const r = await fetch(`/api/stores/${id}`, { method: 'DELETE', credentials: 'include' });
        const data = await r.json();
        if (r.ok) { loadCompetitors(); loadStoreColors(); }
        else alert(data.detail || 'Ошибка удаления');
    } catch (e) { alert('Ошибка: ' + e.message); }
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
<div class="subtitle">Сформирован: ${now} &bull; Аллея Мебели (alleyadoma.ru)</div>
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
<div class="subtitle">Сформирован: ${now} &bull; Аллея Мебели (alleyadoma.ru)</div>
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
