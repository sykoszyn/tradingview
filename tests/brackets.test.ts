import { describe, expect, it } from 'vitest';
import bracketsJson from './fixtures/brackets.json';
import { conservativeBrackets, parseBinancePublicBrackets, parseBybitRiskLimit, pickBracket } from '@/lib/market/brackets';

describe('brackets', () => {
  it('parsea el endpoint público de Binance y ordena por nocional', () => {
    const b = parseBinancePublicBrackets(bracketsJson, ['ETHUSDT', 'BTCUSDT']);
    const eth = b.ETHUSDT!;
    expect(eth.source).toBe('binance-public');
    expect(eth.brackets[0].notionalFloor).toBe(0);
    expect(eth.brackets[0].maintMarginRate).toBeGreaterThan(0);
    for (let i = 1; i < eth.brackets.length; i++) expect(eth.brackets[i].notionalFloor).toBeGreaterThanOrEqual(eth.brackets[i - 1].notionalFloor);
  });
  it('elige el tramo según el nocional', () => {
    const eth = parseBinancePublicBrackets(bracketsJson, ['ETHUSDT']).ETHUSDT!;
    expect(pickBracket(eth, 20)).toBe(eth.brackets[0]);
    expect(pickBracket(eth, 1e15)).toBe(eth.brackets[eth.brackets.length - 1]);
  });
  it('parsea el risk-limit de Bybit', () => {
    const json = { result: { list: [
      { symbol: 'ETHUSDT', riskLimitValue: '1000000', maintenanceMargin: '0.005', maxLeverage: '100', mmDeduction: '' },
      { symbol: 'ETHUSDT', riskLimitValue: '2000000', maintenanceMargin: '0.01', maxLeverage: '50', mmDeduction: '5000' },
    ] } };
    const b = parseBybitRiskLimit(json, 'ETHUSDT');
    expect(b.brackets[0]).toMatchObject({ notionalFloor: 0, notionalCap: 1000000, maintMarginRate: 0.005, maintAmount: 0 });
    expect(b.brackets[1]).toMatchObject({ notionalFloor: 1000000, maintAmount: 5000 });
  });
  it('el fallback conservador trae advertencia y MMR alto', () => {
    const c = conservativeBrackets('ETHUSDT');
    expect(c.warning).toBeTruthy();
    expect(c.brackets[0].maintMarginRate).toBeGreaterThanOrEqual(0.01);
  });
});
