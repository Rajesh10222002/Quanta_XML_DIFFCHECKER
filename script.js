class SchemaComparator {
    constructor() {
        this.files = { schema1: null, schema2: null };
        this.results = null;
        this.currentView = 'differences';
        this.initializeEventListeners();
    }

    initializeEventListeners() {
        ['upload1', 'upload2'].forEach((id, index) => {
            const uploadZone = document.getElementById(id);
            const fileInput = document.getElementById(`file${index + 1}`);

            uploadZone.addEventListener('click', () => fileInput.click());
            uploadZone.addEventListener('dragover', this.handleDragOver.bind(this));
            uploadZone.addEventListener('drop', (e) => this.handleFileDrop(e, index + 1));
            uploadZone.addEventListener('dragleave', this.handleDragLeave.bind(this));

            fileInput.addEventListener('change', (e) => this.handleFileSelect(e, index + 1));
        });

        document.getElementById('compareBtn').addEventListener('click', this.compareSchemas.bind(this));

        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', (e) => this.switchTab(e.currentTarget.dataset.tab));
        });

        document.querySelectorAll('.toggle-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const view = e.currentTarget.dataset.view;
                this.currentView = view;

                document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');

                const activeTab = document.querySelector('.tab.active');
                if (activeTab) {
                    this.renderTabContent(activeTab.dataset.tab, this.results[activeTab.dataset.tab]);
                }
            });
        });
    }

    handleDragOver(e) {
        e.preventDefault();
        e.currentTarget.classList.add('dragover');
    }

    handleDragLeave(e) {
        e.preventDefault();
        e.currentTarget.classList.remove('dragover');
    }

    handleFileDrop(e, fileNumber) {
        e.preventDefault();
        e.currentTarget.classList.remove('dragover');

        const files = e.dataTransfer.files;
        if (files.length > 0 && files[0].name.endsWith('.zip')) {
            this.processFile(files[0], fileNumber);
        }
    }

    handleFileSelect(e, fileNumber) {
        const file = e.target.files[0];
        if (file && file.name.endsWith('.zip')) {
            this.processFile(file, fileNumber);
        }
    }

    processFile(file, fileNumber) {
        this.files[`schema${fileNumber}`] = file;

        const fileInfo = document.getElementById(`fileInfo${fileNumber}`);
        const fileName = document.getElementById(`fileName${fileNumber}`);
        const fileSize = document.getElementById(`fileSize${fileNumber}`);

        document.getElementById(`upload${fileNumber}`).classList.add('uploaded');
        fileName.textContent = file.name;
        fileSize.textContent = this.formatFileSize(file.size);
        fileInfo.classList.add('show');

        this.updateCompareButton();
    }

    formatFileSize(bytes) {
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    updateCompareButton() {
        const compareBtn = document.getElementById('compareBtn');
        compareBtn.disabled = !(this.files.schema1 && this.files.schema2);
    }

    async compareSchemas() {
        const loading = document.getElementById('loading');
        const results = document.getElementById('results');
        loading.classList.add('show');
        results.classList.remove('show');

        try {
            const schema1Data = await this.parseSchemaZip(this.files.schema1);
            const schema2Data = await this.parseSchemaZip(this.files.schema2);
            this.results = this.generateComparison(schema1Data, schema2Data);
            this.displayResults();
        } catch (error) {
            console.error('Comparison failed:', error);
            this.showError('Error comparing schemas. Please check the file formats.');
        } finally {
            loading.classList.remove('show');
        }
    }

    showError(message) {
        const loading = document.getElementById('loading');
        loading.innerHTML = `
            <div class="loading-content">
                <div class="error-icon">
                    <i class="fas fa-exclamation-triangle"></i>
                </div>
                <div class="error-text">${message}</div>
            </div>
        `;
    }

    async parseSchemaZip(file) {
        const zip = await JSZip.loadAsync(file);
        let schemaXml = null;
        for (const filename in zip.files) {
            if (filename.includes('_schema.xml')) {
                schemaXml = await zip.files[filename].async('text');
                break;
            }
        }
        if (!schemaXml) throw new Error('No schema XML file found');
        return this.parseXML(schemaXml);
    }

    parseXML(xmlString) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlString, 'text/xml');
        const result = { tables: [], columns: [], joins: [] };

        const tables = doc.querySelectorAll('tables table');
        tables.forEach(table => {
            const tableData = { name: table.getAttribute('name') };
            Array.from(table.attributes).forEach(attr => tableData[attr.name] = attr.value);
            result.tables.push(tableData);

            const columns = table.querySelectorAll('column');
            columns.forEach(column => {
                const columnData = {
                    table: table.getAttribute('name'),
                    name: column.getAttribute('name')
                };
                Array.from(column.attributes).forEach(attr => columnData[attr.name] = attr.value);
                if (column.getAttribute('formula')) columnData.type = 'formula';
                result.columns.push(columnData);
            });
        });

        const joins = doc.querySelectorAll('joins join');
        joins.forEach(join => {
            const cond = join.querySelector('cond');
            if (cond) {
                const joinData = { join_name: join.getAttribute('name') };
                Array.from(join.attributes).forEach(attr => joinData[attr.name] = attr.value);
                Array.from(cond.attributes).forEach(attr => joinData[attr.name] = attr.value);
                result.joins.push(joinData);
            }
        });

        return result;
    }

    generateComparison(schema1, schema2) {
        const results = {};
        ['tables', 'columns', 'joins'].forEach(type => {
            const keyField = type === 'tables' ? 'name' :
                type === 'columns' ? ['table', 'name'] : ['join_name', 'leftColumn', 'rightColumn', 'operator'];

            const diffs = this.compareArrays(schema1[type], schema2[type], keyField);
            diffs.similar = this.findSimilar(schema1[type], schema2[type], keyField);
            results[type] = diffs;
        });
        return results;
    }

    compareArrays(arr1, arr2, keyField) {
        const getKey = item => Array.isArray(keyField) ? keyField.map(k => item[k]).join('.') : item[keyField];

        const map1 = new Map(arr1.map(item => [getKey(item), item]));
        const map2 = new Map(arr2.map(item => [getKey(item), item]));

        const added = arr2.filter(item => !map1.has(getKey(item)));
        const removed = arr1.filter(item => !map2.has(getKey(item)));
        const changed = [];

        for (const [key, item1] of map1.entries()) {
            const item2 = map2.get(key);
            if (item2 && !this.deepEqual(item1, item2)) {
                changed.push({ old: item1, new: item2 });
            }
        }

        return { added, removed, changed };
    }

    findSimilar(arr1, arr2, keyField) {
        const getKey = item => Array.isArray(keyField) ? keyField.map(k => item[k]).join('.') : item[keyField];
        const map1 = new Map(arr1.map(item => [getKey(item), item]));
        const map2 = new Map(arr2.map(item => [getKey(item), item]));

        return Array.from(map1.entries()).filter(([key, item1]) =>
            map2.has(key) && this.deepEqual(item1, map2.get(key))
        ).map(([_, item]) => item);
    }

    normalizeValue(value) {
        if (value === undefined || value === null) return '';
        if (typeof value === 'string') {
            return value.trim().toLowerCase()
                .replace(/\s*\.\s*/g, '.')
                .replace(/\s*\(\s*/g, '(')
                .replace(/\s*\)\s*/g, ')')
                .replace(/\s+/g, ' ');
        }
        return typeof value === 'object' ? JSON.stringify(value) : value.toString().toLowerCase();
    }

    deepEqual(a, b) {
        if (a === b) return true;
        if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) {
            return this.normalizeValue(a) === this.normalizeValue(b);
        }

        const allKeys = new Set([...Object.keys(a), ...Object.keys(b)]);
        for (const key of allKeys) {
            if (!this.deepEqual(a[key], b[key])) return false;
        }
        return true;
    }

    getPropertyChanges(oldObj, newObj) {
        const allKeys = new Set([...Object.keys(oldObj), ...Object.keys(newObj)]);
        return Array.from(allKeys).map(key => {
            if (!this.deepEqual(oldObj[key], newObj[key])) {
                return { key, oldValue: oldObj[key], newValue: newObj[key] };
            }
            return null;
        }).filter(Boolean);
    }


    displayResults() {
        const results = document.getElementById('results');
        const summary = document.getElementById('summary');

        let totalAdded = 0, totalRemoved = 0, totalChanged = 0, totalSimilar = 0;
        Object.values(this.results).forEach(result => {
            totalAdded += result.added.length;
            totalRemoved += result.removed.length;
            totalChanged += result.changed.length;
            totalSimilar += result.similar.length;
        });

        summary.innerHTML = `
            <div class="summary-item summary-added">
                <i class="fas fa-plus-circle"></i> +${totalAdded} Added
            </div>
            <div class="summary-item summary-removed">
                <i class="fas fa-minus-circle"></i> -${totalRemoved} Removed
            </div>
            <div class="summary-item summary-changed">
                <i class="fas fa-exchange-alt"></i> ~${totalChanged} Changed
            </div>
            <div class="summary-item summary-similar">
                <i class="fas fa-check-circle"></i> =${totalSimilar} Similar
            </div>
        `;

        ['tables', 'columns', 'joins'].forEach(type => {
            this.renderTabContent(type, this.results[type]);
        });

        results.classList.add('show');
    }

    renderTabContent(type, data) {
        const container = document.getElementById(type);
        const view = this.currentView;

        if (view === 'similarities') {
            container.innerHTML = this.renderDiffSection('Similar', data.similar, 'similar', 'check-circle', 'primary');
        } else {
            container.innerHTML = `
                ${this.renderDiffSection('Added', data.added, 'added', 'plus-circle', 'success')}
                ${this.renderDiffSection('Removed', data.removed, 'removed', 'minus-circle', 'danger')}
                ${this.renderDiffSection('Changed', data.changed, 'changed', 'exchange-alt', 'warning')}
            `;
        }

        container.querySelectorAll('.diff-header').forEach(header => {
            header.addEventListener('click', () => {
                header.classList.toggle('active');
                header.nextElementSibling.classList.toggle('expanded');
            });
        });
    }

    renderDiffSection(title, items, type, icon, color) {
        if (items.length === 0) return '';
        return `
        <div class="diff-section">
            <div class="diff-header">
                <i class="fas fa-chevron-right diff-icon"></i>
                <div class="diff-title"><i class="fas fa-${icon} text-${color}"></i> ${title}</div>
                <div class="diff-count ${type}">${items.length}</div>
            </div>
            <div class="diff-content">
                <div class="table-container">
                    ${this.renderDiffTable(items, type)}
                </div>
            </div>
        </div>
    `;
    }


    renderDiffTable(items, type) {
        if (type === 'changed') return this.renderChangedTable(items);

        const keys = this.getObjectKeys(items[0]);
        return `
            <table class="diff-table">
                <thead><tr>${keys.map(k => `<th>${this.formatHeader(k)}</th>`).join('')}</tr></thead>
                <tbody>
                    ${items.map(item => `
                        <tr class="diff-item ${type}">
                            ${keys.map(k => `<td>${this.formatValue(item[k])}</td>`).join('')}
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
    }

    renderChangedTable(items) {
        if (!items || items.length === 0) return '<div class="no-changes">No changes found</div>';

        const isColumnChange = items[0]?.old?.table && items[0]?.old?.name;

        // Render for columns: table + column + property + old + new
        if (isColumnChange) {
            return `
            <table class="diff-table">
                <thead>
                    <tr>
                        <th>Table</th>
                        <th>Column</th>
                        <th>Property</th>
                        <th>Old Value</th>
                        <th>New Value</th>
                    </tr>
                </thead>
                <tbody>
                    ${items.map(item => {
                const tableName = item.old?.table || item.new?.table || '-';
                const columnName = item.old?.name || item.new?.name || '-';
                return this.getPropertyChanges(item.old, item.new).map(change => `
                            <tr class="diff-item changed">
                                <td>${tableName}</td>
                                <td>${columnName}</td>
                                <td>${this.formatHeader(change.key)}</td>
                                <td>${this.formatValue(change.oldValue)}</td>
                                <td>${this.formatValue(change.newValue)}</td>
                            </tr>
                        `).join('');
            }).join('')}
                </tbody>
            </table>
        `;
        }

        // Render for tables: table + property + old + new
        return `
        <table class="diff-table">
            <thead>
                <tr>
                    <th>Table</th>
                    <th>Property</th>
                    <th>Old Value</th>
                    <th>New Value</th>
                </tr>
            </thead>
            <tbody>
                ${items.map(item => {
            const tableName = item.old?.name || item.new?.name || '-';
            return this.getPropertyChanges(item.old, item.new).map(change => `
                        <tr class="diff-item changed">
                            <td>${tableName}</td>
                            <td>${this.formatHeader(change.key)}</td>
                            <td>${this.formatValue(change.oldValue)}</td>
                            <td>${this.formatValue(change.newValue)}</td>
                        </tr>
                    `).join('');
        }).join('')}
            </tbody>
        </table>
    `;
    }



    getObjectKeys(obj) {
        return Object.keys(obj).filter(k => k !== 'type' && typeof obj[k] !== 'object');
    }

    formatHeader(key) {
        return key.split('_').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
    }

    formatValue(value) {
        if (value === undefined || value === null) return '-';
        if (typeof value === 'boolean') return value ? 'Yes' : 'No';
        return value.toString();
    }

    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });

        // Move tab indicator
        const activeTab = document.querySelector(`.tab[data-tab="${tabName}"]`);
        const tabIndicator = document.querySelector('.tab-indicator');
        if (activeTab && tabIndicator) {
            tabIndicator.style.width = `${activeTab.offsetWidth}px`;
            tabIndicator.style.left = `${activeTab.offsetLeft}px`;
        }

        // Show correct tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.toggle('active', content.id === tabName);
        });

        // Rerender current tab view
        if (this.results && this.results[tabName]) {
            this.renderTabContent(tabName, this.results[tabName]);
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    new SchemaComparator();
    const activeTab = document.querySelector('.tab.active');
    const tabIndicator = document.querySelector('.tab-indicator');
    if (activeTab && tabIndicator) {
        tabIndicator.style.width = `${activeTab.offsetWidth}px`;
        tabIndicator.style.left = `${activeTab.offsetLeft}px`;
    }
});
