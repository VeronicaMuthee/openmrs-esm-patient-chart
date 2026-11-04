import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { getDefaultsFromConfigSchema, useConfig } from '@openmrs/esm-framework';
import { mockDrugSearchResultApiData } from '__mocks__';
import { mockPatient } from 'tools';
import { configSchema, type ConfigObject } from '../config-schema';
import { type OmnibarContext, type OmnibarReport } from '../omnibar-contract';
import { getTemplateOrderBasketItem, useDrugSearch } from '../add-drug-order/drug-search/drug-search.resource';
import DrugOrderOmnibarProvider, { readDrugTerm } from './drug-order.extension';

const mockUseDrugSearch = vi.mocked(useDrugSearch);
const config = getDefaultsFromConfigSchema(configSchema) as ConfigObject;
vi.mocked(useConfig<ConfigObject>).mockReturnValue(config);

vi.mock('../add-drug-order/drug-search/drug-search.resource', async (importOriginal) => ({
  ...(await importOriginal()),
  useDrugSearch: vi.fn(),
}));

const patientUuid = mockPatient.id;
const chartContext: OmnibarContext = { scope: 'patient', patientUuid, locale: 'en' };
const underOrder: OmnibarContext = { ...chartContext, command: { id: 'order' } };

function reportFor(query: string, context: OmnibarContext = underOrder) {
  const report = vi.fn<(report: OmnibarReport) => void>();
  render(<DrugOrderOmnibarProvider query={query} context={context} report={report} />);
  return report.mock.calls.at(-1)[0];
}

describe('readDrugTerm', () => {
  it.each([
    ['amox', true, 'amox'],
    ['amoxicillin 500', true, 'amoxicillin 500'],
    ['a', true, null],
    ['', true, null],
    ['order amoxicillin', false, 'amoxicillin'],
    ['Prescribe paracetamol', false, 'paracetamol'],
    ['rx amox', false, 'amox'],
    ['amoxicillin', false, null],
    ['order', false, null],
    ['orders today', false, null],
  ])('reads %j (under /order: %s) as %s', (query, underOrderCommand, expected) => {
    expect(readDrugTerm(query, underOrderCommand)).toBe(expected);
  });
});

describe('DrugOrderOmnibarProvider', () => {
  beforeEach(() => {
    mockUseDrugSearch.mockReturnValue({
      drugs: mockDrugSearchResultApiData,
      isLoading: false,
      error: null,
    } as ReturnType<typeof useDrugSearch>);
  });

  it('opens the drug order form with the drug chosen and no visit, for this patient only', () => {
    const report = reportFor('aspirin');
    const [drug] = mockDrugSearchResultApiData;

    expect(mockUseDrugSearch).toHaveBeenLastCalledWith('aspirin');
    expect(report).toMatchObject({ query: 'aspirin', title: 'Order a drug', status: 'ready' });
    expect(report.results[0]).toMatchObject({ id: drug.uuid, title: drug.display });
    expect(report.results[0].target).toEqual({
      type: 'workspace',
      workspaceName: 'add-drug-order',
      workspaceProps: { order: getTemplateOrderBasketItem(drug, null, config.daysDurationUnit) },
      requiresOpenGroup: { workspaceName: 'add-drug-order', patientUuid },
    });
    expect(report.results[0].target).not.toHaveProperty('windowProps');
  });

  it('lists at most five drugs', () => {
    mockUseDrugSearch.mockReturnValue({
      drugs: Array.from({ length: 8 }, (_, i) => ({ ...mockDrugSearchResultApiData[0], uuid: `drug-${i}` })),
      isLoading: false,
      error: null,
    } as ReturnType<typeof useDrugSearch>);

    expect(reportFor('aspirin').results).toHaveLength(5);
  });

  it('stays idle, without searching, for a plain drug name', () => {
    expect(reportFor('aspirin', chartContext)).toEqual({ query: 'aspirin', title: 'Order a drug', status: 'idle' });
    expect(mockUseDrugSearch).toHaveBeenLastCalledWith(null);
  });

  it('searches for "order …" as plain text', () => {
    reportFor('order aspirin', chartContext);

    expect(mockUseDrugSearch).toHaveBeenLastCalledWith('aspirin');
  });

  it('reports loading while searching', () => {
    mockUseDrugSearch.mockReturnValue({ drugs: undefined, isLoading: true, error: null } as ReturnType<
      typeof useDrugSearch
    >);

    expect(reportFor('aspirin')).toEqual({ query: 'aspirin', title: 'Order a drug', status: 'loading' });
  });

  it('reports an unreachable server as unavailable, never with its message', () => {
    mockUseDrugSearch.mockReturnValue({
      drugs: undefined,
      isLoading: false,
      error: Object.assign(new Error('upstream detail'), { response: { status: 503 } }),
    } as unknown as ReturnType<typeof useDrugSearch>);

    expect(reportFor('aspirin')).toEqual({
      query: 'aspirin',
      title: 'Order a drug',
      status: 'error',
      detail: { state: 'unavailable' },
    });
  });
});
