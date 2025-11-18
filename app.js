// ==================== Constants ====================
const SNAP_RADIUS = 12;
const LINE_COLOR = "#2563eb";
const PIPE_COLOR = "#16a34a";
const RECTANGLE_COLOR = "#7c3aed";
const SUBTRACT_COLOR = "#dc2626";
const POINT_COLOR = "#2563eb";
const POLYGON_FILL_COLOR = "rgba(37, 99, 235, 0.25)";
const SUBTRACT_FILL_COLOR = "rgba(220, 38, 38, 0.25)";
const LINE_WIDTH = 3;
const ANGLE_SNAP_TOLERANCE = 5; // degrees - snap to 90° angles within this tolerance

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
    currentTool: 'line', // 'line', 'rectangle', 'pipe', 'subtract'
    currentLineStart: null,
    currentRectangleStart: null,
    isDrawingRectangle: false,
    justFinishedRectangle: false, // Flag to prevent starting new drawing immediately after rectangle
    hoveredPoint: null,
    isPanning: false,
    panStart: { x: 0, y: 0 },
    cursorPosition: null,
    nearestSnapPoint: null,
    pendingCalibrationLine: null,
    showLengthLabels: true, // Toggle for showing/hiding line length labels
    angleSnapEnabled: true // Toggle for 90-degree angle snapping
};

// ==================== DOM Elements ====================
const elements = {
    // Canvas
    canvas: document.getElementById('measurementCanvas'),
    canvasWrapper: document.getElementById('canvasWrapper'),
    emptyState: document.getElementById('emptyState'),
    loadingState: document.getElementById('loadingState'),
    zoomControls: document.getElementById('zoomControls'),
    zoomLevel: document.getElementById('zoomLevel'),
    zoomInBtn: document.getElementById('zoomInBtn'),
    zoomOutBtn: document.getElementById('zoomOutBtn'),
    resetViewBtn: document.getElementById('resetViewBtn'),
    
    // Upload
    uploadArea: document.getElementById('uploadArea'),
    fileInput: document.getElementById('fileInput'),
    
    // Tool panel
    projectNameInput: document.getElementById('projectNameInput'),
    screenshotBtn: document.getElementById('screenshotBtn'),
    toolLine: document.getElementById('toolLine'),
    toolRectangle: document.getElementById('toolRectangle'),
    toolPipe: document.getElementById('toolPipe'),
    toolSubtract: document.getElementById('toolSubtract'),
    calibrationInfo: document.getElementById('calibrationInfo'),
    totalArea: document.getElementById('totalArea'),
    polygonsList: document.getElementById('polygonsList'),
    pipesList: document.getElementById('pipesList'),
    pipesHeader: document.getElementById('pipesHeader'),
    pointsList: document.getElementById('pointsList'),
    
    // Controls
    newProjectBtn: document.getElementById('newProjectBtn'),
    recalibrateBtn: document.getElementById('recalibrateBtn'),
    undoBtn: document.getElementById('undoBtn'),
    clearBtn: document.getElementById('clearBtn'),
    toggleLengthLabelsBtn: document.getElementById('toggleLengthLabelsBtn'),
    toggleAngleSnapBtn: document.getElementById('toggleAngleSnapBtn'),
    
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

// Check if a point is inside a polygon using ray casting algorithm
function isPointInPolygon(point, polygonPoints) {
    let inside = false;
    for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i++) {
        const xi = polygonPoints[i].x;
        const yi = polygonPoints[i].y;
        const xj = polygonPoints[j].x;
        const yj = polygonPoints[j].y;
        
        const intersect = ((yi > point.y) !== (yj > point.y)) &&
            (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// Check if a polygon overlaps with another polygon (simplified - checks if center is inside)
function doesPolygonOverlap(newPolygonPoints, existingPolygon) {
    // Check if center of new polygon is inside existing polygon
    const centerX = newPolygonPoints.reduce((sum, p) => sum + p.x, 0) / newPolygonPoints.length;
    const centerY = newPolygonPoints.reduce((sum, p) => sum + p.y, 0) / newPolygonPoints.length;
    const center = { x: centerX, y: centerY };
    
    return isPointInPolygon(center, existingPolygon.points);
}

// Find polygon that contains the new polygon
function findContainingPolygon(newPolygonPoints) {
    for (const polygon of state.polygons) {
        if (polygon.isClosed && polygon.points.length >= 3) {
            // Check if center of new polygon is inside this polygon
            if (doesPolygonOverlap(newPolygonPoints, polygon)) {
                return polygon;
            }
        }
    }
    return null;
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

// Snap to 90-degree angles (0°, 90°, 180°, 270°)
function snapToAngle(startPoint, endPoint) {
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    
    // Calculate angle in degrees
    const angleRad = Math.atan2(dy, dx);
    const angleDeg = angleRad * (180 / Math.PI);
    
    // Normalize to 0-360
    const normalizedAngle = ((angleDeg % 360) + 360) % 360;
    
    // Check if close to any 90° angle
    const snapAngles = [0, 90, 180, 270];
    let targetAngle = null;
    
    for (const snapAngle of snapAngles) {
        const diff = Math.abs(normalizedAngle - snapAngle);
        const wrappedDiff = Math.min(diff, 360 - diff);
        
        if (wrappedDiff <= ANGLE_SNAP_TOLERANCE) {
            targetAngle = snapAngle;
            break;
        }
    }
    
    // If no snap angle found, return original point
    if (targetAngle === null) {
        return endPoint;
    }
    
    // Calculate snapped position
    const distance = Math.sqrt(dx * dx + dy * dy);
    const targetAngleRad = targetAngle * (Math.PI / 180);
    
    return {
        x: startPoint.x + distance * Math.cos(targetAngleRad),
        y: startPoint.y + distance * Math.sin(targetAngleRad),
        isAngleSnapped: true,
        snappedAngle: targetAngle
    };
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
    
    // Draw image (will be scaled by ctx.scale transformation)
    if (state.image) {
        // Calculate initial fit size (at zoom=1.0)
        const maxWidth = elements.canvas.width - 40;
        const maxHeight = elements.canvas.height - 40;
        const scale = Math.min(maxWidth / state.image.width, maxHeight / state.image.height, 1);
        const width = state.image.width * scale;
        const height = state.image.height * scale;
        
        // Position in transformed space (will be scaled by zoom)
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
            
            // Draw merged polygons (polygons that were merged into this one)
            if (polygon.mergedPolygons && polygon.mergedPolygons.length > 0) {
                polygon.mergedPolygons.forEach(mergedPolygon => {
                    if (mergedPolygon.isClosed && mergedPolygon.points && mergedPolygon.points.length > 0) {
                        ctx.fillStyle = POLYGON_FILL_COLOR;
                        ctx.beginPath();
                        ctx.moveTo(mergedPolygon.points[0].x, mergedPolygon.points[0].y);
                        for (let i = 1; i < mergedPolygon.points.length; i++) {
                            ctx.lineTo(mergedPolygon.points[i].x, mergedPolygon.points[i].y);
                        }
                        ctx.closePath();
                        ctx.fill();
                    }
                });
            }
            
            // Draw subtract polygons (holes) if any
            if (polygon.subtracts && polygon.subtracts.length > 0) {
                polygon.subtracts.forEach(subtract => {
                    ctx.fillStyle = SUBTRACT_FILL_COLOR;
                    ctx.beginPath();
                    ctx.moveTo(subtract.points[0].x, subtract.points[0].y);
                    for (let i = 1; i < subtract.points.length; i++) {
                        ctx.lineTo(subtract.points[i].x, subtract.points[i].y);
                    }
                    ctx.closePath();
                    ctx.fill();
                    
                    // Draw subtract outline
                    ctx.strokeStyle = SUBTRACT_COLOR;
                    ctx.lineWidth = LINE_WIDTH / state.zoom;
                    ctx.stroke();
                });
            }
        }
    });
    
    // Rectangles are now drawn as polygons, but we can style them differently if needed
    // The polygon rendering above will handle rectangles too
    
    // Draw lines with fixed visual width (not affected by zoom)
    state.lines.forEach(line => {
        const isPipe = line.isPipe === true;
        const isSubtract = line.isSubtract === true;
        
        // Check if this line is part of a subtract polygon (don't show label for subtract lines)
        const isPartOfSubtractPolygon = state.polygons.some(polygon => 
            polygon.subtracts && polygon.subtracts.some(subtract => 
                subtract.lines && subtract.lines.some(l => l.id === line.id)
            )
        );
        
        ctx.strokeStyle = isPipe ? PIPE_COLOR : (isSubtract ? SUBTRACT_COLOR : LINE_COLOR);
        ctx.lineWidth = LINE_WIDTH / state.zoom;  // Fixed screen width
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(line.startPoint.x, line.startPoint.y);
        ctx.lineTo(line.endPoint.x, line.endPoint.y);
        ctx.stroke();
        
        // Draw length label (skip labels for lines that are part of subtract polygons)
        if (state.showLengthLabels && line.lengthInMeters !== undefined && !isPartOfSubtractPolygon && line.lengthInMeters > 0) {
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
            
            ctx.fillStyle = isPipe ? 'rgba(22, 163, 74, 0.9)' : (isSubtract ? 'rgba(220, 38, 38, 0.9)' : 'rgba(37, 99, 235, 0.9)');
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
    
    // Draw current rectangle preview
    if (state.currentRectangleStart && state.cursorPosition) {
        const x1 = state.currentRectangleStart.x;
        const y1 = state.currentRectangleStart.y;
        const x2 = state.cursorPosition.x;
        const y2 = state.cursorPosition.y;
        
        const x = Math.min(x1, x2);
        const y = Math.min(y1, y2);
        const width = Math.abs(x2 - x1);
        const height = Math.abs(y2 - y1);
        
        const isSubtract = state.currentTool === 'subtract';
        ctx.strokeStyle = isSubtract ? SUBTRACT_COLOR : RECTANGLE_COLOR;
        ctx.lineWidth = LINE_WIDTH / state.zoom;
        ctx.setLineDash([5 / state.zoom, 5 / state.zoom]);
        ctx.beginPath();
        ctx.roundRect(x, y, width, height, 0);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Fill preview for subtract mode
        if (isSubtract) {
            ctx.fillStyle = SUBTRACT_FILL_COLOR;
            ctx.beginPath();
            ctx.roundRect(x, y, width, height, 0);
            ctx.fill();
        }
    }
    
    // Draw current line preview with fixed visual width
    if (state.currentLineStart && state.cursorPosition) {
        const snapTarget = state.nearestSnapPoint || state.cursorPosition;
        
        // Check if angle snapped
        const isAngleSnapped = state.cursorPosition.isAngleSnapped;
        const isPipe = state.currentTool === 'pipe';
        const isSubtract = state.currentTool === 'subtract';
        
        ctx.strokeStyle = isAngleSnapped ? '#16a34a' : (isPipe ? PIPE_COLOR : (isSubtract ? SUBTRACT_COLOR : LINE_COLOR));
        ctx.lineWidth = LINE_WIDTH / state.zoom;  // Fixed screen width
        ctx.lineCap = 'round';
        
        // Solid line when angle-snapped, dashed otherwise
        if (!isAngleSnapped) {
            ctx.setLineDash([5 / state.zoom, 5 / state.zoom]);  // Fixed dash size
        }
        
        ctx.beginPath();
        ctx.moveTo(state.currentLineStart.x, state.currentLineStart.y);
        ctx.lineTo(snapTarget.x, snapTarget.y);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Show angle indicator when angle-snapped
        if (isAngleSnapped) {
            const midX = (state.currentLineStart.x + snapTarget.x) / 2;
            const midY = (state.currentLineStart.y + snapTarget.y) / 2;
            
            ctx.save();
            ctx.scale(1 / state.zoom, 1 / state.zoom);
            
            const angleText = `${state.cursorPosition.snappedAngle}°`;
            ctx.font = '600 14px Inter, sans-serif';
            const metrics = ctx.measureText(angleText);
            const padding = 4;
            
            const bgX = midX * state.zoom - metrics.width / 2 - padding;
            const bgY = midY * state.zoom - 10 - padding;
            const bgWidth = metrics.width + padding * 2;
            const bgHeight = 20 + padding * 2;
            
            ctx.fillStyle = 'rgba(22, 163, 74, 0.9)'; // Green background
            ctx.beginPath();
            ctx.roundRect(bgX, bgY, bgWidth, bgHeight, 4);
            ctx.fill();
            
            ctx.fillStyle = 'white';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(angleText, midX * state.zoom, midY * state.zoom);
            
            ctx.restore();
        }
    }
    
    // Draw points with fixed visual size (not affected by zoom)
    state.points.forEach(point => {
        const isHovered = state.nearestSnapPoint?.id === point.id;
        const isStart = state.currentLineStart?.id === point.id;
        
        if (isHovered) {
            ctx.strokeStyle = POINT_COLOR;
            ctx.lineWidth = 2 / state.zoom;  // Fixed screen width
            ctx.beginPath();
            ctx.arc(point.x, point.y, 7 / state.zoom, 0, Math.PI * 2);  // Fixed screen size
            ctx.stroke();
        }
        
        ctx.fillStyle = isStart ? '#dc2626' : POINT_COLOR;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 5 / state.zoom, 0, Math.PI * 2);  // Fixed screen size
        ctx.fill();
    });
    
    ctx.restore();
}

// ==================== Polygon Detection ====================
function checkForClosedPolygon() {
    const pointConnections = new Map();
    
    // Ignore pipes when detecting polygons - pipes only calculate length
    state.lines.forEach(line => {
        if (line.isPipe === true) return; // Skip pipes
        
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
                polygonPath.includes(line.startPoint.id) && polygonPath.includes(line.endPoint.id) && !line.isPipe
            );
            
            const area = calculatePolygonArea(polygonPoints, state.calibration);
            
            // Check if subtract mode is active
            if (state.currentTool === 'subtract') {
                const containingPolygon = findContainingPolygon(polygonPoints);
                if (containingPolygon) {
                    // Subtract area from containing polygon
                    containingPolygon.areaInSquareMeters = Math.max(0, containingPolygon.areaInSquareMeters - area);
                    
                    // Add subtract polygon to containing polygon's subtract list
                    if (!containingPolygon.subtracts) {
                        containingPolygon.subtracts = [];
                    }
                    
                    const subtractPolygon = {
                        id: `subtract-${Date.now()}`,
                        points: polygonPoints,
                        lines: polygonLines,
                        areaInSquareMeters: area,
                        isClosed: true
                    };
                    
                    containingPolygon.subtracts.push(subtractPolygon);
                    
                    showToast(`Area subtracted! Remaining: ${containingPolygon.areaInSquareMeters.toFixed(2)} m²`);
                    // Stop drawing after successful subtract
                    state.currentLineStart = null;
                    state.cursorPosition = null; // Clear cursor position to prevent line preview
                    updateUI();
                    break;
                } else {
                    showToast('No polygon found to subtract from. Draw polygon inside an existing polygon.');
                    // Stop drawing after failed subtract attempt
                    state.currentLineStart = null;
                    state.cursorPosition = null; // Clear cursor position to prevent line preview
                    break;
                }
            }
            
            const newPolygon = {
                id: `polygon-${Date.now()}`,
                points: polygonPoints,
                lines: polygonLines,
                areaInSquareMeters: area,
                isClosed: true,
                name: `Polygon ${state.polygons.length + 1}`
            };
            
            state.polygons.push(newPolygon);
            
            showToast(`Polygon detected! Area: ${area.toFixed(2)} m²`);
            updateUI();
            
            break;
        }
    }
    
    // In subtract mode, if no closed polygon was found after completing a line,
    // stop drawing to prevent continuous line drawing
    if (state.currentTool === 'subtract' && state.currentLineStart !== null) {
        state.currentLineStart = null;
        state.cursorPosition = null; // Clear cursor position to prevent line preview
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
    
    // Rectangle tool uses drag (mousedown/mouseup), not click
    if (state.currentTool === 'rectangle') {
        return;
    }
    
    // Rectangle tool uses drag (mousedown/mouseup), not click
    if ((state.currentTool === 'subtract') && state.isDrawingRectangle) {
        return;
    }
    
    // Prevent starting new drawing immediately after finishing a rectangle
    if (state.justFinishedRectangle) {
        return;
    }
    
    // Subtract tool with rectangle uses drag
    if (state.currentTool === 'subtract' && !state.currentLineStart) {
        // Allow subtract tool to work with lines, but rectangle uses drag
        // This will be handled in handleMouseDown/handleMouseUp
    }
    
    const point = getCanvasPoint(e.clientX, e.clientY);
    
    // Handle line and pipe tools
    // Point snapping takes priority
    let snappedPoint = findNearestPoint(point);
    let actualPoint = snappedPoint || point;
    
    // Apply angle snapping if drawing a line and not point-snapped
    if (state.currentLineStart && !snappedPoint && state.angleSnapEnabled) {
        const angleSnappedPoint = snapToAngle(state.currentLineStart, point);
        if (angleSnappedPoint.isAngleSnapped) {
            // Check again if angle-snapped point is near an existing point
            const nearestToSnapped = findNearestPoint(angleSnappedPoint);
            if (nearestToSnapped) {
                actualPoint = nearestToSnapped;
            } else {
                // Create a proper point object with ID for angle-snapped position
                actualPoint = {
                    x: angleSnappedPoint.x,
                    y: angleSnappedPoint.y,
                    id: `point-${Date.now()}-${Math.random()}`
                };
            }
        }
    }
    
    if (!state.currentLineStart) {
        state.currentLineStart = actualPoint;
        if (!state.points.find(p => p.id === actualPoint.id)) {
            state.points.push(actualPoint);
        }
    } else {
        const newLine = {
            id: `line-${Date.now()}`,
            startPoint: state.currentLineStart,
            endPoint: actualPoint,
            isPipe: state.currentTool === 'pipe',
            isSubtract: state.currentTool === 'subtract'
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
            // Only check for polygons if it's not a pipe
            // For subtract mode, check for closed polygon to subtract
            if (newLine.isPipe !== true) {
                checkForClosedPolygon();
            }
            
            // In subtract mode, always stop drawing after completing a line
            // This ensures drawing stops even if no closed polygon was found
            if (state.currentTool === 'subtract') {
                state.currentLineStart = null;
                state.cursorPosition = null; // Clear cursor position to prevent line preview
            }
        }
        
        // Always stop drawing after completing a line (for non-subtract tools)
        if (state.currentTool !== 'subtract') {
            state.currentLineStart = null;
        }
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
        return;
    }
    
    // Handle rectangle tool drag start (including subtract mode)
    if (e.button === 0 && (state.currentTool === 'rectangle' || state.currentTool === 'subtract') && !state.currentRectangleStart) {
        e.preventDefault();
        const point = getCanvasPoint(e.clientX, e.clientY);
        state.currentRectangleStart = point;
        state.isDrawingRectangle = true;
        if (!state.points.find(p => p.id === point.id)) {
            state.points.push(point);
        }
        renderCanvas();
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
    
    // Handle rectangle preview
    if (state.currentRectangleStart) {
        state.cursorPosition = point; // Only set cursor position when drawing rectangle
        renderCanvas();
        return;
    }
    
    // For rectangle tool, don't show line preview - only rectangle preview when dragging
    if (state.currentTool === 'rectangle') {
        state.cursorPosition = null; // Don't set cursor position for rectangle tool when not drawing
        state.nearestSnapPoint = null;
        state.hoveredPoint = null;
        elements.canvas.classList.remove('snap-cursor');
        renderCanvas();
        return;
    }
    
    // For subtract tool, only show preview when actively drawing (rectangle or line)
    // Don't show line preview when not actively drawing
    if (state.currentTool === 'subtract' && !state.currentRectangleStart && !state.currentLineStart) {
        state.cursorPosition = null; // Don't set cursor position for subtract tool when not drawing
        state.nearestSnapPoint = null;
        state.hoveredPoint = null;
        elements.canvas.classList.remove('snap-cursor');
        renderCanvas();
        return;
    }
    
    // Set cursor position for other tools or when actively drawing
    state.cursorPosition = point;
    
    // First check for point snapping (takes priority over angle snapping)
    let nearest = findNearestPoint(point);
    
    // If drawing a line and not snapping to a point, apply angle snapping
    if (state.currentLineStart && !nearest && state.angleSnapEnabled && (state.currentTool === 'line' || state.currentTool === 'pipe' || state.currentTool === 'subtract')) {
        const snappedPoint = snapToAngle(state.currentLineStart, point);
        if (snappedPoint.isAngleSnapped) {
            state.cursorPosition = snappedPoint;
            // Check again if angle-snapped position is near an existing point
            // Magnetic snap takes priority even after angle snap
            nearest = findNearestPoint(snappedPoint);
        }
    }
    
    state.nearestSnapPoint = nearest;
    state.hoveredPoint = nearest;
    
    if (nearest) {
        elements.canvas.classList.add('snap-cursor');
    } else {
        elements.canvas.classList.remove('snap-cursor');
    }
    
    renderCanvas();
}

function handleMouseUp(e) {
    const wasDrawingRectangle = state.isDrawingRectangle;
    state.isPanning = false;
    elements.canvas.classList.remove('panning');
    
    // Handle rectangle tool drag end (including subtract mode)
    if ((state.currentTool === 'rectangle' || state.currentTool === 'subtract') && state.currentRectangleStart && state.isDrawingRectangle && e.button === 0) {
        e.preventDefault();
        const point = getCanvasPoint(e.clientX, e.clientY);
        
        if (!state.points.find(p => p.id === point.id)) {
            state.points.push(point);
        }
        
        // Create rectangle as a polygon with 4 points
        const x1 = state.currentRectangleStart.x;
        const y1 = state.currentRectangleStart.y;
        const x2 = point.x;
        const y2 = point.y;
        
        // Create 4 corner points for the rectangle
        const topLeft = { x: Math.min(x1, x2), y: Math.min(y1, y2), id: state.currentRectangleStart.id };
        const topRight = { x: Math.max(x1, x2), y: Math.min(y1, y2), id: `point-${Date.now()}-${Math.random()}` };
        const bottomRight = { x: Math.max(x1, x2), y: Math.max(y1, y2), id: point.id };
        const bottomLeft = { x: Math.min(x1, x2), y: Math.max(y1, y2), id: `point-${Date.now()}-${Math.random()}` };
        
        // Add new points if they don't exist
        [topRight, bottomLeft].forEach(p => {
            if (!state.points.find(pt => pt.id === p.id)) {
                state.points.push(p);
            }
        });
        
        const rectanglePoints = [topLeft, topRight, bottomRight, bottomLeft];
        
        // Calculate area
        let area = 0;
        if (state.calibration) {
            area = calculatePolygonArea(rectanglePoints, state.calibration);
        }
        
        // Create lines for the rectangle
        const isSubtract = state.currentTool === 'subtract';
        const rectangleLines = [
            { id: `line-${Date.now()}-1`, startPoint: topLeft, endPoint: topRight, isSubtract: isSubtract },
            { id: `line-${Date.now()}-2`, startPoint: topRight, endPoint: bottomRight, isSubtract: isSubtract },
            { id: `line-${Date.now()}-3`, startPoint: bottomRight, endPoint: bottomLeft, isSubtract: isSubtract },
            { id: `line-${Date.now()}-4`, startPoint: bottomLeft, endPoint: topLeft, isSubtract: isSubtract }
        ];
        
        // Add lines to state
        rectangleLines.forEach(line => {
            if (state.calibration) {
                const pixelLength = calculateDistance(line.startPoint, line.endPoint);
                line.lengthInMeters = pixelLength / state.calibration.pixelsPerMeter;
            }
            state.lines.push(line);
        });
        
        // Check if subtract mode is active
        if (state.currentTool === 'subtract') {
            const containingPolygon = findContainingPolygon(rectanglePoints);
            if (containingPolygon) {
                // Subtract area from containing polygon
                containingPolygon.areaInSquareMeters = Math.max(0, containingPolygon.areaInSquareMeters - area);
                
                // Add subtract polygon to containing polygon's subtract list
                if (!containingPolygon.subtracts) {
                    containingPolygon.subtracts = [];
                }
                
                const subtractPolygon = {
                    id: `subtract-${Date.now()}`,
                    points: rectanglePoints,
                    lines: rectangleLines,
                    areaInSquareMeters: area,
                    isClosed: true,
                    isRectangle: true
                };
                
                containingPolygon.subtracts.push(subtractPolygon);
                
                showToast(`Area subtracted! Remaining: ${containingPolygon.areaInSquareMeters.toFixed(2)} m²`);
                state.currentRectangleStart = null;
                state.currentLineStart = null;
                state.cursorPosition = null; // Clear cursor position to prevent line preview
                state.isDrawingRectangle = false;
                state.justFinishedRectangle = true; // Set flag to prevent immediate new drawing
                // Clear flag after a short delay to allow normal drawing to resume
                setTimeout(() => {
                    state.justFinishedRectangle = false;
                }, 100);
                updateUI();
                renderCanvas();
                return;
            } else {
                showToast('No polygon found to subtract from. Draw rectangle inside an existing polygon.');
                state.currentRectangleStart = null;
                state.currentLineStart = null;
                state.cursorPosition = null; // Clear cursor position to prevent line preview
                state.isDrawingRectangle = false;
                state.justFinishedRectangle = true; // Set flag to prevent immediate new drawing
                // Clear flag after a short delay to allow normal drawing to resume
                setTimeout(() => {
                    state.justFinishedRectangle = false;
                }, 100);
                updateUI();
                renderCanvas();
                return;
            }
        }
        
        // Create polygon from rectangle
        const newPolygon = {
            id: `polygon-${Date.now()}`,
            points: rectanglePoints,
            lines: rectangleLines,
            areaInSquareMeters: area,
            isClosed: true,
            name: `Rectangle ${state.polygons.length + 1}`,
            isRectangle: true
        };
        
        state.polygons.push(newPolygon);
        
        if (area > 0) {
            showToast(`Rectangle created! Area: ${area.toFixed(2)} m²`);
        }
        
        state.currentRectangleStart = null;
        state.currentLineStart = null;
        state.cursorPosition = null; // Clear cursor position to prevent line preview
        state.isDrawingRectangle = false;
        state.justFinishedRectangle = true; // Set flag to prevent immediate new drawing
        // Clear flag after a short delay to allow normal drawing to resume
        setTimeout(() => {
            state.justFinishedRectangle = false;
        }, 100);
        updateUI();
        renderCanvas();
        return;
    }
    
    state.isDrawingRectangle = false;
}

// Helper function to zoom while keeping a specific point fixed
function zoomToPoint(zoomFactor, mouseX, mouseY) {
    const oldZoom = state.zoom;
    const newZoom = Math.max(0.1, Math.min(5, oldZoom * zoomFactor));
    
    // Convert mouse position to image coordinates (before zoom)
    const imageX = (mouseX - state.pan.x) / oldZoom;
    const imageY = (mouseY - state.pan.y) / oldZoom;
    
    // Calculate new pan to keep same image point under mouse
    state.pan.x = mouseX - imageX * newZoom;
    state.pan.y = mouseY - imageY * newZoom;
    
    state.zoom = newZoom;
}

function handleWheel(e) {
    e.preventDefault();
    
    // Block zoom if drawing has started (at least one point exists)
    if (state.points.length > 0) {
        return;
    }
    
    // Get mouse position relative to canvas
    const rect = elements.canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    zoomToPoint(delta, mouseX, mouseY);
    updateUI();
    renderCanvas();
}

function handleZoomIn() {
    // Block zoom if drawing has started
    if (state.points.length > 0) {
        return;
    }
    
    // Zoom to canvas center when using buttons
    const centerX = elements.canvas.width / 2;
    const centerY = elements.canvas.height / 2;
    zoomToPoint(1.2, centerX, centerY);
    updateUI();
    renderCanvas();
}

function handleZoomOut() {
    // Block zoom if drawing has started
    if (state.points.length > 0) {
        return;
    }
    
    // Zoom to canvas center when using buttons
    const centerX = elements.canvas.width / 2;
    const centerY = elements.canvas.height / 2;
    zoomToPoint(1 / 1.2, centerX, centerY);
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
    state.currentRectangleStart = null;
    state.hoveredPoint = null;
    state.justFinishedRectangle = false;
    updateUI();
    renderCanvas();
}

function handleUndoLastLine() {
    // Check polygons first (including rectangles)
    if (state.polygons.length > 0) {
        const lastPolygon = state.polygons[state.polygons.length - 1];
        state.polygons.pop();
        
        // Remove lines associated with this polygon
        if (lastPolygon.lines) {
            lastPolygon.lines.forEach(line => {
                const index = state.lines.findIndex(l => l.id === line.id);
                if (index !== -1) {
                    state.lines.splice(index, 1);
                }
            });
        }
        
        updateUI();
        renderCanvas();
        return;
    }
    
    // Then check standalone lines
    if (state.lines.length === 0) return;
    
    const lastLine = state.lines[state.lines.length - 1];
    state.lines.pop();
    
    state.polygons = state.polygons.filter(polygon =>
        !polygon.lines.some(line => line.id === lastLine.id)
    );
    
    updateUI();
    renderCanvas();
}

function handleNewProject() {
    const hasData = state.points.length > 0 || state.lines.length > 0 || state.polygons.length > 0;
    
    if (hasData) {
        const confirmed = confirm('Are you sure you want to start a new project?\n\nAll current work will be lost and cannot be recovered.\n\nThis will refresh the page and clear the browser cache for this page.');
        
        if (confirmed) {
            // Hard reload - clears cache and reloads from server (like Ctrl+F5)
            window.location.replace(window.location.href.split('?')[0] + '?t=' + Date.now());
        }
    } else {
        // No data, just hard reload without confirmation
        window.location.replace(window.location.href.split('?')[0] + '?t=' + Date.now());
    }
}

function handleRecalibrate() {
    state.calibration = null;
    state.lines = [];
    state.points = [];
    state.polygons = [];
    state.currentLineStart = null;
    state.currentRectangleStart = null;
    updateUI();
    renderCanvas();
    showToast('Calibration reset. Draw a new reference line to recalibrate');
}

function handleToggleLengthLabels() {
    state.showLengthLabels = !state.showLengthLabels;
    updateUI();
    renderCanvas();
    showToast(state.showLengthLabels ? 'Length labels shown' : 'Length labels hidden');
}

function handleToggleAngleSnap() {
    state.angleSnapEnabled = !state.angleSnapEnabled;
    updateUI();
    renderCanvas();
    showToast(state.angleSnapEnabled ? '90° angle snap enabled' : '90° angle snap disabled');
}

// ==================== Screenshot Functions ====================
// Render the full image with all drawings at actual size (for screenshots)
function renderFullImageForScreenshot(ctx, imageWidth, imageHeight) {
    // Clear canvas
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, imageWidth, imageHeight);
    
    // Draw image at full size
    if (state.image) {
        ctx.drawImage(state.image, 0, 0, imageWidth, imageHeight);
    }
    
    // Calculate the coordinate transformation
    // Points are stored in canvas coordinate space (at zoom=1.0, accounting for pan)
    // The image is positioned at (imageX, imageY) in that coordinate space
    // We need to map from canvas coordinates to screenshot coordinates
    
    // Calculate where the image is positioned in the original canvas coordinate space (at zoom=1.0, pan=0,0)
    const maxWidth = elements.canvas.width - 40;
    const maxHeight = elements.canvas.height - 40;
    const originalScale = Math.min(maxWidth / state.image.width, maxHeight / state.image.height, 1);
    const originalImageWidth = state.image.width * originalScale;
    const originalImageHeight = state.image.height * originalScale;
    const originalImageX = (elements.canvas.width - originalImageWidth) / 2;
    const originalImageY = (elements.canvas.height - originalImageHeight) / 2;
    
    // Calculate scale factors to map from original canvas coordinates to screenshot coordinates
    // The screenshot uses the same scale as the original, so scaleX = scaleY = 1.0
    // But we need to account for the image position offset
    const scaleX = imageWidth / originalImageWidth;
    const scaleY = imageHeight / originalImageHeight;
    
    // Helper function to transform a point from canvas coordinates to screenshot coordinates
    const transformPoint = (point) => {
        // First, subtract the image offset to get coordinates relative to image top-left
        const relativeX = point.x - originalImageX;
        const relativeY = point.y - originalImageY;
        // Then scale to screenshot dimensions
        return {
            x: relativeX * scaleX,
            y: relativeY * scaleY
        };
    };
    
    // Helper function to check if a point is within image bounds
    const isPointInImage = (point) => {
        return point.x >= originalImageX && 
               point.x <= originalImageX + originalImageWidth &&
               point.y >= originalImageY && 
               point.y <= originalImageY + originalImageHeight;
    };
    
    // Save context state before clipping
    ctx.save();
    
    // Set clipping region to image bounds
    ctx.beginPath();
    ctx.rect(0, 0, imageWidth, imageHeight);
    ctx.clip();
    
    // Draw polygons
    state.polygons.forEach(polygon => {
        if (polygon.isClosed && polygon.points.length > 0) {
            ctx.fillStyle = POLYGON_FILL_COLOR;
            ctx.beginPath();
            const firstTransformed = transformPoint(polygon.points[0]);
            ctx.moveTo(firstTransformed.x, firstTransformed.y);
            for (let i = 1; i < polygon.points.length; i++) {
                const transformed = transformPoint(polygon.points[i]);
                ctx.lineTo(transformed.x, transformed.y);
            }
            ctx.closePath();
            ctx.fill();
            
            // Draw merged polygons
            if (polygon.mergedPolygons && polygon.mergedPolygons.length > 0) {
                polygon.mergedPolygons.forEach(mergedPolygon => {
                    if (mergedPolygon.isClosed && mergedPolygon.points && mergedPolygon.points.length > 0) {
                        ctx.fillStyle = POLYGON_FILL_COLOR;
                        ctx.beginPath();
                        const firstMergedTransformed = transformPoint(mergedPolygon.points[0]);
                        ctx.moveTo(firstMergedTransformed.x, firstMergedTransformed.y);
                        for (let i = 1; i < mergedPolygon.points.length; i++) {
                            const transformed = transformPoint(mergedPolygon.points[i]);
                            ctx.lineTo(transformed.x, transformed.y);
                        }
                        ctx.closePath();
                        ctx.fill();
                    }
                });
            }
            
            // Draw subtract polygons (holes)
            if (polygon.subtracts && polygon.subtracts.length > 0) {
                polygon.subtracts.forEach(subtract => {
                    ctx.fillStyle = SUBTRACT_FILL_COLOR;
                    ctx.beginPath();
                    const firstSubtractTransformed = transformPoint(subtract.points[0]);
                    ctx.moveTo(firstSubtractTransformed.x, firstSubtractTransformed.y);
                    for (let i = 1; i < subtract.points.length; i++) {
                        const transformed = transformPoint(subtract.points[i]);
                        ctx.lineTo(transformed.x, transformed.y);
                    }
                    ctx.closePath();
                    ctx.fill();
                    
                    // Draw subtract outline
                    ctx.strokeStyle = SUBTRACT_COLOR;
                    ctx.lineWidth = LINE_WIDTH * scaleX;
                    ctx.stroke();
                });
            }
        }
    });
    
    // Draw lines
    state.lines.forEach(line => {
        const isPipe = line.isPipe === true;
        const isSubtract = line.isSubtract === true;
        
        // Check if this line is part of a subtract polygon
        const isPartOfSubtractPolygon = state.polygons.some(polygon => 
            polygon.subtracts && polygon.subtracts.some(subtract => 
                subtract.lines && subtract.lines.some(l => l.id === line.id)
            )
        );
        
        ctx.strokeStyle = isPipe ? PIPE_COLOR : (isSubtract ? SUBTRACT_COLOR : LINE_COLOR);
        ctx.lineWidth = LINE_WIDTH * scaleX;
        ctx.lineCap = 'round';
        ctx.beginPath();
        
        const startTransformed = transformPoint(line.startPoint);
        const endTransformed = transformPoint(line.endPoint);
        
        ctx.moveTo(startTransformed.x, startTransformed.y);
        ctx.lineTo(endTransformed.x, endTransformed.y);
        ctx.stroke();
        
        // Draw length label (skip labels for lines that are part of subtract polygons)
        if (state.showLengthLabels && line.lengthInMeters !== undefined && !isPartOfSubtractPolygon && line.lengthInMeters > 0) {
            const midX = (startTransformed.x + endTransformed.x) / 2;
            const midY = (startTransformed.y + endTransformed.y) / 2;
            
            const text = `${line.lengthInMeters.toFixed(2)}m`;
            ctx.font = '500 16px Inter, sans-serif';
            const metrics = ctx.measureText(text);
            const padding = 6;
            
            const bgX = midX - metrics.width / 2 - padding;
            const bgY = midY - 12 - padding;
            const bgWidth = metrics.width + padding * 2;
            const bgHeight = 24 + padding * 2;
            
            ctx.fillStyle = isPipe ? 'rgba(22, 163, 74, 0.9)' : (isSubtract ? 'rgba(220, 38, 38, 0.9)' : 'rgba(37, 99, 235, 0.9)');
            ctx.beginPath();
            ctx.roundRect(bgX, bgY, bgWidth, bgHeight, 6);
            ctx.fill();
            
            ctx.fillStyle = 'white';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, midX, midY);
        }
    });
    
    // Draw points
    state.points.forEach(point => {
        const transformed = transformPoint(point);
        
        ctx.fillStyle = POINT_COLOR;
        ctx.beginPath();
        ctx.arc(transformed.x, transformed.y, 5 * scaleX, 0, Math.PI * 2);
        ctx.fill();
    });
    
    // Restore context state to remove clipping
    ctx.restore();
}

function handleTakeScreenshot() {
    if (!state.image) {
        showToast('Please upload a drawing first');
        return;
    }
    
    const projectName = elements.projectNameInput.value.trim() || 'Project';
    
    // Calculate the actual image dimensions (at zoom=1.0, fitted to canvas)
    const maxWidth = elements.canvas.width - 40;
    const maxHeight = elements.canvas.height - 40;
    const scale = Math.min(maxWidth / state.image.width, maxHeight / state.image.height, 1);
    const imageWidth = Math.round(state.image.width * scale);
    const imageHeight = Math.round(state.image.height * scale);
    
    // Calculate statistics
    const totalArea = state.polygons.reduce((sum, p) => sum + p.areaInSquareMeters, 0);
    const polygonsCount = state.polygons.length;
    const pipes = state.lines.filter(line => line.isPipe === true);
    const pipesCount = pipes.length;
    const pipesTotalLength = pipes.reduce((sum, pipe) => sum + (pipe.lengthInMeters || 0), 0);
    
    // Calculate overlay height based on content
    // Base section: project name (40px) + date/time (30px) + stats section
    const statsSectionHeight = (pipesCount > 0 ? 22 * 2 : 22); // lineHeight * number of lines
    const baseSectionHeight = 40 + 30; // project name + date/time sections
    const statsStartY = baseSectionHeight + 15; // gap after date/time
    const polygonsSectionStart = statsStartY + statsSectionHeight + 15; // gap after stats
    const polygonsHeadingHeight = 25; // "Polygons:" heading with spacing
    const polygonsListHeight = polygonsCount > 0 ? polygonsHeadingHeight + (polygonsCount * 18) : 0;
    const bottomPadding = 20; // padding at bottom
    const overlayHeight = baseSectionHeight + statsSectionHeight + 15 + polygonsListHeight + bottomPadding;
    
    // Create a new canvas for the screenshot with overlay
    const screenshotCanvas = document.createElement('canvas');
    screenshotCanvas.width = imageWidth;
    screenshotCanvas.height = imageHeight + overlayHeight;
    const ctx = screenshotCanvas.getContext('2d');
    
    // Render the full image with all drawings
    renderFullImageForScreenshot(ctx, imageWidth, imageHeight);
    
    // Prepare overlay information
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    const dateTimeStr = `${dateStr} ${timeStr}`;
    
    // Draw overlay background
    const overlayY = imageHeight;
    ctx.fillStyle = 'rgba(37, 99, 235, 0.95)';
    ctx.fillRect(0, overlayY, screenshotCanvas.width, overlayHeight);
    
    // Draw project name (centered vertically in top section)
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Top section: first 40px of overlay, center at 20px
    const projectNameY = overlayY + 20;
    ctx.fillText(projectName, screenshotCanvas.width / 2, projectNameY);
    
    // Draw date and time (centered vertically in second section)
    ctx.font = '500 14px Inter, sans-serif';
    // Second section: next 30px, center at 55px from overlay start
    const dateTimeY = overlayY + 55;
    ctx.fillText(dateTimeStr, screenshotCanvas.width / 2, dateTimeY);
    
    // Draw statistics (left column) - vertically centered
    ctx.font = '500 16px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const statsX = 30;
    const lineHeight = 22;
    
    // Calculate center Y for statistics section (2 lines if pipes exist, 1 line otherwise)
    const statsCenterY = overlayY + statsStartY + statsSectionHeight / 2;
    
    // Draw Total Area (centered vertically in stats section)
    const totalAreaY = pipesCount > 0 ? statsCenterY - lineHeight / 2 : statsCenterY;
    ctx.fillText(`Total Area: ${totalArea.toFixed(2)} m²`, statsX, totalAreaY);
    
    // Draw Total Pipes (centered vertically in stats section)
    if (pipesCount > 0) {
        ctx.fillText(`Total Pipes: ${pipesTotalLength.toFixed(2)} m`, statsX, statsCenterY + lineHeight / 2);
    }
    
    // Draw polygons list (properly spaced)
    let currentY = overlayY + polygonsSectionStart;
    if (polygonsCount > 0) {
        ctx.font = '600 16px Inter, sans-serif';
        ctx.textBaseline = 'middle';
        ctx.fillText('Polygons:', statsX, currentY + 10);
        currentY += 25;
        
        ctx.font = '500 14px Inter, sans-serif';
        state.polygons.forEach((polygon, index) => {
            const displayName = polygon.name || `Polygon ${index + 1}`;
            const area = polygon.areaInSquareMeters.toFixed(2);
            // Center each polygon line vertically in its 18px height
            ctx.fillText(`  • ${displayName}: ${area} m²`, statsX, currentY + 9);
            currentY += 18;
        });
    }
    
    // Convert to blob and download
    screenshotCanvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        
        // Create filename: ProjectName-YYYYMMDD-HHMM.png
        const dateForFilename = now.toISOString().slice(0, 19).replace(/[:-]/g, '').replace('T', '-');
        const safeProjectName = projectName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
        const filename = `${safeProjectName}-${dateForFilename}.png`;
        
        link.download = filename;
        link.click();
        
        URL.revokeObjectURL(url);
        showToast('Screenshot saved');
    }, 'image/png');
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

// ==================== Polygon Rename Functions ====================
function attachPolygonRenameListeners() {
    const nameElements = elements.polygonsList.querySelectorAll('.polygon-name-text');
    const inputElements = elements.polygonsList.querySelectorAll('.polygon-name-input');
    
    nameElements.forEach(nameEl => {
        nameEl.addEventListener('click', function(e) {
            e.stopPropagation();
            const polygonId = this.getAttribute('data-polygon-id');
            const polygonItem = this.closest('.polygon-item');
            const nameText = polygonItem.querySelector('.polygon-name-text');
            const nameInput = polygonItem.querySelector('.polygon-name-input');
            
            nameText.classList.add('hidden');
            nameInput.classList.remove('hidden');
            nameInput.focus();
            nameInput.select();
        });
    });
    
    inputElements.forEach(inputEl => {
        inputEl.addEventListener('blur', function() {
            finishPolygonRename(this);
        });
        
        inputEl.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                finishPolygonRename(this);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelPolygonRename(this);
            }
        });
    });
}

function finishPolygonRename(inputEl) {
    const polygonId = inputEl.getAttribute('data-polygon-id');
    const polygon = state.polygons.find(p => p.id === polygonId);
    const polygonItem = inputEl.closest('.polygon-item');
    const nameText = polygonItem.querySelector('.polygon-name-text');
    
    if (polygon) {
        const newName = inputEl.value.trim();
        if (newName) {
            polygon.name = newName;
            nameText.textContent = newName;
        } else {
            // If empty, restore original name
            const index = state.polygons.findIndex(p => p.id === polygonId);
            polygon.name = `Polygon ${index + 1}`;
            nameText.textContent = polygon.name;
        }
    }
    
    inputEl.classList.add('hidden');
    nameText.classList.remove('hidden');
}

function cancelPolygonRename(inputEl) {
    const polygonItem = inputEl.closest('.polygon-item');
    const nameText = polygonItem.querySelector('.polygon-name-text');
    const polygonId = inputEl.getAttribute('data-polygon-id');
    const polygon = state.polygons.find(p => p.id === polygonId);
    
    if (polygon) {
        inputEl.value = polygon.name || nameText.textContent;
    }
    
    inputEl.classList.add('hidden');
    nameText.classList.remove('hidden');
}

// ==================== Polygon Merge Functions ====================
function attachPolygonMergeListeners() {
    const mergeButtons = elements.polygonsList.querySelectorAll('.polygon-merge-btn');
    
    mergeButtons.forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.stopPropagation();
            const polygonId = this.getAttribute('data-polygon-id');
            handleMergePolygon(polygonId);
        });
    });
}

function handleMergePolygon(lastPolygonId) {
    if (state.polygons.length < 2) {
        showToast('Need at least 2 polygons to merge');
        return;
    }
    
    const lastIndex = state.polygons.findIndex(p => p.id === lastPolygonId);
    if (lastIndex === -1 || lastIndex !== state.polygons.length - 1) {
        showToast('Can only merge the last polygon');
        return;
    }
    
    const previousIndex = lastIndex - 1;
    const previousPolygon = state.polygons[previousIndex];
    const lastPolygon = state.polygons[lastIndex];
    
    // Merge areas (keep previous polygon's name)
    previousPolygon.areaInSquareMeters += lastPolygon.areaInSquareMeters;
    
    // Add last polygon as a merged polygon to keep it visually rendered
    // This way both polygons stay visible but are treated as one in the menu
    if (!previousPolygon.mergedPolygons) {
        previousPolygon.mergedPolygons = [];
    }
    previousPolygon.mergedPolygons.push(lastPolygon);
    
    // Merge subtracts if any (these are holes in polygons)
    if (lastPolygon.subtracts && lastPolygon.subtracts.length > 0) {
        if (!previousPolygon.subtracts) {
            previousPolygon.subtracts = [];
        }
        previousPolygon.subtracts.push(...lastPolygon.subtracts);
    }
    
    // Remove last polygon from list (but it will still be rendered via mergedPolygons)
    state.polygons.splice(lastIndex, 1);
    
    showToast(`Polygon merged. New area: ${previousPolygon.areaInSquareMeters.toFixed(2)} m²`);
    updateUI();
    renderCanvas();
}

// ==================== Tool Selection ====================
function updateToolButtons() {
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Before calibration, only Line tool is available
    const hasCalibration = state.calibration !== null;
    
    if (state.currentTool === 'line') {
        elements.toolLine.classList.add('active');
    } else if (state.currentTool === 'rectangle') {
        elements.toolRectangle.classList.add('active');
    } else if (state.currentTool === 'pipe') {
        elements.toolPipe.classList.add('active');
    }
    
    // Disable Rectangle, Pipe, and Subtract tools before calibration
    elements.toolRectangle.disabled = !hasCalibration;
    elements.toolPipe.disabled = !hasCalibration;
    elements.toolSubtract.disabled = !hasCalibration;
    
    // If current tool is disabled, switch to Line
    if (!hasCalibration && (state.currentTool === 'rectangle' || state.currentTool === 'pipe' || state.currentTool === 'subtract')) {
        state.currentTool = 'line';
        elements.toolLine.classList.add('active');
        state.currentLineStart = null;
        state.currentRectangleStart = null;
        state.isDrawingRectangle = false;
    }
    
    if (state.currentTool === 'subtract') {
        elements.toolSubtract.classList.add('active');
    }
}

// ==================== UI Updates ====================
function updateUI() {
    // Update tool buttons
    updateToolButtons();
    // Update zoom level
    elements.zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;
    
    // Update calibration info
    if (state.calibration) {
        elements.calibrationInfo.innerHTML = `
            <p class="info-text">Scale: 1px = ${(1 / state.calibration.pixelsPerMeter).toFixed(4)}m</p>
            <p class="info-text" style="margin-top: 0.5rem;">Reference: ${state.calibration.realLengthInMeters.toFixed(2)}m</p>
        `;
    } else {
        elements.calibrationInfo.innerHTML = '<p class="info-text">Draw a reference line first</p>';
    }
    
    // Update total area (polygons include rectangles now)
    const totalArea = state.polygons.reduce((sum, p) => sum + p.areaInSquareMeters, 0);
    elements.totalArea.textContent = `${totalArea.toFixed(2)} m²`;
    
    // Update polygons list
    if (state.polygons.length > 0) {
        elements.polygonsList.innerHTML = state.polygons.map((polygon, index) => {
            const displayName = polygon.name || `Polygon ${index + 1}`;
            const isLast = index === state.polygons.length - 1;
            const canMerge = state.polygons.length >= 2 && isLast;
            return `
            <div class="polygon-item" data-polygon-id="${polygon.id}">
                <div class="polygon-item-header">
                    <div class="polygon-name-editable" data-polygon-id="${polygon.id}">
                        <span class="polygon-name-text">${displayName}</span>
                        <input type="text" class="polygon-name-input hidden" value="${displayName}" data-polygon-id="${polygon.id}">
                    </div>
                    <div class="polygon-area">${polygon.areaInSquareMeters.toFixed(2)} m²</div>
                </div>
                ${canMerge ? `
                    <button class="polygon-merge-btn" data-polygon-id="${polygon.id}" title="Merge with previous polygon">
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v18"/><path d="M12 3v18"/><path d="M16 3v18"/><path d="M2 3h20"/><path d="M2 21h20"/></svg>
                        <span>Merge with previous</span>
                    </button>
                ` : ''}
            </div>
        `;
        }).join('');
        
        // Attach event listeners for renaming
        attachPolygonRenameListeners();
        
        // Attach event listeners for merge buttons
        attachPolygonMergeListeners();
    } else {
        elements.polygonsList.innerHTML = '<p class="info-text">No polygons detected</p>';
    }
    
    // Update pipes list
    const pipes = state.lines.filter(line => line.isPipe === true);
    if (pipes.length > 0) {
        const totalLength = pipes.reduce((sum, pipe) => sum + (pipe.lengthInMeters || 0), 0);
        elements.pipesList.innerHTML = `
            <div class="pipes-total">
                <div class="pipes-total-label">Total Length</div>
                <div class="pipes-total-value">${totalLength.toFixed(2)} m</div>
            </div>
            ${pipes.map((pipe, index) => `
                <div class="pipe-item">
                    <div class="pipe-name">Pipe ${index + 1}</div>
                    <div class="pipe-length">${pipe.lengthInMeters ? pipe.lengthInMeters.toFixed(2) : 'N/A'} m</div>
                </div>
            `).join('')}
        `;
    } else {
        elements.pipesList.innerHTML = '<p class="info-text">No pipes yet</p>';
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
    elements.undoBtn.disabled = state.lines.length === 0 && state.polygons.length === 0;
    elements.clearBtn.disabled = state.points.length === 0;
    
    // Update toggle button states
    elements.toggleLengthLabelsBtn.classList.toggle('active', state.showLengthLabels);
    elements.toggleAngleSnapBtn.classList.toggle('active', state.angleSnapEnabled);
    
    // Hide zoom controls when drawing has started (after calibration)
    const hasPoints = state.points.length > 0;
    if (hasPoints) {
        elements.zoomControls.classList.add('hidden');
    } else {
        elements.zoomControls.classList.remove('hidden');
    }
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
    elements.canvas.addEventListener('mouseleave', (e) => {
        // Cancel rectangle drawing if mouse leaves canvas
        if (state.isDrawingRectangle) {
            state.currentRectangleStart = null;
            state.isDrawingRectangle = false;
            renderCanvas();
        }
        handleMouseUp(e);
    });
    elements.canvas.addEventListener('wheel', handleWheel);
    elements.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    
    // Zoom controls
    elements.zoomInBtn.addEventListener('click', handleZoomIn);
    elements.zoomOutBtn.addEventListener('click', handleZoomOut);
    elements.resetViewBtn.addEventListener('click', handleResetView);
    
    // Control buttons
    elements.newProjectBtn.addEventListener('click', handleNewProject);
    elements.recalibrateBtn.addEventListener('click', handleRecalibrate);
    elements.undoBtn.addEventListener('click', handleUndoLastLine);
    elements.clearBtn.addEventListener('click', handleClearAll);
    elements.toggleLengthLabelsBtn.addEventListener('click', handleToggleLengthLabels);
    elements.toggleAngleSnapBtn.addEventListener('click', handleToggleAngleSnap);
    
    // Calibration modal
    elements.calibrationForm.addEventListener('submit', handleCalibrationSubmit);
    elements.cancelCalibrationBtn.addEventListener('click', closeCalibrationModal);
    
    // Collapsible sections
    elements.polygonsHeader.addEventListener('click', () => {
        toggleCollapsible(elements.polygonsHeader, elements.polygonsList);
    });
    
    elements.pipesHeader.addEventListener('click', () => {
        toggleCollapsible(elements.pipesHeader, elements.pipesList);
    });
    
    elements.pointsHeader.addEventListener('click', () => {
        toggleCollapsible(elements.pointsHeader, elements.pointsList);
    });
    
    elements.instructionsHeader.addEventListener('click', () => {
        toggleCollapsible(elements.instructionsHeader, document.getElementById('instructionsContent'));
    });
    
    // Screenshot button
    elements.screenshotBtn.addEventListener('click', handleTakeScreenshot);
    
    // Tool selection
    elements.toolLine.addEventListener('click', () => {
        state.currentTool = 'line';
        state.currentLineStart = null;
        state.currentRectangleStart = null;
        state.isDrawingRectangle = false;
        state.justFinishedRectangle = false;
        updateToolButtons();
        renderCanvas();
    });
    
    elements.toolRectangle.addEventListener('click', () => {
        state.currentTool = 'rectangle';
        state.currentLineStart = null;
        state.currentRectangleStart = null;
        state.isDrawingRectangle = false;
        state.justFinishedRectangle = false;
        updateToolButtons();
        renderCanvas();
    });
    
    elements.toolPipe.addEventListener('click', () => {
        state.currentTool = 'pipe';
        state.currentLineStart = null;
        state.currentRectangleStart = null;
        state.isDrawingRectangle = false;
        state.justFinishedRectangle = false;
        updateToolButtons();
        renderCanvas();
    });
    
    elements.toolSubtract.addEventListener('click', () => {
        state.currentTool = 'subtract';
        state.currentLineStart = null;
        state.currentRectangleStart = null;
        state.isDrawingRectangle = false;
        state.justFinishedRectangle = false;
        updateToolButtons();
        renderCanvas();
    });
    
    // Window resize
    window.addEventListener('resize', resizeCanvas);
}

// ==================== Initialization ====================
function init() {
    // Set initial collapsible states
    elements.polygonsHeader.setAttribute('aria-expanded', 'true');
    elements.pipesHeader.setAttribute('aria-expanded', 'false');
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

