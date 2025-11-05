// ==================== Constants ====================
const SNAP_RADIUS = 12;
const LINE_COLOR = "#2563eb";
const POINT_COLOR = "#2563eb";
const POLYGON_FILL_COLOR = "rgba(37, 99, 235, 0.25)";
const LINE_WIDTH = 3;

// ==================== State Management ====================
const state = {
    imageData: null,
    image: null,
    zoom: 1,
    pan: { x: 0, y: 0 },
    points: [],
    lines: [],
    polygons: [],
    calibration: null,
    currentLineStart: null,
    hoveredPoint: null,
    isPanning: false,
    panStart: { x: 0, y: 0 },
    cursorPosition: null,
    nearestSnapPoint: null,
    pendingCalibrationLine: null
};

// ==================== DOM Elements ====================
const elements = {
    // Canvas
    canvas: document.getElementById('measurementCanvas'),
    canvasWrapper: document.getElementById('canvasWrapper'),
    emptyState: document.getElementById('emptyState'),
    loadingState: document.getElementById('loadingState'),
    pointCounter: document.getElementById('pointCounter'),
    pointCount: document.getElementById('pointCount'),
    zoomControls: document.getElementById('zoomControls'),
    zoomLevel: document.getElementById('zoomLevel'),
    zoomInBtn: document.getElementById('zoomInBtn'),
    zoomOutBtn: document.getElementById('zoomOutBtn'),
    resetViewBtn: document.getElementById('resetViewBtn'),
    
    // Upload
    uploadArea: document.getElementById('uploadArea'),
    fileInput: document.getElementById('fileInput'),
    
    // Tool panel
    calibrationInfo: document.getElementById('calibrationInfo'),
    totalArea: document.getElementById('totalArea'),
    polygonsList: document.getElementById('polygonsList'),
    pointsList: document.getElementById('pointsList'),
    
    // Controls
    recalibrateBtn: document.getElementById('recalibrateBtn'),
    undoBtn: document.getElementById('undoBtn'),
    clearBtn: document.getElementById('clearBtn'),
    
    // Modal
    calibrationModal: document.getElementById('calibrationModal'),
    calibrationForm: document.getElementById('calibrationForm'),
    lengthInput: document.getElementById('lengthInput'),
    cancelCalibrationBtn: document.getElementById('cancelCalibrationBtn'),
    
    // Toast
    toast: document.getElementById('toast'),
    toastMessage: document.getElementById('toastMessage'),
    
    // Collapsible headers
    polygonsHeader: document.getElementById('polygonsHeader'),
    pointsHeader: document.getElementById('pointsHeader'),
    instructionsHeader: document.getElementById('instructionsHeader')
};

// ==================== Utility Functions ====================
function showToast(message, duration = 3000) {
    elements.toastMessage.textContent = message;
    elements.toast.classList.remove('hidden');
    
    setTimeout(() => {
        elements.toast.classList.add('hidden');
    }, duration);
}

function toggleCollapsible(header, content) {
    const isExpanded = header.getAttribute('aria-expanded') === 'true';
    header.setAttribute('aria-expanded', !isExpanded);
    content.classList.toggle('collapsed');
}

// ==================== Geometry Functions ====================
function calculateDistance(p1, p2) {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

function calculatePolygonArea(points, calibration) {
    if (points.length < 3 || !calibration) return 0;
    
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    area = Math.abs(area) / 2;
    
    const areaInSquareMeters = area / (calibration.pixelsPerMeter * calibration.pixelsPerMeter);
    return areaInSquareMeters;
}

// ==================== Canvas Functions ====================
function getCanvasPoint(clientX, clientY) {
    const rect = elements.canvas.getBoundingClientRect();
    const x = (clientX - rect.left - state.pan.x) / state.zoom;
    const y = (clientY - rect.top - state.pan.y) / state.zoom;
    
    return { 
        x, 
        y, 
        id: `point-${Date.now()}-${Math.random()}` 
    };
}

function findNearestPoint(point) {
    let nearest = null;
    let minDistance = SNAP_RADIUS;
    
    state.points.forEach(p => {
        const distance = calculateDistance(
            { x: p.x * state.zoom, y: p.y * state.zoom },
            { x: point.x * state.zoom, y: point.y * state.zoom }
        );
        
        if (distance < minDistance) {
            minDistance = distance;
            nearest = p;
        }
    });
    
    return nearest;
}

function renderCanvas() {
    const ctx = elements.canvas.getContext('2d');
    if (!ctx) return;
    
    // Clear canvas
    ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
    
    // Save context and apply transformations
    ctx.save();
    ctx.translate(state.pan.x, state.pan.y);
    ctx.scale(state.zoom, state.zoom);
    
    // Draw image
    if (state.image) {
        const maxWidth = elements.canvas.width / state.zoom - 40;
        const maxHeight = elements.canvas.height / state.zoom - 40;
        const scale = Math.min(maxWidth / state.image.width, maxHeight / state.image.height, 1);
        const width = state.image.width * scale;
        const height = state.image.height * scale;
        const x = (elements.canvas.width / state.zoom - width) / 2;
        const y = (elements.canvas.height / state.zoom - height) / 2;
        
        ctx.drawImage(state.image, x, y, width, height);
    }
    
    // Draw polygons
    state.polygons.forEach(polygon => {
        if (polygon.isClosed && polygon.points.length > 0) {
            ctx.fillStyle = POLYGON_FILL_COLOR;
            ctx.beginPath();
            ctx.moveTo(polygon.points[0].x, polygon.points[0].y);
            for (let i = 1; i < polygon.points.length; i++) {
                ctx.lineTo(polygon.points[i].x, polygon.points[i].y);
            }
            ctx.closePath();
            ctx.fill();
        }
    });
    
    // Draw lines
    state.lines.forEach(line => {
        ctx.strokeStyle = LINE_COLOR;
        ctx.lineWidth = LINE_WIDTH;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(line.startPoint.x, line.startPoint.y);
        ctx.lineTo(line.endPoint.x, line.endPoint.y);
        ctx.stroke();
        
        // Draw length label
        if (line.lengthInMeters !== undefined) {
            const midX = (line.startPoint.x + line.endPoint.x) / 2;
            const midY = (line.startPoint.y + line.endPoint.y) / 2;
            
            ctx.save();
            ctx.scale(1 / state.zoom, 1 / state.zoom);
            
            const text = `${line.lengthInMeters.toFixed(2)}m`;
            ctx.font = '500 16px Inter, sans-serif';
            const metrics = ctx.measureText(text);
            const padding = 6;
            
            const bgX = midX * state.zoom - metrics.width / 2 - padding;
            const bgY = midY * state.zoom - 12 - padding;
            const bgWidth = metrics.width + padding * 2;
            const bgHeight = 24 + padding * 2;
            
            ctx.fillStyle = 'rgba(37, 99, 235, 0.9)';
            ctx.beginPath();
            ctx.roundRect(bgX, bgY, bgWidth, bgHeight, 6);
            ctx.fill();
            
            ctx.fillStyle = 'white';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, midX * state.zoom, midY * state.zoom);
            
            ctx.restore();
        }
    });
    
    // Draw current line preview
    if (state.currentLineStart && state.cursorPosition) {
        const snapTarget = state.nearestSnapPoint || state.cursorPosition;
        
        ctx.strokeStyle = LINE_COLOR;
        ctx.lineWidth = LINE_WIDTH;
        ctx.lineCap = 'round';
        ctx.setLineDash([5, 5]);
        ctx.beginPath();
        ctx.moveTo(state.currentLineStart.x, state.currentLineStart.y);
        ctx.lineTo(snapTarget.x, snapTarget.y);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    
    // Draw points
    state.points.forEach(point => {
        const isHovered = state.nearestSnapPoint?.id === point.id;
        const isStart = state.currentLineStart?.id === point.id;
        
        if (isHovered) {
            ctx.strokeStyle = POINT_COLOR;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(point.x, point.y, 7, 0, Math.PI * 2);
            ctx.stroke();
        }
        
        ctx.fillStyle = isStart ? '#dc2626' : POINT_COLOR;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 5, 0, Math.PI * 2);
        ctx.fill();
    });
    
    ctx.restore();
}

// ==================== Polygon Detection ====================
function checkForClosedPolygon() {
    const pointConnections = new Map();
    
    state.lines.forEach(line => {
        if (!pointConnections.has(line.startPoint.id)) {
            pointConnections.set(line.startPoint.id, new Set());
        }
        if (!pointConnections.has(line.endPoint.id)) {
            pointConnections.set(line.endPoint.id, new Set());
        }
        pointConnections.get(line.startPoint.id).add(line.endPoint.id);
        pointConnections.get(line.endPoint.id).add(line.startPoint.id);
    });
    
    const visited = new Set();
    
    function findPolygon(start, current, path) {
        if (path.length > 2 && current === start) {
            return path;
        }
        
        if (visited.has(current) && current !== start) {
            return null;
        }
        
        visited.add(current);
        const connections = pointConnections.get(current);
        
        if (!connections) return null;
        
        for (const next of connections) {
            if (path.length > 0 && next === path[path.length - 1]) continue;
            
            const result = findPolygon(start, next, [...path, current]);
            if (result) return result;
        }
        
        visited.delete(current);
        return null;
    }
    
    for (const pointId of pointConnections.keys()) {
        if (state.polygons.some(p => p.points.some(pt => pt.id === pointId))) continue;
        
        visited.clear();
        const polygonPath = findPolygon(pointId, pointId, []);
        
        if (polygonPath && polygonPath.length >= 3) {
            const polygonPoints = polygonPath
                .map(id => state.points.find(p => p.id === id))
                .filter(Boolean);
            
            const polygonLines = state.lines.filter(line =>
                polygonPath.includes(line.startPoint.id) && polygonPath.includes(line.endPoint.id)
            );
            
            const area = calculatePolygonArea(polygonPoints, state.calibration);
            
            const newPolygon = {
                id: `polygon-${Date.now()}`,
                points: polygonPoints,
                lines: polygonLines,
                areaInSquareMeters: area,
                isClosed: true
            };
            
            state.polygons.push(newPolygon);
            
            showToast(`Polygon detected! Area: ${area.toFixed(2)} m²`);
            updateUI();
            
            break;
        }
    }
}

// ==================== Event Handlers ====================
function handleFileUpload(file) {
    if (!file) return;
    
    const fileType = file.type;
    elements.loadingState.classList.remove('hidden');
    elements.emptyState.classList.add('hidden');
    
    if (fileType === 'application/pdf') {
        const fileReader = new FileReader();
        fileReader.onload = async function(e) {
            try {
                const typedArray = new Uint8Array(e.target.result);
                const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
                const page = await pdf.getPage(1);
                const viewport = page.getViewport({ scale: 2 });
                
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                
                await page.render({
                    canvasContext: context,
                    viewport: viewport
                }).promise;
                
                const dataUrl = canvas.toDataURL();
                loadImage(dataUrl);
            } catch (error) {
                showToast('Error loading PDF file');
                elements.loadingState.classList.add('hidden');
                elements.emptyState.classList.remove('hidden');
            }
        };
        fileReader.readAsArrayBuffer(file);
    } else if (fileType.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = function(e) {
            loadImage(e.target.result);
        };
        reader.readAsDataURL(file);
    } else {
        showToast('Unsupported file type. Please upload JPG, PNG, or PDF');
        elements.loadingState.classList.add('hidden');
        elements.emptyState.classList.remove('hidden');
    }
}

function loadImage(dataUrl) {
    const img = new Image();
    img.onload = function() {
        state.image = img;
        state.imageData = dataUrl;
        
        elements.loadingState.classList.add('hidden');
        elements.canvas.classList.remove('hidden');
        elements.zoomControls.classList.remove('hidden');
        
        resizeCanvas();
        renderCanvas();
    };
    img.src = dataUrl;
}

function handleCanvasClick(e) {
    if (e.shiftKey || !state.image) return;
    
    const point = getCanvasPoint(e.clientX, e.clientY);
    const snappedPoint = findNearestPoint(point);
    const actualPoint = snappedPoint || point;
    
    if (!state.currentLineStart) {
        state.currentLineStart = actualPoint;
        if (!state.points.find(p => p.id === actualPoint.id)) {
            state.points.push(actualPoint);
        }
    } else {
        const newLine = {
            id: `line-${Date.now()}`,
            startPoint: state.currentLineStart,
            endPoint: actualPoint
        };
        
        if (!state.points.find(p => p.id === actualPoint.id)) {
            state.points.push(actualPoint);
        }
        
        if (!state.calibration) {
            state.pendingCalibrationLine = newLine;
            openCalibrationModal();
        } else {
            const pixelLength = calculateDistance(newLine.startPoint, newLine.endPoint);
            newLine.lengthInMeters = pixelLength / state.calibration.pixelsPerMeter;
            
            state.lines.push(newLine);
            checkForClosedPolygon();
        }
        
        state.currentLineStart = null;
    }
    
    updateUI();
    renderCanvas();
}

function handleMouseDown(e) {
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey)) {
        e.preventDefault();
        state.isPanning = true;
        state.panStart = { x: e.clientX - state.pan.x, y: e.clientY - state.pan.y };
        elements.canvas.classList.add('panning');
    }
}

function handleMouseMove(e) {
    if (state.isPanning) {
        state.pan = {
            x: e.clientX - state.panStart.x,
            y: e.clientY - state.panStart.y
        };
        renderCanvas();
        return;
    }
    
    const point = getCanvasPoint(e.clientX, e.clientY);
    state.cursorPosition = point;
    
    const nearest = findNearestPoint(point);
    state.nearestSnapPoint = nearest;
    state.hoveredPoint = nearest;
    
    if (nearest) {
        elements.canvas.classList.add('snap-cursor');
    } else {
        elements.canvas.classList.remove('snap-cursor');
    }
    
    renderCanvas();
}

function handleMouseUp() {
    state.isPanning = false;
    elements.canvas.classList.remove('panning');
}

function handleWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    state.zoom = Math.max(0.1, Math.min(5, state.zoom * delta));
    updateUI();
    renderCanvas();
}

function handleZoomIn() {
    state.zoom = Math.min(5, state.zoom * 1.2);
    updateUI();
    renderCanvas();
}

function handleZoomOut() {
    state.zoom = Math.max(0.1, state.zoom / 1.2);
    updateUI();
    renderCanvas();
}

function handleResetView() {
    state.zoom = 1;
    state.pan = { x: 0, y: 0 };
    updateUI();
    renderCanvas();
}

function handleClearAll() {
    state.points = [];
    state.lines = [];
    state.polygons = [];
    state.currentLineStart = null;
    state.hoveredPoint = null;
    updateUI();
    renderCanvas();
}

function handleUndoLastLine() {
    if (state.lines.length === 0) return;
    
    const lastLine = state.lines[state.lines.length - 1];
    state.lines.pop();
    
    state.polygons = state.polygons.filter(polygon =>
        !polygon.lines.some(line => line.id === lastLine.id)
    );
    
    updateUI();
    renderCanvas();
}

function handleRecalibrate() {
    state.calibration = null;
    state.lines = [];
    state.points = [];
    state.polygons = [];
    state.currentLineStart = null;
    updateUI();
    renderCanvas();
    showToast('Calibration reset. Draw a new reference line to recalibrate');
}

// ==================== Calibration Modal ====================
function openCalibrationModal() {
    elements.calibrationModal.showModal();
    elements.lengthInput.value = '';
    elements.lengthInput.focus();
}

function closeCalibrationModal() {
    elements.calibrationModal.close();
    state.pendingCalibrationLine = null;
}

function handleCalibrationSubmit(e) {
    e.preventDefault();
    
    const lengthInMeters = parseFloat(elements.lengthInput.value);
    
    if (!lengthInMeters || lengthInMeters <= 0) {
        showToast('Please enter a valid length');
        return;
    }
    
    if (!state.pendingCalibrationLine) return;
    
    const line = state.pendingCalibrationLine;
    const pixelLength = calculateDistance(line.startPoint, line.endPoint);
    
    state.calibration = {
        pixelLength,
        realLengthInMeters: lengthInMeters,
        pixelsPerMeter: pixelLength / lengthInMeters
    };
    
    line.lengthInMeters = lengthInMeters;
    state.lines.push(line);
    
    closeCalibrationModal();
    updateUI();
    renderCanvas();
    
    showToast(`Calibration complete. Scale: 1px = ${(1 / state.calibration.pixelsPerMeter).toFixed(4)}m`);
}

// ==================== UI Updates ====================
function updateUI() {
    // Update zoom level
    elements.zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;
    
    // Update point counter
    if (state.points.length > 0) {
        elements.pointCounter.classList.remove('hidden');
        elements.pointCount.textContent = state.points.length;
    } else {
        elements.pointCounter.classList.add('hidden');
    }
    
    // Update calibration info
    if (state.calibration) {
        elements.calibrationInfo.innerHTML = `
            <p class="info-text">Scale: 1px = ${(1 / state.calibration.pixelsPerMeter).toFixed(4)}m</p>
            <p class="info-text" style="margin-top: 0.5rem;">Reference: ${state.calibration.realLengthInMeters.toFixed(2)}m</p>
        `;
    } else {
        elements.calibrationInfo.innerHTML = '<p class="info-text">Draw a reference line first</p>';
    }
    
    // Update total area
    const totalArea = state.polygons.reduce((sum, p) => sum + p.areaInSquareMeters, 0);
    elements.totalArea.textContent = `${totalArea.toFixed(2)} m²`;
    
    // Update polygons list
    if (state.polygons.length > 0) {
        elements.polygonsList.innerHTML = state.polygons.map((polygon, index) => `
            <div class="polygon-item">
                <div class="polygon-name">Polygon ${index + 1}</div>
                <div class="polygon-area">${polygon.areaInSquareMeters.toFixed(2)} m²</div>
            </div>
        `).join('');
    } else {
        elements.polygonsList.innerHTML = '<p class="info-text">No polygons detected</p>';
    }
    
    // Update points list
    if (state.points.length > 0) {
        elements.pointsList.innerHTML = state.points.map((point, index) => `
            <div class="point-item">Point ${index + 1}: (${Math.round(point.x)}, ${Math.round(point.y)})</div>
        `).join('');
    } else {
        elements.pointsList.innerHTML = '<p class="info-text">No points yet</p>';
    }
    
    // Update button states
    elements.recalibrateBtn.disabled = !state.calibration;
    elements.undoBtn.disabled = state.lines.length === 0;
    elements.clearBtn.disabled = state.points.length === 0;
}

function resizeCanvas() {
    const wrapper = elements.canvasWrapper;
    elements.canvas.width = wrapper.clientWidth;
    elements.canvas.height = wrapper.clientHeight;
    renderCanvas();
}

// ==================== Event Listeners ====================
function initEventListeners() {
    // File upload
    elements.uploadArea.addEventListener('click', () => {
        elements.fileInput.click();
    });
    
    elements.fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFileUpload(e.target.files[0]);
        }
    });
    
    // Canvas interactions
    elements.canvas.addEventListener('click', handleCanvasClick);
    elements.canvas.addEventListener('mousedown', handleMouseDown);
    elements.canvas.addEventListener('mousemove', handleMouseMove);
    elements.canvas.addEventListener('mouseup', handleMouseUp);
    elements.canvas.addEventListener('mouseleave', handleMouseUp);
    elements.canvas.addEventListener('wheel', handleWheel);
    elements.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    
    // Zoom controls
    elements.zoomInBtn.addEventListener('click', handleZoomIn);
    elements.zoomOutBtn.addEventListener('click', handleZoomOut);
    elements.resetViewBtn.addEventListener('click', handleResetView);
    
    // Control buttons
    elements.recalibrateBtn.addEventListener('click', handleRecalibrate);
    elements.undoBtn.addEventListener('click', handleUndoLastLine);
    elements.clearBtn.addEventListener('click', handleClearAll);
    
    // Calibration modal
    elements.calibrationForm.addEventListener('submit', handleCalibrationSubmit);
    elements.cancelCalibrationBtn.addEventListener('click', closeCalibrationModal);
    
    // Collapsible sections
    elements.polygonsHeader.addEventListener('click', () => {
        toggleCollapsible(elements.polygonsHeader, elements.polygonsList);
    });
    
    elements.pointsHeader.addEventListener('click', () => {
        toggleCollapsible(elements.pointsHeader, elements.pointsList);
    });
    
    elements.instructionsHeader.addEventListener('click', () => {
        toggleCollapsible(elements.instructionsHeader, document.getElementById('instructionsContent'));
    });
    
    // Window resize
    window.addEventListener('resize', resizeCanvas);
}

// ==================== Initialization ====================
function init() {
    // Set initial collapsible states
    elements.polygonsHeader.setAttribute('aria-expanded', 'true');
    elements.pointsHeader.setAttribute('aria-expanded', 'false');
    elements.instructionsHeader.setAttribute('aria-expanded', 'false');
    
    // Initialize event listeners
    initEventListeners();
    
    // Initial UI update
    updateUI();
    
    // Resize canvas to fit container
    resizeCanvas();
}

// Start the application
document.addEventListener('DOMContentLoaded', init);
