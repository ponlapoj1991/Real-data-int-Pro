
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Project, ReportSlide, ReportElement, DashboardWidget, RawRow } from '../types';
import { 
    Plus, Trash2, Save, Download, Layers,
    Maximize, Monitor, Grid3X3, Type, FileUp, Loader2, MousePointer2,
    Bold, Italic, AlignLeft, AlignCenter, AlignRight, ZoomIn, ZoomOut,
    BringToFront, SendToBack, PaintBucket,
    ChevronLeft, ChevronRight, BarChart3, PieChart, LineChart, Activity, Hash, Cloud, Table
} from 'lucide-react';
import { saveProject } from '../utils/storage';
import { generateCustomReport } from '../utils/report';
import { applyTransformation } from '../utils/transform';
import { ResponsiveContainer, BarChart, Bar, PieChart as RePieChart, Pie, Cell, LineChart as ReLineChart, Line, AreaChart as ReAreaChart, Area, CartesianGrid, XAxis, YAxis } from 'recharts';

interface ReportBuilderProps {
  project: Project;
  onUpdateProject: (p: Project) => void;
}

// --- Constants ---
const CANVAS_WIDTH = 960;
const CANVAS_HEIGHT = 540; // 16:9 Aspect Ratio
const DEFAULT_PPT_WIDTH_EMU = 9144000; // 10 inches
const SNAP_GRID = 10;

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#6366F1', '#84cc16', '#14b8a6'];

const getSentimentColor = (key: string, index: number) => {
    const lower = key.toLowerCase();
    if (lower.includes('positive')) return '#10B981';
    if (lower.includes('negative')) return '#EF4444';
    if (lower.includes('neutral')) return '#9CA3AF';
    return COLORS[index % COLORS.length];
};

// --- Helper: Process Data for Charts ---
const processDataForWidget = (widget: DashboardWidget, rawData: RawRow[]) => {
    const groups: Record<string, any> = {};
    
    if (widget.type === 'bar' && widget.stackBy) {
        const stackKeys = new Set<string>();
        rawData.forEach(row => {
            const dimVal = String(row[widget.dimension] || '(Empty)');
            const stackVal = String(row[widget.stackBy!] || '(Other)');
            stackKeys.add(stackVal);
            if (!groups[dimVal]) groups[dimVal] = { name: dimVal, total: 0 };
            if (!groups[dimVal][stackVal]) groups[dimVal][stackVal] = 0;
            
            if (widget.measure === 'count') {
                groups[dimVal][stackVal]++;
                groups[dimVal].total++;
            } else {
                const val = Number(row[widget.measureCol || '']) || 0;
                groups[dimVal][stackVal] += val;
                groups[dimVal].total += val;
            }
        });
        return { 
            data: Object.values(groups).sort((a: any, b: any) => b.total - a.total).slice(0, widget.limit || 20),
            isStack: true,
            stackKeys: Array.from(stackKeys).sort()
        };
    }

    rawData.forEach(row => {
        const val = String(row[widget.dimension] || '(Empty)');
        if (!groups[val]) groups[val] = 0;
        
        if (widget.measure === 'count' || widget.type === 'wordcloud') {
            groups[val]++;
        } else {
            groups[val] += Number(row[widget.measureCol || '']) || 0;
        }
    });
    
    let result = Object.keys(groups).map(k => ({ name: k, value: groups[k] }));
    result.sort((a, b) => b.value - a.value);
    return { data: result.slice(0, widget.limit || 20), isStack: false };
};

const ReportBuilder: React.FC<ReportBuilderProps> = ({ project, onUpdateProject }) => {
  // --- State ---
  const [slides, setSlides] = useState<ReportSlide[]>(project.reportConfig || [{ id: 'slide-1', elements: [] }]);
  const [activeSlideIdx, setActiveSlideIdx] = useState(0);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isProcessingPptx, setIsProcessingPptx] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const [bgColorPicker, setBgColorPicker] = useState(false);
  const [isSidebarOpen, setSidebarOpen] = useState(true);

  const canvasRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- Drag & Resize Logic State ---
  const dragRef = useRef<{
    active: boolean;
    mode: 'drag' | 'resize';
    handle: string | null; 
    startX: number;
    startY: number;
    initialEl: { x: number; y: number; w: number; h: number } | null;
    elementId: string | null;
    dragOffset: { x: number, y: number };
  }>({
    active: false,
    mode: 'drag',
    handle: null,
    startX: 0,
    startY: 0,
    initialEl: null,
    elementId: null,
    dragOffset: { x: 0, y: 0 }
  });

  // Prepare Data
  const finalData = useMemo(() => {
     return project.transformRules && project.transformRules.length > 0 
        ? applyTransformation(project.data, project.transformRules) 
        : project.data;
  }, [project]);

  const activeSlide = slides[activeSlideIdx];
  const selectedElement = useMemo(() => 
    activeSlide.elements.find(el => el.id === selectedElementId), 
  [activeSlide, selectedElementId]);

  // --- Slide Management ---

  const handleAddSlide = () => {
      const newSlide: ReportSlide = {
          id: `slide-${Date.now()}`,
          elements: []
      };
      setSlides([...slides, newSlide]);
      setActiveSlideIdx(slides.length);
  };

  const handleDeleteSlide = (idx: number, e: React.MouseEvent) => {
      e.stopPropagation();
      if (slides.length <= 1) return;
      const newSlides = slides.filter((_, i) => i !== idx);
      setSlides(newSlides);
      if (activeSlideIdx >= idx) setActiveSlideIdx(Math.max(0, activeSlideIdx - 1));
  };

  const handleAddText = () => {
     const newElement: ReportElement = {
        id: `text-${Date.now()}`,
        type: 'text',
        content: 'Double click to edit',
        x: 100, y: 100, w: 300, h: 50,
        zIndex: activeSlide.elements.length + 1,
        style: { fontSize: '24px', color: '#000000', fontWeight: 'bold', fontFamily: 'Arial' }
     };
     const newSlides = [...slides];
     newSlides[activeSlideIdx].elements.push(newElement);
     setSlides(newSlides);
     setSelectedElementId(newElement.id);
  };

  const handleUpdateSlideBackground = (color: string) => {
      const newSlides = [...slides];
      newSlides[activeSlideIdx].background = color;
      setSlides(newSlides);
      setBgColorPicker(false);
  };

  // --- Element Formatting Logic ---

  const updateElementStyle = (key: string, value: any) => {
    if (!selectedElement) return;
    const newSlides = [...slides];
    const el = newSlides[activeSlideIdx].elements.find(e => e.id === selectedElementId);
    if (el) {
        el.style = { ...el.style, [key]: value };
        setSlides(newSlides);
    }
  };

  const updateElementOrder = (action: 'front' | 'back') => {
      if (!selectedElement) return;
      const newSlides = [...slides];
      const currentSlide = newSlides[activeSlideIdx];
      const maxZ = Math.max(...currentSlide.elements.map(e => e.zIndex || 0), 0);
      
      const el = currentSlide.elements.find(e => e.id === selectedElementId);
      if (el) {
          el.zIndex = action === 'front' ? maxZ + 1 : 0;
          currentSlide.elements.sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
          currentSlide.elements.forEach((e, i) => e.zIndex = i + 1);
          setSlides(newSlides);
      }
  };

  // --- Advanced PPTX Parsing Logic ---
  
  const getChild = (el: Element | null, localName: string): Element | null => {
      if (!el) return null;
      // Handle namespaces (a:rPr vs rPr) by checking both or using wildcard
      const collection = el.getElementsByTagNameNS("*", localName);
      return collection.length > 0 ? collection[0] : null;
  };

  const getChildren = (el: Element | null, localName: string): Element[] => {
      if (!el) return [];
      return Array.from(el.getElementsByTagNameNS("*", localName));
  };

  const handlePptxUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.match(/\.(pptx)$/)) {
        alert("Please upload a valid .pptx file.");
        return;
    }

    setIsProcessingPptx(true);

    try {
        if (!window.JSZip) throw new Error("JSZip library is not loaded");

        const zip = new window.JSZip();
        const content = await zip.loadAsync(file);

        // 0. Determine Slide Size from presentation.xml
        let pptWidthEmu = DEFAULT_PPT_WIDTH_EMU; // Default 10"
        
        try {
            const presentationXml = await content.file("ppt/presentation.xml")?.async("string");
            if (presentationXml) {
                const parser = new DOMParser();
                const presDoc = parser.parseFromString(presentationXml, "text/xml");
                const sldSz = getChild(presDoc.documentElement, "sldSz");
                if (sldSz) {
                    const cx = parseInt(sldSz.getAttribute("cx") || "0");
                    if (cx > 0) pptWidthEmu = cx;
                }
            }
        } catch (e) {
            console.warn("Could not parse presentation.xml for slide size", e);
        }

        const scaleFactor = CANVAS_WIDTH / pptWidthEmu;
        const emuToPx = (emu: number) => Math.round(emu * scaleFactor);
        
        // 1. Identify Slides
        const slideFiles = Object.keys(content.files).filter(name => name.match(/ppt\/slides\/slide\d+\.xml/));
        
        slideFiles.sort((a, b) => {
            const numA = parseInt(a.match(/slide(\d+)\.xml/)![1]);
            const numB = parseInt(b.match(/slide(\d+)\.xml/)![1]);
            return numA - numB;
        });

        const newSlides: ReportSlide[] = [];

        for (const slideFile of slideFiles) {
            const slideXmlStr = await content.file(slideFile)?.async("string");
            if (!slideXmlStr) continue;
            
            const parser = new DOMParser();
            const xmlDoc = parser.parseFromString(slideXmlStr, "text/xml");
            const elements: ReportElement[] = [];
            const relsMap: Record<string, string> = {};

            // 2. Load Relationships (.rels)
            const relsFileName = slideFile.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
            const relsStr = await content.file(relsFileName)?.async("string");
            if (relsStr) {
                const relsDoc = parser.parseFromString(relsStr, "text/xml");
                const relationships = relsDoc.getElementsByTagName("Relationship");
                for (let i = 0; i < relationships.length; i++) {
                    const id = relationships[i].getAttribute("Id");
                    const target = relationships[i].getAttribute("Target");
                    if (id && target) {
                        let cleanTarget = target;
                        if (target.startsWith('../')) {
                            cleanTarget = target.replace('../', 'ppt/');
                        }
                        relsMap[id] = cleanTarget;
                    }
                }
            }

            // 3. Robust Element Traversal
            const allNodes = Array.from(xmlDoc.getElementsByTagName("*"));
            const shapes = allNodes.filter(node => node.localName === 'sp' || node.localName === 'pic');

            for (let index = 0; index < shapes.length; index++) {
                const shape = shapes[index];
                
                // --- Extract Position (xfrm) ---
                const xfrm = getChild(shape, "xfrm");
                if (!xfrm) continue;

                const off = getChild(xfrm, "off");
                const ext = getChild(xfrm, "ext");

                if (!off || !ext) continue;

                const x = emuToPx(parseInt(off.getAttribute("x") || "0"));
                const y = emuToPx(parseInt(off.getAttribute("y") || "0"));
                const w = emuToPx(parseInt(ext.getAttribute("cx") || "0"));
                const h = emuToPx(parseInt(ext.getAttribute("cy") || "0"));

                if (w < 5 || h < 5) continue;
                
                // --- Handle Image (pic) ---
                if (shape.localName === 'pic') {
                    const blipFill = getChild(shape, "blipFill");
                    if (blipFill) {
                        const blip = getChild(blipFill, "blip");
                        const embedId = blip?.getAttribute("r:embed") || blip?.getAttribute("embed");
                        
                        if (embedId && relsMap[embedId]) {
                            const imgPath = relsMap[embedId];
                            const imgFile = content.file(imgPath);
                            if (imgFile) {
                                try {
                                    const imgBlob = await imgFile.async("blob");
                                    const base64 = await new Promise<string>((resolve) => {
                                        const reader = new FileReader();
                                        reader.onload = () => resolve(reader.result as string);
                                        reader.readAsDataURL(imgBlob);
                                    });

                                    elements.push({
                                        id: `img-${Date.now()}-${index}`,
                                        type: 'image',
                                        content: base64,
                                        x, y, w, h,
                                        zIndex: index + 1
                                    });
                                } catch (e) {
                                    console.warn("Failed to load image blob", e);
                                }
                            }
                        }
                    }
                }

                // --- Handle Text (sp) with Enhanced Formatting ---
                if (shape.localName === 'sp') {
                    const txBody = getChild(shape, "txBody");
                    if (txBody) {
                        const paragraphs = getChildren(txBody, "p");
                        let fullText = "";
                        // Capture first valid style to apply to block
                        let fontSize = '14px';
                        let color = '#333333';
                        let fontWeight = 'normal';
                        let fontStyle = 'normal';
                        let textAlign = 'left';
                        let fontFamily = 'Arial';
                        
                        for (let p = 0; p < paragraphs.length; p++) {
                            const runs = getChildren(paragraphs[p], "r");
                            
                            // Check paragraph properties for alignment
                            const pPr = getChild(paragraphs[p], "pPr");
                            if (pPr) {
                                const algn = pPr.getAttribute("algn"); // ctr, r, l
                                if (algn === 'ctr') textAlign = 'center';
                                if (algn === 'r') textAlign = 'right';
                            }

                            for (let r = 0; r < runs.length; r++) {
                                const t = getChild(runs[r], "t");
                                const rPr = getChild(runs[r], "rPr"); // Run Properties
                                
                                if (t && t.textContent) {
                                    fullText += t.textContent;
                                    
                                    // Extract Style from the first text run we find
                                    if (fullText.length === t.textContent.length && rPr) {
                                        // Font Size (sz is in 100th of point)
                                        const sz = rPr.getAttribute("sz");
                                        if (sz) fontSize = `${Math.round(parseInt(sz) / 100)}px`;

                                        // Bold/Italic
                                        if (rPr.getAttribute("b") === "1") fontWeight = 'bold';
                                        if (rPr.getAttribute("i") === "1") fontStyle = 'italic';
                                        
                                        // Color
                                        const solidFill = getChild(rPr, "solidFill");
                                        if (solidFill) {
                                            const srgb = getChild(solidFill, "srgbClr");
                                            if (srgb) {
                                                const val = srgb.getAttribute("val");
                                                if (val) color = `#${val}`;
                                            }
                                        }

                                        // Font Family
                                        const latin = getChild(rPr, "latin");
                                        if (latin) {
                                            const typeface = latin.getAttribute("typeface");
                                            if (typeface) fontFamily = typeface;
                                        }
                                    }
                                }
                            }
                            if (p < paragraphs.length - 1) fullText += "\n";
                        }

                        if (fullText.trim()) {
                            elements.push({
                                id: `text-${Date.now()}-${index}`,
                                type: 'text',
                                content: fullText,
                                x: Math.max(0, x),
                                y: Math.max(0, y),
                                w: Math.max(50, w),
                                h: Math.max(20, h),
                                zIndex: index + 1,
                                style: { 
                                    fontSize, 
                                    color,
                                    fontWeight,
                                    fontStyle,
                                    textAlign,
                                    fontFamily
                                }
                            });
                        }
                    }
                }
            }

            newSlides.push({
                id: `imported-slide-${Date.now()}-${slideFile}`,
                elements: elements
            });
        }

        if (newSlides.length > 0) {
            setSlides(prev => [...prev, ...newSlides]);
            setActiveSlideIdx(slides.length); 
            const updated = { ...project, reportConfig: [...slides, ...newSlides] };
            onUpdateProject(updated);
            saveProject(updated);
        } else {
            alert("No recognizable text or images found.");
        }

    } catch (err: any) {
        console.error("PPTX Parsing Error:", err);
        alert(`Failed to parse PPTX: ${err.message}`);
    } finally {
        setIsProcessingPptx(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // --- Drag & Drop & Resize Logic ---

  const handleDrop = (e: React.DragEvent) => {
      e.preventDefault();
      const widgetId = e.dataTransfer.getData("widgetId");
      const elementType = e.dataTransfer.getData("type");

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      const scale = zoomLevel;
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;

      const snappedX = Math.round((x - 50) / SNAP_GRID) * SNAP_GRID;
      const snappedY = Math.round((y - 50) / SNAP_GRID) * SNAP_GRID;

      let newElement: ReportElement;

      if (elementType === 'text') {
          newElement = {
              id: `text-${Date.now()}`,
              type: 'text',
              content: 'Double click to edit text',
              x: snappedX, y: snappedY, w: 300, h: 60,
              zIndex: activeSlide.elements.length + 1,
              style: { fontSize: '20px', color: '#333333' }
          };
      } else if (widgetId) {
          newElement = {
              id: `widget-${Date.now()}`,
              type: 'widget',
              widgetId,
              x: Math.max(0, Math.min(snappedX, CANVAS_WIDTH - 400)),
              y: Math.max(0, Math.min(snappedY, CANVAS_HEIGHT - 300)),
              w: 400, h: 300,
              zIndex: activeSlide.elements.length + 1,
          };
      } else {
          return;
      }

      const newSlides = [...slides];
      newSlides[activeSlideIdx].elements.push(newElement);
      setSlides(newSlides);
      setSelectedElementId(newElement.id);
  };

  const handleSave = async () => {
      const updated = { ...project, reportConfig: slides };
      onUpdateProject(updated);
      await saveProject(updated);
      alert("Project saved successfully!");
  };

  const handleExport = async () => {
      setIsExporting(true);
      setSelectedElementId(null);
      setTimeout(async () => {
          await generateCustomReport(project, slides, CANVAS_WIDTH, CANVAS_HEIGHT);
          setIsExporting(false);
      }, 500);
  };

  const startDrag = (e: React.MouseEvent, id: string) => {
      e.preventDefault();
      e.stopPropagation();
      
      const el = slides[activeSlideIdx].elements.find(x => x.id === id);
      if(!el || !canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const scale = zoomLevel;
      
      const mouseXCanvas = (e.clientX - rect.left) / scale;
      const mouseYCanvas = (e.clientY - rect.top) / scale;

      setSelectedElementId(id);
      dragRef.current = {
          active: true,
          mode: 'drag',
          handle: null,
          startX: e.clientX, 
          startY: e.clientY,
          initialEl: { ...el },
          elementId: id,
          dragOffset: {
              x: mouseXCanvas - el.x,
              y: mouseYCanvas - el.y
          }
      };
  };

  const startResize = (e: React.MouseEvent, id: string, handle: string) => {
      e.preventDefault();
      e.stopPropagation();

      const el = slides[activeSlideIdx].elements.find(x => x.id === id);
      if(!el) return;

      dragRef.current = {
          active: true,
          mode: 'resize',
          handle: handle,
          startX: e.clientX, 
          startY: e.clientY,
          initialEl: { ...el },
          elementId: id,
          dragOffset: { x: 0, y: 0 }
      };
  };

  // Click on element to select it without dragging
  const handleElementClick = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setSelectedElementId(id);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
        if (!dragRef.current.active || !dragRef.current.initialEl || !canvasRef.current) return;

        const { mode, handle, initialEl, dragOffset, startX, startY } = dragRef.current;
        const canvasRect = canvasRef.current.getBoundingClientRect();
        const scale = zoomLevel;

        setSlides(prev => {
            const newSlides = [...prev];
            const slide = newSlides[activeSlideIdx];
            if (!slide) return prev;

            const elIndex = slide.elements.findIndex(el => el.id === dragRef.current.elementId);
            if (elIndex === -1) return prev;

            if (mode === 'drag') {
                const currentMouseXCanvas = (e.clientX - canvasRect.left) / scale;
                const currentMouseYCanvas = (e.clientY - canvasRect.top) / scale;

                let newX = currentMouseXCanvas - dragOffset.x;
                let newY = currentMouseYCanvas - dragOffset.y;

                if (showGrid) {
                    newX = Math.round(newX / SNAP_GRID) * SNAP_GRID;
                    newY = Math.round(newY / SNAP_GRID) * SNAP_GRID;
                }

                slide.elements[elIndex] = {
                    ...slide.elements[elIndex],
                    x: newX,
                    y: newY
                };
            } else if (mode === 'resize') {
                const deltaX = (e.clientX - startX) / scale;
                const deltaY = (e.clientY - startY) / scale;

                let { x, y, w, h } = initialEl;
                let newW = w;
                let newH = h;
                let newX = x;
                let newY = y;

                if (handle?.includes('e')) newW = Math.max(20, w + deltaX);
                if (handle?.includes('s')) newH = Math.max(20, h + deltaY);
                if (handle?.includes('w')) {
                    const proposedW = Math.max(20, w - deltaX);
                    newX = x + (w - proposedW);
                    newW = proposedW;
                }
                if (handle?.includes('n')) {
                    const proposedH = Math.max(20, h - deltaY);
                    newY = y + (h - proposedH);
                    newH = proposedH;
                }
                
                if (showGrid) {
                    newW = Math.round(newW / SNAP_GRID) * SNAP_GRID;
                    newH = Math.round(newH / SNAP_GRID) * SNAP_GRID;
                    newX = Math.round(newX / SNAP_GRID) * SNAP_GRID;
                    newY = Math.round(newY / SNAP_GRID) * SNAP_GRID;
                }

                slide.elements[elIndex] = {
                    ...slide.elements[elIndex],
                    x: newX, y: newY, w: newW, h: newH
                };
            }

            return newSlides;
        });
    };

    const handleMouseUp = () => {
        if (dragRef.current.active) {
            dragRef.current.active = false;
            dragRef.current.initialEl = null;
        }
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [activeSlideIdx, showGrid, zoomLevel]);

  const deleteElement = (e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (!selectedElementId) return;
      const newSlides = [...slides];
      newSlides[activeSlideIdx].elements = newSlides[activeSlideIdx].elements.filter(el => el.id !== selectedElementId);
      setSlides(newSlides);
      setSelectedElementId(null);
  };
  
  const handleTextChange = (id: string, newText: string) => {
      const newSlides = [...slides];
      const el = newSlides[activeSlideIdx].elements.find(e => e.id === id);
      if (el) {
          el.content = newText;
          setSlides(newSlides);
      }
  };

  const activeBgColor = activeSlide.background?.startsWith('#') ? activeSlide.background : '#ffffff';

  // Helper for Thumbnail Preview
  const renderThumbnailElement = (el: ReportElement) => {
      const style = {
          left: `${(el.x / CANVAS_WIDTH) * 100}%`,
          top: `${(el.y / CANVAS_HEIGHT) * 100}%`,
          width: `${(el.w / CANVAS_WIDTH) * 100}%`,
          height: `${(el.h / CANVAS_HEIGHT) * 100}%`,
          zIndex: el.zIndex || 0
      };

      if (el.type === 'image' && el.content) {
          return <img key={el.id} src={el.content} className="absolute object-contain w-full h-full" style={style} alt="" />;
      }
      
      if (el.type === 'text') {
           // Approximate scale for thumbnail text
           const baseSize = parseInt(el.style?.fontSize || '14');
           return (
               <div key={el.id} className="absolute overflow-hidden leading-tight whitespace-pre-wrap" style={{...style, 
                  fontSize: `${Math.max(2, baseSize / 5)}px`, 
                  color: el.style?.color,
                  textAlign: el.style?.textAlign as any,
                  fontWeight: el.style?.fontWeight,
                  fontStyle: el.style?.fontStyle,
                  fontFamily: el.style?.fontFamily
               }}>
                   {el.content}
               </div>
           );
      }
      
      if (el.type === 'widget') {
          const widget = project.dashboard?.find(w => w.id === el.widgetId);
          return (
              <div key={el.id} className="absolute bg-white border-[0.5px] border-gray-200 flex flex-col shadow-sm overflow-hidden" style={style}>
                   <div className="w-full h-[2px] bg-gray-100 mb-[1px]"></div>
                   <div className="flex-1 flex items-center justify-center p-[1px]">
                        {/* Mini Visual Representation based on Chart Type */}
                        {(!widget || widget.type === 'bar') && <BarChart3 className="w-full h-full text-blue-300 opacity-80" strokeWidth={1.5} />}
                        {widget?.type === 'pie' && <PieChart className="w-full h-full text-green-300 opacity-80" strokeWidth={1.5} />}
                        {widget?.type === 'line' && <LineChart className="w-full h-full text-purple-300 opacity-80" strokeWidth={1.5} />}
                        {widget?.type === 'area' && <Activity className="w-full h-full text-purple-300 opacity-80" strokeWidth={1.5} />}
                        {widget?.type === 'kpi' && <Hash className="w-full h-full text-orange-300 opacity-80" strokeWidth={1.5} />}
                        {widget?.type === 'wordcloud' && <Cloud className="w-full h-full text-gray-300 opacity-80" strokeWidth={1.5} />}
                        {widget?.type === 'table' && <Table className="w-full h-full text-gray-300 opacity-80" strokeWidth={1.5} />}
                   </div>
              </div>
          );
      }
      
      return <div key={el.id} className="absolute bg-gray-200 border border-gray-300" style={style}></div>;
  };

  return (
    <div className="flex h-full bg-gray-100 overflow-hidden font-sans">
      
      {/* Left Sidebar: Slide Sorter */}
      <div className={`${isSidebarOpen ? 'w-52' : 'w-16'} bg-white border-r border-gray-200 flex flex-col z-10 shadow-sm flex-shrink-0 transition-all duration-300`}>
          <div className="p-3 border-b border-gray-100 flex justify-between items-center bg-gray-50 h-10">
              {isSidebarOpen && <h3 className="font-bold text-gray-700 text-sm">Slides</h3>}
              <button onClick={() => setSidebarOpen(!isSidebarOpen)} className="p-1 hover:bg-gray-200 rounded text-gray-500 mx-auto">
                  {isSidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </button>
          </div>
          
          <div className="flex-1 overflow-y-auto p-2 space-y-4 custom-scrollbar">
              {slides.map((slide, idx) => (
                  <div 
                    key={slide.id}
                    onClick={() => setActiveSlideIdx(idx)}
                    className={`relative group cursor-pointer transition-all duration-200`}
                  >
                      <div className={`flex items-center ${isSidebarOpen ? 'justify-between' : 'justify-center'} mb-1`}>
                          <span className={`text-xs font-bold ${activeSlideIdx === idx ? 'text-blue-600' : 'text-gray-400'}`}>
                             {idx + 1}
                          </span>
                          {isSidebarOpen && (
                            <button 
                                onClick={(e) => handleDeleteSlide(idx, e)}
                                className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-50 text-gray-300 hover:text-red-500 rounded transition-all"
                            >
                                <Trash2 className="w-3 h-3" />
                            </button>
                          )}
                      </div>
                      
                      <div className={`aspect-video w-full bg-white rounded border-2 overflow-hidden relative shadow-sm ${activeSlideIdx === idx ? 'border-blue-500 ring-2 ring-blue-100' : 'border-gray-200 hover:border-gray-300'}`}>
                           <div 
                                className="w-full h-full relative overflow-hidden"
                                style={{
                                    backgroundColor: slide.background && slide.background.startsWith('#') ? slide.background : 'white',
                                    backgroundImage: slide.background && !slide.background.startsWith('#') ? `url(${slide.background})` : 'none',
                                    backgroundSize: 'cover'
                                }}
                           >
                                {/* Realtime Preview Elements */}
                                {slide.elements.map(renderThumbnailElement)}
                           </div>
                      </div>
                  </div>
              ))}

              <button 
                onClick={handleAddSlide}
                className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-400 hover:border-blue-400 hover:text-blue-500 hover:bg-white transition-all flex items-center justify-center group mt-2"
                title="Add Slide"
              >
                  <Plus className="w-4 h-4" />
                  {isSidebarOpen && <span className="text-xs font-medium ml-2">Add Slide</span>}
              </button>
          </div>
      </div>

      {/* Center: Canvas Editor */}
      <div className="flex-1 flex flex-col relative bg-gray-100">
          
          {/* Top Toolbar: Global Actions */}
          <div className="h-12 bg-white border-b border-gray-200 flex items-center justify-between px-4 shadow-sm z-20 flex-shrink-0">
              <div className="flex items-center space-x-2">
                  <label className={`flex items-center px-3 py-1.5 rounded-lg cursor-pointer hover:bg-gray-50 border border-transparent hover:border-gray-200 transition-colors ${isProcessingPptx ? 'opacity-50' : ''}`}>
                      {isProcessingPptx ? <Loader2 className="w-4 h-4 animate-spin text-blue-600 mr-2" /> : <FileUp className="w-4 h-4 text-orange-600 mr-2" />}
                      <span className="text-xs font-semibold text-gray-700">Import PPTX</span>
                      <input ref={fileInputRef} type="file" accept=".pptx" className="hidden" onChange={handlePptxUpload} disabled={isProcessingPptx} />
                  </label>
                  <div className="h-5 w-px bg-gray-200 mx-2"></div>
                  <button onClick={handleAddText} className="p-2 hover:bg-gray-100 rounded text-gray-600" title="Add Text"><Type className="w-4 h-4" /></button>
                  <button onClick={() => setShowGrid(!showGrid)} className={`p-2 rounded ${showGrid ? 'bg-blue-50 text-blue-600' : 'hover:bg-gray-100 text-gray-400'}`} title="Snap Grid"><Grid3X3 className="w-4 h-4" /></button>
                  <div className="h-5 w-px bg-gray-200 mx-2"></div>
                  <button onClick={() => setZoomLevel(z => Math.max(0.2, z - 0.1))} className="p-2 hover:bg-gray-100 rounded text-gray-600"><ZoomOut className="w-4 h-4" /></button>
                  <span className="text-xs w-10 text-center text-gray-500">{Math.round(zoomLevel * 100)}%</span>
                  <button onClick={() => setZoomLevel(z => Math.min(2.0, z + 0.1))} className="p-2 hover:bg-gray-100 rounded text-gray-600"><ZoomIn className="w-4 h-4" /></button>
              </div>
              
              <div className="flex items-center space-x-2">
                   <button onClick={handleSave} className="flex items-center px-3 py-1.5 bg-gray-800 text-white rounded text-xs font-medium hover:bg-gray-900 shadow-sm">
                        <Save className="w-3.5 h-3.5 mr-2" /> Save
                  </button>
                  <button onClick={handleExport} disabled={isExporting} className="flex items-center px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 shadow-sm disabled:opacity-50">
                        {isExporting ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-2" />} Export
                  </button>
              </div>
          </div>

          {/* Second Toolbar: Context Aware */}
          <div className="h-10 bg-white border-b border-gray-200 flex items-center px-4 space-x-2 shadow-sm z-10 flex-shrink-0">
             {selectedElement ? (
                 <>
                    <span className="text-[10px] font-bold text-gray-400 uppercase mr-2 tracking-wider">
                        {selectedElement.type === 'text' ? 'Text' : selectedElement.type === 'image' ? 'Image' : 'Chart'}
                    </span>
                    
                    {selectedElement.type === 'text' && (
                        <>
                             <select 
                                className="text-xs border border-gray-300 rounded px-2 py-1 outline-none w-16"
                                value={selectedElement.style?.fontSize || '14px'}
                                onChange={(e) => updateElementStyle('fontSize', e.target.value)}
                             >
                                 {[12,14,16,18,20,24,32,48,64].map(s => <option key={s} value={`${s}px`}>{s}</option>)}
                             </select>
                             <div className="w-px h-4 bg-gray-200 mx-2"></div>
                             <button onClick={() => updateElementStyle('fontWeight', selectedElement.style?.fontWeight === 'bold' ? 'normal' : 'bold')} className={`p-1 rounded ${selectedElement.style?.fontWeight === 'bold' ? 'bg-gray-200' : 'hover:bg-gray-100'}`}><Bold className="w-3.5 h-3.5" /></button>
                             <button onClick={() => updateElementStyle('fontStyle', selectedElement.style?.fontStyle === 'italic' ? 'normal' : 'italic')} className={`p-1 rounded ${selectedElement.style?.fontStyle === 'italic' ? 'bg-gray-200' : 'hover:bg-gray-100'}`}><Italic className="w-3.5 h-3.5" /></button>
                             <div className="w-px h-4 bg-gray-200 mx-2"></div>
                             <button onClick={() => updateElementStyle('textAlign', 'left')} className={`p-1 rounded ${selectedElement.style?.textAlign === 'left' ? 'bg-gray-200' : 'hover:bg-gray-100'}`}><AlignLeft className="w-3.5 h-3.5" /></button>
                             <button onClick={() => updateElementStyle('textAlign', 'center')} className={`p-1 rounded ${selectedElement.style?.textAlign === 'center' ? 'bg-gray-200' : 'hover:bg-gray-100'}`}><AlignCenter className="w-3.5 h-3.5" /></button>
                             <button onClick={() => updateElementStyle('textAlign', 'right')} className={`p-1 rounded ${selectedElement.style?.textAlign === 'right' ? 'bg-gray-200' : 'hover:bg-gray-100'}`}><AlignRight className="w-3.5 h-3.5" /></button>
                             <div className="w-px h-4 bg-gray-200 mx-2"></div>
                             <input type="color" className="w-6 h-6 border-0 p-0 rounded cursor-pointer" value={selectedElement.style?.color || '#000000'} onChange={(e) => updateElementStyle('color', e.target.value)} />
                        </>
                    )}

                    <div className="flex-1"></div>

                    <button onClick={() => updateElementOrder('front')} className="p-1 hover:bg-gray-100 rounded text-gray-600 text-xs flex items-center" title="Bring to Front"><BringToFront className="w-3.5 h-3.5 mr-1" /> Front</button>
                    <button onClick={() => updateElementOrder('back')} className="p-1 hover:bg-gray-100 rounded text-gray-600 text-xs flex items-center" title="Send to Back"><SendToBack className="w-3.5 h-3.5 mr-1" /> Back</button>
                    <div className="w-px h-4 bg-gray-200 mx-2"></div>
                    <button onClick={(e) => deleteElement(e)} className="p-1 hover:bg-red-50 text-red-500 rounded text-xs flex items-center"><Trash2 className="w-3.5 h-3.5 mr-1" /> Delete</button>
                 </>
             ) : (
                 <>
                    <span className="text-[10px] font-bold text-gray-400 uppercase mr-2 tracking-wider">Slide Tools</span>
                    <div className="relative">
                        <button 
                            onClick={() => setBgColorPicker(!bgColorPicker)}
                            className="flex items-center px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 rounded border border-gray-200"
                        >
                            <PaintBucket className="w-3.5 h-3.5 mr-2 text-blue-500" />
                            Background
                        </button>
                        {bgColorPicker && (
                            <div className="absolute top-full left-0 mt-2 bg-white border border-gray-200 rounded shadow-lg p-2 z-50 grid grid-cols-5 gap-1 w-32">
                                {['#ffffff', '#f3f4f6', '#000000', '#1e293b', '#fee2e2', '#fef3c7', '#d1fae5', '#dbeafe', '#ede9fe', '#fce7f3'].map(c => (
                                    <button 
                                        key={c} 
                                        onClick={() => handleUpdateSlideBackground(c)}
                                        className="w-5 h-5 rounded-full border border-gray-300 hover:scale-110 transition-transform"
                                        style={{ backgroundColor: c }}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                 </>
             )}
          </div>

          {/* Canvas Scroll Area */}
          <div 
            className="flex-1 overflow-auto flex items-center justify-center bg-gray-200 relative custom-scrollbar"
            onClick={() => { setSelectedElementId(null); setBgColorPicker(false); }}
          >
              <div className="relative shadow-2xl transition-transform duration-200 ease-out origin-center" style={{ transform: `scale(${zoomLevel})` }}>
                  <div 
                    ref={canvasRef}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={handleDrop}
                    className="bg-white relative select-none overflow-hidden ring-1 ring-black/5"
                    style={{ 
                        width: CANVAS_WIDTH, 
                        height: CANVAS_HEIGHT,
                        backgroundColor: activeSlide.background && activeSlide.background.startsWith('#') ? activeSlide.background : 'white',
                        backgroundImage: activeSlide.background && !activeSlide.background.startsWith('#') ? `url(${activeSlide.background})` : 'none',
                        backgroundSize: 'contain',
                        backgroundRepeat: 'no-repeat',
                        backgroundPosition: 'center'
                    }}
                  >
                      {/* Grid System */}
                      {showGrid && (
                          <div className="absolute inset-0 pointer-events-none opacity-20 z-0" 
                               style={{ 
                                   backgroundImage: `linear-gradient(#e5e7eb 1px, transparent 1px), linear-gradient(90deg, #e5e7eb 1px, transparent 1px)`,
                                   backgroundSize: `${SNAP_GRID*2}px ${SNAP_GRID*2}px`
                               }} 
                          />
                      )}

                      {/* Empty State */}
                      {!activeSlide.background && activeSlide.elements.length === 0 && (
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-40">
                              <div className="text-center">
                                  <MousePointer2 className="w-10 h-10 text-gray-300 mx-auto mb-2" />
                                  <p className="text-sm text-gray-400">Drag items here or Import PPTX</p>
                              </div>
                          </div>
                      )}

                      {/* Elements Rendering */}
                      {activeSlide.elements.map(el => {
                          const widget = el.widgetId ? project.dashboard?.find(w => w.id === el.widgetId) : null;
                          const isSelected = selectedElementId === el.id;

                          return (
                              <div
                                id={`element-${el.id}`}
                                key={el.id}
                                onClick={(e) => handleElementClick(e, el.id)}
                                onMouseDown={(e) => startDrag(e, el.id)}
                                className={`absolute group cursor-move ${isSelected ? 'outline outline-2 outline-blue-500' : ''}`}
                                style={{ 
                                    left: el.x, 
                                    top: el.y, 
                                    width: el.w, 
                                    height: el.h,
                                    zIndex: el.zIndex || 10
                                }}
                              >
                                  {/* Content Container */}
                                  <div className="w-full h-full relative overflow-hidden">
                                        {el.type === 'widget' && widget && (
                                            <div className="w-full h-full bg-white border border-gray-100 p-2 flex flex-col shadow-sm">
                                                <h4 className="text-[10px] font-bold text-gray-600 mb-1 truncate font-sans uppercase tracking-wider">{widget.title}</h4>
                                                <div className="flex-1 min-h-0 pointer-events-none">
                                                    <WidgetRenderer widget={widget} data={finalData} />
                                                </div>
                                            </div>
                                        )}
                                        {el.type === 'text' && (
                                            <textarea 
                                                value={el.content}
                                                onChange={(e) => handleTextChange(el.id, e.target.value)}
                                                className="w-full h-full bg-transparent resize-none focus:outline-none p-1 cursor-text leading-tight"
                                                style={{ 
                                                    fontSize: el.style?.fontSize, 
                                                    color: el.style?.color,
                                                    fontWeight: el.style?.fontWeight,
                                                    fontStyle: el.style?.fontStyle,
                                                    textAlign: el.style?.textAlign,
                                                    fontFamily: el.style?.fontFamily
                                                }}
                                                onMouseDown={(e) => e.stopPropagation()} 
                                                placeholder="Type here..."
                                            />
                                        )}
                                        {el.type === 'image' && el.content && (
                                            <img src={el.content} className="w-full h-full object-contain pointer-events-none" alt="img" />
                                        )}
                                  </div>

                                  {/* Resize Handles (Only when selected) */}
                                  {isSelected && (
                                    <>
                                        <div onMouseDown={(e) => startResize(e, el.id, 'nw')} className="absolute -top-1.5 -left-1.5 w-3 h-3 bg-white border border-blue-500 cursor-nw-resize z-50 shadow-sm" />
                                        <div onMouseDown={(e) => startResize(e, el.id, 'ne')} className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-white border border-blue-500 cursor-ne-resize z-50 shadow-sm" />
                                        <div onMouseDown={(e) => startResize(e, el.id, 'sw')} className="absolute -bottom-1.5 -left-1.5 w-3 h-3 bg-white border border-blue-500 cursor-sw-resize z-50 shadow-sm" />
                                        <div onMouseDown={(e) => startResize(e, el.id, 'se')} className="absolute -bottom-1.5 -right-1.5 w-3 h-3 bg-white border border-blue-500 cursor-se-resize z-50 shadow-sm" />
                                    </>
                                  )}
                              </div>
                          );
                      })}
                  </div>
              </div>
          </div>
      </div>

      {/* Right Sidebar: Widget Palette */}
      <div className="w-56 bg-white border-l border-gray-200 flex flex-col z-20 shadow-lg flex-shrink-0">
           <div className="p-3 border-b border-gray-100 bg-gray-50">
              <h3 className="font-bold text-gray-700 text-xs uppercase tracking-wider flex items-center">
                  <Layers className="w-3.5 h-3.5 mr-2 text-blue-600" /> Insert
              </h3>
           </div>
           
           {/* Draggable Text */}
            <div 
              draggable
              onDragStart={(e) => {
                  e.dataTransfer.setData("type", "text");
              }}
              className="mx-3 mt-3 bg-white border border-gray-200 rounded-lg p-3 cursor-grab hover:shadow-sm hover:border-blue-400 flex items-center text-gray-600 hover:text-blue-600 transition-all group"
           >
               <Type className="w-4 h-4 mr-3 text-gray-400 group-hover:text-blue-500" />
               <span className="text-sm font-medium">Text Block</span>
           </div>

           <div className="px-3 py-2 text-[10px] font-bold text-gray-400 uppercase mt-4">Saved Charts</div>

           <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2 custom-scrollbar">
               {project.dashboard?.map(widget => (
                   <div 
                      key={widget.id}
                      draggable
                      onDragStart={(e) => {
                          e.dataTransfer.setData("widgetId", widget.id);
                          e.dataTransfer.setData("type", "widget");
                      }}
                      className="bg-white border border-gray-200 rounded-lg p-2 cursor-grab hover:shadow-md hover:border-blue-400 transition-all active:cursor-grabbing group"
                   >
                       <div className="flex items-center justify-between mb-2">
                           <span className="font-semibold text-[10px] text-gray-700 truncate pr-2" title={widget.title}>{widget.title}</span>
                       </div>
                       <div className="h-20 bg-gray-50 rounded border border-gray-100 flex items-center justify-center pointer-events-none overflow-hidden relative">
                           {/* Simple Icon Representation */}
                           {widget.type === 'bar' && <BarChart3 className="w-8 h-8 text-blue-200" />}
                           {widget.type === 'pie' && <PieChart className="w-8 h-8 text-green-200" />}
                           {widget.type === 'line' && <LineChart className="w-8 h-8 text-purple-200" />}
                           {widget.type === 'area' && <Activity className="w-8 h-8 text-purple-200" />}
                           {widget.type === 'table' && <Monitor className="w-8 h-8 text-gray-200" />}
                           {widget.type === 'kpi' && <span className="text-lg font-bold text-gray-300">123</span>}
                           {widget.type === 'wordcloud' && <span className="text-lg font-bold text-gray-300">Abc</span>}
                       </div>
                   </div>
               ))}
               {!project.dashboard?.length && (
                   <div className="text-center p-4 text-xs text-gray-400 italic">
                       No charts created yet. Go to Analytics to create some.
                   </div>
               )}
           </div>
      </div>

    </div>
  );
};

// --- Mini Widget Renderer ---
const WidgetRenderer: React.FC<{ widget: DashboardWidget, data: RawRow[] }> = ({ widget, data }) => {
    const { data: chartData, isStack, stackKeys } = useMemo(() => processDataForWidget(widget, data), [widget, data]);

    if (!chartData || chartData.length === 0) return <div className="flex items-center justify-center h-full text-xs text-gray-400">No Data</div>;

    if (widget.type === 'bar') {
        return (
             <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} layout="vertical" margin={{top:0, left:0, right:5, bottom:0}}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f3f4f6" />
                      <XAxis type="number" hide />
                      <YAxis dataKey="name" type="category" width={50} tick={{fontSize: 8}} interval={0} />
                      {isStack && stackKeys ? stackKeys.map((key, i) => (
                          <Bar key={key} dataKey={key} stackId="a" fill={getSentimentColor(key, i)} barSize={15} />
                      )) : (
                          <Bar dataKey="value" fill={widget.color || '#3B82F6'} barSize={15} />
                      )}
                  </BarChart>
             </ResponsiveContainer>
        );
    }
    if (widget.type === 'pie') {
        return (
            <ResponsiveContainer width="100%" height="100%">
                <RePieChart>
                    <Pie data={chartData} cx="50%" cy="50%" innerRadius={15} outerRadius={30} paddingAngle={2} dataKey="value">
                        {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                    </Pie>
                </RePieChart>
            </ResponsiveContainer>
        );
    }
    if (widget.type === 'line' || widget.type === 'area') {
        const ChartComp = widget.type === 'line' ? ReLineChart : ReAreaChart;
        const DataComp = widget.type === 'line' ? Line : Area;
        return (
            <ResponsiveContainer width="100%" height="100%">
                <ChartComp data={chartData} margin={{top:5, left:0, right:5, bottom:0}}>
                     <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                     <XAxis dataKey="name" tick={{fontSize: 8}} hide />
                     <YAxis tick={{fontSize: 8}} hide />
                     <DataComp type="monotone" dataKey="value" stroke="#3B82F6" fill="#3B82F6" fillOpacity={0.2} dot={false} strokeWidth={2} />
                </ChartComp>
            </ResponsiveContainer>
        );
    }
    if (widget.type === 'kpi') {
        const total = (chartData as any[]).reduce((acc: number, curr: any) => acc + (curr.value || 0), 0);
        return (
            <div className="flex flex-col items-center justify-center h-full pb-1">
                 <span className="text-xl font-bold text-blue-600">{total.toLocaleString()}</span>
            </div>
        );
    }
    if (widget.type === 'table') {
         return (
             <div className="w-full h-full overflow-hidden text-[8px]">
                 <table className="w-full text-left">
                     <thead className="bg-gray-50 text-gray-500">
                         <tr>
                             <th className="px-1 py-0.5 truncate">{widget.dimension}</th>
                             <th className="px-1 py-0.5 text-right">Val</th>
                         </tr>
                     </thead>
                     <tbody>
                         {chartData.slice(0,4).map((r: any, i: number) => (
                             <tr key={i} className="border-b border-gray-50">
                                 <td className="px-1 py-0.5 truncate">{r.name}</td>
                                 <td className="px-1 py-0.5 text-right">{r.value}</td>
                             </tr>
                         ))}
                     </tbody>
                 </table>
             </div>
         );
    }
    if (widget.type === 'wordcloud') {
         return (
             <div className="flex flex-wrap content-center justify-center h-full p-1 gap-1 overflow-hidden">
                 {chartData.slice(0, 5).map((item: any, i: number) => (
                     <span key={i} className="text-[9px] text-gray-500">{item.name}</span>
                 ))}
             </div>
         );
    }
    
    return <div className="flex items-center justify-center h-full text-[8px] text-gray-400">{widget.type}</div>;
};

export default ReportBuilder;
