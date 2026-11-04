import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { usePatient, useVisit } from '@openmrs/esm-framework';
import { mockCurrentVisit } from '__mocks__';
import { mockPatient } from 'tools';
import { type OmnibarContext, type OmnibarReport } from '../omnibar-contract';
import VisitActionsOmnibarProvider, { asksToStartVisit } from './visit-actions.extension';

const mockUsePatient = vi.mocked(usePatient);
const mockUseVisit = vi.mocked(useVisit);

const patientUuid = mockPatient.id;
const chartContext: OmnibarContext = { scope: 'patient', patientUuid, locale: 'en' };

function reportFor(query: string, context: OmnibarContext = chartContext) {
  const report = vi.fn<(report: OmnibarReport) => void>();
  render(<VisitActionsOmnibarProvider query={query} context={context} report={report} />);
  return report.mock.calls.at(-1)[0];
}

describe('asksToStartVisit', () => {
  it.each([
    ['', true, true],
    ['start', true, true],
    ['st', true, true],
    ['new', true, true],
    ['end', true, false],
    ['visit', false, true],
    ['start visit', false, true],
    ['new visit', false, true],
    ['start a vis', false, true],
    ['start', false, false],
    ['visit notes', false, false],
    ['vi', false, false],
    ['', false, false],
  ])('reads %j (under /visit: %s) as %s', (query, underVisitCommand, expected) => {
    expect(asksToStartVisit(query, underVisitCommand)).toBe(expected);
  });
});

describe('VisitActionsOmnibarProvider', () => {
  beforeEach(() => {
    mockUsePatient.mockReturnValue({
      patient: mockPatient,
      patientUuid,
      isLoading: false,
      error: null,
    } as ReturnType<typeof usePatient>);
    mockUseVisit.mockReturnValue({ activeVisit: null, isLoading: false, error: null } as ReturnType<typeof useVisit>);
  });

  it('offers to start a visit, opening the visit form as the banner does, for this patient only', () => {
    const report = reportFor('start visit');

    expect(report).toMatchObject({ query: 'start visit', title: 'Visit', status: 'ready' });
    expect(report.results).toHaveLength(1);
    expect(report.results[0]).toMatchObject({ id: 'start-visit', title: 'Start visit' });
    expect(report.results[0].target).toEqual({
      type: 'workspace',
      workspaceName: 'start-visit-workspace-form',
      workspaceProps: { openedFrom: 'patient-chart-start-visit' },
      windowProps: { patient: mockPatient, patientUuid, visitContext: null },
      groupProps: { patient: mockPatient, patientUuid, visitContext: null, showPatientBanner: 'tabletOnly' },
      requiresOpenGroup: { workspaceName: 'start-visit-workspace-form', patientUuid },
    });
  });

  it('offers it for an empty query under /visit', () => {
    const report = reportFor('', { ...chartContext, command: { id: 'visit' } });

    expect(report.results).toHaveLength(1);
  });

  it('stays idle for a query that is not about starting a visit', () => {
    expect(reportFor('weight')).toEqual({ query: 'weight', title: 'Visit', status: 'idle' });
  });

  it('offers nothing while the patient has an active visit', () => {
    mockUseVisit.mockReturnValue({ activeVisit: mockCurrentVisit, isLoading: false, error: null } as ReturnType<
      typeof useVisit
    >);

    expect(reportFor('start visit')).toMatchObject({ status: 'ready', results: [] });
  });

  it('offers nothing for a deceased patient', () => {
    mockUsePatient.mockReturnValue({
      patient: { ...mockPatient, deceasedDateTime: '2024-01-01T00:00:00Z' },
      patientUuid,
      isLoading: false,
      error: null,
    } as ReturnType<typeof usePatient>);

    expect(reportFor('start visit')).toMatchObject({ status: 'ready', results: [] });
  });

  it('reports loading while the visit is loading', () => {
    mockUseVisit.mockReturnValue({ activeVisit: null, isLoading: true, error: null } as ReturnType<typeof useVisit>);

    expect(reportFor('start visit')).toEqual({ query: 'start visit', title: 'Visit', status: 'loading' });
  });

  it('reports an unreachable server as unavailable, never with its message', () => {
    mockUseVisit.mockReturnValue({
      activeVisit: null,
      isLoading: false,
      error: { response: { status: 503 }, message: 'upstream detail' },
    } as unknown as ReturnType<typeof useVisit>);

    expect(reportFor('start visit')).toEqual({
      query: 'start visit',
      title: 'Visit',
      status: 'error',
      detail: { state: 'unavailable' },
    });
  });
});
