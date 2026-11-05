import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { mockCareProgramsResponse } from '__mocks__';
import { mockPatient } from 'tools';
import { type OmnibarContext, type OmnibarReport } from '../omnibar-contract';
import { useAvailablePrograms, useEnrollments } from '../programs/programs.resource';
import { type PatientProgram, type Program } from '../types';
import EnrollOmnibarProvider, { programMatches, readProgramWords } from './enroll.extension';

const mockUseAvailablePrograms = vi.mocked(useAvailablePrograms);
const mockUseEnrollments = vi.mocked(useEnrollments);

vi.mock('../programs/programs.resource', () => ({
  useAvailablePrograms: vi.fn(),
  useEnrollments: vi.fn(),
}));

// A real i18next, which HTML-escapes interpolated values by default as the app's does; the shared
// react-i18next mock only substitutes them.
vi.mock('react-i18next', async () => {
  const { default: i18next } = await import('i18next');
  const i18n = i18next.createInstance();
  await i18n.init({ lng: 'en', resources: {} });
  const t = i18n.t.bind(i18n);
  return { useTranslation: () => ({ t, i18n }) };
});

const patientUuid = mockPatient.id;
const chartContext: OmnibarContext = { scope: 'patient', patientUuid, locale: 'en' };
const underEnroll: OmnibarContext = { ...chartContext, command: { id: 'enroll' } };
const [hivCare, oncology, hivDifferentiated] = mockCareProgramsResponse as Array<Program>;

function reportFor(query: string, context: OmnibarContext = underEnroll) {
  const report = vi.fn<(report: OmnibarReport) => void>();
  render(<EnrollOmnibarProvider query={query} context={context} report={report} />);
  return report.mock.calls.at(-1)[0];
}

function enrollmentsReturn(activeEnrollments: Array<Partial<PatientProgram>>) {
  return { activeEnrollments, isLoading: false, error: null } as unknown as ReturnType<typeof useEnrollments>;
}

describe('readProgramWords', () => {
  it.each([
    ['HIV', true, ['hiv']],
    ['in the HIV program', true, ['hiv']],
    ['', true, []],
    ['enroll in HIV', false, ['hiv']],
    ['Enrol hiv care', false, ['hiv', 'care']],
    ['HIV', false, null],
    ['enrollment', false, null],
  ])('reads %j (under /enroll: %s) as %j', (query, underEnrollCommand, expected) => {
    expect(readProgramWords(query, underEnrollCommand)).toEqual(expected);
  });
});

describe('programMatches', () => {
  it('matches words that start a word of the program’s or its concept’s name', () => {
    expect(programMatches(hivCare, ['hiv'])).toBe(true);
    expect(programMatches(hivCare, ['hiv', 'care'])).toBe(true);
    expect(programMatches(hivCare, ['treat'])).toBe(true);
    expect(programMatches(hivCare, ['hiv', 'onc'])).toBe(false);
    expect(programMatches(oncology, ['onc'])).toBe(true);
    expect(programMatches(oncology, [])).toBe(true);
  });
});

describe('EnrollOmnibarProvider', () => {
  beforeEach(() => {
    mockUseAvailablePrograms.mockReturnValue({
      data: mockCareProgramsResponse,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useAvailablePrograms>);
    mockUseEnrollments.mockReturnValue(enrollmentsReturn([]));
  });

  it('offers to enroll in each matching program, opening the form with it selected, for this patient only', () => {
    const report = reportFor('HIV');

    expect(report).toMatchObject({ query: 'HIV', title: 'Programs', status: 'ready' });
    expect(report.results.map((result) => result.title)).toEqual([
      'Enroll in HIV Care and Treatment',
      'Enroll in HIV Differentiated Care',
    ]);
    expect(report.results[0]).toMatchObject({ id: hivCare.uuid, subtitle: 'Open the program enrollment form' });
    expect(report.results[0].target).toEqual({
      type: 'workspace',
      workspaceName: 'programs-form-workspace',
      workspaceProps: { programUuid: hivCare.uuid },
      requiresOpenGroup: { workspaceName: 'programs-form-workspace', patientUuid },
    });
  });

  it('opens the enrollment of a program the patient is actively enrolled in', () => {
    mockUseEnrollments.mockReturnValue(
      enrollmentsReturn([{ uuid: 'enrollment', program: hivCare, dateEnrolled: '2026-09-15T00:00:00.000+0000' }]),
    );

    const [result] = reportFor('hiv care').results;

    expect(result).toMatchObject({ title: 'HIV Care and Treatment' });
    expect(result.subtitle).toMatch(/^Enrolled since /);
    expect(result.target).toMatchObject({ workspaceProps: { programEnrollmentId: 'enrollment' } });
  });

  it('shows an enrollment without a date as enrolled, still listing the other programs', () => {
    mockUseEnrollments.mockReturnValue(
      enrollmentsReturn([{ uuid: 'enrollment', program: hivCare, dateEnrolled: null }]),
    );

    const report = reportFor('hiv');

    expect(report.status).toBe('ready');
    expect(report.results.map((result) => [result.title, result.subtitle])).toEqual([
      ['HIV Care and Treatment', 'Enrolled'],
      ['Enroll in HIV Differentiated Care', 'Open the program enrollment form'],
    ]);
  });

  it('shows a program’s name as written, without HTML-escaping it', () => {
    mockUseAvailablePrograms.mockReturnValue({
      data: [{ ...hivCare, uuid: 'prep', display: 'HIV Preventative Services (PEP/PrEP)' }],
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof useAvailablePrograms>);

    expect(reportFor('prep').results[0].title).toBe('Enroll in HIV Preventative Services (PEP/PrEP)');
  });

  it('lists every program for /enroll with nothing after it', () => {
    expect(reportFor('').results.map((result) => result.id)).toEqual([
      hivCare.uuid,
      oncology.uuid,
      hivDifferentiated.uuid,
    ]);
  });

  it('stays idle, without fetching enrollments, for a plain program name', () => {
    expect(reportFor('HIV', chartContext)).toEqual({ query: 'HIV', title: 'Programs', status: 'idle' });
    expect(mockUseEnrollments).toHaveBeenLastCalledWith(null);
  });

  it('reports loading while fetching', () => {
    mockUseEnrollments.mockReturnValue({
      activeEnrollments: undefined,
      isLoading: true,
      error: null,
    } as unknown as ReturnType<typeof useEnrollments>);

    expect(reportFor('HIV')).toEqual({ query: 'HIV', title: 'Programs', status: 'loading' });
  });

  it('reports an unreachable server as unavailable, never with its message', () => {
    mockUseAvailablePrograms.mockReturnValue({
      data: null,
      isLoading: false,
      error: Object.assign(new Error('upstream detail'), { response: { status: 503 } }),
    } as unknown as ReturnType<typeof useAvailablePrograms>);

    expect(reportFor('HIV')).toEqual({
      query: 'HIV',
      title: 'Programs',
      status: 'error',
      detail: { state: 'unavailable' },
    });
  });
});
