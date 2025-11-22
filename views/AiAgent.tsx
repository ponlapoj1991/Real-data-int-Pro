
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Project, RawRow } from '../types';
import { 
    Bot, Download, Sparkles, ChevronRight,
    MessageSquare, PlayCircle,
    ArrowRight, CheckCircle2, X, Save, Loader2,
    Database, UploadCloud, Filter, Trash2
} from 'lucide-react';
import { saveProject } from '../utils/storage';
import { exportToExcel, parseExcelFile, inferColumns } from '../utils/excel';
import { processAiAgentAction, askAiAgent } from '../utils/ai';
import TableColumnFilter from '../components/TableColumnFilter';

interface AiAgentProps {
  project: Project;
  onUpdateProject: (p: Project) => void;
}

// Types for Virtual Scroll
const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 40; 
const BUFFER_ROWS = 10;

interface SelectionRange {
    startRow: number;
    startCol: string;
    endRow: number;
    endCol: string;
}

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
    type?: 'text' | 'action_result';
}

// Extended row with original index for tracking
interface IndexedRow extends RawRow {
    _originalIndex: number;
}

type DataSourceMode = 'project' | 'upload';

const AiAgent: React.FC<AiAgentProps> = ({ project, onUpdateProject }) => {
  // --- Data State ---
  const [sourceMode, setSourceMode] = useState<DataSourceMode>('project');
  const [gridData, setGridData] = useState<RawRow[]>([]); // The Source of Truth
  const [columns, setColumns] = useState<string[]>([]);
  
  // --- Filtering State ---
  // Map: Column Key -> Array of allowed values (null means all allowed)
  const [filters, setFilters] = useState<Record<string, string[] | null>>({});
  const [openFilterCol, setOpenFilterCol] = useState<string | null>(null);

  // --- UI State ---
  const [isChatOpen, setIsChatOpen] = useState(true);
  const [chatMode, setChatMode] = useState<'ask' | 'action'>('ask');
  const [messages, setMessages] = useState<ChatMessage[]>([{
      id: 'welcome',
      role: 'assistant',
      content: 'สวัสดีครับ ผมคือ AI Agent ของคุณ สามารถเลือก "Data Source" ด้านบนเพื่อวิเคราะห์ข้อมูลจาก Project หรืออัปโหลดไฟล์ใหม่ได้เลยครับ',
      timestamp: Date.now()
  }]);
  const [userInput, setUserInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  // --- Selection State ---
  const [selection, setSelection] = useState<SelectionRange | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectionStart, setSelectionStart] = useState<{row: number, col: string} | null>(null);

  const [targetCol, setTargetCol] = useState<string | null>(null);
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [pendingActionPrompt, setPendingActionPrompt] = useState<string | null>(null);

  // --- Virtual Scroll State ---
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // --- Initialization ---
  useEffect(() => {
      // When project changes or mode switches to project, load project data
      if (sourceMode === 'project') {
          setGridData(project.data);
          if (project.columns.length > 0) {
              setColumns(project.columns.map(c => c.key));
          } else if (project.data.length > 0) {
              setColumns(Object.keys(project.data[0]));
          } else {
              setColumns([]);
          }
          setFilters({}); // Reset filters on source change
          setSelection(null);
      }
  }, [project, sourceMode]);

  // --- Computed Data (Filtered) ---
  const displayData = useMemo(() => {
      // 1. Attach original index
      const indexed = gridData.map((row, idx) => ({ ...row, _originalIndex: idx } as IndexedRow));

      // 2. Apply Filters
      return indexed.filter(row => {
          return Object.keys(filters).every(key => {
              const allowed = filters[key];
              if (!allowed) return true; // No filter on this col
              
              const val = row[key];
              const strVal = val === null || val === undefined ? '(Blank)' : String(val);
              return allowed.includes(strVal);
          });
      });
  }, [gridData, filters]);

  // --- Upload Handler ---
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsUploading(true);
      try {
          const newData = await parseExcelFile(file);
          if (newData.length > 0) {
              setGridData(newData);
              const newCols = inferColumns(newData[0]).map(c => c.key);
              setColumns(newCols);
              setFilters({});
              setSelection(null);
              setMessages(prev => [...prev, {
                  id: `sys-${Date.now()}`,
                  role: 'assistant',
                  content: `Uploaded "${file.name}" with ${newData.length} rows. Ready to analyze!`,
                  timestamp: Date.now()
              }]);
          }
      } catch (err) {
          alert("Failed to upload file");
      } finally {
          setIsUploading(false);
          // Clear input
          e.target.value = '';
      }
  };

  // --- Resize Handler ---
  useEffect(() => {
      const handleResize = () => {
          if (scrollContainerRef.current) {
              setContainerHeight(scrollContainerRef.current.clientHeight);
          }
      };
      window.addEventListener('resize', handleResize);
      handleResize();
      return () => window.removeEventListener('resize', handleResize);
  }, []);

  // --- Drag End Handler ---
  useEffect(() => {
      const handleGlobalMouseUp = () => {
          setIsDragging(false);
      };
      window.addEventListener('mouseup', handleGlobalMouseUp);
      return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  // --- Virtual Calculation ---
  const totalRows = displayData.length;
  const totalHeight = totalRows * ROW_HEIGHT + HEADER_HEIGHT;
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
  const endIndex = Math.min(totalRows, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + BUFFER_ROWS);
  
  const visibleRows = useMemo(() => {
      return displayData.slice(startIndex, endIndex).map((row, index) => ({
          ...row,
          _visualIndex: startIndex + index
      }));
  }, [displayData, startIndex, endIndex]);

  // --- Helper Functions ---
  const safeRender = (val: any) => {
      if (typeof val === 'object' && val !== null) return JSON.stringify(val);
      if (val === null || val === undefined) return '';
      return String(val);
  };

  const getColIndex = (col: string) => columns.indexOf(col);
  
  const isSelected = (rowVisualIdx: number, col: string) => {
      if (!selection) return false;
      const cIdx = getColIndex(col);
      const startC = getColIndex(selection.startCol);
      const endC = getColIndex(selection.endCol);
      
      const minR = Math.min(selection.startRow, selection.endRow);
      const maxR = Math.max(selection.startRow, selection.endRow);
      const minC = Math.min(startC, endC);
      const maxC = Math.max(startC, endC);

      return rowVisualIdx >= minR && rowVisualIdx <= maxR && cIdx >= minC && cIdx <= maxC;
  };

  // --- Selection Logic (Visual Index Based) ---
  const handleMouseDown = (rowVisualIdx: number, col: string, e: React.MouseEvent) => {
      e.preventDefault(); // Prevent text select
      setIsDragging(true);
      setSelectionStart({ row: rowVisualIdx, col });
      
      if (e.shiftKey && selection) {
          setSelection({ ...selection, endRow: rowVisualIdx, endCol: col });
      } else {
          setSelection({ startRow: rowVisualIdx, startCol: col, endRow: rowVisualIdx, endCol: col });
      }
  };

  const handleMouseEnter = (rowVisualIdx: number, col: string) => {
      if (isDragging && selectionStart) {
          setSelection({
              startRow: selectionStart.row,
              startCol: selectionStart.col,
              endRow: rowVisualIdx,
              endCol: col
          });
      }
  };

  // --- AI Logic ---
  const getSelectedData = () => {
      if (!selection) return [];
      const minR = Math.min(selection.startRow, selection.endRow);
      const maxR = Math.max(selection.startRow, selection.endRow);
      
      // Get the actual data rows from displayData (Filtered view)
      const dataRange = displayData.slice(minR, maxR + 1);
      
      if (selection.startCol === selection.endCol) {
          return dataRange.map(row => String(row[selection.startCol] || ''));
      }
      
      return dataRange.map(row => {
          const startC = getColIndex(selection.startCol);
          const endC = getColIndex(selection.endCol);
          const minC = Math.min(startC, endC);
          const maxC = Math.max(startC, endC);
          
          const rowVals = [];
          for (let i = minC; i <= maxC; i++) {
              rowVals.push(row[columns[i]]);
          }
          return rowVals.join(" ");
      });
  };

  const handleSendMessage = async (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!userInput.trim()) return;

      const currentInput = userInput;
      setUserInput('');
      
      setMessages(prev => [...prev, {
          id: `u-${Date.now()}`,
          role: 'user',
          content: currentInput,
          timestamp: Date.now()
      }]);

      if (!selection) {
          setMessages(prev => [...prev, {
              id: `sys-${Date.now()}`,
              role: 'assistant',
              content: 'Please select data in the grid first (Drag cells).',
              timestamp: Date.now()
          }]);
          return;
      }

      const contextData = getSelectedData();

      if (chatMode === 'ask') {
          setIsProcessing(true);
          const answer = await askAiAgent(contextData, currentInput, project.aiSettings);
          setIsProcessing(false);
          setMessages(prev => [...prev, {
              id: `a-${Date.now()}`,
              role: 'assistant',
              content: answer,
              timestamp: Date.now()
          }]);
      } else {
          // Action Mode
          setPendingActionPrompt(currentInput);
          setTargetCol(null);
          setShowTargetModal(true);
      }
  };

  const executeAction = async () => {
      if (!targetCol || !pendingActionPrompt || !selection) return;
      
      setShowTargetModal(false);
      setIsProcessing(true);

      const selectedCount = getSelectedData().length;
      const thinkingId = `t-${Date.now()}`;
      setMessages(prev => [...prev, {
          id: thinkingId,
          role: 'assistant',
          content: `Processing ${selectedCount} rows (Filtered View)...`,
          timestamp: Date.now()
      }]);

      try {
          const sourceData = getSelectedData();
          const results = await processAiAgentAction(sourceData, pendingActionPrompt, project.aiSettings);
          
          // Update Grid Data - MAPPING BACK TO ORIGINAL INDEX
          const minR = Math.min(selection.startRow, selection.endRow);
          
          const newGridData = [...gridData];
          let newColumns = [...columns];
          let isNewCol = false;
          
          if (!columns.includes(targetCol)) {
              newColumns.push(targetCol);
              setColumns(newColumns);
              isNewCol = true;
          }
          
          let updateCount = 0;
          
          // Iterate through results and map to displayData's original indices
          for (let i = 0; i < results.length; i++) {
              const visualIdx = minR + i;
              // Safely access the row in displayData
              const targetRow = displayData[visualIdx];
              
              if (targetRow) {
                  const originalIdx = targetRow._originalIndex;
                  
                  newGridData[originalIdx] = {
                      ...newGridData[originalIdx],
                      [targetCol]: results[i]
                  };
                  updateCount++;
              }
          }
          
          setGridData(newGridData);

          // If in project mode and new column, allow saving structure
          if (sourceMode === 'project' && isNewCol) {
              // Note: Actual project save happens on "Save" button, 
              // but we keep local state updated for UI consistency
          }

          setMessages(prev => prev.map(m => m.id === thinkingId ? {
              ...m,
              content: `Complete! Updated ${updateCount} rows in column "${targetCol}". (Hidden rows were skipped)`,
              type: 'action_result'
          } : m));

      } catch (err) {
          setMessages(prev => prev.map(m => m.id === thinkingId ? {
              ...m,
              content: `Error: ${(err as Error).message}`
          } : m));
      } finally {
          setIsProcessing(false);
          setPendingActionPrompt(null);
      }
  };

  const handleSaveProject = async () => {
      if (sourceMode === 'upload') {
          // If in upload mode, we might want to merge or replace. 
          // For simplicity in this prompt, we just alert or maybe append?
          // Let's strictly stick to "Modify the app" request.
          if(window.confirm("Merge these uploaded rows into the main Project?")) {
              const updatedData = [...project.data, ...gridData];
              // Infer new cols
              let updatedCols = project.columns;
              columns.forEach(c => {
                  if(!updatedCols.find(xc => xc.key === c)) {
                      updatedCols.push({ key: c, type: 'string', visible: true });
                  }
              });
              const updated = { ...project, data: updatedData, columns: updatedCols };
              onUpdateProject(updated);
              await saveProject(updated);
              setSourceMode('project'); // Switch back
          }
      } else {
          // Save updates to existing project
          const updated = { ...project, data: gridData };
          // Update columns config if new cols added
          let updatedCols = project.columns;
          columns.forEach(c => {
              if(!updatedCols.find(xc => xc.key === c)) {
                  updatedCols.push({ key: c, type: 'string', visible: true, label: c });
              }
          });
          updated.columns = updatedCols;
          
          onUpdateProject(updated);
          await saveProject(updated);
          alert("Project saved successfully!");
      }
  };

  return (
    <div className="flex h-full bg-gray-50 overflow-hidden font-sans">
        
        {/* LEFT: Spreadsheet Area */}
        <div className="flex-1 flex flex-col min-w-0">
            
            {/* Top Bar: Source & Actions */}
            <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shadow-sm z-20">
                
                {/* Data Source Toggle */}
                <div className="flex items-center space-x-3">
                    <div className="font-bold text-gray-700 flex items-center mr-2">
                        <Bot className="w-5 h-5 mr-2 text-indigo-600" /> AI Agent
                    </div>
                    <div className="bg-gray-100 p-1 rounded-lg flex">
                        <button
                            onClick={() => setSourceMode('project')}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center ${sourceMode === 'project' ? 'bg-white shadow text-indigo-600' : 'text-gray-500 hover:text-gray-900'}`}
                        >
                            <Database className="w-3.5 h-3.5 mr-1.5" /> Project Data
                        </button>
                        <button
                            onClick={() => setSourceMode('upload')}
                            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all flex items-center ${sourceMode === 'upload' ? 'bg-white shadow text-indigo-600' : 'text-gray-500 hover:text-gray-900'}`}
                        >
                            <UploadCloud className="w-3.5 h-3.5 mr-1.5" /> External File
                        </button>
                    </div>
                </div>

                {/* File Upload Input (Only for Upload Mode) */}
                {sourceMode === 'upload' && (
                    <div className="flex-1 mx-4">
                        <label className="flex items-center cursor-pointer bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-4 py-1.5 rounded-lg text-xs font-medium transition-colors w-fit">
                            <UploadCloud className="w-3.5 h-3.5 mr-2" />
                            {isUploading ? 'Uploading...' : 'Choose Excel/CSV'}
                            <input type="file" className="hidden" accept=".xlsx,.xls,.csv" onChange={handleFileUpload} disabled={isUploading} />
                        </label>
                    </div>
                )}
                
                {/* Action Buttons */}
                <div className="flex items-center space-x-2">
                    <span className="text-xs text-gray-400 mr-2 hidden md:inline">
                        {selection 
                            ? `Selected: ${Math.abs(selection.endRow - selection.startRow) + 1} rows` 
                            : 'Select rows to start'}
                    </span>
                    <button onClick={handleSaveProject} className="flex items-center px-3 py-1.5 bg-white border border-gray-300 text-gray-700 hover:bg-gray-50 rounded-lg text-xs font-medium shadow-sm transition-colors">
                        <Save className="w-3.5 h-3.5 mr-2" /> {sourceMode === 'upload' ? 'Merge to Project' : 'Save'}
                    </button>
                    <button onClick={() => exportToExcel(displayData, `AiAgent_Export`)} className="flex items-center px-3 py-1.5 bg-green-600 text-white hover:bg-green-700 rounded-lg text-xs font-medium shadow-sm transition-colors">
                        <Download className="w-3.5 h-3.5 mr-2" /> Export
                    </button>
                    <button 
                        onClick={() => setIsChatOpen(!isChatOpen)}
                        className={`p-2 rounded-lg border ml-2 transition-all ${isChatOpen ? 'bg-indigo-50 border-indigo-200 text-indigo-600' : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'}`}
                    >
                        {isChatOpen ? <ChevronRight className="w-4 h-4" /> : <MessageSquare className="w-4 h-4" />}
                    </button>
                </div>
            </div>

            {/* Info Bar for Filters */}
            {Object.values(filters).some(v => v !== null) && (
                 <div className="bg-yellow-50 px-4 py-1 border-b border-yellow-100 text-[10px] text-yellow-800 flex justify-between items-center">
                     <span>Active Filters Applied. AI Actions will only affect visible rows.</span>
                     <button onClick={() => setFilters({})} className="flex items-center hover:underline"><Trash2 className="w-3 h-3 mr-1"/> Clear All</button>
                 </div>
            )}

            {/* Grid Container (Virtualized) */}
            <div 
                className="flex-1 overflow-auto bg-gray-100 relative select-none" 
                ref={scrollContainerRef}
                onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
                onClick={() => setOpenFilterCol(null)} // Close filter on grid click
            >
                {/* Scroll Phantom Div */}
                <div style={{ height: totalHeight, position: 'relative' }}>
                    
                    {/* Sticky Header */}
                    <div 
                        className="sticky top-0 z-20 flex bg-gray-100 border-b border-gray-300 shadow-sm"
                        style={{ height: HEADER_HEIGHT }}
                    >
                        <div className="w-10 flex-shrink-0 bg-gray-200 border-r border-gray-300 flex items-center justify-center font-bold text-xs text-gray-500 h-full">
                            #
                        </div>
                        {columns.map((col) => {
                            const hasFilter = filters[col] !== undefined && filters[col] !== null;
                            return (
                                <div 
                                    key={col} 
                                    className="w-40 flex-shrink-0 bg-gray-50 border-r border-gray-300 px-2 flex items-center justify-between text-xs font-bold text-gray-700 h-full group relative"
                                >
                                    <span 
                                        className="truncate cursor-pointer flex-1"
                                        onClick={() => setSelection({ startRow: 0, startCol: col, endRow: totalRows - 1, endCol: col })}
                                        title={col}
                                    >
                                        {col}
                                    </span>
                                    
                                    {/* Filter Button */}
                                    <button 
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setOpenFilterCol(openFilterCol === col ? null : col);
                                        }}
                                        className={`p-1 rounded hover:bg-gray-200 transition-colors ${hasFilter ? 'text-blue-600 bg-blue-50' : 'text-gray-400 opacity-0 group-hover:opacity-100'}`}
                                    >
                                        <Filter className="w-3 h-3" />
                                    </button>

                                    {/* Filter Dropdown Component */}
                                    {openFilterCol === col && (
                                        <TableColumnFilter 
                                            column={col}
                                            data={gridData} 
                                            activeFilters={filters[col] || null}
                                            onApply={(vals) => setFilters({ ...filters, [col]: vals })}
                                            onClose={() => setOpenFilterCol(null)}
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Rendered Rows */}
                    {visibleRows.length === 0 ? (
                        <div className="absolute top-12 left-0 w-full text-center text-gray-400 text-sm">
                            {gridData.length === 0 ? "No data loaded." : "No records match your filters."}
                        </div>
                    ) : (
                        visibleRows.map((row) => {
                            const rowVisualIdx = row._visualIndex;
                            const top = rowVisualIdx * ROW_HEIGHT + HEADER_HEIGHT;
                            
                            return (
                                <div 
                                    key={row._originalIndex} // Use original index for key stability
                                    className="absolute left-0 right-0 flex border-b border-gray-200 bg-white hover:bg-gray-50"
                                    style={{ top, height: ROW_HEIGHT }}
                                >
                                    {/* Row Number */}
                                    <div className="w-10 flex-shrink-0 bg-gray-50 border-r border-gray-200 flex items-center justify-center text-[10px] text-gray-400 font-mono select-none">
                                        {rowVisualIdx + 1}
                                    </div>
                                    {/* Cells */}
                                    {columns.map((col) => {
                                        const selected = isSelected(rowVisualIdx, col);
                                        return (
                                            <div 
                                                key={`${row._originalIndex}-${col}`}
                                                onMouseDown={(e) => handleMouseDown(rowVisualIdx, col, e)}
                                                onMouseEnter={() => handleMouseEnter(rowVisualIdx, col)}
                                                className={`w-40 flex-shrink-0 border-r border-gray-100 px-2 flex items-center text-xs text-gray-700 truncate cursor-default border-b-0 h-full
                                                    ${selected ? 'bg-blue-100 ring-1 ring-inset ring-blue-500 z-10' : ''}`}
                                                title={safeRender(row[col])}
                                            >
                                                {safeRender(row[col])}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>
        </div>

        {/* RIGHT: AI Side Panel */}
        {isChatOpen && (
            <div className="w-96 bg-white border-l border-gray-200 flex flex-col shadow-xl z-30 transition-all duration-300">
                {/* Chat Header */}
                <div className="p-4 border-b border-gray-100 bg-gray-50">
                    <h3 className="font-bold text-gray-800 flex items-center">
                        <Sparkles className="w-4 h-4 mr-2 text-indigo-500" />
                        AI Assistant
                    </h3>
                    <div className="flex bg-gray-200 p-1 rounded-lg mt-3">
                        <button 
                            onClick={() => setChatMode('ask')}
                            className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${chatMode === 'ask' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Ask Data
                        </button>
                        <button 
                            onClick={() => setChatMode('action')}
                            className={`flex-1 py-1 text-xs font-medium rounded-md transition-all ${chatMode === 'action' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                        >
                            Take Action
                        </button>
                    </div>
                </div>

                {/* Chat History */}
                <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50/30">
                    {messages.map((msg) => (
                        <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                                msg.role === 'user' 
                                    ? 'bg-indigo-600 text-white rounded-br-none' 
                                    : 'bg-white border border-gray-100 text-gray-700 rounded-bl-none'
                            }`}>
                                {msg.type === 'action_result' ? (
                                    <div className="flex items-center text-green-700 font-medium">
                                        <CheckCircle2 className="w-4 h-4 mr-2" /> {msg.content}
                                    </div>
                                ) : (
                                    msg.content
                                )}
                            </div>
                        </div>
                    ))}
                    {isProcessing && (
                         <div className="flex justify-start">
                             <div className="bg-white border border-gray-100 rounded-2xl rounded-bl-none px-4 py-3 shadow-sm flex items-center space-x-2">
                                 <Loader2 className="w-4 h-4 animate-spin text-indigo-500" />
                                 <span className="text-xs text-gray-500">AI is thinking...</span>
                             </div>
                         </div>
                    )}
                </div>

                {/* Chat Input */}
                <div className="p-4 bg-white border-t border-gray-100">
                    <form onSubmit={handleSendMessage} className="relative">
                        <input
                            type="text"
                            value={userInput}
                            onChange={(e) => setUserInput(e.target.value)}
                            placeholder={chatMode === 'ask' ? "Ask about selected data..." : "e.g., 'Classify Sentiment', 'Clean Format'"}
                            className="w-full pl-4 pr-12 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none text-sm transition-all"
                            disabled={isProcessing}
                        />
                        <button 
                            type="submit"
                            disabled={!userInput.trim() || isProcessing}
                            className="absolute right-2 top-2 p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
                        >
                            <ArrowRight className="w-4 h-4" />
                        </button>
                    </form>
                    <p className="text-[10px] text-gray-400 mt-2 text-center">
                        {chatMode === 'ask' ? 'Select cells to analyze context.' : 'Select cells -> Type command -> Choose target column.'}
                    </p>
                </div>
            </div>
        )}

        {/* Modal: Target Column Selection (Action Mode) */}
        {showTargetModal && (
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
                <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-gray-100 flex justify-between items-center bg-indigo-50">
                        <h3 className="font-bold text-gray-800 flex items-center">
                            <PlayCircle className="w-4 h-4 mr-2 text-indigo-600" /> Target Column
                        </h3>
                        <button onClick={() => setShowTargetModal(false)} className="text-gray-400 hover:text-gray-600">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                    <div className="p-5">
                        <p className="text-sm text-gray-600 mb-4">
                            AI will process <strong>{getSelectedData().length} visible rows</strong>.<br/>
                            Hidden/Filtered rows will be ignored.
                            <br/><br/>
                            Command: <span className="font-medium text-indigo-600">"{pendingActionPrompt}"</span>
                        </p>
                        
                        <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Write results to:</label>
                        <div className="space-y-3">
                             <select 
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                onChange={(e) => setTargetCol(e.target.value)}
                                value={targetCol || ''}
                             >
                                 <option value="">-- Select Existing Column --</option>
                                 {columns.map(c => <option key={c} value={c}>{c}</option>)}
                             </select>
                             
                             <input 
                                type="text" 
                                placeholder="Or create New Column..."
                                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                                onChange={(e) => setTargetCol(e.target.value)}
                             />
                        </div>
                    </div>
                    <div className="p-4 bg-gray-50 flex justify-end space-x-3">
                        <button onClick={() => setShowTargetModal(false)} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg text-sm font-medium">Cancel</button>
                        <button 
                            onClick={executeAction}
                            disabled={!targetCol}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 shadow-sm"
                        >
                            Execute AI
                        </button>
                    </div>
                </div>
            </div>
        )}

    </div>
  );
};

export default AiAgent;
