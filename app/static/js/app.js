// Core Event System
class EventEmitter {
    constructor() {
        this.events = {};
    }

    on(event, callback) {
        if (!this.events[event]) {
            this.events[event] = [];
        }
        this.events[event].push(callback);
    }

    emit(event, data) {
        if (!this.events[event]) return;
        this.events[event].forEach(callback => callback(data));
    }
}

// Base Component
class Component {
    constructor(element) {
        this.element = element;
        this.events = new EventEmitter();
    }

    createElement(tag, className = '') {
        const element = document.createElement(tag);
        if (className) element.className = className;
        return element;
    }

    destroy() {
        this.element.remove();
    }
}

class FileBasket {
    constructor() {
        this.files = new Map();
        this.drivefiles = new Map();
        this.uploadQueue = [];
        this.totalSize = 0;
        this.maxBatchSize = 20 * 1024 * 1024; // 20MB
        this.maxConcurrent = 10;
    }

    addFiles(fileList) {
        let duplicates = 0;
        Array.from(fileList).forEach(file => {
            if (!this.drivefiles.has(file.name) && !this.files.has(file.name)) {
                this.files.set(file.name, {
                    file: file,
                    lastModified: file.lastModified,
                    status: 'pending'
                });
                this.uploadQueue.push(file.name);
                this.totalSize += file.size;
            } else {
                duplicates++;
            }
        });

        return {
            fileNames: this.getFileNames(),
            duplicates: duplicates
        };
    }

    addDriveFiles(driveFiles) {
        let duplicates = 0;
        Array.from(driveFiles).forEach(file => {
            if (!this.drivefiles.has(file.name) && !this.files.has(file.name)) {
                this.drivefiles.set(file.name, {
                    fileId: file.id,
                    name: file.name,
                    mimeType: file.mimeType,
                    status: 'pending'
                });
                this.uploadQueue.push(file.name);
                this.totalSize += file.size;
            } else {
                duplicates++;
            }
        });

        return {
            fileNames: this.getFileNames(),
            duplicates: duplicates
        };
    }

    getBatch() {
        let currentBatchSize = 0;
        const batch = [];
        
        while (this.uploadQueue.length > 0 && batch.length < this.maxConcurrent) {
            const fileName = this.uploadQueue[0];
            const fileInfo = this.files.get(fileName) || this.drivefiles.get(fileName);
            
            if (!fileInfo) {
                this.uploadQueue.shift(); // Remove invalid file from queue
                continue;
            }

            if (this.drivefiles.has(fileName)) {
                batch.push(this.uploadQueue.shift());
                continue;
            }

            if (currentBatchSize + fileInfo.file.size > this.maxBatchSize) {
                break;
            }
            
            batch.push(this.uploadQueue.shift());
            currentBatchSize += fileInfo.file.size;
        }
        
        return batch;
    }

    getFileFormData(fileName) {
        const localFile = this.files.get(fileName);
    if (localFile) {
        const formData = new FormData();
        formData.append('file', localFile.file);
        formData.append('lastModified', localFile.lastModified);
        return formData;
    }

    // Check drive files
    const driveFile = this.drivefiles.get(fileName);
    if (driveFile) {
        const formData = new FormData();
        const accessToken = document.cookie
        .split('; ')
        .find(row => row.startsWith('drive_access_token='))
        ?.split('=')[1];
        
        formData.append('driveFileId', driveFile.fileId);
        formData.append('driveFileName', driveFile.name);
        formData.append('lastModified', String(Date.now()));
        formData.append('accessToken', accessToken);

        return formData;
    }

    return null;
    }

    removeFile(fileName) {
        const fileInfo = this.files.get(fileName);
        if (fileInfo) {
            this.totalSize -= fileInfo.file.size;
            this.files.delete(fileName);
            const queueIndex = this.uploadQueue.indexOf(fileName);
            if (queueIndex > -1) {
                this.uploadQueue.splice(queueIndex, 1);
            }
            this.updateSourceCount();
            return true;
        }
        return false;
    }

    getFileNames() {
        const regularFiles = Array.from(this.files.keys());
        const driveFiles = Array.from(this.drivefiles.keys());
        return [...regularFiles, ...driveFiles];
    }

    hasFilesToUpload() {
        return this.uploadQueue.length > 0;
    }

    getFileStatus(fileName) {
        return this.files.get(fileName)?.status || null;
    }

    updateFileStatus(fileName, status) {
        const fileInfo = this.files.get(fileName);
        if (fileInfo) {
            fileInfo.status = status;
            return true;
        }
        return false;
    }

    clear() {
        this.files.clear();
        this.uploadQueue = [];
        this.totalSize = 0;
    }
}

// Domain Manager (Storage)
class DomainManager {
    constructor() {
        this.domains = new Map();
        this.selectedDomainId = null;
        this.events = new EventEmitter();
    }

    getDomain(domainId) {
        return this.domains.get(domainId);
    }

    async addDomain(domain) {
        const domainData = {
            id: domain.id,
            name: domain.name,
            fileCount: domain.files?.length || 0,
            files: domain.files || [],
            fileIDS: domain.fileIDS || []
        };
    
        const domainCard = new DomainCard(domainData);
        this.domains.set(domain.id, { data: domainData, component: domainCard });
        return domainCard;
    }

    getAllDomains() {
        return Array.from(this.domains.values()).map(entry => ({
            id: entry.data.id,
            name: entry.data.name,
            fileCount: entry.data.fileCount,
            files: entry.data.files,
            fileIDS: entry.data.fileIDS
        }));
    }

    updateDomainFileCount(domainId) {
        const domain = this.domains.get(domainId);
        if (domain) {
            // Update fileCount based on current files array length
            domain.data.fileCount = domain.data.files.length;
            
            // Update the domain card display
            if (domain.component) {
                const fileCountElement = domain.component.element.querySelector('.file-count');
                if (fileCountElement) {
                    fileCountElement.textContent = `${domain.data.fileCount} files`;
                }
            }
            
            // Emit an event for other components that might need this update
            this.events.emit('domainFileCountUpdated', {
                domainId: domainId,
                newCount: domain.data.fileCount
            });
        }
    }

    // Single method to handle selection state
    selectDomain(domainId) {
        // Deselect previous
        if (this.selectedDomainId) {
            const previous = this.domains.get(this.selectedDomainId);
            if (previous) {
                previous.component.setSelected(false);
            }
        }

        // Select new
        const domain = this.domains.get(domainId);
        if (domain) {
            domain.component.setSelected(true);
            this.selectedDomainId = domainId;
        }
    }

    getSelectedDomain() {
        if (!this.selectedDomainId) return null;
        return this.domains.get(this.selectedDomainId);
    }

    clearSelection() {
        if (this.selectedDomainId) {
            const previous = this.domains.get(this.selectedDomainId);
            if (previous) {
                previous.component.setSelected(false);
            }
            this.selectedDomainId = null;
        }
    }

    renameDomain(domainId, newName) {
        const domain = this.domains.get(domainId);
        if (domain) {
            domain.data.name = newName;
            return true;
        }
        return false;
    }

    deleteDomain(domainId) {
        const wasSelected = this.selectedDomainId === domainId;
        const success = this.domains.delete(domainId);
        if (success && wasSelected) {
            this.selectedDomainId = null;
        }
        return success;
    }
}

// Domain Card Component
class DomainCard extends Component {
    constructor(domainData) {
        const element = document.createElement('div');
        element.className = 'domain-card';
        super(element);
        
        this.data = domainData;
        this.render();
        this.attachEventListeners();
    }

    render() {
        this.element.innerHTML = `
            <div class="domain-content">
                <div class="checkbox-wrapper">
                    <input type="checkbox" id="${this.data.id}" class="domain-checkbox">
                    <label for="${this.data.id}" class="checkbox-label"></label>
                </div>
                <div class="domain-info">
                    <h6 title="${this.data.name}">${this.data.name}</h6>
                    <span class="file-count">${this.data.fileCount || 0} files</span>
                </div>
            </div>
        `;
    }

    attachEventListeners() {
        const checkbox = this.element.querySelector('.domain-checkbox');
        checkbox.addEventListener('change', () => {
            this.events.emit('selected', {
                id: this.data.id,
                selected: checkbox.checked
            });
        });
    }

    setSelected(selected) {
        const checkbox = this.element.querySelector('.domain-checkbox');
        checkbox.checked = selected;
    }
}

class DomainSettingsModal extends Component {
    constructor(domainManager) {
        const element = document.createElement('div');
        element.id = 'domainSelectModal';
        element.className = 'modal fade';
        element.setAttribute('tabindex', '-1');
        element.setAttribute('aria-hidden', 'true');
        super(element);
        
        this.domainManager = domainManager;
        this.domainToDelete = null;
        this.deleteModal = null;
        this.temporarySelectedId = null;
        this.render();
        this.initializeDeleteModal();
        this.setupEventListeners();
    }

    render() {
        this.element.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="domain-modal-wrapper">
                        <div class="domain-header">
                            <h5>Select Knowledge Base</h5>
                            <button type="button" class="close-button" data-bs-dismiss="modal">
                                <i class="bi bi-x"></i>
                            </button>
                        </div>
                        <div class="limit-indicator mb-4">
                            <div class="d-flex justify-content-between align-items-center mb-2">
                                <small class="text-secondary">Knowledge Base Limit</small>
                                <small class="text-secondary domains-count">0/3</small>
                            </div>
                            <div class="progress" style="height: 6px; background: rgba(255, 255, 255, 0.1);">
                                <div class="progress-bar bg-primary-green" style="width: 0%"></div>
                            </div>
                        </div>
                        <div class="domain-search">
                            <i class="bi bi-search"></i>
                            <input type="text" placeholder="Search..." class="domain-search-input" id="domainSearchInput">
                        </div>

                        <div class="domains-container" id="domainsContainer">
                            <!-- Domains will be populated here -->
                        </div>

                        <button class="new-domain-button" id="newDomainBtn">
                            <i class="bi bi-plus-circle"></i>
                            Create New
                        </button>

                        <button class="select-button">
                            Select
                        </button>
                    </div>
                </div>
            </div>

            <!-- Delete Confirmation Modal -->
            <div class="modal fade" id="deleteConfirmModal" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered modal-sm">
                    <div class="modal-content">
                        <div class="domain-modal-wrapper text-center">
                            <h6 class="mb-3">Delete Knowledge Base?</h6>
                            <p class="text-secondary mb-4">Are you sure you want to delete this domain?</p>
                            <div class="d-flex gap-3">
                                <button class="btn btn-outline-secondary flex-grow-1" data-bs-dismiss="modal">Cancel</button>
                                <button class="btn btn-danger flex-grow-1" id="confirmDeleteBtn">Delete</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Template for new domain input -->
            <template id="newDomainInputTemplate">
                <div class="domain-card new-domain-input-card">
                    <input type="text" class="new-domain-input" placeholder="Enter name" autofocus>
                    <div class="new-domain-actions">
                        <button class="confirm-button"><i class="bi bi-check"></i></button>
                        <button class="cancel-button"><i class="bi bi-x"></i></button>
                    </div>
                </div>
            </template>
        `;

        this.element.innerHTML += `
            <div class="modal fade" id="defaultDomainInfoModal" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-dialog-centered modal-sm">
                    <div class="modal-content">
                        <div class="domain-modal-wrapper text-center">
                            <h6 class="mb-3">I can't do it...</h6>
                            <p class="text-secondary mb-4" id="domainInfoMessage"></p>
                            <div class="d-flex justify-content-center">
                                <button class="btn" style="background-color: #10B981; color: #fff;" data-bs-dismiss="modal">Got it</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(this.element);
    }

    setupEventListeners() {
        // Search functionality
        const searchInput = this.element.querySelector('#domainSearchInput');
        searchInput?.addEventListener('input', (e) => {
            this.events.emit('domainSearch', e.target.value);
        });

        // New domain button
        const newDomainBtn = this.element.querySelector('#newDomainBtn');
        newDomainBtn?.addEventListener('click', () => {
            this.handleNewDomain();
        });

        // Domain deletion
        this.domainManager.events.on('domainFileCountUpdated', ({ domainId, newCount }) => {
            const domainCard = this.element.querySelector(`[data-domain-id="${domainId}"]`);
            if (domainCard) {
                const fileCountElement = domainCard.querySelector('.file-count');
                if (fileCountElement) {
                    fileCountElement.textContent = `${newCount} files`;
                }
            }
        });

        // Select button
        const selectButton = this.element.querySelector('.select-button');
        selectButton?.addEventListener('click', () => {
            if (this.temporarySelectedId) {
                this.events.emit('domainSelected', this.temporarySelectedId);
                this.hide();
            }
        });

        // Close button
        const closeButton = this.element.querySelector('.close-button');
        closeButton?.addEventListener('click', () => {
            this.resetTemporarySelection();
            this.hide();
        });

        // Handle modal hidden event
        this.element.addEventListener('hidden.bs.modal', () => {
            this.resetTemporarySelection();
        });
    }

    createDomainCard(domain) {
        return `
            <div class="domain-card" data-domain-id="${domain.id}">
                <div class="domain-content">
                    <div class="checkbox-wrapper">
                        <input type="checkbox" id="domain-${domain.id}" class="domain-checkbox">
                        <label for="domain-${domain.id}" class="checkbox-label"></label>
                    </div>
                    <div class="domain-info">
                        <h6 title="${domain.name}">${domain.name}</h6>
                        <span class="file-count">${domain.fileCount} files</span>
                    </div>
                </div>
                <div class="domain-actions">
                    <button class="edit-button">
                        <i class="bi bi-pencil"></i>
                    </button>
                    <button class="delete-button">
                        <i class="bi bi-trash3"></i>
                    </button>
                </div>
            </div>
        `;
    }

    setupDomainCardListeners() {
        this.element.querySelectorAll('.domain-card').forEach(card => {
            if (card.classList.contains('new-domain-input-card')) return;

            const domainId = card.dataset.domainId;
            const checkbox = card.querySelector('.domain-checkbox');
            
            // Handle entire card click for selection
            card.addEventListener('click', (e) => {
                if (!e.target.closest('.domain-actions') && !e.target.closest('.checkbox-wrapper')) {
                    checkbox.checked = !checkbox.checked;
                    this.handleDomainSelection(checkbox, domainId);
                }
            });

            // Handle checkbox click
            checkbox?.addEventListener('change', (e) => {
                e.stopPropagation();
                this.handleDomainSelection(checkbox, domainId);
            });

            // Delete button
            card.querySelector('.delete-button')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.domainToDelete = domainId;
                this.showDomainDeleteModal();
            });

            // Edit button
            card.querySelector('.edit-button')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.enableDomainEditing(card);
            });
        });
    }

    handleDomainSelection(checkbox, domainId) {
        // Uncheck all other checkboxes
        this.element.querySelectorAll('.domain-checkbox').forEach(cb => {
            if (cb !== checkbox) {
                cb.checked = false;
            }
        });

        // Update temporary selection
        this.temporarySelectedId = checkbox.checked ? domainId : null;
    }

    resetTemporarySelection() {
        this.temporarySelectedId = null;
        this.element.querySelectorAll('.domain-checkbox').forEach(cb => {
            cb.checked = false;
        });
    }

    handleNewDomain() {
        const template = document.getElementById('newDomainInputTemplate');
        const domainsContainer = this.element.querySelector('#domainsContainer');
        
        if (template && domainsContainer) {
            const clone = template.content.cloneNode(true);
            domainsContainer.appendChild(clone);

            const inputCard = domainsContainer.querySelector('.new-domain-input-card');
            const input = inputCard.querySelector('.new-domain-input');
            
            this.setupNewDomainHandlers(inputCard, input);
            input.focus();
        }
    }

    setupNewDomainHandlers(inputCard, input) {
        const confirmBtn = inputCard.querySelector('.confirm-button');
        const cancelBtn = inputCard.querySelector('.cancel-button');
    
        const handleConfirm = async () => {
            const name = input.value.trim();
            if (name) {
                if (name.length > 20) {                  
                    const alertElement = document.createElement('div');
                    alertElement.className = 'alert-modal';
                    alertElement.innerHTML = `
                        <div class="alert-content">
                            <h5 class="alert-title">I can't do it...</h5>
                            <p class="alert-message">Knowledge Base name must be 20 characters or less. Please try again with a shorter name!</p>
                            <button class="alert-button" style="background-color: #10B981">Got it</button>
                        </div>
                    `;
    
                    document.body.appendChild(alertElement);
                    
                    const closeButton = alertElement.querySelector('.alert-button');
                    closeButton.addEventListener('click', () => {
                        alertElement.classList.remove('show');
                        document.body.style.overflow = '';
                        setTimeout(() => alertElement.remove(), 300);
                    });
    
                    requestAnimationFrame(() => {
                        alertElement.classList.add('show');
                        document.body.style.overflow = 'hidden';
                    });
                    
                    return;
                }
    
                const result = await window.createDomain(window.serverData.userId, name);
                if (result.success) {
                    this.events.emit('domainCreate', {
                        id: result.id,
                        name: name
                    });
                    this.updateDomainCount();
                    inputCard.remove();
                } else {
                    if (result.message && result.message.includes('up to 3 domains')) {
                        const alertElement = document.createElement('div');
                        alertElement.className = 'alert-modal';
                        alertElement.innerHTML = `
                            <div class="alert-content">
                                <div class="alert-icon">
                                    <i class="bi bi-exclamation-circle text-primary-green"></i>
                                </div>
                                <h5 class="alert-title">Knowledge Base Limit Reached</h5>
                                <p class="alert-message">${result.message}</p>
                                <div class="domain-count mt-3 text-secondary">
                                    <small>Domains Used: ${this.domainManager.getAllDomains().length}/3</small>
                                </div>
                                <button class="alert-button">Got it</button>
                            </div>
                        `;

                        document.body.appendChild(alertElement);

                        const closeButton = alertElement.querySelector('.alert-button');
                        closeButton.addEventListener('click', () => {
                            alertElement.classList.remove('show');
                            document.body.style.overflow = '';
                            setTimeout(() => alertElement.remove(), 100);
                        });
        
                        requestAnimationFrame(() => {
                            alertElement.classList.add('show');
                            document.body.style.overflow = 'hidden';
                        });
                        
                    } else {
                        this.events.emit('warning', 'Failed to create knowledge base. Please try again.');
                    }
                    inputCard.remove(); 
                }
            }
        };
    
        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', () => inputCard.remove());
        
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleConfirm();
        });
        
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') inputCard.remove();
        });
    }

    async enableDomainEditing(card) {
        const domainInfo = card.querySelector('.domain-info');
        const domainNameElement = domainInfo.querySelector('h6');
        const currentName = domainNameElement.getAttribute('title') || domainNameElement.textContent;
        const domainId = card.dataset.domainId;
    
        const wrapper = document.createElement('div');
        wrapper.className = 'domain-name-input-wrapper';
        wrapper.innerHTML = `
            <input type="text" class="domain-name-input" value="${currentName}" maxlength="20">
            <div class="domain-edit-actions">
                <button class="edit-confirm-button"><i class="bi bi-check"></i></button>
                <button class="edit-cancel-button"><i class="bi bi-x"></i></button>
            </div>
        `;
    
        const input = wrapper.querySelector('.domain-name-input');
        const confirmBtn = wrapper.querySelector('.edit-confirm-button');
        const cancelBtn = wrapper.querySelector('.edit-cancel-button');
    
        const handleConfirm = async () => {
            const newName = input.value.trim();
            if (newName && newName !== currentName) {
                if (newName.length > 20) {
                    this.events.emit('warning', 'Knowledge Base name must be less than 20 characters');
                    return;
                }
        
                const success = await window.renameDomain(domainId, newName);
                
                if (success) {
                    this.events.emit('domainEdit', {
                        id: domainId,
                        newName: newName
                    });
                    wrapper.replaceWith(domainNameElement);
                    domainNameElement.textContent = newName;
                    domainNameElement.setAttribute('title', newName);
                } else {
                    this.events.emit('warning', 'Failed to rename domain');
                }
            } else {
                wrapper.replaceWith(domainNameElement);
            }
        };
    
        confirmBtn.addEventListener('click', handleConfirm);
        cancelBtn.addEventListener('click', () => wrapper.replaceWith(domainNameElement));
        
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') handleConfirm();
        });
        
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') wrapper.replaceWith(domainNameElement);
        });
    
        domainNameElement.replaceWith(wrapper);
        input.focus();
        input.select();
    }

    updateDomainsList(domains) {
        const container = this.element.querySelector('#domainsContainer');
        if (container) {
            container.innerHTML = domains.map(domain => this.createDomainCard(domain)).join('');
            this.setupDomainCardListeners();
        }
    }

    updateDomainCount() {
        const domains = this.domainManager.getAllDomains();
        const count = domains.length;
        const percentage = (count / 3) * 100;
        
        const countElement = this.element.querySelector('.domains-count');
        const progressBar = this.element.querySelector('.progress-bar');
        
        if (countElement && progressBar) {
            countElement.textContent = `${count}/3`;
            progressBar.style.width = `${percentage}%`;
            
        }
    }

    show() {
        const modal = new bootstrap.Modal(this.element);
        this.resetTemporarySelection();
        this.updateDomainCount();
        modal.show();
    }

    hide() {
        const modal = bootstrap.Modal.getInstance(this.element);
        if (modal) {
            modal.hide();
        }
    }

    initializeDeleteModal() {
        const deleteModalElement = document.getElementById('deleteConfirmModal');
        if (deleteModalElement) {
            this.deleteModal = new bootstrap.Modal(deleteModalElement, {
                backdrop: 'static',
                keyboard: false
            });
    
            deleteModalElement.addEventListener('show.bs.modal', () => {
                document.getElementById('domainSelectModal').classList.add('delete-confirmation-open');
            });
    
            deleteModalElement.addEventListener('hidden.bs.modal', () => {
                document.getElementById('domainSelectModal').classList.remove('delete-confirmation-open');
                this.domainToDelete = null; // Clean up on hide
            });
    
            const confirmBtn = deleteModalElement.querySelector('#confirmDeleteBtn');
            confirmBtn?.addEventListener('click', async () => {
                if (this.domainToDelete) {
                    await this.handleDomainDelete(this.domainToDelete);
                    this.domainToDelete = null;
                    this.deleteModal.hide();
                }
            });
    
            const cancelBtn = deleteModalElement.querySelector('.btn-outline-secondary');
            cancelBtn?.addEventListener('click', () => {
                this.domainToDelete = null;
                this.deleteModal.hide();
            });
        }
    }

    showDomainDeleteModal() {
        if (this.deleteModal) {
            this.deleteModal.show();
        }
    }

    hideDomainDeleteModal() {
        if (this.deleteModal) {
            this.deleteModal.hide();
        }
    }

    async handleDomainDelete(domainId) {
        const result = await window.deleteDomain(domainId);
        
        if (result.success) {
            this.events.emit('domainDelete', domainId);
            this.hideDomainDeleteModal();
            this.updateDomainCount();
            this.events.emit('message', {
                text: 'Knowledege Base deleted!',
                type: 'success'
            });
        } else {
            this.hideDomainDeleteModal();
            
            const messageElement = document.getElementById('domainInfoMessage');
            if (messageElement) {
                messageElement.textContent = result.message;
            }
            const infoModal = new bootstrap.Modal(document.getElementById('defaultDomainInfoModal'));
            infoModal.show();
        }
    }
}

class FileUploadModal extends Component {
    constructor(DomainManager) {
        const element = document.createElement('div');
        element.id = 'fileUploadModal';
        element.className = 'modal fade';
        element.setAttribute('tabindex', '-1');
        element.setAttribute('aria-hidden', 'true');
        super(element);
        
        this.isUploading = false;
        this.fileBasket = new FileBasket();
        this.urlInputModal = new URLInputModal()
        this.domainManager = DomainManager;

        this.render();
        this.setupEventListeners();
        this.setupCloseButton();
        this.currentpicker = null;
    }

    render() {
        this.element.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="domain-modal-wrapper">
                        <div class="modal-header border-0 d-flex align-items-center">
                            <div>
                                <h6 class="mb-0">Selected Domain: <span class="domain-name text-primary-green text-truncate"></span></h6>
                            </div>
                            <button type="button" class="close-button" data-bs-dismiss="modal">
                                <i class="bi bi-x"></i>
                            </button>
                        </div>
                        <div class="limit-indicator mt-3">
                            <div class="d-flex justify-content-between align-items-center mb-2">
                                <small class="text-secondary">Total Sources</small>
                                <small class="text-secondary sources-count">0/20</small>
                            </div>
                            <div class="progress" style="height: 6px; background: rgba(255, 255, 255, 0.1);">
                                <div class="progress-bar bg-primary-green" style="width: 0%"></div>
                            </div>
                        </div>
                    </div>

                        <div class="upload-container">
                            <div id="fileList" class="file-list mb-3"></div>

                            <div class="upload-area" id="dropZone">
                                <div class="upload-content text-center">
                                    <div class="upload-icon-wrapper">
                                        <div class="upload-icon">
                                            <i class="bi bi-cloud-upload text-primary-green"></i>
                                        </div>
                                    </div>
                                    <h5 class="mb-2">Upload Files</h5>
                                    <p class="mb-3">Drag & drop or <span class="text-primary-green choose-text">choose files</span> to upload</p>
                                    <small class="text-secondary">Supported file types: PDF, DOCX, XLSX, PPTX, UDF and TXT</small>
                                    <input type="file" id="fileInput" multiple accept=".pdf,.docx,.xlsx,.pptx,,.udf,.txt" class="d-none">
                                </div>
                            </div>

                                 <button class="url-input-btn w-100 mb-2 d-flex align-items-center justify-content-center gap-2">
                                    <i class="bi bi-link-45deg"></i>
                                    Add from URL
                                </button>

                            <button class="upload-btn mt-3" id="uploadBtn" disabled>
                                Upload
                                <div class="upload-progress">
                                    <div class="progress-bar"></div>
                                </div>
                            </button>

                            <div class="upload-loading-overlay" style="display: none">
                                <div class="loading-content">
                                    <div class="spinner-border text-primary-green mb-3" role="status">
                                        <span class="visually-hidden">Loading...</span>
                                    </div>
                                    <h5 class="mb-2">Uploading Files...</h5>
                                    <p class="text-center mb-0">Please wait for ragchat to process your files</p>
                                    <p class="text-center text-secondary">This might take a moment depending on file size</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(this.element);
    }

    setupEventListeners() {
        const dropZone = this.element.querySelector('#dropZone');
        const fileInput = this.element.querySelector('#fileInput');
        const uploadBtn = this.element.querySelector('#uploadBtn');
        const chooseText = this.element.querySelector('.choose-text');
        const uploadIcon = this.element.querySelector('.upload-icon-wrapper');
        const urlButton = this.element.querySelector('.url-input-btn');

        // Drag and drop handlers
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => {
                if (!this.isUploading) {
                    dropZone.classList.add('dragover');
                }
            });
        });

        ['dragleave', 'drop'].forEach(eventName => {
            dropZone.addEventListener(eventName, () => {
                dropZone.classList.remove('dragover');
            });
        });

        // File drop handler
        dropZone.addEventListener('drop', (e) => {
            if (!this.isUploading) {
                const files = e.dataTransfer.files;
                this.handleFiles(files);
            }
        });

        // Icon click handler
        uploadIcon.addEventListener('click', () => {
            if (!this.isUploading) {
                fileInput.click();
            }
        });

        // File input handler
        chooseText.addEventListener('click', () => {
            if (!this.isUploading) {
                fileInput.click();
            }
        });

        fileInput.addEventListener('change', () => {
            this.handleFiles(fileInput.files);
        });

        // Upload button handler
        uploadBtn.addEventListener('click', () => {
            this.startUpload();
        });

        urlButton.addEventListener('click', () => {
                if (!this.isUploading) {
                    this.urlInputModal.show();
                }
        });

        this.urlInputModal.events.on('urlProcessed', (result) => {
            if (result.files) {
                this.handleFiles(result.files);
            }
            this.events.emit('message', result);
        });

        this.element.addEventListener('hidden.bs.modal', () => {
            this.events.emit('modalClose');
        });
    }

    handleFiles(newFiles) {
        if (this.isUploading) return;

        const fileList = this.element.querySelector('#fileList');
        const uploadBtn = this.element.querySelector('#uploadBtn');
        const uploadArea = this.element.querySelector('#dropZone');
        
        let addFilesResult;
        if (newFiles[0]?.mimeType) {
            addFilesResult = this.fileBasket.addDriveFiles(newFiles);
        } else {
            addFilesResult = this.fileBasket.addFiles(newFiles);
        }
    
        if (addFilesResult.duplicates > 0) {
            this.events.emit('warning', `${addFilesResult.duplicates} files were skipped as they were already added`);
        }

        // Update UI
        fileList.innerHTML = '';
        this.fileBasket.getFileNames().forEach(fileName => {
            const fileItem = this.createFileItem(fileName);
            fileList.appendChild(fileItem);
        });
        
        this.updateUploadUI(fileList, uploadBtn, uploadArea);
        this.updateSourceCount();
    }

    createFileItem(fileName) {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item pending-upload';
        fileItem.dataset.fileName = fileName;
        const driveFile = this.fileBasket.drivefiles.get(fileName);
        
        const icon = this.getFileIcon(fileName,driveFile?.mimeType);
        fileItem.innerHTML = `
            <div class="file-icon">
                <i class="bi ${icon} text-primary-green"></i>
            </div>
            <div class="file-info">
                <div class="file-name">${fileName}</div>
                <div class="file-progress">
                    <div class="progress-bar"></div>
                </div>
            </div>
            <div class="file-remove">
                <i class="bi bi-trash"></i>
            </div>
        `;

        const removeButton = fileItem.querySelector('.file-remove');
        removeButton.addEventListener('click', () => {
            if (!this.isUploading) {
                this.fileBasket.removeFile(fileName);
                fileItem.remove();
                this.updateUploadUI(
                    this.element.querySelector('#fileList'),
                    this.element.querySelector('#uploadBtn'),
                    this.element.querySelector('#dropZone')
                );
            }
        });

        return fileItem;
    }

    setupCloseButton() {
        const closeButton = this.element.querySelector('.close-button');
        closeButton.addEventListener('click', () => {
            console.log('Close button clicked');
            this.hide();
        });
    }
    
    setLoadingState(isLoading) {
        const loadingOverlay = this.element.querySelector('.upload-loading-overlay');
        const closeButton = this.element.querySelector('.close-button');
        const uploadBtn = this.element.querySelector('#uploadBtn');
        const modal = bootstrap.Modal.getInstance(this.element);
    
        if (isLoading) {
            loadingOverlay.style.display = 'flex';
            closeButton.style.display = 'none';
            uploadBtn.disabled = true;
            modal._config.backdrop = 'static';
            modal._config.keyboard = false;
        } else {
            loadingOverlay.style.display = 'none';
            closeButton.style.display = 'block';
            uploadBtn.disabled = false;
            modal._config.backdrop = true;
            modal._config.keyboard = true;
        }
    }

    async startUpload() {
        if (!this.fileBasket.hasFilesToUpload() || this.isUploading) return;

        this.isUploading = true;
        const uploadBtn = this.element.querySelector('#uploadBtn');
        uploadBtn.disabled = true;
        this.setLoadingState(true); 
        let successCount = 0;

        try {
            while (this.fileBasket.hasFilesToUpload()) {
                const batch = this.fileBasket.getBatch();
                const uploadPromises = batch.map(async (fileName) => {
                    try {
                        const result = await this.uploadFile(fileName);
                        if (result.success) successCount++;
                    } catch (error) {
                        console.error(`Failed to upload ${fileName}:`, error);
                    }
                });
                await Promise.all(uploadPromises);
            }

            if (successCount > 0) {
                const uploadResult = await window.uploadFiles(window.serverData.userId);
                
                if (uploadResult.success) {
                    this.events.emit('filesUploaded', uploadResult.data);
                    this.resetUploadUI();
                    this.updateSourceCount();
                    this.events.emit('message', {
                        text: `Successfully uploaded ${successCount} files`,
                        type: 'success'
                    });
                    setTimeout(() =>  {
                        this.hide();
                        this.events.emit('modalClose');
                    }, 500);
                } else if (uploadResult.error && uploadResult.error.includes('Upgrade')) {
                    console.log('first')
                    console.log(uploadResult.error)
                    const alertElement = document.createElement('div');
                    alertElement.className = 'alert-modal';
                    alertElement.innerHTML = `
                        <div class="alert-content">
                            <div class="alert-icon">
                                <i class="bi bi-exclamation-circle text-primary-green"></i>
                            </div>
                            <h5 class="alert-title">File Limit Reached</h5>
                            <p class="alert-message">${uploadResult.error}</p>
                            <button class="alert-button">Got it</button>
                        </div>
                    `;

                    document.body.appendChild(alertElement);
                    
                    const closeButton = alertElement.querySelector('.alert-button');
                    closeButton.addEventListener('click', () => {
                        alertElement.classList.remove('show');
                        document.body.style.overflow = '';
                        setTimeout(() => alertElement.remove(), 300);
                    });

                    requestAnimationFrame(() => {
                        alertElement.classList.add('show');
                        document.body.style.overflow = 'hidden';
                    });
                } else {
                    console.log('second')
                    console.log(uploadResult.error)
                    throw new Error(uploadResult.error);
                }
            }

        } catch (error) {
            console.error('Upload error:', error);
            this.events.emit('error', error.message);
        } finally {
            this.isUploading = false;
            this.fileBasket.clear();
            uploadBtn.disabled = false;
            this.setLoadingState(false);
        }
    }

    resetUploadUI() {
        const fileList = this.element.querySelector('#fileList');
        const uploadBtn = this.element.querySelector('#uploadBtn');
        const uploadArea = this.element.querySelector('#dropZone');
        
        // Clear file list
        fileList.innerHTML = '';
        
        // Reset upload area
        uploadArea.style.display = 'flex';
        uploadBtn.disabled = true;
        
        // Remove "Add More Files" button
        this.removeAddMoreFilesButton();
        
        // Clear FileBasket
        this.fileBasket.clear();
    }

    async uploadFile(fileName) {
        const fileItem = this.element.querySelector(`[data-file-name="${fileName}"]`);
        const progressBar = fileItem.querySelector('.progress-bar');
        
        try {
            const formData = this.fileBasket.getFileFormData(fileName);
            if (!formData) throw new Error('File not found');

            fileItem.classList.remove('pending-upload');
            fileItem.classList.add('uploading');
            
            let success;
            if (formData.has('driveFileId')) {
                success = await window.storedriveFile(window.serverData.userId, formData);
            } else {
                success = await window.storeFile(window.serverData.userId, formData);
            }

            if (success) {
                progressBar.style.width = '100%';
                fileItem.classList.remove('uploading');
                fileItem.classList.add('uploaded');
                return { success: true };
            } else {
                throw new Error(result.error);
            }

        } catch (error) {
            fileItem.classList.remove('uploading');
            fileItem.classList.add('upload-error');
            return { success: false, error: error.message };
        }
    }
    
    loadDrivePicker() {
        if (typeof google === 'undefined') {
            const script = document.createElement('script');
            script.src = 'https://apis.google.com/js/api.js';
            script.onload = () => {
                window.gapi.load('picker', () => {
                    this.createPicker();
                });
            };
            document.body.appendChild(script);
        } else {
            this.createPicker();
        }
    }

    createPicker() {

        if (this.currentPicker) {
            this.currentPicker.dispose();
            this.currentPicker = null;
        }

        const accessToken = document.cookie
            .split('; ')
            .find(row => row.startsWith('drive_access_token='))
            ?.split('=')[1];
    
        if (!accessToken) {
            const alertModal = document.createElement('div');
            alertModal.className = 'alert-modal';
            alertModal.innerHTML = `
                <div class="alert-content">
                    <div class="alert-icon">
                        <i class="bi bi-exclamation-circle text-primary-green"></i>
                    </div>
                    <h5 class="alert-title">Drive Access Required</h5>
                    <p class="alert-message">To access your Google Drive files:
                        <br>1. Sign out
                        <br>2. Sign in with Google
                        <br>3. Allow Drive access when prompted
                    </p>
                    <button class="alert-button">Got it!</button>
                </div>
            `;
        
            document.body.appendChild(alertModal);
            
            requestAnimationFrame(() => {
                alertModal.classList.add('show');
                document.body.style.overflow = 'hidden';
            });
            
            const closeButton = alertModal.querySelector('.alert-button');
            closeButton.addEventListener('click', () => {
                alertModal.classList.remove('show');
                document.body.style.overflow = '';
                setTimeout(() => alertModal.remove(), 300);
            });
        
            return;
        }
        
        const GOOGLE_API_KEY = document.cookie
        .split('; ')
        .find(row => row.startsWith('google_api_key='))
        ?.split('=')[1];

    
        const picker = new google.picker.PickerBuilder()
            .addView(google.picker.ViewId.DOCS)
            .setOAuthToken(accessToken)
            .setDeveloperKey(GOOGLE_API_KEY)
            .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
            .enableFeature(google.picker.Feature.MULTISELECT_ENABLED)
            .setCallback((data) => {
                if (data[google.picker.Response.ACTION] === google.picker.Action.PICKED) {
                    const docs = data[google.picker.Response.DOCUMENTS];
                    this.handleDriveSelection(docs);  // Pass token to handler
                }
            })
            .build();
        picker.setVisible(true);
        this.currentPicker = picker;

        setTimeout(() => {
            const pickerFrame = document.querySelector('.picker-dialog-bg');
            const pickerDialog = document.querySelector('.picker-dialog');
            
            if (pickerFrame && pickerDialog) {
                document.querySelectorAll('.picker-dialog-bg, .picker-dialog').forEach(el => {
                    if (el !== pickerFrame && el !== pickerDialog) {
                        el.remove();
                    }
                });

                pickerFrame.style.zIndex = '10000';
                pickerDialog.style.zIndex = '10001';
            }
        }, 0);

    }

    handleDriveSelection(files) {
        const supportedTypes = [
            'application/pdf',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/plain',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'application/vnd.google-apps.document',
            'application/vnd.google-apps.document',    
            'application/vnd.google-apps.spreadsheet', 
            'application/vnd.google-apps.presentation',
            'application/vnd.google-apps.script',
        ];
    
        const filteredFiles = files.filter(file => {
            return supportedTypes.includes(file.mimeType);
        });

    
        if (filteredFiles.length === 0) {
            this.events.emit('warning', 'No supported files selected. Please select PDF, DOCX, or TXT files.');
            return;
        }
    
        if (filteredFiles.length < files.length) {
            this.events.emit('warning', `${files.length - filteredFiles.length} files were skipped due to unsupported file types`);
        }
        
        const fileList = this.element.querySelector('#fileList');
        this.fileBasket.files.clear();
        this.fileBasket.drivefiles.clear();
        this.fileBasket.uploadQueue = [];
        
        fileList.innerHTML = '';
        filteredFiles.forEach(file => {
            const fileItem = this.createFileItem(file.name);
            fileList.appendChild(fileItem);
        });

        this.updateUploadUI(
            fileList,
            this.element.querySelector('#uploadBtn'),
            this.element.querySelector('#dropZone')
        );
        
        this.handleFiles(filteredFiles);
    }

    getFileIcon(fileName, mimeType) {
        const extension = fileName.split('.').pop().toLowerCase();

        if (mimeType) {
            switch (mimeType) {
                case 'application/vnd.google-apps.document':
                    return 'bi-file-word';
                case 'application/vnd.google-apps.spreadsheet':
                    return 'bi-file-excel';
                case 'application/vnd.google-apps.presentation':
                    return 'bi-file-ppt';
                case 'application/vnd.google-apps.script':
                    return 'bi-file-text';
            }
        }

        const iconMap = {
            pdf: 'bi-file-pdf',
            docx: 'bi-file-word',
            doc: 'bi-file-word',
            txt: 'bi-file-text',
            pptx: 'bi-file-ppt',
            xlsx: 'bi-file-excel',
            udf: 'bi-file-post',
            html: 'bi-file-code',
        };
        return iconMap[extension] || 'bi-file';
    }

    updateUploadUI(fileList, uploadBtn, uploadArea) {
        if (this.fileBasket.getFileNames().length > 0 || this.fileBasket.drivefiles.size > 0) {
            uploadArea.style.display = 'none';
            uploadBtn.disabled = false;
            this.ensureAddMoreFilesButton(fileList);
        } else {
            uploadArea.style.display = 'flex';
            uploadBtn.disabled = true;
            this.removeAddMoreFilesButton();
        }
    }

    ensureAddMoreFilesButton(fileList) {
        let addFileBtn = this.element.querySelector('.add-file-btn');
        if (!addFileBtn) {
            addFileBtn = document.createElement('button');
            addFileBtn.className = 'add-file-btn';
            addFileBtn.innerHTML = `
                <i class="bi bi-plus-circle"></i>
                Add More Files
            `;
            addFileBtn.addEventListener('click', () => {
                if (!this.isUploading) {
                    this.element.querySelector('#fileInput').click();
                }
            });
            fileList.after(addFileBtn);
        }
        addFileBtn.disabled = this.isUploading;
        addFileBtn.style.opacity = this.isUploading ? '0.5' : '1';
    }

    removeAddMoreFilesButton() {
        const addFileBtn = this.element.querySelector('.add-file-btn');
        if (addFileBtn) {
            addFileBtn.remove();
        }
    }

    updateSourceCount() {
        const domains =  this.domainManager.getAllDomains();
        let totalSources = 0;
        
        domains.forEach(domain => {
            if (domain.fileCount) {
                totalSources += domain.fileCount;
            }
        });
        
        const percentage = (totalSources / 20) * 100;
        
        const countElement = this.element.querySelector('.sources-count');
        const progressBar = this.element.querySelector('.progress-bar');
        
        if (countElement && progressBar) {
            countElement.textContent = `${totalSources}/20`;
            progressBar.style.width = `${percentage}%`;
            
        }
    }

    show(domainName = '') {
        const domainNameElement = this.element.querySelector('.domain-name');
        if (domainNameElement) {
            domainNameElement.textContent = domainName;
        }
        this.updateSourceCount();
        const modal = new bootstrap.Modal(this.element);
        modal.show();
    }

    hide() {
        const modal = bootstrap.Modal.getInstance(this.element);
        if (modal) {
            modal.hide();
            this.events.emit('modalClose');
            this.fileBasket.clear();
            this.resetUploadUI();
        }
    }
}


class ChatManager extends Component {
    constructor() {
        const element = document.querySelector('.chat-content');
        super(element);
        
        this.messageContainer = this.element.querySelector('.chat-messages');
        this.setupMessageInput();
        this.setupExportButton();
    }

    setupMessageInput() {
        const container = document.querySelector('.message-input-container');
        container.innerHTML = `
           <textarea 
                class="message-input" 
                placeholder="Please select your domain from settings ⚙️ to start chat!"
                rows="1"
                disabled
            ></textarea>
            <button class="send-button" disabled>
                <i class="bi bi-send send-icon"></i>
            </button>
            <button class="export-button" disabled title="Export Selected Messages">
             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 4h14a2 2 0 012 2v12a2 2 0 01-2 2H4a2 2 0 01-2-2V6a2 2 0 012-2z" stroke="currentColor" stroke-width="2"/>
                <path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                <path d="M16 12l3 3m0 0l3-3m-3 3V4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            </button>
        `;
    
        const input = container.querySelector('.message-input');
        const sendButton = container.querySelector('.send-button');
        
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.handleSendMessage(input);
            }
        });
    
        sendButton.addEventListener('click', () => {
            this.handleSendMessage(input);
        });
    }

    async handleSendMessage(input) {
        const message = input.value.trim();
        if (!message) return;
    
        // Add user message
        this.addMessage(message, 'user');
        input.value = '';
    
        // Add loading message
        const loadingMessage = this.addLoadingMessage();

        // Disable chat
        this.disableChat();
    
        try {
            const selectedFileIds = window.app.sidebar.getSelectedFileIds();

            const response = await window.sendMessage(
                message, 
                window.serverData.userId,
                window.serverData.sessionId,
                selectedFileIds
            );
    
            // Remove loading message
            loadingMessage.remove();
    
            if (response.status === 400) {
                if (response.message.includes('Daily question limit')) {
                    // Show limit reached modal
                    const alertElement = document.createElement('div');
                    alertElement.className = 'alert-modal';
                    alertElement.innerHTML = `
                        <div class="alert-content">
                            <div class="alert-icon">
                                <i class="bi bi-exclamation-circle text-primary-green"></i>
                            </div>
                            <h5 class="alert-title">Daily Limit Reached</h5>
                            <p class="alert-message">${response.message}</p>
                            <div class="usage-count mt-3">
                                <small>Questions Used Today: 50/50</small>
                            </div>
                            <button class="alert-button">Got it</button>
                        </div>
                    `;
    
                    document.body.appendChild(alertElement);
                    
                    const closeButton = alertElement.querySelector('.alert-button');
                    closeButton.addEventListener('click', () => {
                        alertElement.classList.remove('show');
                        document.body.style.overflow = '';
                        setTimeout(() => alertElement.remove(), 300);
                    });
    
                    requestAnimationFrame(() => {
                        alertElement.classList.add('show');
                        document.body.style.overflow = 'hidden';
                    });
                } else {
                    this.addMessage(response.message, 'ai');
                }
                return;
            }
    
            if (response.answer && response.question_count == 10) {
                this.addMessage(response.answer, 'ai');
                this.updateResources(response.resources, response.resource_sentences);
                this.events.emit('ratingModalOpen');
                window.app.profileLimitsModal.updateDailyCount(response.question_count);
            } 
            else if (response.answer) {
                this.addMessage(response.answer, 'ai');
                this.updateResources(response.resources, response.resource_sentences);
                window.app.profileLimitsModal.updateDailyCount(response.question_count);
            } 
            else {
                this.addMessage(response.message, 'ai');
            }
    
        } catch (error) {
            loadingMessage.remove();
            this.addMessage('Error generating message!', 'ai');
            console.error('Error:', error);
        } finally {
            this.enableChat();
        }
    }

    addMessage(content, type) {
        const message = document.createElement('div');
        message.className = `chat-message ${type}`;
        
        const bubble = document.createElement('div');
        bubble.className = `message-bubble ${type}-bubble`;
        
        const text = document.createElement('div');
        text.className = 'message-text';
        
        if (type === 'ai') {
            text.innerHTML = this.formatMessage(content);
            bubble.appendChild(text);
            
            if (!content.includes('what can I find for you?')) {
                message.setAttribute('data-exportable', 'true');

                const actionBar = document.createElement('div');
                actionBar.className = 'message-actions';

                const actionContainer = document.createElement('div');
                actionContainer.className = 'action-container';

                const selectionMark = document.createElement('div');
                selectionMark.className = 'selection-mark';
                selectionMark.innerHTML = '<i class="bi bi-check-circle"></i>';
                
                const copyButton = document.createElement('button');
                copyButton.className = 'copy-button';
                copyButton.innerHTML = `
                <i class="bi bi-clipboard"></i>
                <span class="action-text">Copy</span>`;
                
                copyButton.addEventListener('click', () => {
                    const messageContent = text.innerHTML;
                    this.copyToClipboard(messageContent);
                    
                    copyButton.innerHTML = `
                    <i class="bi bi-check2"></i>
                    <span class="action-text">Copied!</span>`;
                    copyButton.classList.add('copied');
                    
                    setTimeout(() => {
                        copyButton.innerHTML = `
                        <i class="bi bi-clipboard"></i>
                        <span class="action-text">Copy</span>`;
                        copyButton.classList.remove('copied');
                    }, 2000);
                });
                
                selectionMark.addEventListener('click', () => {
                    message.classList.toggle('selected');
                    this.updateExportButton();
                });
                
                actionContainer.appendChild(copyButton);
                actionBar.appendChild(copyButton);
                bubble.appendChild(selectionMark);
                bubble.appendChild(actionBar);
                message.appendChild(bubble);
            } else {
                message.appendChild(bubble);
                bubble.appendChild(text);
                message.appendChild(bubble);
            }
        } else {
            text.textContent = content;
            bubble.appendChild(text);
            message.appendChild(bubble);
        }
        
        this.messageContainer.appendChild(message);
        this.scrollToBottom();
        
        return message;
    }

    setupExportButton() {
        const exportButton = document.querySelector('.export-button');
        if (exportButton) {
            exportButton.addEventListener('click', () => this.handleExportSelected());
            exportButton.disabled = true;
        }
    }

    updateExportButton() {
        const exportButton = document.querySelector('.export-button');
        const selectedMessages = document.querySelectorAll('.chat-message.ai.selected');
        const count = selectedMessages.length;

        let counter = document.querySelector('.export-counter');
        if (!counter) {
            counter = document.createElement('div');
            counter.className = 'export-counter';
            exportButton.parentElement.appendChild(counter);
        }

        counter.textContent = `${count}/10`;
        counter.style.color = count === 10 ? '#10B981' : 'white';
        
        exportButton.disabled = count === 0;
        
        if (count > 10) {
            const lastSelected = selectedMessages[selectedMessages.length - 1];
            lastSelected.classList.remove('selected');
            this.updateExportButton();
        }
    }

    getSelectedMessages() {
        const selectedMessages = document.querySelectorAll('.chat-message.ai.selected');
        return Array.from(selectedMessages).map(message => {
            return message.querySelector('.message-text').innerHTML;
        });
    }

    async handleExportSelected() {
        const selectedContents = this.getSelectedMessages();
        if (selectedContents.length === 0 || selectedContents.length > 10 ) return;

        const exportButton = document.querySelector('.export-button');
        const originalHTML = exportButton.innerHTML;
        
        try {
            // Show loading state
            exportButton.innerHTML = `<div class="spinner-border spinner-border-sm" role="status"></div>`;
            exportButton.disabled = true;

            const result = await window.exportResponse(selectedContents);
            
            if (result === true) {
                // Success state
                exportButton.innerHTML = '<i class="bi bi-check2"></i>';
                setTimeout(() => {
                    // Reset state
                    exportButton.innerHTML = originalHTML;
                    exportButton.disabled = false;
                    
                    // Deselect all messages
                    document.querySelectorAll('.chat-message.ai.selected').forEach(msg => {
                        msg.classList.remove('selected');
                    });
                    this.updateExportButton();
                }, 2000);
            } else {
                // Error state
                exportButton.innerHTML = '<i class="bi bi-x-circle"></i>';
                setTimeout(() => {
                    exportButton.innerHTML = originalHTML;
                    exportButton.disabled = false;
                }, 2000);
            }
        } catch (error) {
            console.error('Export failed:', error);
            exportButton.innerHTML = '<i class="bi bi-x-circle"></i>';
            setTimeout(() => {
                exportButton.innerHTML = originalHTML;
                exportButton.disabled = false;
            }, 2000);
        }
    }

    updateHeader(domainName = null) {
        const headerTitle = document.querySelector('.header-title');
        if (!headerTitle) return;
        
        if (domainName) {
            headerTitle.innerHTML = `Chat with <span style="color: #10B981; font-size: 1.1em;">${domainName}</span>`;
        } else {
            headerTitle.textContent = 'Chat';
        }
    }

    addLoadingMessage() {
        const message = document.createElement('div');
        message.className = 'chat-message ai';
        message.innerHTML = `
            <div class="message-bubble ai-bubble">
                <div class="message-text">
                    <div class="spinner-border text-light" role="status">
                        <span class="visually-hidden">Loading...</span>
                    </div>
                </div>
            </div>
        `;
        this.messageContainer.appendChild(message);
        this.scrollToBottom();
        return message;
    }

    showDefaultMessage() {
        this.messageContainer.innerHTML = `
            <div class="chat-message ai">
                <div class="message-bubble ai-bubble">
                    <div class="message-text">
                        Please select a knowledge base to start chatting with your documents.
                        Click the settings icon <i class="bi bi-gear"></i> to select a knowledge base.
                    </div>
                </div>
            </div>
        `;
    }

    formatMessage(text) {
        // First process headers
        let formattedText = text.replace(/\[header\](.*?)\[\/header\]/g, '<div class="message-header">$1</div>');
        
        // Process bold terms
        formattedText = formattedText.replace(/\*\*(.*?)\*\*/g, '<strong class="message-bold">$1</strong>');
        
        // Handle nested lists with proper indentation
        formattedText = formattedText.replace(/^-\s*(.*?)$/gm, '<div class="message-item">$1</div>');
        formattedText = formattedText.replace(/^\s{2}-\s*(.*?)$/gm, '<div class="message-item nested-1">$1</div>');
        formattedText = formattedText.replace(/^\s{4}-\s*(.*?)$/gm, '<div class="message-item nested-2">$1</div>');
        
        return `<div class="message-content">${formattedText}</div>`;
      }

      convertMarkdownToHtmlTable(content) {
        if (!content.includes('|')) {
            return content;
        }
    
        const tableRegex = /\|[^\|]+(?:\|[^\|]+)*\|/g;
        let lastIndex = 0;
        let segments = [];
        let match;
    
        tableRegex.lastIndex = 0;
        
        while ((match = tableRegex.exec(content)) !== null) {
            if (match.index > lastIndex) {
                const textContent = content.substring(lastIndex, match.index).trim();
                if (textContent) {
                    segments.push(`<div class="description-content">${textContent}</div>`);
                }
            }
            
            const tableContent = match[0];
    
            const rows = tableContent
                .trim()
                .split('\n')
                .slice(1)
                .filter(row => {
                    const cleanRow = row.replace(/[|\s-]/g, '');
                    return cleanRow.length > 0;
                });
    
            let htmlTable = '<div class="table-wrapper"><table class="resource-table">';
            
            rows.forEach((row, rowIndex) => {
                const cells = row
                    .split('|')
                    .filter(cell => cell.trim())
                    .map(cell => {
                        const cleanCell = cell.trim();
                            if (cleanCell.match(/^-+$/)) return '';
                            return cleanCell
                             // Handle any type of subscript (letter followed by number)
                             .replace(/\s+/g, ' ')
                             // Handle numeric values with units
                             .replace(/(\d+\.?\d*)\s*([A-Za-z²³/]+)/, '<span class="numeric">$1</span> <span class="unit">$2</span>')
                             // Handle row identifiers
                             .replace(/^\(([i\d]+)\)/, '<span class="identifier">($1)</span>');
                    });
                    
                htmlTable += '<tr>';
                cells.forEach(cell => {
                    if (!cell) return;
                    const cellTag = rowIndex === 0 ? 'th' : 'td';
                    const className = [];
                    
                    if (cell.includes('class="numeric"') || !isNaN(cell.replace(/[^\d.-]/g, ''))) {
                        className.push('align-right');
                    }
                    
                    if (cell.includes('class="identifier"')) {
                        className.push('indent-cell');
                    }
                    htmlTable += `<${cellTag}${className.length ? ` class="${className.join(' ')}"` : ''}>${cell}</${cellTag}>`;
                });
                htmlTable += '</tr>';
            });
            
            htmlTable += '</table></div>';
            segments.push(htmlTable);
            lastIndex = match.index + match[0].length;
        }
        
        if (lastIndex < content.length) {
            const remainingText = content.substring(lastIndex).trim();
            if (remainingText) {
                segments.push(`<div class="description-content">${remainingText}</div>`);
                }
            }
        
        return segments.join('');
        }

    updateResources(resources, sentences) {
        const container = document.querySelector('.resources-list');
        container.innerHTML = '';
    
        if (!resources || !sentences || !resources.file_names?.length) {
            return;
        }
    
        sentences.forEach((sentence, index) => {
            const item = document.createElement('div');
            item.className = 'resource-item';
            const content = this.convertMarkdownToHtmlTable(sentence);
                
            item.innerHTML = `
                <div class="source-info">
                    <span class="document-name">${resources.file_names[index]}</span>
                    <span class="page-number">
                        <i class="bi bi-file-text"></i>
                        Page ${resources.page_numbers[index]}
                    </span>
                </div>
                <div class="content-wrapper">
                    <div class="bullet-indicator">
                        <div class="bullet-line"></div>
                        <div class="bullet-number">${index + 1}</div>
                    </div>
                     <div class="description">
                    ${content}
                    </div>
                </div>
            `;
                
            container.appendChild(item);
        });
    }

    copyToClipboard(content) {
        const cleanText = content.replace(/<div class="message-header">(.*?)<\/div>/g, '$1\n')
            .replace(/<div class="message-item.*?">(.*?)<\/div>/g, '- $1')
            .replace(/<div class="message-item nested-1">(.*?)<\/div>/g, '  - $1')
            .replace(/<div class="message-item nested-2">(.*?)<\/div>/g, '    - $1')
            .replace(/<strong class="message-bold">(.*?)<\/strong>/g, '$1')
            .replace(/<[^>]+>/g, '')
            .replace(/\n\s*\n/g, '\n\n')
            .trim();
    
        navigator.clipboard.writeText(cleanText)
            .catch(err => console.error('Failed to copy text:', err));
    }

    scrollToBottom() {
        this.element.scrollTop = this.element.scrollHeight;
    }

    enableChat() {
        this.element.classList.remove('chat-disabled');
        const input = document.querySelector('.message-input');
        const button = document.querySelector('.send-button');
        input.disabled = false;
        button.disabled = false;
        input.placeholder = "Send message";
    }

    disableChat() {
        this.element.classList.add('chat-disabled'); 
        const input = document.querySelector('.message-input');
        const button = document.querySelector('.send-button');
        input.disabled = true;
        button.disabled = true;
        input.placeholder = "Select your knowledge base to chat...";
    }

    clearDefaultMessage() {
        this.messageContainer.innerHTML = '';
    }
}

// Sidebar Component
class Sidebar extends Component {
    constructor(domainManager) {
        const element = document.createElement('div');
        element.className = 'sidebar-container';
        super(element);
        
        this.domainManager = domainManager;
        this.isOpen = false;
        this.timeout = null;
        this.selectedFiles = new Set();
        this.render();
        this.setupEventListeners();
        this.isModalOpen = false;
    }

    render() {
        this.element.innerHTML = `
            <div class="sidebar d-flex flex-column flex-shrink-0 h-100">
                <div class="top-header py-3 px-4">
                    <div class="d-flex align-items-center justify-content-between">
                        <div class="d-flex align-items-center gap-3">
                            <h1 class="logo-text m-0 d-xl-block">Doclink</h1>
                        </div>
                    </div>
                </div>
                <div class="px-4 py-3">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <div class="d-flex align-items-center gap-2">
                            <i class="bi bi-folder empty-folder"></i>
                            <span class="d-xl-block selected-domain-text">Unselected</span>
                        </div>
                        <i class="bi bi-gear settings-icon"></i>
                    </div>

                    <div class="file-list-container">
                        <div id="sidebarFileList" class="sidebar-files">
                        </div>
                    </div>
                    <div class="file-add">
                        <button class="open-file-btn">
                            Add Sources
                        </button>
                        <p class="helper-text">
                            To add first select on ⚙️
                        </p>
                    </div>
                </div>

                <div class="bottom-section mt-auto">
                    <div class="text-center mb-3">
                        <span class="plan-badge d-xl-block">Free Plan</span>
                    </div>
                    <div class="user-section d-flex align-items-center gap-3 mb-3" role="button" id="userProfileMenu">
                        <div class="user-avatar">i</div>
                        <div class="user-info d-xl-block">
                            <div class="user-email">ibrahimyasing@gmail.com</div>
                            <div class="user-status">
                                <span class="status-dot"></span>
                                Online
                            </div>
                        </div>
                        <div class="user-menu">
                            <div class="menu-item">
                                <i class="bi bi-person-circle"></i>
                                Profile
                            </div>
                            <div class="menu-item">
                                <i class="bi bi-gear"></i>
                                Settings
                            </div>
                            <div class="menu-divider"></div>
                            <div class="menu-item logout-item">
                                <i class="bi bi-box-arrow-right"></i>
                                Logout
                            </div>
                        </div>
                    </div>
                    <div class="bottom-links justify-content-center">
                        <a href="#" class="premium-link">Go Premium!</a>
                        <a href="#">Feedback</a>
                    </div>
                </div>
                <div id="sidebar-seperator"></div>
            </div>
        `;

        // Create backdrop
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'sidebar-backdrop';
        document.body.appendChild(this.backdrop);
    }

    setupEventListeners() {
        // Existing event listeners
        const settingsIcon = this.element.querySelector('.settings-icon');
        settingsIcon.addEventListener('click', () => {
            this.events.emit('settingsClick');
        });
    
        const fileMenuBtn = this.element.querySelector('.open-file-btn');
        fileMenuBtn.addEventListener('click', () => {
            this.events.emit('fileMenuClick');
        });
    
        this.backdrop.addEventListener('click', () => {
            this.toggle(false);
        });
    
        // Add hover handlers for desktop
        const menuTrigger = document.querySelector('.menu-trigger');
        if (window.innerWidth >= 992 && menuTrigger) {
            // Menu trigger hover
            if (menuTrigger) {
                menuTrigger.addEventListener('mouseenter', () => {
                    console.log('Menu trigger hover');
                    clearTimeout(this.timeout);
                    this.toggle(true);
                });
    
                menuTrigger.addEventListener('mouseleave', () => {
                    this.timeout = setTimeout(() => {
                        if (!this.element.matches(':hover')) {
                            this.toggle(false);
                        }
                    }, 300);
                });
            }

            // Sidebar hover
            this.element.addEventListener('mouseenter', () => {
                console.log('Sidebar hover');
                clearTimeout(this.timeout);
                this.toggle(true);
            });
    
            this.element.addEventListener('mouseleave', () => {
                if (this.isModalOpen) return;  // Prevent closing if modal is open

                this.timeout = setTimeout(() => {
                    if (!document.querySelector('.menu-trigger')?.matches(':hover')) {
                        this.toggle(false);
                    }
                }, 300);
            });
        }

        this.events.on('modalOpen', () => {
            this.isModalOpen = true;
        });

        this.events.on('modalClose', () => {
            this.isModalOpen = false;
            setTimeout(() => {
                this.toggle(false);  // Force close the sidebar
            }, 200);
        });
        
        // Mobile menu trigger handler
        this.events.on('menuTrigger', () => {
            if (window.innerWidth < 992) {
                const menuIcon = document.querySelector('.menu-trigger .bi-list');
                if (menuIcon) {
                    menuIcon.style.transform = this.isOpen ? 'rotate(0)' : 'rotate(45deg)';
                }
                this.toggle();
            }
        });
    
        // Handle window resize
        window.addEventListener('resize', () => {
            if (window.innerWidth >= 992) {
                this.backdrop.classList.remove('show');
                document.body.style.overflow = '';
                const menuIcon = document.querySelector('.menu-trigger .bi-list');
                if (menuIcon) {
                    menuIcon.style.transform = 'rotate(0)';
                }
            }
        });

        // User Profile Menu
        const userSection = this.element.querySelector('#userProfileMenu');
        if (userSection) {
            userSection.addEventListener('click', (e) => {
                e.stopPropagation();
                userSection.classList.toggle('active');
            });

            // Close menu when clicking outside
            document.addEventListener('click', (e) => {
                if (!userSection.contains(e.target)) {
                    userSection.classList.remove('active');
                }
            });

            // Handle menu items
            userSection.querySelectorAll('.menu-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (item.classList.contains('logout-item')) {
                        // Handle logout logic here
                        console.log('Logging out...');
                    }
                    userSection.classList.remove('active');
                });
            });
        }

        // Premium and Feedback links
        const premiumLink = this.element.querySelector('.premium-link');
        if (premiumLink) {
            premiumLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.events.emit('premiumClick');
            });
        }

        const feedbackLink = this.element.querySelector('.bottom-links a:not(.premium-link)');
        if (feedbackLink) {
            feedbackLink.addEventListener('click', (e) => {
                e.preventDefault();
                this.events.emit('feedbackClick');
            });
        }

        const profileMenuItem = userSection.querySelector('.menu-item:first-child');
        if (profileMenuItem) {
            profileMenuItem.addEventListener('click', (e) => {
                e.stopPropagation();
                userSection.classList.remove('active');
                this.events.emit('showProfileLimits');
            });
        }
    }

    toggle(force = null) {
        this.isOpen = force !== null ? force : !this.isOpen;
        this.element.classList.toggle('open', this.isOpen);
        this.backdrop.classList.toggle('show', this.isOpen);
        document.body.style.overflow = this.isOpen ? 'hidden' : '';
    }

    updateDomainSelection(domain) {
        const domainText = this.element.querySelector('.selected-domain-text');
        const folderIcon = this.element.querySelector('.bi-folder');
        
        if (domain) {
            domainText.textContent = domain.name;
            domainText.title = domain.name;
            folderIcon.classList.remove('empty-folder');
        } else {
            domainText.textContent = 'Select Knowledge Base';
            domainText.removeAttribute('title');
            folderIcon.classList.add('empty-folder');
        }
    }

    updateFileList(files, fileIDS) {
        const fileList = this.element.querySelector('#sidebarFileList');
        if (!fileList) return;
        
        fileList.innerHTML = '';
        
        if (files.length > 0 && fileIDS.length > 0) {
            files.forEach((file, index) => {
                const fileItem = this.createFileListItem(file, fileIDS[index]);
                
                // Check the checkbox by default
                const checkbox = fileItem.querySelector('.file-checkbox');
                if (checkbox) {
                    checkbox.checked = true;
                }
                
                fileList.appendChild(fileItem);
            });
        }
    
        this.updateFileMenuVisibility();
    }

    createFileListItem(fileName, fileID) {
        const fileItem = document.createElement('li');
        let extension;
        if (fileName.includes('http') || fileName.includes('www.')) {
            extension = 'html';
        } else {
            extension = fileName.split('.').pop().toLowerCase();
        }
        const icon = this.getFileIcon(extension);
        const truncatedName = this.truncateFileName(fileName);
        
        fileItem.innerHTML = `
            <div class="d-flex align-items-center w-100">
                <div class="icon-container">
                    <i class="bi ${icon} file-icon sidebar-file-list-icon" style="color:#10B981"></i>
                    <button class="delete-file-btn">
                        <i class="bi bi-trash"></i>
                    </button>
                    <div class="delete-confirm-actions">
                        <button class="confirm-delete-btn" title="Confirm delete">
                            <i class="bi bi-check"></i>
                        </button>
                        <button class="cancel-delete-btn" title="Cancel delete">
                            <i class="bi bi-x"></i>
                        </button>
                    </div>
                </div>
                <span class="file-name" title="${fileName}">${truncatedName}</span>
                <div class="checkbox-wrapper">
                    <input type="checkbox" class="file-checkbox" id="file-${fileID}" data-file-id="${fileID}">
                    <label class="checkbox-label" for="file-${fileID}"></label>
                </div>
            </div>
        `;

        this.selectedFiles.add(fileID);

        const checkbox = fileItem.querySelector('.file-checkbox');
        checkbox.checked = true;

        // Handle checkbox changes
        checkbox.addEventListener('change', () => {
            if (checkbox.checked) {
                this.selectedFiles.add(fileID);
            } else {
                this.selectedFiles.delete(fileID);
            }
            // Update sources count
            window.app.updateSourcesCount(this.selectedFiles.size);
        });

        const deleteBtn = fileItem.querySelector('.delete-file-btn');
        const confirmActions = fileItem.querySelector('.delete-confirm-actions');

        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Show confirmation actions
            confirmActions.classList.add('show');
            deleteBtn.style.display = 'none';
        });
    
        // Add confirm/cancel handlers
        const confirmBtn = fileItem.querySelector('.confirm-delete-btn');
        const cancelBtn = fileItem.querySelector('.cancel-delete-btn');
    
        confirmBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const selectedDomain = this.domainManager.getSelectedDomain();
            if (!selectedDomain) return;
    
            const success = await window.removeFile(fileID, selectedDomain.data.id, window.serverData.userId);
    
            if (success) {
                // Remove file from UI
                fileItem.remove();
                
                // Update domain file count
                selectedDomain.data.files = selectedDomain.data.files.filter(f => f !== fileName);
                selectedDomain.data.fileIDS = selectedDomain.data.fileIDS.filter(id => id !== fileID);
                this.domainManager.updateDomainFileCount(selectedDomain.data.id);
                
                // Update sources count
                const sourcesCount = selectedDomain.data.files.length;
                window.app.updateSourcesCount(sourcesCount);
            }
        });
    
        cancelBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            confirmActions.classList.remove('show');
            deleteBtn.style.display = 'flex';
        });

        return fileItem;
    }

    truncateFileName(fileName, maxLength = 25) {
        if (fileName.length <= maxLength) return fileName;
        
        let extension;
        if (fileName.includes('http') || fileName.includes('www.')) {
            extension = 'html';
        } else {
            extension = fileName.split('.').pop().toLowerCase();
        }
        
        const nameWithoutExt = fileName.slice(0, fileName.lastIndexOf('.'));
        
        // Leave room for ellipsis and extension
        const truncatedLength = maxLength - 3 - extension.length - 1;
        return `${nameWithoutExt.slice(0, truncatedLength)}...${extension}`;
    }

    getSelectedFileIds() {
        return Array.from(this.selectedFiles);
    }

    updateFileList(files, fileIDS) {
        const fileList = this.element.querySelector('#sidebarFileList');
        if (!fileList) return;
        
        fileList.innerHTML = '';
        this.selectedFiles.clear(); // Clear existing selections
        
        if (files.length > 0 && fileIDS.length > 0) {
            files.forEach((file, index) => {
                const fileItem = this.createFileListItem(file, fileIDS[index]);
                fileList.appendChild(fileItem);
            });
        }
    
        this.updateFileMenuVisibility();
        // Update initial sources count
        window.app.updateSourcesCount(this.selectedFiles.size);
    }

    hideDeleteConfirmations() {
        this.element.querySelectorAll('.delete-confirm-actions').forEach(actions => {
            actions.classList.remove('show');
        });
        this.element.querySelectorAll('.delete-file-btn').forEach(btn => {
            btn.style.display = 'flex';
        });
    }

    clearFileSelections() {
        this.selectedFiles.clear();
        window.app.updateSourcesCount(0);
    }

    getFileIcon(extension) {
        console.log(extension)
        const iconMap = {
            pdf: 'bi-file-pdf',
            docx: 'bi-file-word',
            doc: 'bi-file-word',
            txt: 'bi-file-text',
            pptx: 'bi-file-ppt',
            xlsx: 'bi-file-excel',
            udf: 'bi-file-post',
            html: 'bi-file-earmark-code',
        };
        return iconMap[extension] || 'bi-file';
    }

    updateFileMenuVisibility() {
        const fileList = this.element.querySelector('#sidebarFileList');
        const helperText = this.element.querySelector('.helper-text');
        const fileMenuBtn = this.element.querySelector('.open-file-btn');
        const fileListContainer = this.element.querySelector('.file-list-container');

        if (fileList.children.length > 0) {
            helperText.style.display = 'none';
            helperText.style.height = '0';
            helperText.style.margin = '0';
            helperText.style.padding = '0';
        } else {
            fileListContainer.style.height = 'auto';
            fileMenuBtn.style.position = 'static';
            fileMenuBtn.style.width = '100%';
        }
    }

    
}

class PremiumModal extends Component {
    constructor() {
        const element = document.getElementById('premiumAlert');
        super(element);
        this.setupEventListeners();
    }

    setupEventListeners() {
        const closeButton = this.element.querySelector('.alert-button');
        closeButton?.addEventListener('click', () => this.hide());
    }

    show() {
        this.element.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    hide() {
        this.element.classList.remove('show');
        document.body.style.overflow = '';
    }
}

// Feedback Modal Component
class FeedbackModal extends Component {
    constructor() {
        const element = document.createElement('div');
        element.className = 'feedback-modal';
        super(element);
        
        this.render();
        this.setupEventListeners();
    }

    render() {
        this.element.innerHTML = `
            <div class="feedback-modal-content">
                <div class="feedback-modal-header">
                    <h3>Send Feedback</h3>
                    <button class="close-modal">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="feedback-modal-description">
                    <p>Your feedback really helps us get better!</p>
                    <p>Please follow these steps:</p>
                    <ol>
                        <li>Select the type of your feedback</li>
                        <li>Add your description</li>
                        <li>If it helps explain better, attach a screenshot</li>
                    </ol>
                </div>
                <form id="feedback-form" enctype="multipart/form-data">
                    <div class="form-group">
                        <label for="feedback-type">Type</label>
                        <select id="feedback-type" name="feedback_type" class="form-control">
                            <option value="general">General Feedback</option>
                            <option value="bug">Bug Report</option>
                            <option value="feature">Feature Request</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="feedback-description">Description</label>
                        <textarea 
                            id="feedback-description" 
                            name="feedback_description"
                            class="form-control" 
                            rows="4" 
                            placeholder="Please describe your feedback or issue..."
                            required
                        ></textarea>
                    </div>
                    <div class="form-group">
                        <label for="feedback-screenshot">Screenshot (Optional)</label>
                        <input 
                            type="file" 
                            id="feedback-screenshot"
                            name="feedback_screenshot"
                            class="form-control" 
                            accept="image/*"
                        >
                        <small class="form-text">Max size: 2MB</small>
                    </div>
                    <div class="feedback-modal-footer">
                        <button type="button" class="btn-cancel">Cancel</button>
                        <button type="submit" class="btn-submit">Submit Feedback</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(this.element);
    }

    setupEventListeners() {
        // Close button handlers
        const closeButtons = this.element.querySelectorAll('.close-modal, .btn-cancel');
        closeButtons.forEach(button => {
            button.addEventListener('click', () => this.hide());
        });

        // Click outside to close
        this.element.addEventListener('click', (e) => {
            if (e.target === this.element) {
                this.hide();
            }
        });

        // Form submission
        const form = this.element.querySelector('#feedback-form');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await this.handleSubmit(e);
        });

        // File size validation
        const fileInput = this.element.querySelector('#feedback-screenshot');
        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file && file.size > 2 * 1024 * 1024) {
                alert('File size must be less than 2MB');
                e.target.value = '';
            }
        });
    }

    async handleSubmit(e) {
        const form = e.target;
        const submitButton = form.querySelector('.btn-submit');
        submitButton.disabled = true;

        try {
            const formData = new FormData(form);
            const result = await window.sendFeedback(formData, window.serverData.userId);

            if (result.success) {
                this.hide();
                this.events.emit('success', result.message);
            } else {
                this.events.emit('error', result.message);
            }
        } catch (error) {
            console.error('Error in feedback submission:', error);
            this.events.emit('error', 'An unexpected error occurred');
        } finally {
            submitButton.disabled = false;
            form.reset();
        }
    }

    show() {
        this.element.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    hide() {
        this.element.classList.remove('show');
        document.body.style.overflow = '';
        this.element.querySelector('#feedback-form').reset();
    }
}

class SuccessAlert extends Component {
    constructor() {
        const element = document.getElementById('feedbackSuccessAlert');
        super(element);
        this.setupEventListeners();
    }

    setupEventListeners() {
        const closeButton = this.element.querySelector('.alert-button');
        closeButton?.addEventListener('click', () => this.hide());
    }

    show() {
        this.element.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    hide() {
        this.element.classList.remove('show');
        document.body.style.overflow = '';
    }
}

// Logout
class LogoutModal extends Component {
    constructor() {
        const element = document.getElementById('logoutConfirmModal');
        super(element);
        this.setupEventListeners();
        
        // Set URLs based on environment from serverData
        this.WEB_URL = window.serverData.environment === 'dev' 
            ? 'http://localhost:3000'
            : 'https://doclink.io';
    }

    setupEventListeners() {
        const logoutButton = this.element.querySelector('.alert-button');
        const cancelButton = this.element.querySelector('.btn-cancel');

        logoutButton?.addEventListener('click', () => {
            this.handleLogout();
        });

        cancelButton?.addEventListener('click', () => {
            this.hide();
        });
    }

    handleLogout() {
        try {
            // 1. Clear client-side app state
            localStorage.clear();
            sessionStorage.clear();
            
            // 2. Call FastAPI logout endpoint
            window.handleLogoutRequest(window.serverData.userId, window.serverData.sessionId)
            .finally(() => {
                // 3. Clear cookies manually as backup
                this.clearCookies();
                // 4. Redirect to signout
                window.location.href = `${this.WEB_URL}/api/auth/signout?callbackUrl=/`;
            });
    
        } catch (error) {
            console.error('Logout error:', error);
            window.location.href = this.WEB_URL;
        }
    }

    clearCookies() {
        const cookies = document.cookie.split(';');
        const domain = window.location.hostname;
        for (let cookie of cookies) {
            const name = cookie.split('=')[0].trim();
            document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=${domain}`;
            document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=.${domain}`;
        }
    }

    show() {
        this.element.classList.add('show');
        document.body.style.overflow = 'hidden';
    }

    hide() {
        this.element.classList.remove('show');
        document.body.style.overflow = '';
    }
}

// Rating Modal
class RatingModal extends Component {
    constructor() {
        const element = document.createElement('div');
        element.className = 'modal fade';
        element.id = 'ratingModal';
        element.setAttribute('tabindex', '-1');
        element.setAttribute('aria-hidden', 'true');
        super(element);
        
        this.rating = 0;
        
        this.render();
        this.setupEventListeners();
    }

    render() {
        this.element.innerHTML = `
        <div class="modal-dialog modal-dialog-centered">
            <div class="modal-content">
                <div class="domain-modal-wrapper">
                    <div class="modal-header border-0">
                        <h5 class="modal-title">How would you rate Doclink?</h5>
                        <button type="button" class="close-button" data-bs-dismiss="modal">
                            <i class="bi bi-x"></i>
                        </button>
                    </div>
                    <div class="modal-body text-center">
                        <div class="stars-container">
                            <div class="stars">
                                <i class="bi bi-star" data-rating="1"></i>
                                <i class="bi bi-star" data-rating="2"></i>
                                <i class="bi bi-star" data-rating="3"></i>
                                <i class="bi bi-star" data-rating="4"></i>
                                <i class="bi bi-star" data-rating="5"></i>
                            </div>
                        </div>
                        <div class="feedback-container">
                            <textarea class="feedback-input" placeholder="Share your thoughts..."></textarea>
                        </div>
                        <div class="text-center">
                            <button class="submit-button">Submit</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        `;

        document.body.appendChild(this.element);
        this.modal = new bootstrap.Modal(this.element);
    }

    setupEventListeners() {
        // Star rating handlers
        const stars = this.element.querySelectorAll('.stars i');
        stars.forEach((star, index) => {
            star.addEventListener('click', () => this.handleStarClick(index));
            star.addEventListener('mouseover', () => this.highlightStars(index));
            star.addEventListener('mouseout', () => this.updateStars());
        });

        // Close button handler
        const closeButton = this.element.querySelector('.close-button');
        closeButton.addEventListener('click', () => this.hide());

        // Submit button handler
        const submitButton = this.element.querySelector('.submit-button');
        submitButton.addEventListener('click', () => {
            const feedbackInput = this.element.querySelector('.feedback-input');
            this.sendRating(this.rating,feedbackInput.value)
            setTimeout(() => {
                this.hide();
            }, 1000);
        });

        // Click outside to close
        this.element.addEventListener('click', (e) => {
            if (e.target === this.element) {
                this.hide();
            }
        });
    }

    handleStarClick(index) {
        this.rating = index + 1;
        this.updateStars();
    }

    async sendRating(rating,user_note) {
        try {
            const result = await window.sendRating(rating, user_note, window.serverData.userId);

            if (result.success) {
                this.hide()
                this.events.emit('success', result.message);
            } else {
                this.events.emit('error', result.message);
            }
        } catch (error) {
            console.error('Error in rating submission:', error);
            this.events.emit('error', 'An unexpected error occurred');
        } finally {
            this.reset();
        }
    }

    highlightStars(index) {
        const stars = this.element.querySelectorAll('.stars i');
        stars.forEach((star, i) => {
            star.classList.remove('bi-star-fill', 'bi-star');
            if (i <= index) {
                star.classList.add('bi-star-fill');
                star.classList.add('active');
            } else {
                star.classList.add('bi-star');
                star.classList.remove('active');
            }
        });
    }

    updateStars() {
        const stars = this.element.querySelectorAll('.stars i');
        stars.forEach((star, i) => {
            star.classList.remove('bi-star-fill', 'bi-star', 'active');
            if (i < this.rating) {
                star.classList.add('bi-star-fill');
                star.classList.add('active');
            } else {
                star.classList.add('bi-star');
            }
        });
    }

    show() {
        this.modal.show();
        document.body.style.overflow = 'hidden';
    }

    hide() {
        this.modal.hide();
        document.body.style.overflow = '';
    }

    reset() {
        this.rating = 0;
        this.updateStars();
        const feedbackInput = this.element.querySelector('.feedback-input');
        if (feedbackInput) {
        feedbackInput.value = '';
        }
    }
}

// URLuploadModal
class URLInputModal extends Component {
    constructor() {
        const element = document.createElement('div');
        element.className = 'modal fade';
        element.id = 'urlInputModal';
        element.setAttribute('tabindex', '-1');
        element.setAttribute('aria-hidden', 'true');
        super(element);
        
        this.render();
        this.setupEventListeners();
        this.modal = null;

    }

    render() {
        this.element.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="domain-modal-wrapper">
                        <div class="modal-header border-0 d-flex align-items-center">
                            <h6 class="mb-0">Add content from URL</h6>
                            <button type="button" class="close-button" data-bs-dismiss="modal">
                                <i class="bi bi-x"></i>
                            </button>
                        </div>

                        <div class="upload-container">
                            <div class="url-input-container">
                                <input 
                                    type="url" 
                                    class="form-control url-input" 
                                    placeholder="Enter website URL..."
                                    required
                                >
                                <small class="text-secondary mt-2">
                                    Enter the URL of the webpage you want to add to your knowledge base
                                </small>
                            </div>

                            <button class="add-url-btn mt-3" disabled>
                                Add Content
                                <div class="url-progress">
                                    <div class="progress-bar"></div>
                                </div>
                            </button>

                            <div class="upload-loading-overlay" style="display: none">
                                <div class="loading-content">
                                    <div class="spinner-border text-primary-green mb-3" role="status">
                                        <span class="visually-hidden">Loading...</span>
                                    </div>
                                    <h5 class="mb-2">Processing URL...</h5>
                                    <p class="text-center mb-0">Please wait while we extract the content</p>
                                    <p class="text-center text-secondary">This might take a moment</p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(this.element);
        this.modal = new bootstrap.Modal(this.element);
    }

    setupEventListeners() {
        const urlInput = this.element.querySelector('.url-input');
        const addButton = this.element.querySelector('.add-url-btn');
        const closeButton = this.element.querySelector('.close-button');

        // Enable/disable add button based on URL input
        urlInput.addEventListener('input', () => {
            addButton.disabled = !urlInput.value.trim();
        });

        // URL processing
        addButton.addEventListener('click', () => {
            const url = urlInput.value; 
            this.startProcessing(url);
            urlInput.value = '';
        });

        // Close button handler
        closeButton.addEventListener('click', () => {
            this.hide();
        });

        // Click outside to close
        this.element.addEventListener('click', (e) => {
            if (e.target === this.element) {
                this.hide();
            }
        });
        
    }

    async startProcessing(url) {
        const clean_url = url.trim();
            if (!clean_url) return;

            this.setLoadingState(true);

            try {
                const success = await window.storeURL(window.serverData.userId, clean_url);

                if (success === 1) {
                    this.handleFileBasketAddition(clean_url)
                    this.events.emit('urlProcessed', {
                        message: 'Successfully processed URL',
                        type: 'success'
                    });
                    this.hide();
                } else {
                    throw new Error('Failed to process URL');
                }

            } catch (error) {
                this.events.emit('error', error.message);
            } finally {
                this.setLoadingState(false);
            }
    }

    handleFileBasketAddition(url) {
        try {
            // Create a clean filename from the URL
            const urlObj = new URL(url);
            const fileName = `${urlObj.hostname}.html`;
            
            // Create URL file object similar to drive file object
            const urlFile = {
                name: fileName,
                mimeType: 'text/html',
                lastModified: Date.now()
            };
    
            // Emit event for FileUploadModal to handle
            this.events.emit('urlProcessed', {
                files: [urlFile],
                message: 'Successfully processed URL',
                type: 'success'
            });
            
            this.hide();
            return true;
    
        } catch (error) {
            console.error('Error preparing URL file:', error);
            return false;
        }
    }

    setLoadingState(isLoading) {
        const loadingOverlay = this.element.querySelector('.upload-loading-overlay');
        const closeButton = this.element.querySelector('.close-button');
        const addButton = this.element.querySelector('.add-url-btn');

        if (isLoading) {
            loadingOverlay.style.display = 'flex';
            closeButton.style.display = 'none';
            addButton.disabled = true;
            this.modal._config.backdrop = 'static';
            this.modal._config.keyboard = false;
        } else {
            loadingOverlay.style.display = 'none';
            closeButton.style.display = 'block';
            addButton.disabled = false;
            this.modal._config.backdrop = true;
            this.modal._config.keyboard = true;
        }
    }

    show() {
        if (this.modal) {
            this.modal.dispose();
        }

        this.modal = new bootstrap.Modal(this.element);
        
        this.element.style.zIndex = '9999';
        
        this.modal.show();
        
        setTimeout(() => {
            const backdrop = document.querySelector('.modal-backdrop:last-child');
            if (backdrop) {
                backdrop.style.zIndex = '9998';
            }
        }, 0);
    }

    hide() {
        this.modal.hide();
        const urlInput = this.element.querySelector('.url-input');
        urlInput.value = '';
    }

}

// Add this class after other modal classes
class ProfileLimitsModal extends Component {
    constructor(domainManager) {
        const element = document.createElement('div');
        element.className = 'modal fade';
        element.id = 'profileLimitsModal';
        element.setAttribute('tabindex', '-1');
        element.setAttribute('aria-hidden', 'true');
        super(element);
        
        this.domainManager = domainManager;
        this.render();
        this.setupEventListeners();
        this.dailyQuestionsCount = 0; 
    }

    render() {
        this.element.innerHTML = `
            <div class="modal-dialog modal-dialog-centered">
                <div class="modal-content">
                    <div class="domain-modal-wrapper">
                        <div class="modal-header border-0">
                            <h5 class="modal-title">Usage Limits</h5>
                            <button type="button" class="close-button" data-bs-dismiss="modal">
                                <i class="bi bi-x"></i>
                            </button>
                        </div>
                        
                        <div class="limits-container">
                            <!-- Sources Limit -->
                            <div class="limit-indicator mb-3">
                                <div class="d-flex justify-content-between align-items-center mb-2">
                                    <div>
                                        <small class="text-secondary d-block">Total Sources</small>
                                        <small class="text-white-50">Upload limit across all domains</small>
                                    </div>
                                    <small class="text-secondary sources-count">0/20</small>
                                </div>
                                <div class="progress" style="height: 6px; background: rgba(255, 255, 255, 0.1);">
                                    <div class="progress-bar bg-primary-green" style="width: 0%"></div>
                                </div>
                            </div>

                            <!-- Domains Limit -->
                            <div class="limit-indicator mb-3">
                                <div class="d-flex justify-content-between align-items-center mb-2">
                                    <div>
                                        <small class="text-secondary d-block">Knowledge Bases</small>
                                        <small class="text-white-50">Number of domains you can create</small>
                                    </div>
                                    <small class="text-secondary domains-count">0/3</small>
                                </div>
                                <div class="progress" style="height: 6px; background: rgba(255, 255, 255, 0.1);">
                                    <div class="progress-bar bg-primary-green" style="width: 0%"></div>
                                </div>
                            </div>

                            <!-- Daily Questions Limit -->
                            <div class="limit-indicator">
                                <div class="d-flex justify-content-between align-items-center mb-2">
                                    <div>
                                        <small class="text-secondary d-block">Daily Questions</small>
                                        <small class="text-white-50">Resets daily at midnight UTC</small>
                                    </div>
                                    <small class="text-secondary questions-count">0/50</small>
                                </div>
                                <div class="progress" style="height: 6px; background: rgba(255, 255, 255, 0.1);">
                                    <div class="progress-bar bg-primary-green" style="width: 0%"></div>
                                </div>
                            </div>

                            <div class="upgrade-section mt-4 text-center">
                                <button class="upgrade-button">
                                    <i class="bi bi-gem me-2"></i>
                                    Upgrade to Premium
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(this.element);
    }

    updateLimits() {
        const domains = this.domainManager.getAllDomains();
        let totalSources = 0;

        domains.forEach(domain => {
            if (domain.fileCount) {
                totalSources += domain.fileCount;
            }
        });
        
        this.updateProgressBar('sources', totalSources, 20);

        const domainCount = domains.length;
        this.updateProgressBar('domains', domainCount, 3);

        this.updateProgressBar('questions', this.dailyQuestionsCount, 50);

    }

    updateDailyCount(count) {
        this.dailyQuestionsCount = count;
        if (this.element.classList.contains('show')) {
            this.updateProgressBar('questions', count, 50);
        }
    }

    updateProgressBar(type, current, max) {
        const countElement = this.element.querySelector(`.${type}-count`);
        const progressBar = countElement?.closest('.limit-indicator').querySelector('.progress-bar');
        
        if (countElement && progressBar) {
            const percentage = (current / max) * 100;
            countElement.textContent = `${current}/${max}`;
            progressBar.style.width = `${percentage}%`;
        }
    }

    setupEventListeners() {
        const upgradeButton = this.element.querySelector('.upgrade-button');
        upgradeButton?.addEventListener('click', () => {
            this.hide();
            window.app.premiumModal.show();
        });
    }

    show() {
        this.updateLimits();
        const modal = new bootstrap.Modal(this.element);
        modal.show();
    }

    hide() {
        const modal = bootstrap.Modal.getInstance(this.element);
        if (modal) {
            modal.hide();
        }
    }
}

// Application
class App {
    constructor() {
        this.domainManager = new DomainManager();
        this.sidebar = new Sidebar(this.domainManager);
        this.feedbackModal = new FeedbackModal();
        this.domainSettingsModal = new DomainSettingsModal(this.domainManager);
        this.fileUploadModal = new FileUploadModal(this.domainManager);
        this.events = new EventEmitter();
        this.userData = null;
        this.sourcesCount = 0;
        this.sourcesBox = document.querySelector('.sources-box');
        this.sourcesNumber = document.querySelector('.sources-number');
        this.chatManager = new ChatManager();
        this.premiumModal = new PremiumModal();
        this.successAlert = new SuccessAlert();
        this.logoutModal = new LogoutModal();
        this.ratingModal = new RatingModal();
        this.profileLimitsModal = new ProfileLimitsModal(this.domainManager);
        this.chatManager.disableChat();
        this.setupEventListeners();
    }

    updateUserInterface() {
        // Update user section in sidebar
        const userEmail = this.sidebar.element.querySelector('.user-email');
        const userAvatar = this.sidebar.element.querySelector('.user-avatar');
        
        userEmail.textContent = this.userData.user_info.user_email;
        userAvatar.textContent = this.userData.user_info.user_name[0].toUpperCase();
    }

    updateSourcesCount(count) {
        this.sourcesCount = count;
        if (this.sourcesNumber) {
            this.sourcesNumber.textContent = count;
            this.sourcesBox.setAttribute('count', count);
        }
    }

    setupEventListeners() {
        // Sidebar events
        this.sidebar.events.on('settingsClick', () => {
            this.domainSettingsModal.show();
        });

        this.sidebar.events.on('fileMenuClick', () => {
            const selectedDomain = this.domainManager.getSelectedDomain();
            if (!selectedDomain) {
                this.events.emit('warning', 'Please select a domain first');
                return;
            }
            this.fileUploadModal.show(selectedDomain.data.name);
            this.sidebar.events.emit('modalOpen');
        });

        this.sidebar.events.on('feedbackClick', () => {
            this.feedbackModal.show();
        });

        // Domain Settings Modal events
        this.domainSettingsModal.events.on('domainCreate', async (domainData) => {
            const domainCard = this.domainManager.addDomain({
                id: domainData.id,
                name: domainData.name
            });
        
            // Update the domains list in the modal
            this.domainSettingsModal.updateDomainsList(this.domainManager.getAllDomains());

            this.updateDomainCount();
            
            this.events.emit('message', {
                text: `Successfully created knowledge base ${domainData.name}`,
                type: 'success'
            });
        });

        this.domainSettingsModal.events.on('domainSearch', (searchTerm) => {
            const filteredDomains = this.domainManager.searchDomains(searchTerm);
            this.domainSettingsModal.updateDomainsList(filteredDomains);
        });

        this.domainSettingsModal.events.on('domainSelected', async (domainId) => {
            try {
                const success = await window.selectDomain(domainId, window.serverData.userId);
                
                if (success) {
                    const domain = this.domainManager.getDomain(domainId);
                    if (!domain) return;
        
                    // Update domain manager state and UI
                    this.domainManager.selectDomain(domainId);
                    this.sidebar.updateDomainSelection(domain.data);
                    
                    // Update header with domain name
                    this.chatManager.updateHeader(domain.data.name);
                    
                    const files = domain.data.files || [];
                    const fileIDS = domain.data.fileIDS || [];
                    this.sidebar.updateFileList(files, fileIDS);
                    
                    // Update sources count
                    this.updateSourcesCount(files.length);
                    
                    // Enable chat
                    this.chatManager.enableChat();
                    
                    this.events.emit('message', {
                        text: `Successfully switched to knowledge base ${domain.data.name}`,
                        type: 'success'
                    });
                }
            } catch (error) {
                this.events.emit('message', {
                    text: 'Failed to select knowledge base',
                    type: 'error'
                });
            }
        });

        const selectButton = this.domainSettingsModal.element.querySelector('.select-button');
        selectButton?.addEventListener('click', () => {
            const selectedCheckbox = this.domainSettingsModal.element.querySelector('.domain-checkbox:checked');
            if (selectedCheckbox) {
                const domainCard = selectedCheckbox.closest('.domain-card');
                const domainId = domainCard.dataset.domainId;
                this.domainSettingsModal.events.emit('domainSelected', domainId);
            }
        });

        this.domainSettingsModal.events.on('domainEdit', async ({ id, newName }) => {
            const success = this.domainManager.renameDomain(id, newName);
            if (success) {
                // If this is the currently selected domain, update the sidebar
                const selectedDomain = this.domainManager.getSelectedDomain();
                if (selectedDomain && selectedDomain.data.id === id) {
                    this.sidebar.updateDomainSelection(selectedDomain.data);
                }
                
                // Update the domains list in the modal
                this.domainSettingsModal.updateDomainsList(this.domainManager.getAllDomains());
                
                this.events.emit('message', {
                    text: `Successfully renamed knowledge base to ${newName}`,
                    type: 'success'
                });
            }
        });
        
        this.domainSettingsModal.events.on('warning', (message) => {
            this.events.emit('message', {
                text: message,
                type: 'warning'
            });
        });

        this.domainSettingsModal.events.on('domainDelete', async (domainId) => {
            const wasSelected = this.domainManager.getSelectedDomain()?.data.id === domainId;
            
            if (this.domainManager.deleteDomain(domainId)) {
                if (wasSelected) {
                    // Reset sidebar to default state
                    this.sidebar.updateDomainSelection(null);
                    this.sidebar.updateFileList([], []);
                    // Reset sources count
                    this.updateSourcesCount(0);
                    // Disable chat
                    this.chatManager.disableChat();
                }
                
                this.domainSettingsModal.updateDomainsList(this.domainManager.getAllDomains());
                
                this.updateDomainCount();

                this.events.emit('message', {
                    text: 'Knowledge Base successfully deleted',
                    type: 'success'
                });
            }
        });
        
        this.chatManager.events.on('ratingModalOpen', () => {
            setTimeout(() => {
                this.ratingModal.show();
            }, 500);
        });

        // File Upload Modal events
        this.fileUploadModal.events.on('filesUploaded', (data) => {
            const selectedDomain = this.domainManager.getSelectedDomain();
            if (selectedDomain) {
                // Access the nested data object
                selectedDomain.data.files = data.file_names;
                selectedDomain.data.fileIDS = data.file_ids;
                this.sidebar.updateFileList(data.file_names, data.file_ids);
                this.updateSourcesCount(data.file_names.length);
                this.domainManager.updateDomainFileCount(selectedDomain.data.id);
            }
        });

        this.fileUploadModal.events.on('warning', (message) => {
            this.events.emit('message', {
                text: message,
                type: 'warning'
            });
        });

        this.fileUploadModal.events.on('error', (message) => {
            this.events.emit('message', {
                text: message,
                type: 'error'
            });
        });

        this.fileUploadModal.events.on('modalClose', () => {
            this.sidebar.events.emit('modalClose');
        });

        // Feedback Modal events
        this.feedbackModal.events.on('feedbackSubmitted', (message) => {
            console.log(message);
        });
    
        this.feedbackModal.events.on('feedbackError', (error) => {
            console.error(error);
        });

        this.feedbackModal.events.on('success', (message) => {
            this.successAlert.show();
        });

        // Premium Modal Events
        const premiumLink = this.sidebar.element.querySelector('.premium-link');
        premiumLink?.addEventListener('click', (e) => {
            e.preventDefault();
            this.premiumModal.show();
        });

        // Logout event
        const logoutItem = this.sidebar.element.querySelector('.logout-item');
        logoutItem?.addEventListener('click', (e) => {
            e.preventDefault();
            this.logoutModal.show();
        });

        this.sidebar.events.on('showProfileLimits', () => {
            this.profileLimitsModal.show()
        });
        
    }

    // In App class initialization
    async init() {
        // Initialize
        this.userData = await window.fetchUserInfo(window.serverData.userId);
        if (!this.userData) {
            throw new Error('Failed to load user data');
        }

        // Update user interface with user data
        this.updateUserInterface()

        // Store domain data
        Object.keys(this.userData.domain_info).forEach(key => {
            const domainData = this.userData.domain_info[key];
            const domain = {
              id: key,
              name: domainData.domain_name,
              fileCount: domainData.file_names.length,
              files: domainData.file_names,
              fileIDS: domainData.file_ids
            };
            this.domainManager.addDomain(domain);
          });

        // Update UI with domain data
        this.domainSettingsModal.updateDomainsList(
            this.domainManager.getAllDomains()
        );

        // Add sidebar to DOM
        document.body.appendChild(this.sidebar.element);

        // Setup menu trigger
        const menuTrigger = document.querySelector('.menu-trigger');
        if (menuTrigger) {
            menuTrigger.addEventListener('click', () => {
                this.sidebar.events.emit('menuTrigger');
            });
        }

        // Welcome operations
        const isFirstTime = window.serverData.isFirstTime === 'True';
        if (isFirstTime) {
            localStorage.setItem('firstTime', 0);
            const firstTimeMsg = `[header]Welcome to Doclink${this.userData.user_info.user_name ? `, ${this.userData.user_info.user_name}` : ''}👋[/header]\nI've automatically set up your first knowledge base with helpful guide about using Doclink. You can always use this file to get any information about Doclink!\n[header]To get started[/header]\n- Ask any question about Doclink's features and capabilities \n- Try asking "What can Doclink do?" or "How do I organize my documents?"\n- The user guide has been uploaded to your first knowledge base\n- All answers will include source references\n\n[header]Quick Tips[/header]\n- Open & close navigation bar by hovering\n- Click ⚙️ to manage domains and documents\n- Upload files via "Add Sources" button after selecting a knowledge base\n- Check right panel for answer sources\n- Supports PDF, DOCX, Excel, PowerPoint, UDF and TXT formats\n- Create different domains for different topics\n- View highlighted source sections in answers\n- Use file checkboxes to control search scope`;
            this.chatManager.addMessage(firstTimeMsg, 'ai');

            const domains = this.domainManager.getAllDomains();
            if (domains.length > 0) {
                this.domainSettingsModal.events.emit('domainSelected', domains[0].id);
            }

        } else {
            // Regular welcome message for returning users
            this.chatManager.addMessage(
                `Welcome ${this.userData.user_info.user_name}, what can I find for you?`, 
                'ai'
            );
        }
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new App();
    window.app.init();

    const resourcesTrigger = document.querySelector('.resources-trigger');
    const resourcesContainer = document.querySelector('.resources-container');
    const mainContent = document.querySelector('.chat-container'); // Ana içerik

    if (resourcesTrigger && resourcesContainer) {
        resourcesTrigger.addEventListener('click', () => {
            resourcesContainer.classList.toggle('show');
            mainContent.classList.toggle('blur-content'); // Blur sınıfını ekle/kaldır

            if (resourcesContainer.classList.contains('show')) {
                backdrop.classList.add('show');
                document.body.style.overflow = 'hidden';
            } else {
                backdrop.classList.remove('show');
                document.body.style.overflow = '';
            }
        });

        // Backdrop'a tıklandığında resources'ı ve blur'u kapat
        backdrop.addEventListener('click', () => {
            resourcesContainer.classList.remove('show');
            mainContent.classList.remove('blur-content'); // Blur'u kaldır
            backdrop.classList.remove('show');
            document.body.style.overflow = '';
        });

        // Escape tuşu ile kapatma
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && resourcesContainer.classList.contains('show')) {
                resourcesContainer.classList.remove('show');
                mainContent.classList.remove('blur-content'); // Blur'u kaldır
                backdrop.classList.remove('show');
                document.body.style.overflow = '';
            }
        });
    }
    
});