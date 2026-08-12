import { useState, useRef, useEffect } from 'react';

export interface MACHipProps {
  period: number;
  color: string;
  active: boolean;
  onToggle: () => void;
  onPeriodChange: (newPeriod: number) => void;
}

export default function MACHip({ period, color, active, onToggle, onPeriodChange }: MACHipProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState(String(period));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleDoubleClick = () => {
    setEditing(true);
    setInputValue(String(period));
  };

  const handleSubmit = () => {
    const val = parseInt(inputValue, 10);
    if (!isNaN(val) && val >= 2 && val <= 500) {
      onPeriodChange(val);
    } else {
      setInputValue(String(period));
    }
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
    if (e.key === 'Escape') {
      setInputValue(String(period));
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        type="number"
        min={2}
        max={500}
        value={inputValue}
        onChange={(e) => setInputValue(e.target.value)}
        onBlur={handleSubmit}
        onKeyDown={handleKeyDown}
        className="w-12 px-1 py-0.5 text-[10px] font-mono bg-[#111] border text-white outline-none"
        style={{ borderColor: color }}
      />
    );
  }

  return (
    <button
      onClick={onToggle}
      onDoubleClick={handleDoubleClick}
      className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono font-bold border transition-colors"
      style={{
        borderColor: active ? color : '#333',
        background: active ? `${color}15` : 'transparent',
        color: active ? color : '#666',
      }}
      title={`MA-${period} — click to toggle, double-click to edit`}
    >
      <span
        className="w-1.5 h-1.5 rounded-full"
        style={{ background: active ? color : '#333' }}
      />
      {period}
    </button>
  );
}
