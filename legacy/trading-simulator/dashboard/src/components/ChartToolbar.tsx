import MACHip from './MAChip';
import { MA_COLORS, INDICATOR_COLORS } from './chartUtils';

export type TechnicalIndicator = 'RSI' | 'STOCH' | 'MACD';
export type InstitutionalIndicator = 'VWAP' | 'OBV' | 'ADL' | 'MFI' | 'CMF' | 'VWMA' | 'LIQP' | 'INTENSITY';

export interface ChartToolbarProps {
  chartType: 'candlestick' | 'line';
  onChartTypeChange: (type: 'candlestick' | 'line') => void;
  timeRange: string;
  onTimeRangeChange: (range: string) => void;
  maPeriods: number[];
  maActive: boolean[];
  onMAToggle: (index: number) => void;
  onMAPeriodChange: (index: number, period: number) => void;
  technicalIndicator: TechnicalIndicator | null;
  onTechnicalIndicatorChange: (indicator: TechnicalIndicator | null) => void;
  institutionalIndicators: Record<InstitutionalIndicator, boolean>;
  onInstitutionalToggle: (indicator: InstitutionalIndicator) => void;
}

const TIME_RANGES = [
  { label: '1D', value: '5d' },
  { label: '1W', value: '1mo' },
  { label: '1M', value: '3mo' },
  { label: '3M', value: '6mo' },
  { label: '6M', value: '1y' },
  { label: '1Y', value: '2y' },
  { label: '5Y', value: '5y' },
];

const TECH_INDICATORS: TechnicalIndicator[] = ['RSI', 'STOCH', 'MACD'];
const INST_INDICATORS: InstitutionalIndicator[] = ['VWAP', 'OBV', 'ADL', 'MFI', 'CMF', 'VWMA', 'LIQP', 'INTENSITY'];

export default function ChartToolbar({
  chartType, onChartTypeChange,
  timeRange, onTimeRangeChange,
  maPeriods, maActive, onMAToggle, onMAPeriodChange,
  technicalIndicator, onTechnicalIndicatorChange,
  institutionalIndicators, onInstitutionalToggle,
}: ChartToolbarProps) {
  const sortedIndices = maPeriods
    .map((p, i) => ({ period: p, index: i }))
    .sort((a, b) => a.period - b.period)
    .map(item => item.index);

  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-1.5 bg-[#0a0a0a] border-b border-[#1c1c1c] text-[10px] font-mono">
      {/* Chart Type */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={() => onChartTypeChange('candlestick')}
          className={`px-2 py-0.5 border ${chartType === 'candlestick' ? 'bg-[#FF6600] text-black border-[#FF6600]' : 'bg-transparent text-[#666] border-[#333]'}`}
        >
          CANDLE
        </button>
        <button
          onClick={() => onChartTypeChange('line')}
          className={`px-2 py-0.5 border ${chartType === 'line' ? 'bg-[#FF6600] text-black border-[#FF6600]' : 'bg-transparent text-[#666] border-[#333]'}`}
        >
          LINE
        </button>
      </div>

      <div className="w-px h-4 bg-[#333]" />

      {/* MA Chips */}
      <div className="flex items-center gap-1">
        <span className="text-[#666] font-bold mr-1">MA</span>
        {sortedIndices.map((idx, colorIdx) => (
          <MACHip
            key={idx}
            period={maPeriods[idx]}
            color={MA_COLORS[colorIdx]}
            active={maActive[idx]}
            onToggle={() => onMAToggle(idx)}
            onPeriodChange={(p) => onMAPeriodChange(idx, p)}
          />
        ))}
      </div>

      <div className="w-px h-4 bg-[#333]" />

      {/* Time Range */}
      <div className="flex items-center gap-0.5">
        {TIME_RANGES.map(tr => (
          <button
            key={tr.value}
            onClick={() => onTimeRangeChange(tr.value)}
            className={`px-2 py-0.5 border ${timeRange === tr.value ? 'bg-[#FF6600] text-black border-[#FF6600]' : 'bg-transparent text-[#666] border-[#333]'}`}
          >
            {tr.label}
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-[#333]" />

      {/* Technical Indicators */}
      <div className="flex items-center gap-0.5">
        {TECH_INDICATORS.map(t => (
          <button
            key={t}
            onClick={() => onTechnicalIndicatorChange(technicalIndicator === t ? null : t)}
            className={`px-2 py-0.5 border ${technicalIndicator === t ? 'bg-[#FF6600] text-black border-[#FF6600]' : 'bg-transparent text-[#666] border-[#333]'}`}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="w-px h-4 bg-[#333]" />

      {/* Institutional Indicators */}
      <div className="flex items-center gap-0.5">
        {INST_INDICATORS.map(inst => (
          <button
            key={inst}
            onClick={() => onInstitutionalToggle(inst)}
            className="px-2 py-0.5 border"
            style={{
              borderColor: institutionalIndicators[inst] ? INDICATOR_COLORS[inst] : '#333',
              background: institutionalIndicators[inst] ? `${INDICATOR_COLORS[inst]}15` : 'transparent',
              color: institutionalIndicators[inst] ? INDICATOR_COLORS[inst] : '#666',
            }}
          >
            {inst}
          </button>
        ))}
      </div>
    </div>
  );
}
