// SPDX-License-Identifier: MIT

'use client';

import { useEffect, useRef, useState, useCallback, useMemo, forwardRef, useImperativeHandle } from 'react';
import '../styles/pdfviewer.css';
import 'pdfjs-dist/web/pdf_viewer.css';
import { parseSyncTeX } from '@/lib/synctex-parser.js';

console.log('🔥🔥🔥 PDFViewer.js FILE LOADED 🔥🔥🔥');
console.log('🔥🔥🔥 If you see this, the file is being loaded 🔥🔥🔥');

const PDFViewer = forwardRef(function PDFViewer({ src, onTextClick, compilationError, projectId, onTextSearch, userMessage, onFixError, onFixAllErrors, onApplyImageFix, zoomScale = null, onPageInfoChange }, ref) {
  // Debug logging
  console.log('🎨 PDFViewer MOUNTED/RENDERED');
  console.log('PDFViewer compilationError:', compilationError);
  console.log('PDFViewer compilationError length:', compilationError ? compilationError.length : 'null');
  console.log('PDFViewer userMessage:', userMessage);
  console.log('PDFViewer src:', src);
  console.log('🔍 PDFViewer onTextClick prop:', typeof onTextClick, onTextClick ? '✅ EXISTS' : '❌ MISSING');
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const canvasWrapperRef = useRef(null);
  const textLayerRef = useRef(null);
  const annotationLayerRef = useRef(null);
  const [scale, setScale] = useState(null); // null = auto-fit width
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [pdf, setPdf] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [rendering, setRendering] = useState(false);
  const [renderedPages, setRenderedPages] = useState(new Map());
  const pageCanvasRefs = useRef({});
  const pageTextRefs = useRef({});
  const pageRenderTasksRef = useRef({}); // Track render tasks per page
  const [debugMode, setDebugMode] = useState(false);
  const [synctexData, setSynctexData] = useState(null);
  const [showRawLog, setShowRawLog] = useState(false);
  const renderTaskRef = useRef(null);
  const [zoomInput, setZoomInput] = useState('');
  const [isEditingZoom, setIsEditingZoom] = useState(false);
  const savedScrollPositionRef = useRef(null); // Store scroll position before reload
  const isReloadingRef = useRef(false); // Track if this is a reload vs initial load

  // Compile target from PDF src URL (root document we compiled)
  const compileTargetFromSrc = useMemo(() => {
    if (!src) return null;
    try {
      return new URL(src, window.location.origin).searchParams.get('target');
    } catch {
      return null;
    }
  }, [src]);

  useImperativeHandle(ref, () => ({
    goToPage: (pageNum) => {
      if (!totalPages) return;
      const targetPage = Math.max(1, Math.min(Math.floor(pageNum), totalPages));
      setCurrentPage(targetPage);
      const scrollToPage = () => {
        const wrappers = canvasWrapperRef.current?.querySelectorAll('.pdf-page-wrapper');
        const container = containerRef.current;
        if (wrappers && wrappers[targetPage - 1] && container) {
          const wrapper = wrappers[targetPage - 1];
          const top = wrapper.offsetTop - 16;
          container.scrollTo({ top, behavior: 'smooth' });
        }
      };
      requestAnimationFrame(() => requestAnimationFrame(scrollToPage));
    }
  }), [totalPages]);

  useEffect(() => {
    if (zoomScale === null) {
      setScale(null);
      return;
    }
    if (typeof zoomScale === 'number' && !Number.isNaN(zoomScale)) {
      setScale(zoomScale);
    }
  }, [zoomScale]);

  useEffect(() => {
    if (typeof onPageInfoChange !== 'function') return;
    onPageInfoChange({ currentPage, totalPages });
  }, [currentPage, totalPages, onPageInfoChange]);

  useEffect(() => {
    let canceled = false;

    async function loadPDF() {
      if (!src) return;

      // Skip loading when there are compilation errors - PDF may be corrupted from failed compile
      const hasCriticalErrors = compilationError && compilationError.length > 0;
      if (hasCriticalErrors) {
        setLoading(false);
        setError('');
        setPdf(null);
        return;
      }

      // Save scroll position before reload (only if we have a container and this is a reload)
      if (containerRef.current && pdf) {
        savedScrollPositionRef.current = {
          scrollTop: containerRef.current.scrollTop,
          scrollLeft: containerRef.current.scrollLeft,
          scrollHeight: containerRef.current.scrollHeight
        };
        isReloadingRef.current = true;
        console.log('📍 Saved scroll position before reload:', savedScrollPositionRef.current);
      }

      // Cancel any existing render task before loading new PDF
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      setLoading(true);
      setError('');

      try {
        // Fetch PDF first to handle 404 / non-PDF responses gracefully
        // Otherwise PDF.js receives the error text and throws "Missing PDF"
        const response = await fetch(src, { credentials: 'same-origin', cache: 'no-store' });
        if (canceled) return;

        if (!response.ok) {
          const errorText = response.status === 404 
            ? 'PDF not found. Compile the document first.' 
            : `Failed to load PDF (${response.status})`;
          setError(errorText);
          setLoading(false);
          return;
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('pdf')) {
          setError('PDF not found. Compile the document first.');
          setLoading(false);
          return;
        }

        const pdfData = await response.arrayBuffer();
        if (canceled) return;

        // Validate PDF data before passing to PDF.js
        if (!pdfData || pdfData.byteLength === 0) {
          setError('PDF is empty. Please compile the document again.');
          setLoading(false);
          return;
        }
        const header = new Uint8Array(pdfData, 0, Math.min(5, pdfData.byteLength));
        const headerStr = String.fromCharCode.apply(null, header);
        if (!headerStr.startsWith('%PDF')) {
          setError('Invalid PDF file. Please compile the document again.');
          setLoading(false);
          return;
        }

        // Import PDF.js and load from fetched data
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/js/pdf.worker.min.js';

        const loadingTask = pdfjsLib.getDocument({ data: pdfData });
        const pdfDoc = await loadingTask.promise;
        console.log('✅ PDF loaded successfully, pages:', pdfDoc.numPages);
        if (canceled) return;

        setPdf(pdfDoc);
        setTotalPages(pdfDoc.numPages);
        setCurrentPage(1);
        setLoading(false);
      } catch (err) {
        console.error('❌ PDF error:', err);
        if (err.name === 'RenderingCancelledException' || err.name === 'AbortException') {
          return;
        }
        let message = 'Failed to load PDF';
        if (err.message?.includes('404')) {
          message = 'PDF not found. Compile the document first.';
        } else if (err.name === 'InvalidPDFException' || err.message?.includes('Invalid PDF structure')) {
          message = 'Invalid or corrupted PDF. Please compile the document again.';
        }
        setError(message);
        setLoading(false);
      }
    }

    loadPDF();
    return () => {
      canceled = true;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [src, compilationError]);

  // Load SyncTeX data when PDF is loaded
  useEffect(() => {
    async function loadSyncTeX() {
      if (!projectId || !src || compilationError) return;

      try {
        console.log('📍 Loading SyncTeX data for project:', projectId);

        // Extract target from src URL (no default - only fetch when target is set)
        const url = new URL(src, window.location.origin);
        const target = url.searchParams.get('target');
        if (!target) return;

        // Fetch SyncTeX data
        const response = await fetch(`/api/synctex/${projectId}?target=${encodeURIComponent(target)}`);
        const result = await response.json();

        if (result.ok && result.data) {
          console.log('📍 SyncTeX data received, parsing...');
          const parsed = parseSyncTeX(result.data);
          setSynctexData(parsed);
          const summary = parsed.getSummary();
          console.log('✅ SyncTeX parsed successfully:', summary);
          console.log(`   📄 Pages: ${summary.pageCount}, 📦 Boxes: ${summary.totalBoxes}`);
        } else {
          console.warn('⚠️ SyncTeX not available:', result.error);
          setSynctexData(null);
        }
      } catch (error) {
        console.warn('⚠️ Failed to load SyncTeX:', error.message);
        setSynctexData(null);
      }
    }

    loadSyncTeX();
  }, [projectId, src, compilationError]);

  const renderPage = async (pdfDoc, pageNum) => {
    if (!pdfDoc) return;

    try {
      const page = await pdfDoc.getPage(pageNum);
      
      // Auto-calculate scale to fit width if scale is null
      let renderScale = scale;
      if (!scale || scale === null) {
        const container = containerRef.current;
        if (container) {
          const containerWidth = container.clientWidth - 32;
          const pageViewport = page.getViewport({ scale: 1 });
          renderScale = containerWidth / pageViewport.width;
          setScale(renderScale);
        } else {
          renderScale = 1.5;
        }
      }
      
      const viewport = page.getViewport({ scale: renderScale });

      // Get or create canvas for this page
      let canvas = pageCanvasRefs.current[pageNum];
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        canvas.style.display = 'block';
        canvas.style.pointerEvents = 'none';
        pageCanvasRefs.current[pageNum] = canvas;
      }

      // Cancel any existing render task for this page
      if (pageRenderTasksRef.current[pageNum]) {
        try {
          pageRenderTasksRef.current[pageNum].cancel();
        } catch (err) {
          // Ignore cancel errors
        }
        pageRenderTasksRef.current[pageNum] = null;
      }

      // Only render canvas if it hasn't been rendered yet
      if (!canvas.dataset.rendered) {
        const context = canvas.getContext('2d');
        context.clearRect(0, 0, canvas.width, canvas.height);

        const renderTask = page.render({
          canvasContext: context,
          viewport
        });

        // Store render task
        pageRenderTasksRef.current[pageNum] = renderTask;

        await renderTask.promise;
        canvas.dataset.rendered = 'true';
        pageRenderTasksRef.current[pageNum] = null; // Clear task after completion
        console.log(`✅ Page ${pageNum} canvas rendered`);
      }

      // Create and append text layer for this page
      if (!pageTextRefs.current[pageNum]) {
        const textDiv = document.createElement('div');
        textDiv.className = 'textLayer';
        textDiv.style.position = 'absolute';
        textDiv.style.top = '0';
        textDiv.style.left = '0';
        textDiv.style.zIndex = '10000'; // High z-index to be above everything
        // textDiv.style.zIndex = '3';
        textDiv.style.setProperty('pointer-events', 'auto', 'important');
        // textDiv.style.pointerEvents = 'auto'; // CRITICAL: Enable pointer events on text layer
        textDiv.style.width = `${viewport.width}px`;
        textDiv.style.height = `${viewport.height}px`;
        
        // Override any CSS that might disable pointer events
        textDiv.setAttribute('data-synctex-enabled', 'true');
        
        // Create a wrapper div for this page
        const pageWrapper = document.createElement('div');
        pageWrapper.className = 'pdf-page-wrapper';
        pageWrapper.appendChild(canvas);
        pageWrapper.appendChild(textDiv);
        
        // Append to container in correct order
        if (canvasWrapperRef.current) {
          canvasWrapperRef.current.appendChild(pageWrapper);
          
          // Add separator after each page (except last)
          if (pageNum < pdfDoc.numPages) {
            const separator = document.createElement('div');
            separator.className = 'pdf-page-separator';
            canvasWrapperRef.current.appendChild(separator);
          }
        }
        
        pageTextRefs.current[pageNum] = textDiv;
        
        // Render text layer
        await renderTextLayer(page, viewport, textDiv, pageNum);
      }

    } catch (err) {
      if (err.name !== 'RenderingCancelledException' && err.name !== 'AbortException') {
        console.error(`❌ Page ${pageNum} render error:`, err);
      }
    }
  };

  const renderTextLayer = async (page, viewport, textLayerDiv, pageNum) => {
    if (!textLayerDiv) {
      textLayerDiv = textLayerRef.current;
    }

    if (!textLayerDiv) {
      console.error("❌ Text layer div not found!");
      return;
    }

    try {
      console.log(`📝 Rendering text layer for page ${pageNum}...`);
      console.log("📐 Viewport dimensions:", viewport.width, "x", viewport.height);

      // Clear existing text layer
      textLayerDiv.innerHTML = '';
      textLayerDiv.className = 'textLayer';

      // CRITICAL: Set text layer dimensions to EXACTLY match viewport
      textLayerDiv.style.width = viewport.width + 'px';
      textLayerDiv.style.height = viewport.height + 'px';

      // Get text content from PDF
      const textContent = await page.getTextContent();
      console.log(`📝 Found ${textContent.items.length} text items from PDF.js`);

      if (synctexData) {
        console.log("📍 SyncTeX data available:", synctexData.getSummary());
      }

      if (textContent.items.length === 0) {
        console.warn("⚠️ No text content found in PDF");
        return;
      }

      // Get EXACT TeX fonts that match PDF font names
      const getFontFamily = (pdfFontName) => {
        if (!pdfFontName) return '"Latin Modern Roman", serif';

        const fontLower = pdfFontName.toLowerCase();

        // Computer Modern Roman (default LaTeX) -> Latin Modern Roman (modern replacement)
        if (fontLower.includes('cmr') || fontLower.includes('lmroman') || fontLower.includes('latinmodern')) {
          return '"Latin Modern Roman", "Computer Modern", serif';
        }
        // Computer Modern Sans Serif
        if (fontLower.includes('cmss') || fontLower.includes('lmsans')) {
          return '"Latin Modern Sans", "Computer Modern Sans", sans-serif';
        }
        // Computer Modern Typewriter (monospace)
        if (fontLower.includes('cmtt') || fontLower.includes('lmmono')) {
          return '"Latin Modern Mono", "Computer Modern Typewriter", monospace';
        }
        // Helvetica
        if (fontLower.includes('helvetica') || fontLower.includes('arial')) {
          return 'Arial, Helvetica, sans-serif';
        }
        // Times fonts
        if (fontLower.includes('times') || fontLower.includes('ptm')) {
          return '"Times New Roman", Times, serif';
        }
        // Courier (monospace)
        if (fontLower.includes('courier')) {
          return '"Courier New", Courier, monospace';
        }
        // Math fonts - use Latin Modern Roman as fallback
        if (fontLower.includes('cmmi') || fontLower.includes('cmsy') || fontLower.includes('cmex')) {
          return '"Latin Modern Roman", "STIX Two Math", serif';
        }

        // Default to Latin Modern Roman (most common LaTeX font)
        return '"Latin Modern Roman", serif';
      };

      // Get SyncTeX boxes for current page if available
      // CRITICAL: Use pageNum parameter, not currentPage state (which might not match)
      let synctexBoxes = [];
      if (synctexData) {
        synctexBoxes = synctexData.getPageBoxes(pageNum);
        console.log(`📍 Found ${synctexBoxes.length} SyncTeX boxes for page ${pageNum}`);
        
        // Debug: Show first few boxes
        if (synctexBoxes.length > 0) {
          console.log('📦 Sample SyncTeX boxes:', synctexBoxes.slice(0, 3).map(box => ({
            line: box.line,
            x: box.x?.toFixed(2),
            y: box.y?.toFixed(2),
            width: box.width?.toFixed(2),
            height: box.height?.toFixed(2)
          })));
        }
      } else {
        console.warn(`⚠️ No SyncTeX data available for page ${pageNum}`);
      }

      // Helper function to find nearby SyncTeX box for position refinement
      const findNearestSynctexBox = (pdfX, pdfY, textWidth = 0, textHeight = 0) => {
        if (!synctexBoxes.length) {
          console.log(`⚠️ No SyncTeX boxes available for matching (pdfX=${pdfX}, pdfY=${pdfY})`);
          return null;
        }

        // SyncTeX coordinates are in scaled points (sp), where 1pt = 65536sp
        // The parser already converts to points in lib/synctex-parser.js line 100
        // So box.x and box.y are already in points, same as PDF.js
        // Threshold for matching  
        const threshold = 40;

        // Method: Score boxes based on overlap and alignment
        let nearestBox = null;
        let bestScore = 0;

        for (const box of synctexBoxes) {
          const dx = Math.abs(box.x - pdfX);
          const dy = Math.abs(box.y - pdfY);
          const distance = dx + dy;

          if (distance > threshold) continue;

          // Calculate overlap if we have dimensions
          let overlapScore = 0;
          if (textWidth > 0 && textHeight > 0 && box.width > 0 && box.height > 0) {
            const overlapX = Math.max(0, Math.min(pdfX + textWidth, box.x + box.width) - Math.max(pdfX, box.x));
            const overlapY = Math.max(0, Math.min(pdfY + textHeight, box.y + box.height) - Math.max(pdfY, box.y));
            const overlapArea = overlapX * overlapY;
            const textArea = textWidth * textHeight;
            const boxArea = box.width * box.height;
            const unionArea = textArea + boxArea - overlapArea;
            overlapScore = unionArea > 0 ? (overlapArea / unionArea) * 60 : 0;
          }
          
          const proximityScore = Math.max(0, (1 - distance / threshold) * 30);
          const alignmentScore = dx < 10 ? 10 : 0;
          const score = overlapScore + proximityScore + alignmentScore;

          if (score > bestScore) {
            bestScore = score;
            nearestBox = box;
          }
        }

        if (nearestBox) {
          console.log(`✅ Found SyncTeX match: line ${nearestBox.line} with score ${bestScore.toFixed(1)}`);
        }

        return nearestBox;
      };

      // Statistics for debugging
      let totalTextItems = 0;
      let synctexMatchedItems = 0;
      
      // Render text items with EXACT character positioning (bypassing CSS spacing)
      textContent.items.forEach((item, idx) => {
        if (!item.str || item.str.trim() === '') return;
        
        totalTextItems++;

        const tx = item.transform;
        // tx = [scaleX, skewY, skewX, scaleY, translateX, translateY]

        // Calculate font metrics from PDF.js
        const fontHeightPDF = Math.abs(tx[3]); // Font size in PDF points
        const fontWidthPDF = Math.abs(tx[0]);  // Width scale in PDF points

        // Convert to screen pixels using viewport scale
        // Add 5% to font size to better match visual appearance
        let fontHeight = fontHeightPDF * viewport.scale * 1.05;
        let fontWidth = fontWidthPDF * viewport.scale * 1.17;

        // Get baseline position in PDF coordinates
        const x = tx[4];
        const y = tx[5];

        // Calculate approximate text dimensions for better matching
        const estimatedTextWidth = item.width || (item.str.length * Math.abs(tx[0]));
        const estimatedTextHeight = Math.abs(tx[3]);

        // Try to find corresponding SyncTeX box for refinement
        const synctexBox = findNearestSynctexBox(x, y, estimatedTextWidth, estimatedTextHeight);
        if (synctexBox) {
          synctexMatchedItems++;
        }

        // If SyncTeX box found, use it to refine dimensions
        if (synctexBox && synctexBox.height > 0) {
          // SyncTeX height is more accurate for text boxes
          const synctexHeightScreen = synctexBox.height * viewport.scale;

          // Use SyncTeX height if it's within reasonable range (±30% of PDF.js estimate)
          if (Math.abs(synctexHeightScreen - fontHeight) < fontHeight * 0.3) {
            fontHeight = synctexHeightScreen;
          }

          if (idx < 3) {
            console.log(`🔍 SyncTeX refinement for "${item.str}":`, {
              pdfHeight: fontHeightPDF.toFixed(2),
              synctexHeight: synctexBox.height.toFixed(2),
              screenHeight: fontHeight.toFixed(2),
              synctexBox: synctexBox
            });
          }
        }

        // Convert to viewport coordinates (PDF bottom-left to HTML top-left)
        const [vx, vy] = viewport.convertToViewportPoint(x, y);

        // Calculate top position
        // convertToViewportPoint returns (vx, vy) where vy is Y from top
        // But we need to account for that y coordinate represents the baseline
        // Text height includes descent below baseline, so we adjust by font height
        const top = vy - fontHeight;

        // Calculate EXACT width from PDF.js (includes TeX kerning!)
        let width = 0;
        if (item.width > 0) {
          // PDF.js gives us the exact typeset width INCLUDING kerning
          const [endX] = viewport.convertToViewportPoint(x + item.width, y);
          width = Math.abs(endX - vx);
        } else {
          // Fallback: estimate based on character count
          width = item.str.length * fontWidth * 0.5;
        }

        // Refine width using SyncTeX if available
        if (synctexBox && synctexBox.width > 0) {
          const synctexWidthScreen = synctexBox.width * viewport.scale;

          // Use SyncTeX width if reasonable
          if (synctexWidthScreen > 0 && synctexWidthScreen < width * 3) {
            width = Math.max(width, synctexWidthScreen);
          }
        }

        // Get font family based on PDF font name
        const fontFamily = getFontFamily(item.fontName);

        // CRITICAL: Calculate natural browser width estimate for transform scaling
        // Different fonts have different average character widths
        const strLength = item.str.length;
        const avgCharWidth = strLength > 0 ? width / strLength : width;

        // Font-specific width estimates based on actual TeX font metrics
        // These values are increased to account for better spacing
        const fontLower = (item.fontName || '').toLowerCase();
        let avgEmWidth = 0.55; // Default for Latin Modern Roman (increased for better spacing)

        if (fontLower.includes('cmr') || fontLower.includes('lmroman') || fontLower.includes('latinmodern')) {
          avgEmWidth = 0.55; // Latin Modern Roman (increased)
        } else if (fontLower.includes('cmss') || fontLower.includes('lmsans')) {
          avgEmWidth = 0.53; // Latin Modern Sans (increased)
        } else if (fontLower.includes('cmtt') || fontLower.includes('lmmono') || fontLower.includes('tt')) {
          avgEmWidth = 0.575; // Latin Modern Mono (increased)
        } else if (fontLower.includes('times') || fontLower.includes('ptm')) {
          avgEmWidth = 0.51; // Times New Roman (increased)
        } else if (fontLower.includes('helvetica') || fontLower.includes('arial')) {
          avgEmWidth = 0.57; // Helvetica/Arial (increased)
        } else if (fontLower.includes('courier')) {
          avgEmWidth = 0.65; // Courier (increased)
        } else if (fontLower.includes('cmmi') || fontLower.includes('cmsy') || fontLower.includes('cmex')) {
          avgEmWidth = 0.55; // Math fonts (increased)
        }

        // Estimate natural width based on font metrics
        const naturalWidthEstimate = strLength * fontHeight * avgEmWidth;

        // Calculate horizontal scale needed to match exact PDF width
        const horizontalScale = naturalWidthEstimate > 0 ? width / naturalWidthEstimate : 1;

        // Create span with PRECISE styling
        const span = document.createElement('span');
        span.textContent = item.str;
        span.style.position = 'absolute';
        span.style.left = vx + 'px';
        span.style.top = top + 'px';
        // span.style.pointerEvents = 'auto'; // CRITICAL: Enable clicks on spans (overrides CSS)
        span.style.setProperty('pointer-events', 'auto', 'important');
        span.style.setProperty('z-index', '10001', 'important');
        // Apply exact font metrics
        span.style.fontSize = fontHeight + 'px';
        span.style.fontFamily = fontFamily;
        span.style.fontWeight = '475'; // Slightly bolder for better visibility
        span.style.whiteSpace = 'pre';
        span.style.transformOrigin = '0 0';
        span.style.lineHeight = '1';
        span.style.height = fontHeight + 'px';
        span.style.width = width + 'px';

        // Don't set fixed width - let transform handle it
        span.style.display = 'block';

        // Add explicit spacing for better character and word separation
        // Letter spacing helps distribute characters naturally
        span.style.letterSpacing = '0.04em';

        // Word spacing helps with space character width
        if (item.str.includes(' ')) {
          span.style.wordSpacing = '0.3em';
        }

        // Build transform with proper scaling
        let transformValue = '';

        // Apply font-level horizontal scaling from PDF (for condensed/expanded fonts)
        const fontScaleX = fontWidth / fontHeight;

        // Combine font scaling with width scaling
        const finalScaleX = fontScaleX * horizontalScale;

        // Apply the combined horizontal scale
        if (Math.abs(finalScaleX - 1) > 0.01) {
          transformValue = `scaleX(${finalScaleX})`;
        }

        if (transformValue) {
          span.style.transform = transformValue;
        }

        // Add data attributes for debugging
        if (item.fontName) {
          span.setAttribute('data-font', item.fontName);
        }
        if (synctexBox) {
          span.setAttribute('data-synctex-line', synctexBox.line);
          
          // Add click handler to navigate to LaTeX source (single click for better UX)
          span.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            const lineNumber = synctexBox.line;
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
            console.log(`🎯 PDF TEXT CLICKED`);
            console.log(`   Text: "${item.str}"`);
            console.log(`   SyncTeX line: ${lineNumber}`);
            console.log(`   onTextClick type: ${typeof onTextClick}`);
            console.log(`   onTextClick exists: ${!!onTextClick}`);
            console.log(`   onTextClick value:`, onTextClick);
            
            // Call onTextClick callback to jump to line in editor
            if (onTextClick && typeof onTextClick === 'function' && lineNumber) {
              console.log(`🚀 Calling onTextClick(${lineNumber})...`);
              try {
                const result = onTextClick(lineNumber);
                console.log(`✅ onTextClick(${lineNumber}) returned:`, result);
                // If it's a promise, log it
                if (result && typeof result.then === 'function') {
                  result.then(
                    (resolved) => console.log(`✅ onTextClick promise resolved:`, resolved),
                    (rejected) => console.error(`❌ onTextClick promise rejected:`, rejected)
                  );
                }
              } catch (error) {
                console.error(`❌ Error calling onTextClick:`, error);
                console.error(`   Error stack:`, error.stack);
              }
            } else {
              console.warn(`⚠️ Cannot navigate:`);
              console.warn(`   - onTextClick exists: ${!!onTextClick}`);
              console.warn(`   - onTextClick is function: ${typeof onTextClick === 'function'}`);
              console.warn(`   - lineNumber valid: ${!!lineNumber && lineNumber > 0}`);
            }
            console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
          });
          
          // Add visual feedback on hover
          span.style.cursor = 'pointer';
          span.style.transition = 'background-color 0.2s';
          span.addEventListener('mouseenter', () => {
            span.style.backgroundColor = 'rgba(59, 130, 246, 0.1)'; // Light blue highlight
          });
          span.addEventListener('mouseleave', () => {
            span.style.backgroundColor = 'transparent';
          });
          span.title = `Click to go to line ${synctexBox.line} in LaTeX source`;
        } else if (onTextSearch) {
          // Fallback: If no SyncTeX data, add handler that will search for the text
          span.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            console.log(`📍 Double-clicked text without SyncTeX data: "${item.str}"`);
            
            // Call onTextSearch to search for this text in LaTeX source
            if (onTextSearch && item.str.trim()) {
              console.log(`🔍 Attempting search fallback for: "${item.str.trim()}"`);
              onTextSearch(item.str.trim());
            } else {
              console.warn(`⚠️ onTextSearch not available or text is empty`);
            }
          });
          
          // Add visual feedback on hover
          span.style.cursor = 'pointer';
          span.title = `Double-click to search for "${item.str}" in LaTeX source`;
        }
        
        // Always add pointer cursor to all text spans for better UX
        span.style.cursor = span.style.cursor || 'pointer';
        
        if (!span.title) {
          span.title = 'Select text (double-click to navigate)';
        }
        
        span.setAttribute('data-pdf-width', width.toFixed(2));

        // Debug logging for first 5 items
        if (idx < 5) {
          console.log(`📍 [${idx}] "${item.str}":`, {
            fontName: item.fontName,
            fontFamily: fontFamily,
            chars: strLength,
            avgCharWidth: avgCharWidth.toFixed(2),
            pdfWidth: width.toFixed(2),
            estimatedWidth: naturalWidthEstimate.toFixed(2),
            avgEmWidth: avgEmWidth.toFixed(3),
            fontScaleX: fontScaleX.toFixed(3),
            horizontalScale: horizontalScale.toFixed(3),
            finalScaleX: finalScaleX.toFixed(3),
            transform: tx,
            viewportScale: viewport.scale,
            fontHeightPDF: fontHeightPDF.toFixed(2),
            fontHeightScreen: fontHeight.toFixed(2),
            pdfCoords: `(${x.toFixed(1)}, ${y.toFixed(1)})`,
            viewportCoords: `(${vx.toFixed(1)}, ${vy.toFixed(1)})`,
            position: `left:${vx.toFixed(1)}, top:${top.toFixed(1)}`,
            hasSynctex: !!synctexBox
          });
        }

        textLayerDiv.appendChild(span);
      });

      console.log(`✅ Enhanced text layer rendered with ${textContent.items.length} spans`);
      console.log(`📊 SyncTeX Coverage: ${synctexBoxes.length > 0 ? ((synctexMatchedItems / totalTextItems * 100).toFixed(1)) : 'N/A'}% (${synctexMatchedItems}/${totalTextItems} text items matched)`);

    } catch (err) {
      console.error("❌ Text layer render error:", err);
      console.error("Stack:", err.stack);
    }
  };


  // Cleanup render task on unmount
  useEffect(() => {
    return () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, []);

  // Clear pages when PDF source changes
  useEffect(() => {
    // Cancel all pending render tasks
    Object.keys(pageRenderTasksRef.current).forEach(pageNum => {
      const task = pageRenderTasksRef.current[pageNum];
      if (task) {
        try {
          task.cancel();
        } catch (err) {
          // Ignore cancel errors
        }
      }
    });
    pageRenderTasksRef.current = {};
    
    if (canvasWrapperRef.current) {
      canvasWrapperRef.current.innerHTML = '';
    }
    pageCanvasRefs.current = {};
    pageTextRefs.current = {};
  }, [src]);

  // Render all pages for continuous scrolling
  useEffect(() => {
    if (!pdf || !totalPages || !canvasWrapperRef.current) return;

      const renderAllPages = async () => {
        setRendering(true);
        console.log(`🔄 Rendering all ${totalPages} pages at scale ${scale}...`);

        // Clear all "rendered" flags so pages re-render with new scale
        Object.keys(pageCanvasRefs.current).forEach(pageNum => {
          if (pageCanvasRefs.current[pageNum]) {
            delete pageCanvasRefs.current[pageNum].dataset.rendered;
          }
        });

        // Render pages sequentially (1, 2, 3...) to preserve correct order
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          console.log(`📄 Rendering page ${pageNum} of ${totalPages} at scale ${scale}`);
          await renderPage(pdf, pageNum);
        }

        setRendering(false);
        console.log('✅ All pages rendered in correct order');

        // Restore scroll position after rendering completes (for reloads)
        if (isReloadingRef.current && savedScrollPositionRef.current && containerRef.current) {
          // Use requestAnimationFrame to ensure DOM is ready
          requestAnimationFrame(() => {
            if (containerRef.current && savedScrollPositionRef.current) {
              const { scrollTop, scrollLeft, scrollHeight: oldScrollHeight } = savedScrollPositionRef.current;
              const newScrollHeight = containerRef.current.scrollHeight;

              // Calculate proportional scroll position if document height changed
              // (e.g., due to content changes affecting page layout)
              let targetScrollTop = scrollTop;
              if (oldScrollHeight > 0 && newScrollHeight > 0 && oldScrollHeight !== newScrollHeight) {
                const scrollRatio = scrollTop / oldScrollHeight;
                targetScrollTop = scrollRatio * newScrollHeight;
                console.log(`📍 Adjusting scroll for height change: ${oldScrollHeight} → ${newScrollHeight}, ratio: ${scrollRatio.toFixed(3)}`);
              }

              containerRef.current.scrollTop = targetScrollTop;
              containerRef.current.scrollLeft = scrollLeft;
              console.log(`📍 Restored scroll position: top=${targetScrollTop.toFixed(0)}, left=${scrollLeft}`);

              // Clear saved position
              savedScrollPositionRef.current = null;
              isReloadingRef.current = false;
            }
          });
        }
      };

    const timer = setTimeout(() => {
      renderAllPages();
    }, 100);

    return () => clearTimeout(timer);
  }, [pdf, totalPages, scale]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateVisiblePage = () => {
      const wrappers = canvasWrapperRef.current?.querySelectorAll('.pdf-page-wrapper');
      if (!wrappers || wrappers.length === 0) return;

      const scrollTop = container.scrollTop;
      const containerHeight = container.clientHeight;
      const viewportMid = scrollTop + containerHeight / 2;

      let closestPage = 1;
      let closestDistance = Number.POSITIVE_INFINITY;

      wrappers.forEach((wrapper, index) => {
        const rectTop = wrapper.offsetTop;
        const rectHeight = wrapper.offsetHeight;
        const pageMid = rectTop + rectHeight / 2;
        const distance = Math.abs(viewportMid - pageMid);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestPage = index + 1;
        }
      });

      setCurrentPage(closestPage);
    };

    updateVisiblePage();
    container.addEventListener('scroll', updateVisiblePage, { passive: true });
    return () => container.removeEventListener('scroll', updateVisiblePage);
  }, [pdf, totalPages, rendering]);

  const fitToWidth = useCallback(() => {
    console.log('🔲 Fit to Width clicked');
    console.log('containerRef.current:', containerRef.current);
    console.log('pdf:', pdf);
    
    if (!containerRef.current || !pdf) {
      console.warn('⚠️ Missing containerRef or pdf:', { 
        hasContainer: !!containerRef.current, 
        hasPdf: !!pdf 
      });
      return;
    }
    
    // Get first page to calculate dimensions
    pdf.getPage(1).then(page => {
      const viewport = page.getViewport({ scale: 1.0 });
      const containerWidth = containerRef.current.clientWidth - 32; // padding
      const newScale = containerWidth / viewport.width;
      console.log('📐 Fit to Width:', { containerWidth, viewportWidth: viewport.width, newScale });
      setScale(Math.max(0.5, Math.min(3, newScale)));
    }).catch(err => {
      console.error('❌ Error fitting to width:', err);
    });
  }, [pdf]);

  const fitToPage = useCallback(() => {
    console.log('📄 Fit to Page clicked');
    console.log('containerRef.current:', containerRef.current);
    console.log('pdf:', pdf);
    
    if (!containerRef.current || !pdf) {
      console.warn('⚠️ Missing containerRef or pdf:', { 
        hasContainer: !!containerRef.current, 
        hasPdf: !!pdf 
      });
      return;
    }
    
    pdf.getPage(1).then(page => {
      const viewport = page.getViewport({ scale: 1.0 });
      const container = containerRef.current;
      const containerWidth = container.clientWidth - 32;
      const containerHeight = container.clientHeight - 100; // controls height
      
      const scaleX = containerWidth / viewport.width;
      const scaleY = containerHeight / viewport.height;
      const newScale = Math.min(scaleX, scaleY);
      
      console.log('📐 Fit to Page:', { 
        containerWidth, 
        containerHeight, 
        viewportWidth: viewport.width, 
        viewportHeight: viewport.height, 
        scaleX, 
        scaleY, 
        newScale 
      });
      setScale(Math.max(0.5, Math.min(3, newScale)));
    }).catch(err => {
      console.error('❌ Error fitting to page:', err);
    });
  }, [pdf]);

  const openInNewTab = () => {
    if (src) {
      window.open(src, '_blank');
    }
  };

  const toggleDebugMode = () => {
    setDebugMode(!debugMode);
  };

  // Apply debug mode to all text layers when it changes
  useEffect(() => {
    Object.values(pageTextRefs.current).forEach(textLayer => {
      if (textLayer) {
        if (debugMode) {
          textLayer.classList.add('debug');
        } else {
          textLayer.classList.remove('debug');
        }
      }
    });
  }, [debugMode]);

  useEffect(() => {
    console.log('✅ PDFViewer Controls Mounted');
    return () => {
      console.log('❌ PDFViewer Controls Unmounted');
    };
  }, []);

  return (
    <div 
      className="w-full h-full min-h-0 flex flex-col overflow-hidden"
      style={{ minHeight: 0 }}
    >

      {/* Error Display - Show when there are actual compilation errors (hides PDF to avoid confusion) */}
      {compilationError && compilationError.filter(e => e.type === 'error' || e.severity === 'error').length > 0 && (
        <div className="flex-1 min-h-0 bg-gray-50 p-4 overflow-auto">
          <div className="max-w-4xl mx-auto">
            {/* User-friendly message at the top */}
            {userMessage && (
              <div className="mb-4 p-4 bg-red-100 border border-red-300 rounded-lg">
                <div className="text-red-800 font-semibold">{userMessage}</div>
              </div>
            )}
            
            <div className="flex items-center justify-between mb-4">
              <div className="text-red-600 font-bold text-lg">⚠️ Compilation Errors ({compilationError.filter(e => e.type === 'error' || e.severity === 'error').length})</div>
              {onFixAllErrors && compilationError.filter(e => e.type === 'error' || e.severity === 'error').length > 0 && (
                <button
                  onClick={onFixAllErrors}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg shadow-sm transition-colors flex items-center gap-2"
                  title="Fix all errors with AI"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  Fix All Errors with AI
                </button>
              )}
            </div>
            
            {/* Separate .bib file errors */}
            {compilationError.filter(e => (e.type === 'error' || e.severity === 'error') && e.file && e.file.endsWith('.bib')).length > 0 && (
              <div className="mb-4">
                <div className="text-cyan-700 font-semibold mb-2 text-sm">📚 Bibliography File Errors</div>
                <div className="space-y-2">
                  {compilationError.filter(e => (e.type === 'error' || e.severity === 'error') && e.file && e.file.endsWith('.bib')).map((error, index) => (
                    <div key={`bib-error-${error.id || index}`} className="p-3 bg-cyan-50 border border-cyan-200 rounded">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm font-medium text-cyan-800">
                            {error.file && error.file.split(/[/\\]/).pop()}
                            {error.line && `:${error.line}`}
                          </div>
                          <div className="text-xs text-cyan-700 mt-1">{error.message}</div>
                          {error.engine === 'bibtex-error-detector' && (
                            <div className="text-xs text-cyan-600 mt-1">.bib file syntax error</div>
                          )}
                        </div>
                        {onFixError && (
                          <button
                            onClick={() => onFixError(error)}
                            className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded flex items-center gap-1 transition-colors"
                            title="Fix this error with AI"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                            </svg>
                            Fix with AI
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            {/* Display only actual errors, not warnings */}
            <div className="space-y-4">
              {compilationError.filter(e => (e.type === 'error' || e.severity === 'error') && (!e.file || !e.file.endsWith('.bib'))).map((error, index) => (
                <div key={error.id || index}>
                  <div className="border rounded-lg overflow-hidden border-red-200">
                    {/* Error Header */}
                    <div className="bg-red-600 text-white px-4 py-2">
                      <div className="flex items-center justify-between">
                        <div className="font-medium text-sm">
                          <span className="capitalize">{error.category || 'error'}</span>
                          {error.file && error.line && (
                            <span className="ml-2 text-red-200">
                              {error.file}:{error.line}
                            </span>
                          )}
                          {error.line && !error.file && (
                            <span className="ml-2 text-red-200">
                              Line {error.line}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          {onFixError && (
                            <button
                              onClick={() => onFixError(error)}
                              className="text-xs bg-blue-600 hover:bg-blue-700 px-3 py-1 rounded flex items-center gap-1 transition-colors"
                              title="Fix this error with AI"
                            >
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                              </svg>
                              Fix with AI
                            </button>
                          )}
                          {error.line && onTextClick && (
                            <button
                              onClick={() => onTextClick(error.line, error.file)}
                              className="text-xs bg-red-700 hover:bg-red-800 px-2 py-1 rounded"
                            >
                              {error.file && compileTargetFromSrc && error.file !== compileTargetFromSrc ? 'Go to File' : 'Go to Line'}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    
                    {/* Error Description */}
                    <div className="p-4 bg-red-50">
                      <div className="text-sm mb-3 text-red-800">
                        <div className="font-semibold mb-1">{error.message}</div>
                        {error.engine && error.engine !== 'pdflatex' && (
                          <div className="text-xs opacity-75">Engine: {error.engine}</div>
                        )}
                      </div>
                      
                      {/* Suggestions */}
                      {error.suggestions && error.suggestions.length > 0 && (
                        <div className="mt-3">
                          <div className="text-xs font-semibold mb-2 text-red-700">
                            Suggestions:
                          </div>
                          <ul className="text-xs list-disc list-inside space-y-1 text-red-700">
                            {error.suggestions.map((suggestion, idx) => (
                              <li key={idx}>{suggestion}</li>
                            ))}
                          </ul>
                          {onApplyImageFix && error.suggestions.some(s => typeof s === 'string' && s.startsWith('Did you mean images/')) && (
                            <button
                              onClick={() => onApplyImageFix(error)}
                              className="mt-2 text-xs bg-green-600 hover:bg-green-700 text-white px-3 py-1.5 rounded flex items-center gap-1 transition-colors"
                              title="Replace wrong image path with suggested filename"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              Apply fix
                            </button>
                          )}
                        </div>
                      )}
                      
                      {/* Context */}
                      {error.context && error.context.length > 0 && (
                        <details className="mt-3">
                          <summary className="text-xs cursor-pointer text-red-600 hover:text-red-800">
                            Show context ({error.context.length} lines)
                          </summary>
                          <div className="mt-2 p-3 border rounded text-xs font-mono bg-white border-red-200 text-gray-800">
                            <div className="whitespace-pre-wrap">{error.context.join('\n')}</div>
                          </div>
                        </details>
                      )}
                    </div>
                  </div>
                  
                  {/* Horizontal separator between errors */}
                  {index < compilationError.filter(e => e.type === 'error' || e.severity === 'error').length - 1 && (
                    <div className="my-3 flex items-center">
                      <div className="flex-1 border-t border-gray-300"></div>
                      <div className="px-3 text-xs text-gray-500">Error {index + 2}</div>
                      <div className="flex-1 border-t border-gray-300"></div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* No PDF Section */}
            <div className="mt-6">
              <div className="border border-red-200 rounded-lg overflow-hidden">
                <div className="bg-red-600 text-white px-4 py-2">
                  <div className="font-medium text-sm">No PDF</div>
                </div>
                <div className="p-4 bg-red-50">
                  <div className="text-sm mb-2 text-red-800">
                    This compile didn't produce a PDF. This can happen if:
                  </div>
                  <ul className="text-sm text-red-700 list-disc list-inside space-y-1">
                    <li>There is an unrecoverable LaTeX error. If there are LaTeX errors shown above, please try to fix them and compile again.</li>
                    <li>The document environment contains no content. If it's empty, please add some content and compile again.</li>
                    <li>This project contains a file called output.pdf. If that file exists, please rename it and compile again.</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PDF canvas area - Hidden when there are compilation errors to avoid showing stale PDF */}
      {!(compilationError && compilationError.filter(e => e.type === 'error' || e.severity === 'error').length > 0) && (
      <div
        ref={containerRef}
        className="flex-1 min-h-0 overflow-y-auto bg-white border rounded relative"
        style={{ 
          position: 'relative', 
          scrollBehavior: 'smooth'
        }}
      >
          {(loading || rendering) && (
            <div className="flex items-center justify-center h-full">
              <div className="text-gray-500">
                {loading ? 'Loading PDF...' : 'Rendering PDF...'}
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center h-full">
              <div className="text-red-500">{error}</div>
            </div>
          )}

        {pdf && !error && (
          <div className="flex justify-center" style={{ paddingTop: '8px', paddingBottom: '16px', paddingLeft: '16px', paddingRight: '16px' }}>
            
            {/* PDF Layer Container - Will hold all pages */}
            <div
              ref={canvasWrapperRef}
              className="pdf__layers"
              style={{
                width: '100%',
                maxWidth: '100%'
              }}
            >
              {/* Pages will be dynamically added here */}
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
});

export default PDFViewer;
