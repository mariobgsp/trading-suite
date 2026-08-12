/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import BacktestCard from './BacktestCard';

describe('BacktestCard', () => {
  it('renders loading state initially', () => {
    render(<BacktestCard emiten="BBCA.JK" />);
    expect(screen.getByText(/running 5-year backtest/i)).toBeTruthy();
  });
});
