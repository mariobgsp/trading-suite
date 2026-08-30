import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fmtIdr, fmtNum, fmtPct } from "./format.ts";

describe("fmtIdr", () => {
  it("returns — for null/undefined/NaN", () => {
    assert.equal(fmtIdr(null), "—");
    assert.equal(fmtIdr(undefined), "—");
    assert.equal(fmtIdr(NaN), "—");
  });
  it("formats plain IDR with id-ID grouping", () => {
    assert.equal(fmtIdr(0), "Rp 0");
    assert.equal(fmtIdr(1000), "Rp 1.000");
    assert.equal(fmtIdr(1_250_000), "Rp 1.250.000");
  });
  it("handles negative", () => {
    assert.equal(fmtIdr(-5000), "Rp -5.000");
  });
  it("rounds to nearest integer", () => {
    assert.equal(fmtIdr(999.6), "Rp 1.000");
    assert.equal(fmtIdr(1234.4), "Rp 1.234");
  });
  it("compact: T (>1e12)", () => {
    assert.equal(fmtIdr(1_500_000_000_000, true), "Rp 1.50 T");
    assert.equal(fmtIdr(2_000_000_000_000, true), "Rp 2.00 T");
  });
  it("compact: M (>1e9)", () => {
    assert.equal(fmtIdr(1_500_000_000, true), "Rp 1.5 M");
    assert.equal(fmtIdr(12_400_000_000, true), "Rp 12.4 M");
  });
  it("compact: Jt (>1e6)", () => {
    assert.equal(fmtIdr(2_500_000, true), "Rp 2.5 Jt");
    assert.equal(fmtIdr(1_000_000, true), "Rp 1.0 Jt");
  });
  it("compact keeps plain for <1e6", () => {
    assert.equal(fmtIdr(500_000, true), "Rp 500.000");
  });
});

describe("fmtNum", () => {
  it("returns — for null/NaN", () => {
    assert.equal(fmtNum(null), "—");
    assert.equal(fmtNum(undefined), "—");
    assert.equal(fmtNum(NaN), "—");
  });
  it("formats with id-ID locale and default 2 decimals max", () => {
    // 1234.5 -> "1.234,5" in id-ID, but maximumFractionDigits=2 means 1.234,56
    assert.equal(fmtNum(1234.567, 2), "1.234,57");
    assert.equal(fmtNum(0, 0), "0");
    assert.equal(fmtNum(1000), "1.000");
  });
  it("respects digits param", () => {
    assert.equal(fmtNum(1.2345, 0), "1");
    assert.equal(fmtNum(1.2345, 3), "1,235");
  });
  it("handles zero and negative", () => {
    assert.equal(fmtNum(0), "0");
    assert.equal(fmtNum(-42.5), "-42,5");
  });
});

describe("fmtPct", () => {
  it("returns — for null/NaN", () => {
    assert.equal(fmtPct(null), "—");
    assert.equal(fmtPct(undefined), "—");
    assert.equal(fmtPct(NaN), "—");
  });
  it("adds + for positive, no sign for negative (minus comes from toFixed)", () => {
    assert.equal(fmtPct(1.234), "+1.23%");
    assert.equal(fmtPct(-1.234), "-1.23%");
    assert.equal(fmtPct(0), "0.00%");
  });
  it("always 2 decimals", () => {
    assert.equal(fmtPct(0.1), "+0.10%");
    assert.equal(fmtPct(12), "+12.00%");
  });
});
