
import React, { useState, useEffect } from 'react';
import { X, BarChart3, PieChart, LineChart, Hash, Activity, Save, Table, Cloud, Layers } from 'lucide-react';
import { ChartType, DashboardWidget, AggregateMethod } from '../types';

interface ChartBuilderProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (widget: DashboardWidget) => void;
  availableColumns: string[];
  initialWidget?: DashboardWidget | null;
}

// Robust ID generator
const generateId = () => {
  return 'widget-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 9);
};

const ChartBuilder: React.FC<ChartBuilderProps> = ({ 
  isOpen, 
  onClose, 
  onSave, 
  availableColumns, 
  initialWidget 
}) => {
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ChartType>('bar');
  const [dimension, setDimension] = useState('');
  const [stackBy, setStackBy] = useState(''); // New State
  const [measure, setMeasure] = useState<AggregateMethod>('count');
  const [measureCol, setMeasureCol] = useState('');
  const [limit, setLimit] = useState<number | undefined>(undefined);
  const [width, setWidth] = useState<'half' | 'full'>('half');

  useEffect(() => {
    if (isOpen) {
        if (initialWidget) {
            setTitle(initialWidget.title);
            setType(initialWidget.type);
            setDimension(initialWidget.dimension);
            setStackBy(initialWidget.stackBy || '');
            setMeasure(initialWidget.measure);
            setMeasureCol(initialWidget.measureCol || '');
            setLimit(initialWidget.limit);
            setWidth(initialWidget.width);
        } else {
            // Reset for new
            setTitle('');
            setType('bar');
            setDimension(availableColumns[0] || '');
            setStackBy('');
            setMeasure('count');
            setMeasureCol('');
            setLimit(undefined);
            setWidth('half');
        }
    }
  }, [isOpen, initialWidget, availableColumns]);

  if (!isOpen) return null;

  const handleSave = () => {
    if (!title || !dimension) return;
    
    const newWidget: DashboardWidget = {
        id: initialWidget?.id || generateId(),
        title,
        type,
        dimension,
        stackBy: (type === 'bar' && stackBy) ? stackBy : undefined,
        measure,
        measureCol: measure === 'count' ? undefined : measureCol,
        limit,
        width
    };
    onSave(newWidget);
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[70] flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
          <h3 className="font-bold text-lg text-gray-800">
            {initialWidget ? 'Edit Chart' : 'Add New Chart'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-6">
            
            {/* 1. Basic Info */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Widget Title</label>
                <input 
                    value={title}
                    onChange={e => setTitle(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="e.g. Sentiment by Channel"
                    autoFocus
                />
            </div>

            {/* 2. Chart Type */}
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Visualization Type</label>
                <div className="grid grid-cols-7 gap-2">
                    {[
                        { id: 'bar', icon: BarChart3, label: 'Bar' },
                        { id: 'pie', icon: PieChart, label: 'Pie' },
                        { id: 'line', icon: LineChart, label: 'Line' },
                        { id: 'area', icon: Activity, label: 'Area' },
                        { id: 'kpi', icon: Hash, label: 'KPI' },
                        { id: 'wordcloud', icon: Cloud, label: 'Cloud' },
                        { id: 'table', icon: Table, label: 'Table' },
                    ].map(item => (
                        <button
                            key={item.id}
                            onClick={() => setType(item.id as ChartType)}
                            className={`flex flex-col items-center justify-center p-2 rounded-lg border transition-all ${type === item.id ? 'bg-blue-50 border-blue-500 text-blue-700 ring-1 ring-blue-500' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}
                        >
                            <item.icon className="w-5 h-5 mb-1" />
                            <span className="text-[10px] font-medium">{item.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* 3. Data Configuration */}
            <div className="grid grid-cols-2 gap-6">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                        {type === 'kpi' ? 'KPI Category (Optional)' : type === 'wordcloud' ? 'Text Source Column' : type === 'table' ? 'Primary Info Column' : 'X-Axis (Dimension)'}
                    </label>
                    <select 
                        value={dimension}
                        onChange={e => setDimension(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                    >
                        <option value="">Select Column...</option>
                        {availableColumns.map(col => (
                            <option key={col} value={col}>{col}</option>
                        ))}
                    </select>
                    <p className="text-[10px] text-gray-400 mt-1">The main data field to visualize.</p>
                </div>

                {/* Stack By Option (Only for Bar Chart) */}
                {type === 'bar' && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1 flex items-center">
                            <Layers className="w-3 h-3 mr-1" /> Stack By (Optional)
                        </label>
                        <select 
                            value={stackBy}
                            onChange={e => setStackBy(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                        >
                            <option value="">None (Simple Bar)</option>
                            {availableColumns.map(col => (
                                <option key={col} value={col}>{col}</option>
                            ))}
                        </select>
                        <p className="text-[10px] text-gray-400 mt-1">Breakdown bars by another category (e.g. Sentiment).</p>
                    </div>
                )}

                {type !== 'wordcloud' && type !== 'bar' && (
                   <div className="hidden md:block"></div>
                )}


                {type !== 'wordcloud' && (
                <div className="col-span-2 md:col-span-2 grid grid-cols-2 gap-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                             {type === 'kpi' ? 'KPI Value' : type === 'table' ? 'Sort By Column' : 'Y-Axis (Metric)'}
                        </label>
                        <div className="flex space-x-2">
                            {type !== 'table' && (
                            <select 
                                value={measure}
                                onChange={e => setMeasure(e.target.value as AggregateMethod)}
                                className="w-1/2 px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                            >
                                <option value="count">Count Rows</option>
                                <option value="sum">Sum Value</option>
                                <option value="avg">Average</option>
                            </select>
                            )}
                            
                            {(measure !== 'count' || type === 'table') && (
                                <select 
                                    value={measureCol}
                                    onChange={e => setMeasureCol(e.target.value)}
                                    className={`${type === 'table' ? 'w-full' : 'w-1/2'} px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white`}
                                >
                                    <option value="">Select Column...</option>
                                    {availableColumns.map(col => (
                                        <option key={col} value={col}>{col}</option>
                                    ))}
                                </select>
                            )}
                        </div>
                    </div>
                </div>
                )}

                {/* Limit Option for Table/Cloud */}
                {(type === 'table' || type === 'wordcloud' || type === 'bar') && (
                    <div className="col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Limit Items</label>
                        <select 
                            value={limit || ''}
                            onChange={e => setLimit(e.target.value ? parseInt(e.target.value) : undefined)}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                        >
                            <option value="">Default (20)</option>
                            <option value="5">Top 5</option>
                            <option value="10">Top 10</option>
                            <option value="50">Top 50</option>
                            <option value="100">Top 100</option>
                        </select>
                    </div>
                )}
            </div>

            {/* 4. Layout */}
             <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Card Size</label>
                <div className="flex space-x-4">
                     <label className={`flex-1 border rounded-lg p-3 cursor-pointer flex items-center justify-center space-x-2 ${width === 'half' ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500' : 'bg-white'}`}>
                        <input type="radio" name="width" value="half" checked={width === 'half'} onChange={() => setWidth('half')} className="hidden" />
                        <div className="w-6 h-4 bg-gray-300 rounded-sm"></div>
                        <div className="w-6 h-4 border border-dashed border-gray-300 rounded-sm"></div>
                        <span className="text-sm font-medium">Half Width</span>
                     </label>
                     <label className={`flex-1 border rounded-lg p-3 cursor-pointer flex items-center justify-center space-x-2 ${width === 'full' ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500' : 'bg-white'}`}>
                        <input type="radio" name="width" value="full" checked={width === 'full'} onChange={() => setWidth('full')} className="hidden" />
                        <div className="w-full h-4 bg-gray-300 rounded-sm"></div>
                        <span className="text-sm font-medium">Full Width</span>
                     </label>
                </div>
             </div>

        </div>

        {/* Footer */}
        <div className="p-6 border-t border-gray-100 bg-gray-50 flex justify-end space-x-3">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg font-medium transition-colors">
            Cancel
          </button>
          <button 
            onClick={handleSave}
            disabled={!title || !dimension || (measure !== 'count' && !measureCol && type !== 'table' && type !== 'wordcloud')}
            className="flex items-center px-6 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="w-4 h-4 mr-2" />
            Save Widget
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChartBuilder;
