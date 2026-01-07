// ==================== Polyfill for roundRect ====================
if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function(x, y, width, height, radius) {
        if (width < 0) { x += width; width = -width; }
        if (height < 0) { y += height; height = -height; }
        this.beginPath();
        this.moveTo(x + radius, y);
        this.lineTo(x + width - radius, y);
        this.quadraticCurveTo(x + width, y, x + width, y + radius);
        this.lineTo(x + width, y + height - radius);
        this.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        this.lineTo(x + radius, y + height);
        this.quadraticCurveTo(x, y + height, x, y + height - radius);
        this.lineTo(x, y + radius);
        this.quadraticCurveTo(x, y, x + radius, y);
        this.closePath();
    };
}

// ==================== Constants ====================
const SNAP_RADIUS = 12;
const LINE_COLOR = "#2563eb";
const WALL_COLOR = "#2563eb";
const WINDOW_COLOR = "#16a34a";
const WALL_THICKNESS = 20; // Distance between parallel lines for walls in pixels
const WINDOW_THICKNESS = 15; // Distance between parallel lines for windows in pixels
const POINT_COLOR = "#2563eb";
const POLYGON_FILL_COLOR = "rgba(37, 99, 235, 0.25)";
const DEFAULT_POLYGON_COLOR = "#2563eb"; // Base color for polygons (without transparency)
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
    currentTool: 'walls', // 'select', 'walls', 'window'
    currentLineStart: null,
    currentRectangleStart: null,
    isDrawingRectangle: false,
    justFinishedRectangle: false, // Flag to prevent starting new drawing immediately after rectangle
    selectedPoints: [], // Array of selected point IDs
    selectedLines: [], // Array of selected line IDs
    isSelecting: false, // Flag for selection rectangle mode
    selectionStart: null, // Start point for selection rectangle
    selectionEnd: null, // End point for selection rectangle
    justFinishedSelection: false, // Flag to prevent click event from clearing selection after drag
    hoveredPoint: null,
    isPanning: false,
    panStart: { x: 0, y: 0 },
    cursorPosition: null,
    nearestSnapPoint: null,
    pendingLengthLine: null, // For walls/windows length input
    showLengthLabels: true, // Toggle for showing/hiding line length labels
    angleSnapEnabled: true, // Toggle for 90-degree angle snapping
    pointSnapEnabled: true, // Toggle for point snapping
    isSelectingScreenshot: false, // Screenshot selection mode
    screenshotSelectionStart: null, // Start point of screenshot selection
    screenshotSelectionEnd: null, // End point of screenshot selection
    actionHistory: [] // History of actions for undo functionality
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
    
    // Tool panel
    projectNameInput: document.getElementById('projectNameInput'),
    screenshotBtn: document.getElementById('screenshotBtn'),
    toolSelect: document.getElementById('toolSelect'),
    toolWalls: document.getElementById('toolWalls'),
    toolWindow: document.getElementById('toolWindow'),
    totalArea: document.getElementById('totalArea'),
    polygonsList: document.getElementById('polygonsList'),
    
    // Controls
    newProjectBtn: document.getElementById('newProjectBtn'),
    undoBtn: document.getElementById('undoBtn'),
    clearBtn: document.getElementById('clearBtn'),
    toggleLengthLabelsBtn: document.getElementById('toggleLengthLabelsBtn'),
    toggleAngleSnapBtn: document.getElementById('toggleAngleSnapBtn'),
    togglePointSnapBtn: document.getElementById('togglePointSnapBtn'),
    
    // Modal
    lengthModal: document.getElementById('lengthModal'),
    lengthForm: document.getElementById('lengthForm'),
    lengthInput: document.getElementById('lengthInput'),
    lengthModalDescription: document.getElementById('lengthModalDescription'),
    cancelLengthBtn: document.getElementById('cancelLengthBtn'),
    
    // Toast
    toast: document.getElementById('toast'),
    toastMessage: document.getElementById('toastMessage'),
    
    // Collapsible headers
    polygonsHeader: document.getElementById('polygonsHeader'),
    instructionsHeader: document.getElementById('instructionsHeader'),
    shortcutsHeader: document.getElementById('shortcutsHeader')
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

// Calculate perpendicular offset point for parallel lines
function getPerpendicularOffset(startPoint, endPoint, offsetDistance) {
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    
    if (length === 0) return { x: startPoint.x, y: startPoint.y };
    
    // Normalize direction vector
    const nx = -dy / length; // Perpendicular x
    const ny = dx / length;  // Perpendicular y
    
    return {
        x: offsetDistance * nx,
        y: offsetDistance * ny
    };
}

// Create parallel lines for walls or windows
function createParallelLines(startPoint, endPoint, isWindow = false) {
    const thickness = isWindow ? WINDOW_THICKNESS : WALL_THICKNESS;
    const offset = getPerpendicularOffset(startPoint, endPoint, thickness / 2);
    
    const lines = [];
    
    if (isWindow) {
        // Window: 3 parallel lines (outer, middle, outer)
        const offsets = [-thickness, 0, thickness];
        offsets.forEach(offsetDist => {
            const perpOffset = getPerpendicularOffset(startPoint, endPoint, offsetDist);
            lines.push({
                startPoint: {
                    x: startPoint.x + perpOffset.x,
                    y: startPoint.y + perpOffset.y,
                    id: `point-${Date.now()}-${Math.random()}`
                },
                endPoint: {
                    x: endPoint.x + perpOffset.x,
                    y: endPoint.y + perpOffset.y,
                    id: `point-${Date.now()}-${Math.random()}`
                }
            });
        });
    } else {
        // Wall: single line (no parallel lines) - use original points directly
        lines.push({
            startPoint: startPoint,
            endPoint: endPoint
        });
    }
    
    return lines;
}

function calculatePolygonArea(points, calibration) {
    if (points.length < 3) return 0;
    
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const j = (i + 1) % points.length;
        area += points[i].x * points[j].y;
        area -= points[j].x * points[i].y;
    }
    area = Math.abs(area) / 2;
    
    // Use calibration if available, otherwise use default scale (100 pixels = 1 meter)
    const pixelsPerMeter = calibration ? calibration.pixelsPerMeter : 100;
    const areaInSquareMeters = area / (pixelsPerMeter * pixelsPerMeter);
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

// Check if a line segment intersects with a rectangle
function lineIntersectsRect(x1, y1, x2, y2, rectX1, rectY1, rectX2, rectY2) {
    // Check if line segment intersects any of the rectangle edges
    // Rectangle edges: top, bottom, left, right
    const edges = [
        { x1: rectX1, y1: rectY1, x2: rectX2, y2: rectY1 }, // top
        { x1: rectX1, y1: rectY2, x2: rectX2, y2: rectY2 }, // bottom
        { x1: rectX1, y1: rectY1, x2: rectX1, y2: rectY2 }, // left
        { x1: rectX2, y1: rectY1, x2: rectX2, y2: rectY2 }  // right
    ];
    
    for (const edge of edges) {
        if (lineSegmentsIntersect(x1, y1, x2, y2, edge.x1, edge.y1, edge.x2, edge.y2)) {
            return true;
        }
    }
    
    return false;
}

// Check if two line segments intersect
function lineSegmentsIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
    const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
    if (Math.abs(denom) < 1e-10) return false; // Parallel lines
    
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
    const u = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / denom;
    
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
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
// Helper function to calculate image position in transformed space
function getImagePosition() {
    if (!state.image || !state.image.width || !state.image.height) return null;
    
    const maxWidth = elements.canvas.width - 40;
    const maxHeight = elements.canvas.height - 40;
    const scale = Math.min(maxWidth / state.image.width, maxHeight / state.image.height, 1);
    const width = state.image.width * scale;
    const height = state.image.height * scale;
    
    // Position in transformed space (same as in renderCanvas)
    const x = (elements.canvas.width / state.zoom - width) / 2;
    const y = (elements.canvas.height / state.zoom - height) / 2;
    
    return { x, y, width, height };
}

function getCanvasPoint(clientX, clientY) {
    try {
        const rect = elements.canvas.getBoundingClientRect();
        // Get point in transformed space (direct canvas coordinates)
        const transformedX = (clientX - rect.left - state.pan.x) / state.zoom;
        const transformedY = (clientY - rect.top - state.pan.y) / state.zoom;
        
        // Return direct canvas coordinates (no image offset needed)
        return { 
            x: transformedX, 
            y: transformedY, 
            id: `point-${Date.now()}-${Math.random()}` 
        };
    } catch (error) {
        console.error('Error in getCanvasPoint:', error);
        // Fallback to safe return
        return { 
            x: 0, 
            y: 0, 
            id: `point-${Date.now()}-${Math.random()}` 
        };
    }
}

function findNearestPoint(point, forceCheck = false) {
    // Return null if point snapping is disabled (unless forceCheck is true)
    if (!state.pointSnapEnabled && !forceCheck) {
        return null;
    }
    
    let nearest = null;
    
    // Use larger radius for selection (forceCheck) to make it easier to click
    const selectionRadius = forceCheck ? 20 : SNAP_RADIUS;
    
    // Selection radius is in screen pixels, convert to transformed space
    const snapRadiusInTransformedSpace = selectionRadius / state.zoom;
    let minDistance = snapRadiusInTransformedSpace;
    
    // Points are now stored in direct canvas coordinates
    state.points.forEach(p => {
        // Calculate distance in transformed space
        const distance = calculateDistance(p, point);
        
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
    let imagePos = null;
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
        
        imagePos = { x, y, width, height };
        ctx.drawImage(state.image, x, y, width, height);
    }
    
    // Helper function to convert point to canvas coordinates
    // Points are now stored in direct canvas coordinates, so no conversion needed
    const toCanvasPoint = (point) => {
        if (!point) return point;
        return point;
    };
    
    // Draw polygons
    state.polygons.forEach(polygon => {
        if (polygon.isClosed && polygon.points.length > 0) {
            // Use polygon's color or default, with transparency
            const polygonColor = polygon.color || DEFAULT_POLYGON_COLOR;
            ctx.fillStyle = hexToRgba(polygonColor, 0.25);
            ctx.strokeStyle = hexToRgba(polygonColor, 0.6); // Border with 60% opacity
            ctx.lineWidth = LINE_WIDTH / state.zoom; // Fixed screen width
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            const firstPoint = toCanvasPoint(polygon.points[0]);
            ctx.moveTo(firstPoint.x, firstPoint.y);
            for (let i = 1; i < polygon.points.length; i++) {
                const point = toCanvasPoint(polygon.points[i]);
                ctx.lineTo(point.x, point.y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            
            // Draw area label in the center of the polygon
            if (polygon.areaInSquareMeters > 0) {
                // Calculate center point of polygon
                const centerX = polygon.points.reduce((sum, p) => sum + p.x, 0) / polygon.points.length;
                const centerY = polygon.points.reduce((sum, p) => sum + p.y, 0) / polygon.points.length;
                const centerCanvas = toCanvasPoint({ x: centerX, y: centerY });
                
                ctx.save();
                ctx.scale(1 / state.zoom, 1 / state.zoom);
                
                // Get room name
                const roomName = polygon.name || `Room ${state.polygons.indexOf(polygon) + 1}`;
                const areaText = `${polygon.areaInSquareMeters.toFixed(2)} m²`;
                const fullText = `${roomName}\n${areaText}`;
                
                ctx.font = '600 18px Inter, sans-serif';
                const nameMetrics = ctx.measureText(roomName);
                ctx.font = '500 16px Inter, sans-serif';
                const areaMetrics = ctx.measureText(areaText);
                
                const maxWidth = Math.max(nameMetrics.width, areaMetrics.width);
                const padding = 10;
                const lineHeight = 22;
                const totalHeight = lineHeight * 2 + padding * 2;
                
                const bgX = centerCanvas.x * state.zoom - maxWidth / 2 - padding;
                const bgY = centerCanvas.y * state.zoom - totalHeight / 2;
                const bgWidth = maxWidth + padding * 2;
                const bgHeight = totalHeight;
                
                // Draw background
                ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
                ctx.strokeStyle = polygonColor;
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.roundRect(bgX, bgY, bgWidth, bgHeight, 6);
                ctx.fill();
                ctx.stroke();
                
                // Draw room name
                ctx.fillStyle = polygonColor;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'top';
                ctx.font = '600 18px Inter, sans-serif';
                ctx.fillText(roomName, centerCanvas.x * state.zoom, bgY + padding);
                
                // Draw area
                ctx.font = '500 16px Inter, sans-serif';
                ctx.fillText(areaText, centerCanvas.x * state.zoom, bgY + padding + lineHeight);
                
                ctx.restore();
            }
            
            // Draw merged polygons (polygons that were merged into this one)
            if (polygon.mergedPolygons && polygon.mergedPolygons.length > 0) {
                polygon.mergedPolygons.forEach(mergedPolygon => {
                    if (mergedPolygon.isClosed && mergedPolygon.points && mergedPolygon.points.length > 0) {
                        const mergedColor = mergedPolygon.color || DEFAULT_POLYGON_COLOR;
                        ctx.fillStyle = hexToRgba(mergedColor, 0.25);
                        ctx.strokeStyle = hexToRgba(mergedColor, 0.6); // Border with 60% opacity
                        ctx.lineWidth = LINE_WIDTH / state.zoom; // Fixed screen width
                        ctx.lineCap = 'round';
                        ctx.lineJoin = 'round';
                        ctx.beginPath();
                        const firstMergedPoint = toCanvasPoint(mergedPolygon.points[0]);
                        ctx.moveTo(firstMergedPoint.x, firstMergedPoint.y);
                        for (let i = 1; i < mergedPolygon.points.length; i++) {
                            const point = toCanvasPoint(mergedPolygon.points[i]);
                            ctx.lineTo(point.x, point.y);
                        }
                        ctx.closePath();
                        ctx.fill();
                        ctx.stroke();
                    }
                });
            }
            
            // Draw subtract polygons (holes) if any
            if (polygon.subtracts && polygon.subtracts.length > 0) {
                polygon.subtracts.forEach(subtract => {
                    ctx.fillStyle = SUBTRACT_FILL_COLOR;
                    ctx.beginPath();
                    const firstSubtractPoint = toCanvasPoint(subtract.points[0]);
                    ctx.moveTo(firstSubtractPoint.x, firstSubtractPoint.y);
                    for (let i = 1; i < subtract.points.length; i++) {
                        const point = toCanvasPoint(subtract.points[i]);
                        ctx.lineTo(point.x, point.y);
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
        const isWall = line.isWall === true;
        const isWindow = line.isWindow === true;
        
        // Check if this line is part of a polygon - use polygon's color
        let lineColor = LINE_COLOR;
        if (isWall) {
            lineColor = WALL_COLOR;
        } else if (isWindow) {
            lineColor = WINDOW_COLOR;
        } else {
            // Check if line belongs to a polygon (including merged polygons)
            let containingPolygon = state.polygons.find(polygon => 
                polygon.lines && polygon.lines.some(l => l.id === line.id)
            );
            
            // Also check merged polygons
            if (!containingPolygon) {
                for (const polygon of state.polygons) {
                    if (polygon.mergedPolygons) {
                        const mergedPolygon = polygon.mergedPolygons.find(mp => 
                            mp.lines && mp.lines.some(l => l.id === line.id)
                        );
                        if (mergedPolygon) {
                            containingPolygon = mergedPolygon;
                            break;
                        }
                    }
                }
            }
            
            if (containingPolygon) {
                lineColor = containingPolygon.color || DEFAULT_POLYGON_COLOR;
            }
        }
        
        const isSelected = state.selectedLines.includes(line.id);
        
        // Draw selection highlight for selected lines
        if (isSelected) {
            ctx.strokeStyle = '#ff0000'; // Red for selected
            ctx.lineWidth = (LINE_WIDTH + 2) / state.zoom;
            ctx.lineCap = 'round';
            ctx.beginPath();
            const startPoint = toCanvasPoint(line.startPoint);
            const endPoint = toCanvasPoint(line.endPoint);
            ctx.moveTo(startPoint.x, startPoint.y);
            ctx.lineTo(endPoint.x, endPoint.y);
            ctx.stroke();
        }
        
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = LINE_WIDTH / state.zoom;  // Fixed screen width
        ctx.lineCap = 'round';
        ctx.beginPath();
        const startPoint = toCanvasPoint(line.startPoint);
        const endPoint = toCanvasPoint(line.endPoint);
        ctx.moveTo(startPoint.x, startPoint.y);
        ctx.lineTo(endPoint.x, endPoint.y);
        ctx.stroke();
        
        // Draw length label (only show label once per wall/window group)
        if (state.showLengthLabels && line.lengthInMeters !== undefined && line.lengthInMeters > 0) {
            // For windows, only show label on the middle line (index 1)
            if (isWindow && line.id && !line.id.endsWith('-1')) {
                // Skip non-middle lines for windows (show only on middle line which is index 1)
            } else {
                const midX = (startPoint.x + endPoint.x) / 2;
                const midY = (startPoint.y + endPoint.y) / 2;
                
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
                
                // Determine label background color based on line type
                let labelBgColor;
                if (isWall) {
                    labelBgColor = 'rgba(37, 99, 235, 0.9)'; // Blue for walls
                } else if (isWindow) {
                    labelBgColor = 'rgba(22, 163, 74, 0.9)'; // Green for windows
                } else {
                    // Check if line belongs to a polygon (including merged polygons)
                    let containingPolygon = state.polygons.find(polygon => 
                        polygon.lines && polygon.lines.some(l => l.id === line.id)
                    );
                    
                    // Also check merged polygons
                    if (!containingPolygon) {
                        for (const polygon of state.polygons) {
                            if (polygon.mergedPolygons) {
                                const mergedPolygon = polygon.mergedPolygons.find(mp => 
                                    mp.lines && mp.lines.some(l => l.id === line.id)
                                );
                                if (mergedPolygon) {
                                    containingPolygon = mergedPolygon;
                                    break;
                                }
                            }
                        }
                    }
                    
                    if (containingPolygon) {
                        labelBgColor = hexToRgba(containingPolygon.color || DEFAULT_POLYGON_COLOR, 0.9);
                    } else {
                        labelBgColor = 'rgba(37, 99, 235, 0.9)'; // Default blue
                    }
                }
            
                ctx.fillStyle = labelBgColor;
                ctx.beginPath();
                ctx.roundRect(bgX, bgY, bgWidth, bgHeight, 6);
                ctx.fill();
                
                ctx.fillStyle = 'white';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(text, midX * state.zoom, midY * state.zoom);
                
                ctx.restore();
            }
        }
    });
    
    // Draw current rectangle preview
    if (state.currentRectangleStart && state.cursorPosition) {
        const rectStart = toCanvasPoint(state.currentRectangleStart);
        const rectCursor = toCanvasPoint(state.cursorPosition);
        const x1 = rectStart.x;
        const y1 = rectStart.y;
        const x2 = rectCursor.x;
        const y2 = rectCursor.y;
        
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
        const lineStart = toCanvasPoint(state.currentLineStart);
        const snapTarget = state.nearestSnapPoint ? toCanvasPoint(state.nearestSnapPoint) : toCanvasPoint(state.cursorPosition);
        
        // Check if angle snapped
        const isAngleSnapped = state.cursorPosition.isAngleSnapped;
        const isWall = state.currentTool === 'walls';
        const isWindow = state.currentTool === 'window';
        
        let previewColor = LINE_COLOR;
        if (isWall) {
            previewColor = WALL_COLOR;
        } else if (isWindow) {
            previewColor = WINDOW_COLOR;
        }
        
        ctx.strokeStyle = isAngleSnapped ? '#16a34a' : previewColor;
        ctx.lineWidth = LINE_WIDTH / state.zoom;  // Fixed screen width
        ctx.lineCap = 'round';
        
        // Solid line when angle-snapped, dashed otherwise
        if (!isAngleSnapped) {
            ctx.setLineDash([5 / state.zoom, 5 / state.zoom]);  // Fixed dash size
        }
        
        ctx.beginPath();
        ctx.moveTo(lineStart.x, lineStart.y);
        ctx.lineTo(snapTarget.x, snapTarget.y);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Show length and angle indicator
        const midX = (lineStart.x + snapTarget.x) / 2;
        const midY = (lineStart.y + snapTarget.y) / 2;
        
        ctx.save();
        ctx.scale(1 / state.zoom, 1 / state.zoom);
        
        // Calculate and show length
        const pixelLength = calculateDistance(state.currentLineStart, state.cursorPosition);
        // Use a simple scale: 1 meter = 100 pixels (can be adjusted)
        const pixelsPerMeter = 100;
        const lengthInMeters = pixelLength / pixelsPerMeter;
        const lengthText = `${lengthInMeters.toFixed(2)}m`;
        
        // Show angle if angle-snapped
        let displayText = lengthText;
        if (isAngleSnapped) {
            displayText = `${lengthText} (${state.cursorPosition.snappedAngle}°)`;
        }
        
        ctx.font = '600 14px Inter, sans-serif';
        const metrics = ctx.measureText(displayText);
        const padding = 6;
        
        const bgX = midX * state.zoom - metrics.width / 2 - padding;
        const bgY = midY * state.zoom - 12 - padding;
        const bgWidth = metrics.width + padding * 2;
        const bgHeight = 24 + padding * 2;
        
        ctx.fillStyle = isAngleSnapped ? 'rgba(22, 163, 74, 0.9)' : 'rgba(37, 99, 235, 0.9)';
        ctx.beginPath();
        ctx.roundRect(bgX, bgY, bgWidth, bgHeight, 4);
        ctx.fill();
        
        ctx.fillStyle = 'white';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(displayText, midX * state.zoom, midY * state.zoom);
        
        ctx.restore();
    }
    
    // Draw points with fixed visual size (not affected by zoom)
    state.points.forEach(point => {
        const canvasPoint = toCanvasPoint(point);
        const isHovered = state.nearestSnapPoint?.id === point.id;
        const isStart = state.currentLineStart?.id === point.id;
        const isSelected = state.selectedPoints.includes(point.id);
        
        // Find if point belongs to a polygon (including merged polygons)
        let pointColor = POINT_COLOR;
        if (!isStart) {
            // Check if point belongs to a polygon
            let containingPolygon = state.polygons.find(polygon => 
                polygon.points && polygon.points.some(p => p.id === point.id)
            );
            
            // Also check merged polygons
            if (!containingPolygon) {
                for (const polygon of state.polygons) {
                    if (polygon.mergedPolygons) {
                        const mergedPolygon = polygon.mergedPolygons.find(mp => 
                            mp.points && mp.points.some(p => p.id === point.id)
                        );
                        if (mergedPolygon) {
                            containingPolygon = mergedPolygon;
                            break;
                        }
                    }
                }
            }
            
            if (containingPolygon) {
                pointColor = containingPolygon.color || DEFAULT_POLYGON_COLOR;
            }
        }
        
        // Highlight selected points
        if (isSelected) {
            ctx.strokeStyle = '#ff0000'; // Red outline for selected
            ctx.lineWidth = 3 / state.zoom;
            ctx.beginPath();
            ctx.arc(canvasPoint.x, canvasPoint.y, 8 / state.zoom, 0, Math.PI * 2);
            ctx.stroke();
        } else if (isHovered) {
            ctx.strokeStyle = pointColor;
            ctx.lineWidth = 2 / state.zoom;  // Fixed screen width
            ctx.beginPath();
            ctx.arc(canvasPoint.x, canvasPoint.y, 7 / state.zoom, 0, Math.PI * 2);  // Fixed screen size
            ctx.stroke();
        }
        
        ctx.fillStyle = isStart ? '#dc2626' : pointColor;
        ctx.beginPath();
        ctx.arc(canvasPoint.x, canvasPoint.y, 5 / state.zoom, 0, Math.PI * 2);  // Fixed screen size
        ctx.fill();
    });
    
    // Draw selection rectangle for select tool
    if (state.isSelecting && state.selectionStart && state.selectionEnd) {
        const startCanvas = toCanvasPoint(state.selectionStart);
        const endCanvas = toCanvasPoint(state.selectionEnd);
        
        const x = Math.min(startCanvas.x, endCanvas.x);
        const y = Math.min(startCanvas.y, endCanvas.y);
        const width = Math.abs(endCanvas.x - startCanvas.x);
        const height = Math.abs(endCanvas.y - startCanvas.y);
        
        // Draw selection rectangle with dashed border
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 2 / state.zoom;
        ctx.setLineDash([8 / state.zoom, 4 / state.zoom]);
        ctx.strokeRect(x, y, width, height);
        ctx.setLineDash([]);
        
        // Draw semi-transparent fill
        ctx.fillStyle = 'rgba(37, 99, 235, 0.1)';
        ctx.fillRect(x, y, width, height);
    }
    
    // Draw screenshot selection rectangle
    if (state.isSelectingScreenshot && state.screenshotSelectionStart && state.screenshotSelectionEnd) {
        const startCanvas = toCanvasPoint(state.screenshotSelectionStart);
        const endCanvas = toCanvasPoint(state.screenshotSelectionEnd);
        
        const x = Math.min(startCanvas.x, endCanvas.x);
        const y = Math.min(startCanvas.y, endCanvas.y);
        const width = Math.abs(endCanvas.x - startCanvas.x);
        const height = Math.abs(endCanvas.y - startCanvas.y);
        
        // Draw selection rectangle with dashed border
        ctx.strokeStyle = '#2563eb';
        ctx.lineWidth = 2 / state.zoom;
        ctx.setLineDash([8 / state.zoom, 4 / state.zoom]);
        ctx.strokeRect(x, y, width, height);
        ctx.setLineDash([]);
        
        // Draw semi-transparent fill
        ctx.fillStyle = 'rgba(37, 99, 235, 0.1)';
        ctx.fillRect(x, y, width, height);
    }
    
    ctx.restore();
}

// ==================== Polygon Detection ====================
function checkForClosedPolygon() {
    const pointConnections = new Map();
    
    // Use all lines (walls, windows, etc.) for polygon detection
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
            
            // Include all lines that are part of the polygon path
            const polygonLines = state.lines.filter(line =>
                polygonPath.includes(line.startPoint.id) && polygonPath.includes(line.endPoint.id)
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
                name: `Room ${state.polygons.length + 1}`,
                color: DEFAULT_POLYGON_COLOR // Default color, can be changed via color picker
            };
            
            state.polygons.push(newPolygon);
            
            // Record action for undo
            state.actionHistory.push({
                type: 'add_polygon',
                data: { polygon: JSON.parse(JSON.stringify(newPolygon)) }
            });
            
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
    if (!file) {
        console.error('No file provided to handleFileUpload');
        showToast('No file selected');
        return;
    }
    
    // Validate file size (max 50MB)
    const maxSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxSize) {
        showToast('File is too large. Maximum size is 50MB');
        return;
    }
    
    if (file.size === 0) {
        showToast('File is empty');
        return;
    }
    
    const fileType = file.type;
    const fileName = file.name.toLowerCase();
    
    // Show loading state
    if (elements.loadingState) {
        elements.loadingState.classList.remove('hidden');
    }
    if (elements.emptyState) {
        elements.emptyState.classList.add('hidden');
    }
    
    // Check file type by MIME type or extension
    const isPDF = fileType === 'application/pdf' || fileName.endsWith('.pdf');
    const isImage = fileType.startsWith('image/') || 
                   fileName.endsWith('.jpg') || 
                   fileName.endsWith('.jpeg') || 
                   fileName.endsWith('.png') ||
                   fileName.endsWith('.gif') ||
                   fileName.endsWith('.webp');
    
    if (isPDF) {
        const fileReader = new FileReader();
        fileReader.onerror = function() {
            console.error('Error reading PDF file');
            showToast('Error reading PDF file');
            if (elements.loadingState) {
                elements.loadingState.classList.add('hidden');
            }
            if (elements.emptyState) {
                elements.emptyState.classList.remove('hidden');
            }
        };
        fileReader.onload = async function(e) {
            try {
                if (!e.target || !e.target.result) {
                    throw new Error('No file data');
                }
                const typedArray = new Uint8Array(e.target.result);
                const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
                const page = await pdf.getPage(1);
                const viewport = page.getViewport({ scale: 2 });
                
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                if (!context) {
                    throw new Error('Could not get canvas context');
                }
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                
                await page.render({
                    canvasContext: context,
                    viewport: viewport
                }).promise;
                
                const dataUrl = canvas.toDataURL();
                loadImage(dataUrl);
            } catch (error) {
                console.error('Error loading PDF:', error);
                showToast('Error loading PDF file: ' + (error.message || 'Unknown error'));
                if (elements.loadingState) {
                    elements.loadingState.classList.add('hidden');
                }
                if (elements.emptyState) {
                    elements.emptyState.classList.remove('hidden');
                }
            }
        };
        fileReader.readAsArrayBuffer(file);
    } else if (isImage) {
        const reader = new FileReader();
        reader.onerror = function() {
            console.error('Error reading image file');
            showToast('Error reading image file');
            if (elements.loadingState) {
                elements.loadingState.classList.add('hidden');
            }
            if (elements.emptyState) {
                elements.emptyState.classList.remove('hidden');
            }
        };
        reader.onload = function(e) {
            if (!e.target || !e.target.result) {
                showToast('Error reading image file');
                if (elements.loadingState) {
                    elements.loadingState.classList.add('hidden');
                }
                if (elements.emptyState) {
                    elements.emptyState.classList.remove('hidden');
                }
                return;
            }
            loadImage(e.target.result);
        };
        reader.readAsDataURL(file);
    } else {
        showToast('Unsupported file type. Please upload JPG, PNG, or PDF');
        if (elements.loadingState) {
            elements.loadingState.classList.add('hidden');
        }
        if (elements.emptyState) {
            elements.emptyState.classList.remove('hidden');
        }
    }
}

function loadImage(dataUrl) {
    const img = new Image();
    img.onload = function() {
        try {
            state.image = img;
            state.imageData = dataUrl;
            
            elements.loadingState.classList.add('hidden');
            elements.canvas.classList.remove('hidden');
            elements.zoomControls.classList.remove('hidden');
            
            resizeCanvas();
            renderCanvas();
        } catch (error) {
            console.error('Error loading image:', error);
            showToast('Error loading image');
            elements.loadingState.classList.add('hidden');
            elements.emptyState.classList.remove('hidden');
        }
    };
    img.onerror = function() {
        showToast('Error loading image file');
        elements.loadingState.classList.add('hidden');
        elements.emptyState.classList.remove('hidden');
    };
    img.src = dataUrl;
}

function handleCanvasClick(e) {
    if (e.shiftKey) return;
    
    // Ignore clicks when in screenshot selection mode
    if (state.isSelectingScreenshot) {
        return;
    }
    
    // Ignore clicks when actively dragging selection rectangle
    if (state.isSelecting) {
        return;
    }
    
    // Ignore clicks immediately after finishing drag selection
    if (state.justFinishedSelection) {
        state.justFinishedSelection = false; // Reset flag
        return;
    }
    
    const point = getCanvasPoint(e.clientX, e.clientY);
    
    // Check if double-clicking on a wall/window line to edit length (works for all tools)
    if (e.detail === 2) {
        const clickedLine = findNearestLine(point);
        if (clickedLine && (clickedLine.isWall || clickedLine.isWindow)) {
            // Find all lines in the same group
            const groupLines = state.lines.filter(l => l.groupId === clickedLine.groupId);
            if (groupLines.length > 0) {
                // Use the first line as the base (they all have the same length)
                const baseLine = groupLines[0];
                const currentLength = baseLine.lengthInMeters || calculateDistance(baseLine.startPoint, baseLine.endPoint) / 100;
                
                // Create a temporary line object for editing
                state.pendingLengthLine = {
                    id: baseLine.groupId,
                    startPoint: baseLine.startPoint,
                    endPoint: baseLine.endPoint,
                    isWall: baseLine.isWall,
                    isWindow: baseLine.isWindow,
                    existingLines: groupLines // Store reference to existing lines
                };
                
                // Set current value in input
                elements.lengthInput.value = currentLength.toFixed(2);
                openLengthModal();
                return;
            }
        }
    }
    
    // Handle select tool (works even without image)
    if (state.currentTool === 'select') {
        handleSelectToolClick(e);
        return;
    }
    
    // Handle walls and window tools
    // Point snapping takes priority
    let snappedPoint = findNearestPoint(point);
    let actualPoint = snappedPoint || point;
    
    // Apply angle snapping if drawing and not point-snapped
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
        // Create the base line and draw it directly
        const pixelLength = calculateDistance(state.currentLineStart, actualPoint);
        const pixelsPerMeter = 100; // Default scale: 1 meter = 100 pixels
        const lengthInMeters = pixelLength / pixelsPerMeter;
        
        // Create parallel lines
        const parallelLines = createParallelLines(state.currentLineStart, actualPoint, state.currentTool === 'window');
        
        // Add all parallel lines to state
        const addedLines = [];
        const groupId = `group-${Date.now()}`;
        parallelLines.forEach((lineData, index) => {
            const line = {
                id: `line-${Date.now()}-${index}`,
                startPoint: lineData.startPoint,
                endPoint: lineData.endPoint,
                isWall: state.currentTool === 'walls',
                isWindow: state.currentTool === 'window',
                lengthInMeters: lengthInMeters,
                groupId: groupId // Group ID to identify lines that belong together
            };
            
            // Add points if they don't exist
            if (!state.points.find(p => p.id === line.startPoint.id)) {
                state.points.push(line.startPoint);
            }
            if (!state.points.find(p => p.id === line.endPoint.id)) {
                state.points.push(line.endPoint);
            }
            
            state.lines.push(line);
            addedLines.push(line);
        });
        
        // Record action for undo
        state.actionHistory.push({
            type: 'add_wall_window',
            data: { lines: addedLines.map(l => JSON.parse(JSON.stringify(l))) }
        });
        
        // Store pending line info for length input modal
        // Use the first line as base line (for walls it's the only line, for windows it's the middle one)
        const baseLineForModal = {
            startPoint: state.currentLineStart,
            endPoint: actualPoint,
            isWall: state.currentTool === 'walls',
            isWindow: state.currentTool === 'window',
            existingLines: addedLines, // Store the newly created lines
            currentLengthInMeters: lengthInMeters
        };
        
        state.pendingLengthLine = baseLineForModal;
        
        // Show length input modal automatically
        openLengthModal();
        
        // Don't continue drawing until length is confirmed
        state.currentLineStart = null;
        state.cursorPosition = null; // Clear cursor position
    }
    
    updateUI();
    renderCanvas();
}

function handleSelectToolClick(e) {
    const point = getCanvasPoint(e.clientX, e.clientY);
    
    // Check if clicking on a point (force check even if point snapping is disabled)
    const clickedPoint = findNearestPoint(point, true);
    if (clickedPoint) {
        // Toggle point selection
        const pointIndex = state.selectedPoints.indexOf(clickedPoint.id);
        if (pointIndex === -1) {
            state.selectedPoints.push(clickedPoint.id);
        } else {
            state.selectedPoints.splice(pointIndex, 1);
        }
        updateUI();
        renderCanvas();
        return;
    }
    
    // Check if clicking on a line
    const clickedLine = findNearestLine(point);
    if (clickedLine) {
        // Toggle line selection
        const lineIndex = state.selectedLines.indexOf(clickedLine.id);
        if (lineIndex === -1) {
            state.selectedLines.push(clickedLine.id);
        } else {
            state.selectedLines.splice(lineIndex, 1);
        }
        updateUI();
        renderCanvas();
        return;
    }
    
    // If clicking on empty space, clear selection (unless Ctrl/Cmd is held)
    if (!e.ctrlKey && !e.metaKey) {
        state.selectedPoints = [];
        state.selectedLines = [];
        updateUI();
        renderCanvas();
    }
}

function findNearestLine(point) {
    const snapRadius = 15 / state.zoom; // Selection radius (increased for better selection)
    
    let nearestLine = null;
    let minDistance = snapRadius;
    
    state.lines.forEach(line => {
        if (!line.startPoint || !line.endPoint) return;
        
        // Points are now stored in direct canvas coordinates
        const startX = line.startPoint.x;
        const startY = line.startPoint.y;
        const endX = line.endPoint.x;
        const endY = line.endPoint.y;
        const pointCanvasX = point.x;
        const pointCanvasY = point.y;
        
        // Calculate distance from point to line segment
        const A = pointCanvasX - startX;
        const B = pointCanvasY - startY;
        const C = endX - startX;
        const D = endY - startY;
        
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;
        
        if (lenSq !== 0) {
            param = dot / lenSq;
        }
        
        let xx, yy;
        if (param < 0) {
            xx = startX;
            yy = startY;
        } else if (param > 1) {
            xx = endX;
            yy = endY;
        } else {
            xx = startX + param * C;
            yy = startY + param * D;
        }
        
        const dx = pointCanvasX - xx;
        const dy = pointCanvasY - yy;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance < minDistance) {
            minDistance = distance;
            nearestLine = line;
        }
    });
    
    return nearestLine;
}

function handleMouseDown(e) {
    // Handle select tool selection rectangle
    if (state.currentTool === 'select' && e.button === 0 && !e.ctrlKey && !e.metaKey) {
        const point = getCanvasPoint(e.clientX, e.clientY);
        const clickedPoint = findNearestPoint(point, true); // Force check for selection
        const clickedLine = findNearestLine(point);
        
        // Only start selection rectangle if not clicking on an element
        // Selection of elements is handled in handleCanvasClick (which fires after mousedown)
        if (!clickedPoint && !clickedLine) {
            e.preventDefault(); // Prevent default behavior and click event
            state.isSelecting = true;
            state.selectionStart = point;
            state.selectionEnd = point;
            renderCanvas();
            return;
        }
        // If clicking on an element, let handleCanvasClick handle the selection
        // Don't return here - let handleCanvasClick handle element selection
    }
    
    // Handle screenshot selection mode
    if (state.isSelectingScreenshot && e.button === 0) {
        e.preventDefault();
        const point = getCanvasPoint(e.clientX, e.clientY);
        state.screenshotSelectionStart = point;
        state.screenshotSelectionEnd = point;
        renderCanvas();
        return;
    }
    
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

// Helper function to check if key matches (supports both Latin and Cyrillic)
function isKeyMatch(key, latinLower, latinUpper, cyrillicLower, cyrillicUpper) {
    return key === latinLower || key === latinUpper || key === cyrillicLower || key === cyrillicUpper;
}

function handleKeyDown(e) {
    // Don't process tool shortcuts if user is typing in an input field
    const isTyping = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';
    
    // Delete or Backspace to delete selected elements
    if ((e.key === 'Delete' || e.key === 'Backspace') && (state.selectedPoints.length > 0 || state.selectedLines.length > 0)) {
        if (isTyping) {
            return;
        }
        e.preventDefault();
        handleDeleteSelected();
        return;
    }
    
    // Ctrl+Z or Cmd+Z for undo
    if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        if (isTyping) {
            return;
        }
        e.preventDefault();
        handleUndo();
        return;
    }
    
    // ESC key cancels any active drawing or clears selection
    if (e.key === 'Escape' || e.key === 'Esc') {
        if (state.currentLineStart || state.currentRectangleStart || state.isDrawingRectangle) {
            state.currentLineStart = null;
            state.currentRectangleStart = null;
            state.isDrawingRectangle = false;
            state.cursorPosition = null;
            state.justFinishedRectangle = false;
            renderCanvas();
            showToast('Drawing cancelled');
        } else if (state.selectedPoints.length > 0 || state.selectedLines.length > 0) {
            state.selectedPoints = [];
            state.selectedLines = [];
            state.isSelecting = false;
            state.selectionStart = null;
            state.selectionEnd = null;
            renderCanvas();
        }
    }
    
    // S key toggles point snapping (S/С)
    if (isKeyMatch(e.key, 's', 'S', 'с', 'С')) {
        if (isTyping) {
            return;
        }
        e.preventDefault();
        handleTogglePointSnap();
        return;
    }
    
    // A key activates select tool (A/А)
    if (isKeyMatch(e.key, 'a', 'A', 'а', 'А')) {
        if (isTyping) {
            return;
        }
        e.preventDefault();
        if (elements.toolSelect) {
            elements.toolSelect.click();
        }
        return;
    }
    
    // W key activates walls tool (W/В)
    if (isKeyMatch(e.key, 'w', 'W', 'в', 'В')) {
        if (isTyping) {
            return;
        }
        e.preventDefault();
        if (elements.toolWalls) {
            elements.toolWalls.click();
        }
        return;
    }
    
    // N key activates window tool (N/Н)
    if (isKeyMatch(e.key, 'n', 'N', 'н', 'Н')) {
        if (isTyping) {
            return;
        }
        e.preventDefault();
        if (elements.toolWindow) {
            elements.toolWindow.click();
        }
        return;
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
    
    // Handle select tool selection rectangle
    if (state.isSelecting && state.selectionStart) {
        const point = getCanvasPoint(e.clientX, e.clientY);
        state.selectionEnd = point;
        renderCanvas();
        return;
    }
    
    // Handle screenshot selection drag
    if (state.isSelectingScreenshot && state.screenshotSelectionStart) {
        const point = getCanvasPoint(e.clientX, e.clientY);
        state.screenshotSelectionEnd = point;
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
    
    // For select tool, don't show line preview
    if (state.currentTool === 'select' && !state.isSelecting) {
        state.cursorPosition = null;
        // Still show snap point for better UX
        let nearest = findNearestPoint(point);
        state.nearestSnapPoint = nearest;
        state.hoveredPoint = nearest;
        
        if (nearest) {
            elements.canvas.classList.add('snap-cursor');
        } else {
            elements.canvas.classList.remove('snap-cursor');
        }
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
    if (state.currentLineStart && !nearest && state.angleSnapEnabled && (state.currentTool === 'line' || state.currentTool === 'pipe' || state.currentTool === 'subtract' || state.currentTool === 'walls' || state.currentTool === 'window')) {
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
    
    // Handle select tool selection rectangle end
    if (state.isSelecting && state.selectionStart && state.selectionEnd && e.button === 0) {
        e.preventDefault(); // Prevent click event from firing
        const startX = Math.min(state.selectionStart.x, state.selectionEnd.x);
        const startY = Math.min(state.selectionStart.y, state.selectionEnd.y);
        const endX = Math.max(state.selectionStart.x, state.selectionEnd.x);
        const endY = Math.max(state.selectionStart.y, state.selectionEnd.y);
        
        // Only process if selection rectangle has meaningful size (not just a click)
        const selectionWidth = endX - startX;
        const selectionHeight = endY - startY;
        if (selectionWidth > 0.1 || selectionHeight > 0.1) {
            // Select points and lines within rectangle
            // Note: Both selection coordinates and point coordinates are in image-relative space
            state.points.forEach(point => {
                if (point.x >= startX && point.x <= endX && point.y >= startY && point.y <= endY) {
                    if (!state.selectedPoints.includes(point.id)) {
                        state.selectedPoints.push(point.id);
                    }
                }
            });
            
            state.lines.forEach(line => {
                if (!line.startPoint || !line.endPoint) return;
                const startX_line = line.startPoint.x;
                const startY_line = line.startPoint.y;
                const endX_line = line.endPoint.x;
                const endY_line = line.endPoint.y;
                
                // Check if line is within or intersects selection rectangle
                const lineInRect = 
                    (startX_line >= startX && startX_line <= endX && startY_line >= startY && startY_line <= endY) ||
                    (endX_line >= startX && endX_line <= endX && endY_line >= startY && endY_line <= endY) ||
                    (startX_line < startX && endX_line > endX && startY_line >= startY && startY_line <= endY) ||
                    (startY_line < startY && endY_line > endY && startX_line >= startX && startX_line <= endX) ||
                    // Check if line intersects rectangle edges
                    lineIntersectsRect(startX_line, startY_line, endX_line, endY_line, startX, startY, endX, endY);
                
                if (lineInRect && !state.selectedLines.includes(line.id)) {
                    state.selectedLines.push(line.id);
                }
            });
            
            // Set flag to prevent click event from clearing selection after drag
            state.justFinishedSelection = true;
        }
        
        state.isSelecting = false;
        state.selectionStart = null;
        state.selectionEnd = null;
        updateUI();
        renderCanvas();
        return;
    }
    
    // Handle screenshot selection end
    if (state.isSelectingScreenshot && state.screenshotSelectionStart && state.screenshotSelectionEnd && e.button === 0) {
        e.preventDefault();
        // Validate selection (points are in direct canvas coordinates)
        const selectionWidth = Math.abs(state.screenshotSelectionEnd.x - state.screenshotSelectionStart.x);
        const selectionHeight = Math.abs(state.screenshotSelectionEnd.y - state.screenshotSelectionStart.y);
        
        if (selectionWidth >= 10 && selectionHeight >= 10) {
            // Create screenshot from selection (don't reset selection mode here - it will be reset in createScreenshotFromSelection)
            createScreenshotFromSelection();
        } else {
            showToast('Selection too small. Please select a larger area.');
            // Reset selection mode if selection is too small
            state.isSelectingScreenshot = false;
            state.screenshotSelectionStart = null;
            state.screenshotSelectionEnd = null;
            state.currentLineStart = null;
            state.cursorPosition = null;
            elements.canvas.style.cursor = 'default';
        }
        renderCanvas();
        return;
    }
    
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
            name: `Room ${state.polygons.length + 1}`,
            isRectangle: true,
            color: DEFAULT_POLYGON_COLOR // Default color, can be changed via color picker
        };
        
        state.polygons.push(newPolygon);
        
        // Record action for undo
        state.actionHistory.push({
            type: 'add_rectangle',
            data: { 
                polygon: JSON.parse(JSON.stringify(newPolygon)),
                lines: rectangleLines.map(l => JSON.parse(JSON.stringify(l)))
            }
        });
        
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
    
    // Allow zoom even after drawing has started
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
    // Allow zoom even after drawing has started
    // Zoom to canvas center when using buttons
    const centerX = elements.canvas.width / 2;
    const centerY = elements.canvas.height / 2;
    zoomToPoint(1.2, centerX, centerY);
    updateUI();
    renderCanvas();
}

function handleZoomOut() {
    // Allow zoom even after drawing has started
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
    state.actionHistory = []; // Clear history when clearing all
    updateUI();
    renderCanvas();
}

function handleUndo() {
    if (state.actionHistory.length === 0) {
        showToast('Nothing to undo');
        return;
    }
    
    // Helper function to check if a point is still used by any line
    const isPointUsed = (pointId) => {
        return state.lines.some(line => 
            (line.startPoint && line.startPoint.id === pointId) ||
            (line.endPoint && line.endPoint.id === pointId)
        );
    };
    
    // Helper function to remove unused points
    const removeUnusedPoints = (pointIds) => {
        pointIds.forEach(pointId => {
            if (pointId && !isPointUsed(pointId)) {
                const pointIndex = state.points.findIndex(p => p.id === pointId);
                if (pointIndex !== -1) {
                    state.points.splice(pointIndex, 1);
                }
            }
        });
    };
    
    // Get the last action
    const lastAction = state.actionHistory.pop();
    
    switch (lastAction.type) {
        case 'add_line':
            // Remove the line
            const lineToRemove = lastAction.data.line;
            const lineIndex = state.lines.findIndex(l => l.id === lineToRemove.id);
            if (lineIndex !== -1) {
                state.lines.splice(lineIndex, 1);
            }
            
            // Remove unused points
            const linePointIds = [];
            if (lineToRemove.startPoint && lineToRemove.startPoint.id) {
                linePointIds.push(lineToRemove.startPoint.id);
            }
            if (lineToRemove.endPoint && lineToRemove.endPoint.id) {
                linePointIds.push(lineToRemove.endPoint.id);
            }
            removeUnusedPoints(linePointIds);
            
            // Remove polygon if it was created by this line
            state.polygons = state.polygons.filter(polygon =>
                !polygon.lines || !polygon.lines.some(l => l.id === lineToRemove.id)
            );
            break;
            
        case 'add_polygon':
            // Remove the polygon and its lines
            const polygonToRemove = lastAction.data.polygon;
            const polygonIndex = state.polygons.findIndex(p => p.id === polygonToRemove.id);
            if (polygonIndex !== -1) {
                state.polygons.splice(polygonIndex, 1);
            }
            
            // Remove lines associated with this polygon
            const polygonPointIds = [];
            if (polygonToRemove.lines) {
                polygonToRemove.lines.forEach(line => {
                    const index = state.lines.findIndex(l => l.id === line.id);
                    if (index !== -1) {
                        state.lines.splice(index, 1);
                    }
                    if (line.startPoint && line.startPoint.id) {
                        polygonPointIds.push(line.startPoint.id);
                    }
                    if (line.endPoint && line.endPoint.id) {
                        polygonPointIds.push(line.endPoint.id);
                    }
                });
            }
            
            // Remove unused points
            removeUnusedPoints(polygonPointIds);
            break;
            
        case 'add_rectangle':
            // Remove the rectangle polygon and its lines
            const rectangleToRemove = lastAction.data.polygon;
            const rectangleIndex = state.polygons.findIndex(p => p.id === rectangleToRemove.id);
            if (rectangleIndex !== -1) {
                state.polygons.splice(rectangleIndex, 1);
            }
            
            // Remove rectangle lines
            const rectanglePointIds = [];
            if (lastAction.data.lines) {
                lastAction.data.lines.forEach(line => {
                    const index = state.lines.findIndex(l => l.id === line.id);
                    if (index !== -1) {
                        state.lines.splice(index, 1);
                    }
                    if (line.startPoint && line.startPoint.id) {
                        rectanglePointIds.push(line.startPoint.id);
                    }
                    if (line.endPoint && line.endPoint.id) {
                        rectanglePointIds.push(line.endPoint.id);
                    }
                });
            }
            
            // Remove unused points
            removeUnusedPoints(rectanglePointIds);
            break;
            
        case 'set_calibration':
            // Restore previous calibration or remove it
            if (lastAction.data.previousCalibration) {
                state.calibration = lastAction.data.previousCalibration;
            } else {
                state.calibration = null;
            }
            
            // Remove calibration line
            const calibrationLine = lastAction.data.line;
            const calLineIndex = state.lines.findIndex(l => l.id === calibrationLine.id);
            if (calLineIndex !== -1) {
                state.lines.splice(calLineIndex, 1);
            }
            
            // Remove unused points
            const calPointIds = [];
            if (calibrationLine.startPoint && calibrationLine.startPoint.id) {
                calPointIds.push(calibrationLine.startPoint.id);
            }
            if (calibrationLine.endPoint && calibrationLine.endPoint.id) {
                calPointIds.push(calibrationLine.endPoint.id);
            }
            removeUnusedPoints(calPointIds);
            
            // Recalculate all line lengths if calibration was removed
            if (!state.calibration) {
                state.lines.forEach(line => {
                    if (line.lengthInMeters !== undefined && !line.isCalibration) {
                        delete line.lengthInMeters;
                    }
                });
            }
            break;
            
        case 'delete_elements':
            // Restore deleted elements
            if (lastAction.data.points) {
                lastAction.data.points.forEach(point => {
                    if (!state.points.find(p => p.id === point.id)) {
                        state.points.push(point);
                    }
                });
            }
            
            if (lastAction.data.lines) {
                lastAction.data.lines.forEach(line => {
                    if (!state.lines.find(l => l.id === line.id)) {
                        state.lines.push(line);
                    }
                });
            }
            
            // Re-check for polygons
            checkForClosedPolygon();
            break;
    }
    
    // Clear current drawing state
    state.currentLineStart = null;
    state.currentRectangleStart = null;
    state.isDrawingRectangle = false;
    state.cursorPosition = null;
    
    updateUI();
    renderCanvas();
    showToast('Undo completed');
}

// Keep old function name for compatibility, but redirect to new function
function handleUndoLastLine() {
    handleUndo();
}

function handleDeleteSelected() {
    if (state.selectedPoints.length === 0 && state.selectedLines.length === 0) {
        return;
    }
    
    // Collect lines to delete (selected lines + lines connected to selected points)
    const linesToDelete = new Set();
    
    // Add selected lines
    state.selectedLines.forEach(lineId => {
        linesToDelete.add(lineId);
    });
    
    // Find lines connected to selected points
    state.selectedPoints.forEach(pointId => {
        state.lines.forEach(line => {
            if ((line.startPoint && line.startPoint.id === pointId) ||
                (line.endPoint && line.endPoint.id === pointId)) {
                linesToDelete.add(line.id);
            }
        });
    });
    
    // Record action for undo
    const deletedLines = state.lines.filter(l => linesToDelete.has(l.id)).map(l => JSON.parse(JSON.stringify(l)));
    const deletedPoints = state.points.filter(p => state.selectedPoints.includes(p.id)).map(p => JSON.parse(JSON.stringify(p)));
    
    if (deletedLines.length > 0 || deletedPoints.length > 0) {
        state.actionHistory.push({
            type: 'delete_elements',
            data: {
                lines: deletedLines,
                points: deletedPoints
            }
        });
    }
    
    // Remove lines
    state.lines = state.lines.filter(line => !linesToDelete.has(line.id));
    
    // Remove points
    state.points = state.points.filter(point => !state.selectedPoints.includes(point.id));
    
    // Remove polygons that reference deleted lines
    state.polygons = state.polygons.filter(polygon => {
        if (!polygon.lines) return true;
        return polygon.lines.every(line => !linesToDelete.has(line.id));
    });
    
    // Clear selection
    state.selectedPoints = [];
    state.selectedLines = [];
    
    // Clear drawing state
    state.currentLineStart = null;
    state.currentRectangleStart = null;
    state.isDrawingRectangle = false;
    state.cursorPosition = null;
    
    updateUI();
    renderCanvas();
    showToast(`Deleted ${deletedPoints.length} point(s) and ${deletedLines.length} line(s)`);
}

function handleContextMenu(e) {
    // Only show context menu for select tool
    if (state.currentTool !== 'select') {
        e.preventDefault();
        return;
    }
    
    // Only show if there are selected elements
    if (state.selectedPoints.length === 0 && state.selectedLines.length === 0) {
        e.preventDefault();
        return;
    }
    
    e.preventDefault();
    
    // Create context menu
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.position = 'fixed';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';
    menu.style.backgroundColor = 'white';
    menu.style.border = '1px solid #e5e7eb';
    menu.style.borderRadius = '0.375rem';
    menu.style.boxShadow = '0 4px 6px -1px rgba(0, 0, 0, 0.1)';
    menu.style.padding = '0.5rem 0';
    menu.style.zIndex = '10000';
    menu.style.minWidth = '150px';
    
    const deleteItem = document.createElement('div');
    deleteItem.className = 'context-menu-item';
    deleteItem.style.padding = '0.5rem 1rem';
    deleteItem.style.cursor = 'pointer';
    deleteItem.style.fontSize = '0.875rem';
    deleteItem.style.color = '#dc2626';
    deleteItem.textContent = 'Delete';
    deleteItem.addEventListener('click', () => {
        handleDeleteSelected();
        document.body.removeChild(menu);
    });
    
    menu.appendChild(deleteItem);
    document.body.appendChild(menu);
    
    // Remove menu when clicking elsewhere
    const removeMenu = (event) => {
        if (!menu.contains(event.target)) {
            document.body.removeChild(menu);
            document.removeEventListener('click', removeMenu);
        }
    };
    
    setTimeout(() => {
        document.addEventListener('click', removeMenu);
    }, 0);
}

function handleNewProject() {
    const hasData = state.points.length > 0 || state.lines.length > 0 || state.polygons.length > 0 || state.actionHistory.length > 0;
    
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
    state.actionHistory = []; // Clear history when recalibrating
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

function handleTogglePointSnap() {
    state.pointSnapEnabled = !state.pointSnapEnabled;
    state.nearestSnapPoint = null; // Clear current snap point
    updateUI();
    renderCanvas();
    showToast(state.pointSnapEnabled ? 'Point snap enabled' : 'Point snap disabled');
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
    // The key insight: In renderCanvas(), the coordinate system is transformed by:
    // ctx.translate(state.pan.x, state.pan.y) and ctx.scale(state.zoom, state.zoom)
    // Then the image is drawn at: (canvas.width/zoom - width)/2 in transformed space
    //
    // Points are stored as: (clientX - rect.left - pan.x) / zoom
    // This gives coordinates in the transformed space.
    //
    // The problem: The image position in transformed space is (canvas.width/zoom - width)/2
    // This changes with zoom! At zoom=1.0 it's (canvas.width - width)/2, at zoom=2.0 it's (canvas.width/2 - width)/2
    //
    // But points are stored in transformed space coordinates. The solution is to realize that
    // points are ALWAYS in the same coordinate system regardless of when they were created,
    // because getCanvasPoint divides by zoom. So we need to use the image position at zoom=1.0.
    
    // Calculate the image dimensions - same as in renderCanvas()
    const maxWidth = elements.canvas.width - 40;
    const maxHeight = elements.canvas.height - 40;
    const originalScale = Math.min(maxWidth / state.image.width, maxHeight / state.image.height, 1);
    const originalImageWidth = state.image.width * originalScale;
    const originalImageHeight = state.image.height * originalScale;
    
    // The real solution: Points are stored in transformed space coordinates, normalized by zoom.
    // In getCanvasPoint: x = (clientX - rect.left - pan.x) / zoom
    // This means points are in the coordinate system AFTER the transformation, but normalized.
    //
    // In renderCanvas, the image is positioned at (canvas.width/zoom - width)/2 in transformed space.
    // This position changes with zoom. But since points are normalized (divided by zoom),
    // we need to use the image position at zoom=1.0 as the reference.
    //
    // However, there's a subtlety: The image position formula (canvas.width/zoom - width)/2
    // ensures the image is centered. At zoom=1.0, this is (canvas.width - width)/2.
    // But this is in transformed space AFTER the transformation is applied.
    //
    // Since points are normalized to zoom=1.0 (divided by zoom in getCanvasPoint),
    // we should use the image position at zoom=1.0, which is (canvas.width - width)/2.
    // However, we need to be careful: The image position in renderCanvas is calculated
    // as (canvas.width/zoom - width)/2. At zoom=1.0, this is (canvas.width - width)/2.
    // But we're using this for screenshot, where we want the image at full size.
    //
    // Actually, I think the issue might be that we need to account for the fact that
    // the canvas size might be different. Let's use the same calculation as renderCanvas
    // but for zoom=1.0:
    const originalImageX = (elements.canvas.width / 1.0 - originalImageWidth) / 2;
    const originalImageY = (elements.canvas.height / 1.0 - originalImageHeight) / 2;
    
    // Calculate scale factors to map from original canvas coordinates to screenshot coordinates
    const scaleX = imageWidth / originalImageWidth;
    const scaleY = imageHeight / originalImageHeight;
    
    // Helper function to transform a point from canvas coordinates to screenshot coordinates
    const transformPoint = (point) => {
        // Points are stored in transformed coordinate space, normalized to zoom=1.0
        // (because getCanvasPoint divides by zoom). The image position in this space
        // should be (canvas.width - width)/2 at zoom=1.0.
        //
        // However, there's a subtle issue: The image position in renderCanvas is
        // (canvas.width/zoom - width)/2, which changes with zoom. But points are
        // normalized by dividing by zoom in getCanvasPoint.
        //
        // The solution: We need to ensure we're using the same coordinate system.
        // Since points are normalized (divided by zoom), we should use the image
        // position at zoom=1.0, which is (canvas.width - width)/2.
        
        // First, subtract the image offset to get coordinates relative to image top-left
        const relativeX = point.x - originalImageX;
        const relativeY = point.y - originalImageY;
        
        // Check if point is within image bounds (with some tolerance)
        // But actually, let's be more lenient - points might be slightly outside due to rounding
        if (relativeX < -50 || relativeX > originalImageWidth + 50 || 
            relativeY < -50 || relativeY > originalImageHeight + 50) {
            // Point is way outside image bounds, return a position that will be clipped
            return { x: -1000, y: -1000 };
        }
        
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
            // Use polygon's color or default, with transparency
            const polygonColor = polygon.color || DEFAULT_POLYGON_COLOR;
            ctx.fillStyle = hexToRgba(polygonColor, 0.25);
            ctx.strokeStyle = hexToRgba(polygonColor, 0.6); // Border with 60% opacity
            ctx.lineWidth = LINE_WIDTH * scaleX;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ctx.beginPath();
            const firstTransformed = transformPoint(polygon.points[0]);
            ctx.moveTo(firstTransformed.x, firstTransformed.y);
            for (let i = 1; i < polygon.points.length; i++) {
                const transformed = transformPoint(polygon.points[i]);
                ctx.lineTo(transformed.x, transformed.y);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            
            // Draw merged polygons
            if (polygon.mergedPolygons && polygon.mergedPolygons.length > 0) {
                polygon.mergedPolygons.forEach(mergedPolygon => {
                    if (mergedPolygon.isClosed && mergedPolygon.points && mergedPolygon.points.length > 0) {
                        const mergedColor = mergedPolygon.color || DEFAULT_POLYGON_COLOR;
                        ctx.fillStyle = hexToRgba(mergedColor, 0.25);
                        ctx.strokeStyle = hexToRgba(mergedColor, 0.6); // Border with 60% opacity
                        ctx.lineWidth = LINE_WIDTH * scaleX;
                        ctx.lineCap = 'round';
                        ctx.lineJoin = 'round';
                        ctx.beginPath();
                        const firstMergedTransformed = transformPoint(mergedPolygon.points[0]);
                        ctx.moveTo(firstMergedTransformed.x, firstMergedTransformed.y);
                        for (let i = 1; i < mergedPolygon.points.length; i++) {
                            const transformed = transformPoint(mergedPolygon.points[i]);
                            ctx.lineTo(transformed.x, transformed.y);
                        }
                        ctx.closePath();
                        ctx.fill();
                        ctx.stroke();
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
        const isSubtract = line.isSubtract === true;
        const isCalibration = line.isCalibration === true;
        
        // Check if this line is part of a subtract polygon
        const isPartOfSubtractPolygon = state.polygons.some(polygon => 
            polygon.subtracts && polygon.subtracts.some(subtract => 
                subtract.lines && subtract.lines.some(l => l.id === line.id)
            )
        );
        
        // Check if this line is part of a polygon - use polygon's color
        let lineColor = LINE_COLOR;
        if (isCalibration) {
            lineColor = CALIBRATION_LINE_COLOR;
        } else if (isSubtract) {
            lineColor = SUBTRACT_COLOR;
        } else {
            // Check if line belongs to a polygon (including merged polygons)
            let containingPolygon = state.polygons.find(polygon => 
                polygon.lines && polygon.lines.some(l => l.id === line.id)
            );
            
            // Also check merged polygons
            if (!containingPolygon) {
                for (const polygon of state.polygons) {
                    if (polygon.mergedPolygons) {
                        const mergedPolygon = polygon.mergedPolygons.find(mp => 
                            mp.lines && mp.lines.some(l => l.id === line.id)
                        );
                        if (mergedPolygon) {
                            containingPolygon = mergedPolygon;
                            break;
                        }
                    }
                }
            }
            
            if (containingPolygon) {
                lineColor = containingPolygon.color || DEFAULT_POLYGON_COLOR;
            }
        }
        
        ctx.strokeStyle = lineColor;
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
            
            // Determine label background color based on line type and polygon color
            let labelBgColor;
            if (isCalibration) {
                labelBgColor = hexToRgba(CALIBRATION_LINE_COLOR, 0.9);
            } else if (isSubtract) {
                labelBgColor = 'rgba(220, 38, 38, 0.9)';
            } else {
                // Check if line belongs to a polygon (including merged polygons)
                let containingPolygon = state.polygons.find(polygon => 
                    polygon.lines && polygon.lines.some(l => l.id === line.id)
                );
                
                // Also check merged polygons
                if (!containingPolygon) {
                    for (const polygon of state.polygons) {
                        if (polygon.mergedPolygons) {
                            const mergedPolygon = polygon.mergedPolygons.find(mp => 
                                mp.lines && mp.lines.some(l => l.id === line.id)
                            );
                            if (mergedPolygon) {
                                containingPolygon = mergedPolygon;
                                break;
                            }
                        }
                    }
                }
                
                if (containingPolygon) {
                    labelBgColor = hexToRgba(containingPolygon.color || DEFAULT_POLYGON_COLOR, 0.9);
                } else {
                    labelBgColor = 'rgba(37, 99, 235, 0.9)'; // Default blue
                }
            }
            
            ctx.fillStyle = labelBgColor;
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
        
        // Find if point belongs to a polygon (including merged polygons)
        let pointColor = POINT_COLOR;
        // Check if point belongs to a polygon
        let containingPolygon = state.polygons.find(polygon => 
            polygon.points && polygon.points.some(p => p.id === point.id)
        );
        
        // Also check merged polygons
        if (!containingPolygon) {
            for (const polygon of state.polygons) {
                if (polygon.mergedPolygons) {
                    const mergedPolygon = polygon.mergedPolygons.find(mp => 
                        mp.points && mp.points.some(p => p.id === point.id)
                    );
                    if (mergedPolygon) {
                        containingPolygon = mergedPolygon;
                        break;
                    }
                }
            }
        }
        
        if (containingPolygon) {
            pointColor = containingPolygon.color || DEFAULT_POLYGON_COLOR;
        }
        
        ctx.fillStyle = pointColor;
        ctx.beginPath();
        ctx.arc(transformed.x, transformed.y, 5 * scaleX, 0, Math.PI * 2);
        ctx.fill();
    });
    
    // Restore context state to remove clipping
    ctx.restore();
}

function handleTakeScreenshot() {
    // Check if canvas is visible
    if (elements.canvas.classList.contains('hidden')) {
        showToast('Canvas is not visible');
        return;
    }
    
    // If already in selection mode, cancel it
    if (state.isSelectingScreenshot) {
        state.isSelectingScreenshot = false;
        state.screenshotSelectionStart = null;
        state.screenshotSelectionEnd = null;
        elements.canvas.style.cursor = 'default';
        renderCanvas();
        showToast('Screenshot selection cancelled');
        return;
    }
    
    // Enter screenshot selection mode
    state.isSelectingScreenshot = true;
    state.screenshotSelectionStart = null;
    state.screenshotSelectionEnd = null;
    elements.canvas.style.cursor = 'crosshair';
    showToast('Select area for screenshot (drag to select)');
    renderCanvas();
}

function createScreenshotFromSelection() {
    const projectName = elements.projectNameInput.value.trim() || 'Project';
    
    // Validate selection size
    const selectionWidth = Math.abs(state.screenshotSelectionEnd.x - state.screenshotSelectionStart.x);
    const selectionHeight = Math.abs(state.screenshotSelectionEnd.y - state.screenshotSelectionStart.y);
    
    if (selectionWidth < 10 || selectionHeight < 10) {
        showToast('Selection too small. Please select a larger area.');
        return;
    }
    
    try {
        // Save current zoom and pan
        const savedZoom = state.zoom;
        const savedPan = { x: state.pan.x, y: state.pan.y };
        
        // Temporarily reset zoom and pan to 1.0 and 0,0
        state.zoom = 1.0;
        state.pan = { x: 0, y: 0 };
        
        // Render canvas at zoom=1.0
        renderCanvas();
        
        // Use requestAnimationFrame to ensure rendering is complete
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                setTimeout(() => {
            // Points are stored in direct canvas coordinates
            // Calculate selection rectangle in canvas coordinates at zoom=1.0
            const selectionX = Math.min(state.screenshotSelectionStart.x, state.screenshotSelectionEnd.x);
            const selectionY = Math.min(state.screenshotSelectionStart.y, state.screenshotSelectionEnd.y);
            const selectionWidthAtZoom1 = Math.abs(state.screenshotSelectionEnd.x - state.screenshotSelectionStart.x);
            const selectionHeightAtZoom1 = Math.abs(state.screenshotSelectionEnd.y - state.screenshotSelectionStart.y);
            
            // Validate and clip selection coordinates to canvas bounds
            const canvasWidth = elements.canvas.width;
            const canvasHeight = elements.canvas.height;
            
            // Clip selection to canvas bounds
            const clippedX = Math.max(0, Math.min(selectionX, canvasWidth));
            const clippedY = Math.max(0, Math.min(selectionY, canvasHeight));
            const clippedWidth = Math.min(selectionWidthAtZoom1, canvasWidth - clippedX);
            const clippedHeight = Math.min(selectionHeightAtZoom1, canvasHeight - clippedY);
            
            // Check if selection is valid (has some area)
            if (clippedWidth <= 0 || clippedHeight <= 0) {
                // Restore zoom and pan
                state.zoom = savedZoom;
                state.pan = savedPan;
                renderCanvas();
                showToast('Selection is too small or outside canvas bounds');
                // Reset selection mode
                state.isSelectingScreenshot = false;
                state.screenshotSelectionStart = null;
                state.screenshotSelectionEnd = null;
                state.currentLineStart = null;
                state.cursorPosition = null;
                elements.canvas.style.cursor = 'default';
                return;
            }
            
            // Use clipped coordinates
            const finalSelectionX = clippedX;
            const finalSelectionY = clippedY;
            const finalSelectionWidth = clippedWidth;
            const finalSelectionHeight = clippedHeight;
            
            // Extract the selected area directly from the canvas BEFORE restoring zoom/pan
            const imageCanvas = document.createElement('canvas');
            imageCanvas.width = Math.round(finalSelectionWidth);
            imageCanvas.height = Math.round(finalSelectionHeight);
            const imageCtx = imageCanvas.getContext('2d');
            
            // Draw the selected area from the main canvas (canvas is still at zoom=1.0)
            imageCtx.drawImage(
                elements.canvas,
                finalSelectionX, finalSelectionY, finalSelectionWidth, finalSelectionHeight,
                0, 0, imageCanvas.width, imageCanvas.height
            );
            
            // Now restore zoom and pan
            state.zoom = savedZoom;
            state.pan = savedPan;
            renderCanvas();
            
            // Continue with creating the screenshot with overlay
            // Now create the final canvas with overlay
                // Calculate statistics
                const totalArea = state.polygons.reduce((sum, p) => sum + p.areaInSquareMeters, 0);
                const polygonsCount = state.polygons.length;
                
                // Calculate overlay height based on content
                const statsSectionHeight = 22;
                const baseSectionHeight = 40 + 30;
                const statsStartY = baseSectionHeight + 15;
                const polygonsSectionStart = statsStartY + statsSectionHeight + 15;
                const polygonsHeadingHeight = 25;
                const polygonsListHeight = polygonsCount > 0 ? polygonsHeadingHeight + (polygonsCount * 18) : 0;
                const bottomPadding = 20;
                const overlayHeight = baseSectionHeight + statsSectionHeight + 15 + polygonsListHeight + bottomPadding;
                
                // Create a new canvas for the screenshot with overlay
                const screenshotCanvas = document.createElement('canvas');
                screenshotCanvas.width = imageCanvas.width;
                screenshotCanvas.height = imageCanvas.height + overlayHeight;
                const ctx = screenshotCanvas.getContext('2d');
                
                // Draw the image canvas (with all drawings already on it)
                ctx.drawImage(imageCanvas, 0, 0);
                
                // Prepare overlay information
                const now = new Date();
                const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
                const timeStr = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
                const dateTimeStr = `${dateStr} ${timeStr}`;
                
                // Draw overlay background
                const overlayY = imageCanvas.height;
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
                
                // Calculate center Y for statistics section
                const statsCenterY = overlayY + statsStartY + statsSectionHeight / 2;
                
                // Draw Total Area (centered vertically in stats section)
                ctx.fillText(`Total Area: ${totalArea.toFixed(2)} m²`, statsX, statsCenterY);
                
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
                    if (!blob) {
                        showToast('Error: Failed to create screenshot blob');
                        console.error('Failed to create blob from canvas');
                        return;
                    }
                    
                    try {
                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        
                        // Create filename: ProjectName-YYYYMMDD-HHMM.png
                        const dateForFilename = now.toISOString().slice(0, 19).replace(/[:-]/g, '').replace('T', '-');
                        const safeProjectName = projectName.replace(/[^a-z0-9]/gi, '-').toLowerCase();
                        const filename = `${safeProjectName}-${dateForFilename}.png`;
                        
                        link.download = filename;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        
                        setTimeout(() => {
                            URL.revokeObjectURL(url);
                        }, 100);
                        
                        // Reset selection mode after successful screenshot
                        state.isSelectingScreenshot = false;
                        state.screenshotSelectionStart = null;
                        state.screenshotSelectionEnd = null;
                        state.currentLineStart = null; // Prevent auto-starting a line after screenshot
                        state.cursorPosition = null; // Clear cursor position
                        elements.canvas.style.cursor = 'default';
                        renderCanvas();
                        
                        showToast('Screenshot saved');
                    } catch (error) {
                        showToast('Error downloading screenshot: ' + error.message);
                        console.error('Download error:', error);
                        // Reset selection mode on error
                        state.isSelectingScreenshot = false;
                        state.screenshotSelectionStart = null;
                        state.screenshotSelectionEnd = null;
                        state.currentLineStart = null; // Prevent auto-starting a line after screenshot
                        state.cursorPosition = null; // Clear cursor position
                        elements.canvas.style.cursor = 'default';
                        renderCanvas();
                    }
                }, 'image/png');
                });
            });
        }, 50);  // Small delay to ensure rendering is complete
        } catch (error) {
            showToast('Error creating screenshot: ' + error.message);
            console.error('Screenshot creation error:', error);
            // Reset selection mode on error
            state.isSelectingScreenshot = false;
            state.screenshotSelectionStart = null;
            state.screenshotSelectionEnd = null;
            state.currentLineStart = null; // Prevent auto-starting a line after screenshot
            state.cursorPosition = null; // Clear cursor position
            elements.canvas.style.cursor = 'default';
            renderCanvas();
        }
}

// ==================== Length Input Modal ====================
function openLengthModal() {
    if (!state.pendingLengthLine) return;
    
    const isWindow = state.pendingLengthLine.isWindow;
    const isEditing = state.pendingLengthLine.existingLines && state.pendingLengthLine.existingLines.length > 0;
    
    elements.lengthModalDescription.textContent = isEditing
        ? (isWindow ? 'Edit the length of the window' : 'Edit the length of the wall')
        : (isWindow ? 'Enter the desired length for the window' : 'Enter the desired length for the wall');
    elements.lengthModal.showModal();
    
    // Set current length as default value (for new lines) or existing value (for editing)
    if (state.pendingLengthLine.currentLengthInMeters) {
        elements.lengthInput.value = state.pendingLengthLine.currentLengthInMeters.toFixed(2);
    } else {
        elements.lengthInput.value = '';
    }
    elements.lengthInput.focus();
    elements.lengthInput.select();
}

function closeLengthModal() {
    elements.lengthModal.close();
    state.pendingLengthLine = null;
}

function handleLengthSubmit(e) {
    e.preventDefault();
    
    const lengthInMeters = parseFloat(elements.lengthInput.value);
    
    if (!lengthInMeters || lengthInMeters <= 0) {
        showToast('Please enter a valid length');
        return;
    }
    
    if (!state.pendingLengthLine) return;
    
    const baseLine = state.pendingLengthLine;
    const isWindow = baseLine.isWindow;
    const pixelsPerMeter = 100; // Default scale: 1 meter = 100 pixels
    
    // Check if we're editing existing lines
    if (baseLine.existingLines && baseLine.existingLines.length > 0) {
        // Editing existing lines - remove old ones and create new ones
        const oldLines = baseLine.existingLines;
        const groupId = oldLines[0].groupId;
        
        // Remove old lines
        oldLines.forEach(oldLine => {
            const index = state.lines.findIndex(l => l.id === oldLine.id);
            if (index !== -1) {
                state.lines.splice(index, 1);
            }
        });
        
        // Calculate new end point based on desired length
        const dx = baseLine.endPoint.x - baseLine.startPoint.x;
        const dy = baseLine.endPoint.y - baseLine.startPoint.y;
        const currentLength = Math.sqrt(dx * dx + dy * dy);
        
        if (currentLength === 0) {
            closeLengthModal();
            return;
        }
        
        const desiredPixelLength = lengthInMeters * pixelsPerMeter;
        const scale = desiredPixelLength / currentLength;
        const newEndPoint = {
            x: baseLine.startPoint.x + dx * scale,
            y: baseLine.startPoint.y + dy * scale,
            id: baseLine.endPoint.id
        };
        
        // Update the end point
        const endPointIndex = state.points.findIndex(p => p.id === newEndPoint.id);
        if (endPointIndex !== -1) {
            state.points[endPointIndex] = newEndPoint;
        }
        
        // Create new parallel lines
        const parallelLines = createParallelLines(baseLine.startPoint, newEndPoint, isWindow);
        
        // Add new lines
        parallelLines.forEach((lineData, index) => {
            const line = {
                id: `${groupId}-${index}`,
                startPoint: lineData.startPoint,
                endPoint: lineData.endPoint,
                isWall: baseLine.isWall,
                isWindow: baseLine.isWindow,
                lengthInMeters: lengthInMeters,
                groupId: groupId
            };
            
            // Add points if they don't exist
            if (!state.points.find(p => p.id === line.startPoint.id)) {
                state.points.push(line.startPoint);
            }
            if (!state.points.find(p => p.id === line.endPoint.id)) {
                state.points.push(line.endPoint);
            }
            
            state.lines.push(line);
        });
        
        // Record action for undo
        state.actionHistory.push({
            type: 'edit_wall_window',
            data: { 
                oldLines: oldLines.map(l => JSON.parse(JSON.stringify(l))),
                newLength: lengthInMeters
            }
        });
        
        closeLengthModal();
        updateUI();
        renderCanvas();
        
        const toolName = isWindow ? 'Window' : 'Wall';
        showToast(`${toolName} length updated: ${lengthInMeters.toFixed(2)}m`);
        
        // Check if a closed polygon was formed after length adjustment
        checkForClosedPolygon();
    } else {
        // Handle new lines (not editing existing ones)
        // This happens when user finishes drawing a wall/window
        const baseLine = state.pendingLengthLine;
        const isWindow = baseLine.isWindow;
        const pixelsPerMeter = state.calibration ? state.calibration.pixelsPerMeter : 100;
        
        // Calculate new end point based on desired length
        const dx = baseLine.endPoint.x - baseLine.startPoint.x;
        const dy = baseLine.endPoint.y - baseLine.startPoint.y;
        const currentLength = Math.sqrt(dx * dx + dy * dy);
        
        if (currentLength === 0) {
            closeLengthModal();
            return;
        }
        
        const desiredPixelLength = lengthInMeters * pixelsPerMeter;
        const scale = desiredPixelLength / currentLength;
        const newEndPoint = {
            x: baseLine.startPoint.x + dx * scale,
            y: baseLine.startPoint.y + dy * scale,
            id: baseLine.endPoint.id
        };
        
        // Update the end point in state.points
        const endPointIndex = state.points.findIndex(p => p.id === newEndPoint.id);
        if (endPointIndex !== -1) {
            state.points[endPointIndex] = newEndPoint;
        } else {
            // If point doesn't exist, add it
            state.points.push(newEndPoint);
        }
        
        // Update all lines in the group with new end point
        if (baseLine.existingLines && baseLine.existingLines.length > 0) {
            const groupId = baseLine.existingLines[0].groupId;
            
            // Remove old lines
            baseLine.existingLines.forEach(oldLine => {
                const index = state.lines.findIndex(l => l.id === oldLine.id);
                if (index !== -1) {
                    state.lines.splice(index, 1);
                }
            });
            
            // Create new lines with adjusted length
            const parallelLines = createParallelLines(baseLine.startPoint, newEndPoint, isWindow);
            
            // Add new lines
            parallelLines.forEach((lineData, index) => {
                const line = {
                    id: `${groupId}-${index}`,
                    startPoint: lineData.startPoint,
                    endPoint: lineData.endPoint,
                    isWall: baseLine.isWall,
                    isWindow: baseLine.isWindow,
                    lengthInMeters: lengthInMeters,
                    groupId: groupId
                };
                
                // Add points if they don't exist
                if (!state.points.find(p => p.id === line.startPoint.id)) {
                    state.points.push(line.startPoint);
                }
                if (!state.points.find(p => p.id === line.endPoint.id)) {
                    state.points.push(line.endPoint);
                }
                
                state.lines.push(line);
            });
            
            // Record action for undo
            state.actionHistory.push({
                type: 'add_wall_window',
                data: { 
                    lines: baseLine.existingLines.map(l => JSON.parse(JSON.stringify(l))),
                    adjustedLength: lengthInMeters
                }
            });
        }
        
        closeLengthModal();
        updateUI();
        renderCanvas();
        
        // Check if a closed polygon was formed
        checkForClosedPolygon();
        
        const toolName = isWindow ? 'Window' : 'Wall';
        showToast(`${toolName} created: ${lengthInMeters.toFixed(2)}m`);
    }
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
            polygon.name = `Room ${index + 1}`;
            nameText.textContent = polygon.name;
        }
        
        // Re-render canvas to show updated name in the center
        renderCanvas();
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
    
    // Merge polygon should adopt the color of the parent polygon
    lastPolygon.color = previousPolygon.color || DEFAULT_POLYGON_COLOR;
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

function attachPolygonColorListeners() {
    const colorPickers = elements.polygonsList.querySelectorAll('.polygon-color-picker');
    
    colorPickers.forEach(picker => {
        picker.addEventListener('input', function(e) {
            e.stopPropagation();
            const polygonId = this.getAttribute('data-polygon-id');
            const polygon = state.polygons.find(p => p.id === polygonId);
            
            if (polygon) {
                polygon.color = this.value;
                renderCanvas();
            }
        });
        
        picker.addEventListener('change', function(e) {
            e.stopPropagation();
            const polygonId = this.getAttribute('data-polygon-id');
            const polygon = state.polygons.find(p => p.id === polygonId);
            
            if (polygon) {
                polygon.color = this.value;
                renderCanvas();
            }
        });
    });
}

// ==================== Tool Selection ====================
function updateToolButtons() {
    document.querySelectorAll('.tool-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    if (state.currentTool === 'select') {
        if (elements.toolSelect) {
            elements.toolSelect.classList.add('active');
        }
    } else if (state.currentTool === 'walls') {
        if (elements.toolWalls) {
            elements.toolWalls.classList.add('active');
        }
    } else if (state.currentTool === 'window') {
        if (elements.toolWindow) {
            elements.toolWindow.classList.add('active');
        }
    }
}

// ==================== UI Updates ====================
function updateUI() {
    // Update tool buttons
    updateToolButtons();
    // Update zoom level
    elements.zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;
    
    
    // Update total area (polygons include rectangles now)
    const totalArea = state.polygons.reduce((sum, p) => sum + p.areaInSquareMeters, 0);
    elements.totalArea.textContent = `${totalArea.toFixed(2)} m²`;
    
    // Update polygons list
    if (state.polygons.length > 0) {
        elements.polygonsList.innerHTML = state.polygons.map((polygon, index) => {
            const displayName = polygon.name || `Polygon ${index + 1}`;
            const isLast = index === state.polygons.length - 1;
            const canMerge = state.polygons.length >= 2 && isLast;
            const polygonColor = polygon.color || DEFAULT_POLYGON_COLOR;
            return `
            <div class="polygon-item" data-polygon-id="${polygon.id}">
                <div class="polygon-item-header">
                    <div class="polygon-name-editable" data-polygon-id="${polygon.id}">
                        <input 
                            type="color" 
                            class="polygon-color-picker" 
                            value="${polygonColor}"
                            data-polygon-id="${polygon.id}"
                            title="Select polygon color"
                        >
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
        
        // Attach event listeners for color pickers
        attachPolygonColorListeners();
    } else {
        elements.polygonsList.innerHTML = '<p class="info-text">No rooms detected</p>';
    }
    
    // Update button states
    elements.undoBtn.disabled = state.actionHistory.length === 0;
    elements.clearBtn.disabled = state.points.length === 0;
    
    // Update toggle button states
    elements.toggleLengthLabelsBtn.classList.toggle('active', state.showLengthLabels);
    elements.toggleAngleSnapBtn.classList.toggle('active', state.angleSnapEnabled);
    if (elements.togglePointSnapBtn) {
        elements.togglePointSnapBtn.classList.toggle('active', state.pointSnapEnabled);
    }
    
    // Keep zoom controls visible - zoom is now allowed even after drawing
    elements.zoomControls.classList.remove('hidden');
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
    if (elements.uploadArea && elements.fileInput) {
        console.log('File upload elements found, setting up event listeners');
        
        // File input change - this will work with label click or direct file selection
        elements.fileInput.addEventListener('change', (e) => {
            console.log('File input changed', e.target.files);
            if (e.target.files && e.target.files.length > 0) {
                const file = e.target.files[0];
                console.log('File selected:', file.name, file.type, file.size, 'bytes');
                showToast(`Loading ${file.name}...`);
                handleFileUpload(file);
                // Reset input so same file can be selected again
                e.target.value = '';
            } else {
                console.log('No files selected - user cancelled file selection');
            }
        });
        
        // Also add focus event to help debug
        elements.fileInput.addEventListener('focus', () => {
            console.log('File input focused');
        });
        
        // Add click event to file input for debugging
        elements.fileInput.addEventListener('click', () => {
            console.log('File input clicked directly');
        });
        
        // Drag and drop support
        elements.uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            elements.uploadArea.style.borderColor = 'var(--primary)';
            elements.uploadArea.style.backgroundColor = 'var(--surface)';
        });
        
        elements.uploadArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            elements.uploadArea.style.borderColor = '';
            elements.uploadArea.style.backgroundColor = '';
        });
        
        elements.uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            elements.uploadArea.style.borderColor = '';
            elements.uploadArea.style.backgroundColor = '';
            
            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                const file = e.dataTransfer.files[0];
                console.log('File dropped:', file.name, file.type, file.size);
                const fileType = file.type;
                const fileName = file.name.toLowerCase();
                
                // Validate file type by MIME type or extension
                const isPDF = fileType === 'application/pdf' || fileName.endsWith('.pdf');
                const isImage = fileType.startsWith('image/') || 
                               fileName.endsWith('.jpg') || 
                               fileName.endsWith('.jpeg') || 
                               fileName.endsWith('.png') ||
                               fileName.endsWith('.gif') ||
                               fileName.endsWith('.webp');
                
                if (isPDF || isImage) {
                    handleFileUpload(file);
                } else {
                    showToast('Unsupported file type. Please upload JPG, PNG, or PDF');
                }
            }
        });
        
        // Additional click handler for debugging (label should handle it, but this is backup)
        elements.uploadArea.addEventListener('click', (e) => {
            // If it's not the file input that was clicked, log it
            if (e.target !== elements.fileInput) {
                console.log('Upload area clicked (label should handle file input)');
            }
        });
    } else {
        console.error('Upload area or file input not found');
        if (!elements.uploadArea) {
            console.error('Upload area element missing');
        }
        if (!elements.fileInput) {
            console.error('File input element missing');
        }
    }
    
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
    elements.canvas.addEventListener('contextmenu', handleContextMenu);
    
    // Keyboard events for ESC to cancel drawing
    document.addEventListener('keydown', handleKeyDown);
    
    // Zoom controls
    elements.zoomInBtn.addEventListener('click', handleZoomIn);
    elements.zoomOutBtn.addEventListener('click', handleZoomOut);
    elements.resetViewBtn.addEventListener('click', handleResetView);
    
    // Control buttons
    elements.newProjectBtn.addEventListener('click', handleNewProject);
    elements.undoBtn.addEventListener('click', handleUndoLastLine);
    elements.clearBtn.addEventListener('click', handleClearAll);
    elements.toggleLengthLabelsBtn.addEventListener('click', handleToggleLengthLabels);
    elements.toggleAngleSnapBtn.addEventListener('click', handleToggleAngleSnap);
    if (elements.togglePointSnapBtn) {
        elements.togglePointSnapBtn.addEventListener('click', handleTogglePointSnap);
    }
    
    // Length input modal
    elements.lengthForm.addEventListener('submit', handleLengthSubmit);
    elements.cancelLengthBtn.addEventListener('click', closeLengthModal);
    
    // Handle modal close (ESC or click outside)
    elements.lengthModal.addEventListener('close', () => {
        // If modal was closed without submitting, keep the lines with original length
        if (state.pendingLengthLine) {
            // Lines are already added, just clear the pending state
            state.pendingLengthLine = null;
            // Check if a closed polygon was formed
            checkForClosedPolygon();
        }
    });
    
    // Collapsible sections
    elements.polygonsHeader.addEventListener('click', () => {
        toggleCollapsible(elements.polygonsHeader, elements.polygonsList);
    });
    
    elements.instructionsHeader.addEventListener('click', () => {
        toggleCollapsible(elements.instructionsHeader, document.getElementById('instructionsContent'));
    });
    
    if (elements.shortcutsHeader) {
        elements.shortcutsHeader.addEventListener('click', () => {
            toggleCollapsible(elements.shortcutsHeader, document.getElementById('shortcutsContent'));
        });
    }
    
    // Screenshot button
    elements.screenshotBtn.addEventListener('click', handleTakeScreenshot);
    
    // Tool selection
    if (elements.toolSelect) {
        elements.toolSelect.addEventListener('click', () => {
            state.currentTool = 'select';
            state.currentLineStart = null;
            state.currentRectangleStart = null;
            state.isDrawingRectangle = false;
            state.justFinishedRectangle = false;
            updateToolButtons();
            renderCanvas();
        });
    }
    
    if (elements.toolWalls) {
        elements.toolWalls.addEventListener('click', () => {
            state.currentTool = 'walls';
            state.currentLineStart = null;
            state.currentRectangleStart = null;
            state.isDrawingRectangle = false;
            state.justFinishedRectangle = false;
            updateToolButtons();
            renderCanvas();
        });
    }
    
    if (elements.toolWindow) {
        elements.toolWindow.addEventListener('click', () => {
            state.currentTool = 'window';
            state.currentLineStart = null;
            state.currentRectangleStart = null;
            state.isDrawingRectangle = false;
            state.justFinishedRectangle = false;
            updateToolButtons();
            renderCanvas();
        });
    }
    
    // Window resize
    window.addEventListener('resize', resizeCanvas);
}

// ==================== Calibration Color Management ====================
function hexToRgba(hex, alpha = 1) {
    // Remove # if present
    hex = hex.replace('#', '');
    // Parse hex to RGB
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function loadCalibrationColor() {
    const savedColor = localStorage.getItem('calibrationLineColor');
    if (savedColor) {
        CALIBRATION_LINE_COLOR = savedColor;
    }
    if (elements.calibrationColorInput) {
        elements.calibrationColorInput.value = CALIBRATION_LINE_COLOR;
    }
}

function saveCalibrationColor(color) {
    localStorage.setItem('calibrationLineColor', color);
    CALIBRATION_LINE_COLOR = color;
    // Update all existing calibration lines
    renderCanvas();
}

function handleCalibrationColorChange(e) {
    const newColor = e.target.value;
    saveCalibrationColor(newColor);
}

// ==================== Initialization ====================
function init() {
    console.log('Initializing application...');
    
    // Validate critical elements exist
    if (!elements.canvas) {
        console.error('Canvas element not found');
        return;
    }
    // Show canvas by default (no image needed for drawing)
    if (elements.canvas) {
        elements.canvas.classList.remove('hidden');
    }
    if (elements.emptyState) {
        elements.emptyState.classList.add('hidden');
    }
    if (elements.zoomControls) {
        elements.zoomControls.classList.remove('hidden');
    }
    
    // Set initial collapsible states
    if (elements.polygonsHeader) {
        elements.polygonsHeader.setAttribute('aria-expanded', 'true');
    }
    if (elements.instructionsHeader) {
        elements.instructionsHeader.setAttribute('aria-expanded', 'false');
    }
    if (elements.shortcutsHeader) {
        elements.shortcutsHeader.setAttribute('aria-expanded', 'false');
    }
    
    // Initialize event listeners
    initEventListeners();
    
    // Initial UI update
    updateUI();
    
    // Resize canvas to fit container
    resizeCanvas();
}

// Start the application
document.addEventListener('DOMContentLoaded', init);

