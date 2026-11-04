import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { getDefaultsFromConfigSchema, useConfig } from '@openmrs/esm-framework';
import { mockPatient } from 'tools';
import { configSchema, type ConfigObject } from '../config-schema';
import { type OmnibarContext, type OmnibarReport } from '../omnibar-contract';
import { createEmptyLabOrder } from '../test-orders/add-test-order/test-order';
import { type TestType, useTestTypes } from '../test-orders/add-test-order/useTestTypes';
import LabOrderOmnibarProvider, { readTestTerm } from './lab-order.extension';

const mockUseTestTypes = vi.mocked(useTestTypes);
const config = getDefaultsFromConfigSchema(configSchema) as ConfigObject;
vi.mocked(useConfig<ConfigObject>).mockReturnValue(config);

vi.mock('../test-orders/add-test-order/useTestTypes', () => ({ useTestTypes: vi.fn() }));

const patientUuid = mockPatient.id;
const chartContext: OmnibarContext = { scope: 'patient', patientUuid, locale: 'en' };
const underOrder: OmnibarContext = { ...chartContext, command: { id: 'order' } };
const cbc: TestType = { label: 'Complete blood count', conceptUuid: 'cbc-concept', synonyms: ['CBC'] };

function reportFor(query: string, context: OmnibarContext = underOrder) {
  const report = vi.fn<(report: OmnibarReport) => void>();
  render(<LabOrderOmnibarProvider query={query} context={context} report={report} />);
  return report.mock.calls.at(-1)[0];
}

describe('readTestTerm', () => {
  it.each([
    ['cbc', true, 'cbc'],
    ['complete blood', true, 'complete blood'],
    ['c', true, null],
    ['order cbc', false, 'cbc'],
    ['Order malaria smear', false, 'malaria smear'],
    ['cbc', false, null],
    ['order', false, null],
  ])('reads %j (under /order: %s) as %s', (query, underOrderCommand, expected) => {
    expect(readTestTerm(query, underOrderCommand)).toBe(expected);
  });
});

describe('LabOrderOmnibarProvider', () => {
  beforeEach(() => {
    mockUseTestTypes.mockReturnValue({ testTypes: [cbc], isLoading: false, error: null });
  });

  it('opens the lab order form with the test chosen and no visit, for this patient only', () => {
    const report = reportFor('cbc');

    expect(mockUseTestTypes).toHaveBeenLastCalledWith('cbc', config.orders.labOrderableConcepts);
    expect(report).toMatchObject({ query: 'cbc', title: 'Order a lab test', status: 'ready' });
    expect(report.results).toEqual([
      {
        id: 'cbc-concept',
        title: 'Complete blood count',
        subtitle: 'Lab test · Open the lab order form',
        target: {
          type: 'workspace',
          workspaceName: 'add-lab-order',
          workspaceProps: {
            order: createEmptyLabOrder(cbc, undefined, null),
            orderTypeUuid: config.orders.labOrderTypeUuid,
          },
          requiresOpenGroup: { workspaceName: 'add-lab-order', patientUuid },
        },
      },
    ]);
  });

  it('lists at most five tests', () => {
    mockUseTestTypes.mockReturnValue({
      testTypes: Array.from({ length: 8 }, (_, i) => ({ ...cbc, conceptUuid: `test-${i}` })),
      isLoading: false,
      error: null,
    });

    expect(reportFor('blood').results).toHaveLength(5);
  });

  it('stays idle, without fetching the lab sets, for a plain test name', () => {
    expect(reportFor('cbc', chartContext)).toEqual({ query: 'cbc', title: 'Order a lab test', status: 'idle' });
    expect(mockUseTestTypes).toHaveBeenLastCalledWith('', []);
  });

  it('searches for "order …" as plain text', () => {
    reportFor('order cbc', chartContext);

    expect(mockUseTestTypes).toHaveBeenLastCalledWith('cbc', config.orders.labOrderableConcepts);
  });

  it('reports loading while searching', () => {
    mockUseTestTypes.mockReturnValue({ testTypes: [], isLoading: true, error: null });

    expect(reportFor('cbc')).toEqual({ query: 'cbc', title: 'Order a lab test', status: 'loading' });
  });

  it('reports an unreachable server as unavailable, never with its message', () => {
    mockUseTestTypes.mockReturnValue({
      testTypes: [],
      isLoading: false,
      error: Object.assign(new Error('upstream detail'), { response: { status: 503 } }),
    });

    expect(reportFor('cbc')).toEqual({
      query: 'cbc',
      title: 'Order a lab test',
      status: 'error',
      detail: { state: 'unavailable' },
    });
  });
});
