import { describe, expect, it } from "vitest";
import { aujourdhuiDakar, formatDate, formatXOF, parseMontant } from "@/lib/format";

describe("formats sénégalais", () => {
  it("formate les montants en F CFA sans décimales", () => {
    expect(formatXOF(12500000).replace(/\s/g, " ")).toBe("12 500 000 F CFA");
    expect(formatXOF(null).replace(/\s/g, " ")).toBe("0 F CFA");
  });
  it("formate les dates jj/mm/aaaa à Dakar", () => {
    expect(formatDate(new Date("2026-10-25T23:30:00Z"))).toBe("25/10/2026");
  });
  it("calcule la date du jour à Dakar (UTC+0)", () => {
    expect(aujourdhuiDakar(new Date("2026-10-25T23:59:00Z")).toISOString()).toBe("2026-10-25T00:00:00.000Z");
  });
  it("lit les montants saisis avec séparateurs", () => {
    expect(parseMontant("1 500 000")).toBe(1_500_000);
    expect(parseMontant("1 500 000")).toBe(1_500_000);
    expect(parseMontant("1.500.000")).toBe(1_500_000);
    expect(parseMontant("-250 000")).toBe(-250_000);
    expect(parseMontant("12 000 F CFA")).toBe(12_000);
    expect(parseMontant("abc")).toBeNull();
    expect(parseMontant("")).toBeNull();
  });
});
