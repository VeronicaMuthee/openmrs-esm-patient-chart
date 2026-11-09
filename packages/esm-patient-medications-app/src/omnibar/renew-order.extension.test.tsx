import React from 'react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import { formatDate } from '@openmrs/esm-framework';
import { type DrugOrderBasketItem, type Order, useOrderBasket } from '@openmrs/esm-patient-common-lib';
import { _resetOrderBasketStore } from '@openmrs/esm-patient-common-lib/src/orders/store';
import { mockPatientDrugOrdersApiData } from '__mocks__';
import { mockPatient } from 'tools';
import { type OmnibarContext, type OmnibarReport } from '../omnibar-contract';
import { buildMedicationOrder, useMedicationOrders } from '../api';
import RenewOrderOmnibarProvider, { readRenewTerm } from './renew-order.extension';

const mockUseMedicationOrders = vi.mocked(useMedicationOrders);

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal()),
  useMedicationOrders: vi.fn(),
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

// The real formatDate, unless a test stands in for a locale that writes dates with a "/"
const dates = vi.hoisted(() => ({ writtenAs: null as string | null }));
vi.mock('@openmrs/esm-framework', async (importOriginal) => {
  const framework = await importOriginal<Record<string, unknown> & { formatDate: (date: Date) => string }>();
  return { ...framework, formatDate: (date: Date) => dates.writtenAs ?? framework.formatDate(date) };
});

const patientUuid = mockPatient.id;
const chartContext: OmnibarContext = { scope: 'patient', patientUuid, locale: 'en' };
const underRenew: OmnibarContext = { ...chartContext, command: { id: 'renew' } };
const medicationsPage = { type: 'navigate', to: `\${openmrsSpaBase}/patient/${patientUuid}/chart/medications` };

const [firstOrder, sulfacetamide, acetaminophen] = mockPatientDrugOrdersApiData as unknown as Array<Order>;
// Written in an earlier visit, as an order to renew usually was
const aspirin = {
  ...firstOrder,
  encounter: { ...firstOrder.encounter, visit: { uuid: 'earlier-visit-uuid' } },
} as Order;
const started = (order: Order) => formatDate(new Date(order.scheduledDate || order.dateActivated));
const named = (display: string, uuid: string) => ({ ...aspirin, uuid, drug: { ...aspirin.drug, display } }) as Order;

function inBasket(...items: Array<DrugOrderBasketItem>) {
  const { result } = renderHook(() => useOrderBasket<DrugOrderBasketItem>(mockPatient, 'medications'));
  act(() => result.current.setOrders(items));
}

function ordersAre(state: Partial<ReturnType<typeof useMedicationOrders>>) {
  mockUseMedicationOrders.mockReturnValue({
    activeOrders: [],
    pastOrders: [],
    futureOrders: [],
    error: null,
    isLoading: false,
    isValidating: false,
    ...state,
  } as ReturnType<typeof useMedicationOrders>);
}

function reportFor(query: string, context: OmnibarContext = underRenew) {
  const report = vi.fn<(report: OmnibarReport) => void>();
  render(<RenewOrderOmnibarProvider query={query} context={context} report={report} />);
  return report.mock.calls.at(-1)[0];
}

const idsFor = (query: string) => reportFor(query).results.map(({ id }) => id);

describe('readRenewTerm', () => {
  it.each([
    ['', true, ''],
    ['-', true, ''],
    ['renew  - ', false, ''],
    ['Aspirin', true, 'Aspirin'],
    ['  aspirin   162 ', true, 'aspirin 162'],
    ['renew', false, ''],
    ['Renew Aspirin', false, 'Aspirin'],
    ['aspirin', false, null],
    ['renewal', false, null],
    ['', false, null],
  ])('reads %j (under /renew: %s) as %j', (query, underRenewCommand, expected) => {
    expect(readRenewTerm(query, underRenewCommand)).toBe(expected);
  });
});

describe('RenewOrderOmnibarProvider', () => {
  beforeEach(() => {
    dates.writtenAs = null;
    _resetOrderBasketStore();
    ordersAre({ activeOrders: [aspirin], pastOrders: [sulfacetamide, acetaminophen] });
  });

  it('lists the active medications, then the past ones, as the medication lists offer Renew on', () => {
    const report = reportFor('');

    expect(mockUseMedicationOrders).toHaveBeenLastCalledWith(patientUuid);
    expect(report).toMatchObject({ query: '', title: 'Renew a medication', status: 'ready' });
    expect(report.results.map(({ id, title, subtitle }) => ({ id, title, subtitle }))).toEqual([
      {
        id: aspirin.uuid,
        title: 'Aspirin 162.5mg',
        subtitle: `Active, started ${started(aspirin)} · 1 tablet, Once daily · Open the drug order form to renew`,
      },
      {
        id: sulfacetamide.uuid,
        title: 'Sulfacetamide 0.1',
        subtitle: expect.stringMatching(new RegExp(`^Past, started ${started(sulfacetamide)} · .+ · Open the drug`)),
      },
      {
        id: acetaminophen.uuid,
        title: 'Acetaminophen 325 mg',
        subtitle: expect.stringMatching(new RegExp(`^Past, started ${started(acetaminophen)} · .+ · Open the drug`)),
      },
    ]);
  });

  it('opens the drug order form filled from the order as a renewal, with no visit and no start yet', () => {
    const { target } = reportFor('aspirin').results[0];

    expect(target).toEqual({
      type: 'workspace',
      workspaceName: 'add-drug-order',
      workspaceProps: { order: { ...buildMedicationOrder(aspirin, 'RENEW'), scheduledDate: undefined, visit: null } },
      requiresOpenGroup: { workspaceName: 'add-drug-order', patientUuid },
    });
    expect(target).toMatchObject({ workspaceProps: { order: { action: 'RENEW', previousOrder: aspirin.uuid } } });
    // The Renew button's item keeps the earlier visit; here the form takes the chart's current one
    expect(buildMedicationOrder(aspirin, 'RENEW').visit).toEqual({ uuid: 'earlier-visit-uuid' });
    expect(target).not.toHaveProperty('windowProps');
  });

  it('keeps the start of an order that starts in the future', () => {
    // An order scheduled for next week and stopped before it started is the past order that does
    const later = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    ordersAre({
      pastOrders: [
        {
          ...aspirin,
          urgency: 'ON_SCHEDULED_DATE',
          scheduledDate: later.toISOString(),
          dateStopped: new Date(Date.now() - 60 * 1000).toISOString(),
        } as Order,
      ],
    });

    const { target } = reportFor('aspirin').results[0];

    expect(target).toMatchObject({ workspaceProps: { order: { scheduledDate: later } } });
  });

  it("shows a scheduled order's start as its scheduled date, as the medication lists do", () => {
    ordersAre({
      pastOrders: [
        {
          ...aspirin,
          scheduledDate: '2023-09-01T08:00:00.000+0000',
          dateStopped: '2023-09-30T08:00:00.000+0000',
        } as Order,
      ],
    });

    expect(reportFor('').results[0].subtitle).toMatch(
      new RegExp(`^Past, started ${formatDate(new Date('2023-09-01T08:00:00.000+0000'))} · `),
    );
  });

  it('shows an order without a readable start as active or past, not a broken date, and still lists the rest', () => {
    ordersAre({
      activeOrders: [{ ...aspirin, dateActivated: undefined, scheduledDate: undefined } as Order],
      pastOrders: [{ ...sulfacetamide, dateActivated: 'not a date' } as Order, acetaminophen],
    });

    const subtitles = reportFor('').results.map(({ subtitle }) => subtitle);

    expect(subtitles).toEqual([
      'Active · 1 tablet, Once daily · Open the drug order form to renew',
      expect.stringMatching(/^Past · .+ · Open the drug/),
      expect.stringMatching(new RegExp(`^Past, started ${started(acetaminophen)} · `)),
    ]);
  });

  it('shows dates and what was typed as written, without HTML-escaping them', () => {
    dates.writtenAs = '09/11/2026';

    expect(reportFor('').results[0].subtitle).toMatch(/^Active, started 09\/11\/2026 · /);
    expect(reportFor('PEP/PrEP').results[0].title).toBe('No medication to renew matches "PEP/PrEP"');
  });

  it('matches each word typed against the start of a word of the drug, in any case', () => {
    expect(idsFor('ACETA')).toEqual([acetaminophen.uuid]);
    expect(idsFor('aspirin 162')).toEqual([aspirin.uuid]);
    expect(idsFor('aspirin 325')).toEqual(['no-medications-to-renew']);
  });

  it('matches words inside punctuation and without accents', () => {
    ordersAre({
      pastOrders: [named('Amoxicillin/Clavulanate (625mg)', 'combined'), named('Éthambutol 400mg', 'accented')],
    });

    expect(idsFor('clav 625')).toEqual(['combined']);
    expect(idsFor('ethambutol')).toEqual(['accented']);
  });

  it('matches anywhere in a name written without spaces, as in Chinese, but only at word starts otherwise', () => {
    ordersAre({ pastOrders: [named('阿莫西林胶囊 500mg', 'chinese'), named('Sulfacetamide 0.1', 'latin')] });

    expect(idsFor('西林')).toEqual(['chinese']);
    expect(idsFor('阿莫')).toEqual(['chinese']);
    expect(idsFor('cetamide')).toEqual(['no-medications-to-renew']);
  });

  it('leaves out an order without a coded drug, which Renew can’t renew, and still lists the rest', () => {
    ordersAre({ activeOrders: [{ ...aspirin, uuid: 'non-coded', drug: null } as unknown as Order, acetaminophen] });

    expect(idsFor('')).toEqual([acetaminophen.uuid]);
  });

  it.each([
    ['a dose and how often, as the medication lists write them', {}, '1 tablet, Once daily'],
    ['how often, with no dose', { dose: null }, 'Once daily'],
    ['a dose, with no frequency', { frequency: null }, '1 tablet'],
    ['a dose with no unit', { doseUnits: null }, '1, Once daily'],
    ['a dose of zero', { dose: 0 }, '0 tablet, Once daily'],
    ['a unit written with a "/", as written', { doseUnits: { display: 'mg/kg' } }, '1 mg/kg, Once daily'],
    [
      'free-text instructions',
      {
        dosingType: 'org.openmrs.FreeTextDosingInstructions',
        dose: null,
        frequency: null,
        dosingInstructions: '  Two puffs  ',
      },
      'Two puffs',
    ],
    [
      'free-text instructions of exactly 60 characters, uncut',
      {
        dosingType: 'org.openmrs.FreeTextDosingInstructions',
        dose: null,
        frequency: null,
        dosingInstructions: 'x'.repeat(60),
      },
      'x'.repeat(60),
    ],
    [
      'free-text instructions, cut to 60 characters',
      {
        dosingType: 'org.openmrs.FreeTextDosingInstructions',
        dose: null,
        frequency: null,
        dosingInstructions: 'x'.repeat(70),
      },
      `${'x'.repeat(59)}…`,
    ],
    [
      'free-text instructions, cut between characters as drawn',
      {
        dosingType: 'org.openmrs.FreeTextDosingInstructions',
        dose: null,
        frequency: null,
        dosingInstructions: '👨‍👩‍👧'.repeat(61),
      },
      `${'👨‍👩‍👧'.repeat(59)}…`,
    ],
  ])('tells orders apart by %s', (_, change, dosing) => {
    ordersAre({ activeOrders: [{ ...aspirin, ...change } as Order] });

    expect(reportFor('').results[0].subtitle).toBe(
      `Active, started ${started(aspirin)} · ${dosing} · Open the drug order form to renew`,
    );
  });

  it('leaves out an order already in the basket, as the medication lists grey its Renew out', () => {
    inBasket(buildMedicationOrder(aspirin, 'DISCONTINUE'));

    expect(idsFor('')).toEqual([sulfacetamide.uuid, acetaminophen.uuid]);
  });

  it('leaves out another order of a drug whose renewal is in the basket, which the form would save over', () => {
    const earlierAspirin = { ...aspirin, uuid: 'earlier-aspirin' } as Order;
    ordersAre({ activeOrders: [aspirin], pastOrders: [earlierAspirin, acetaminophen] });
    inBasket(buildMedicationOrder(aspirin, 'RENEW'));

    expect(idsFor('')).toEqual([acetaminophen.uuid]);
  });

  it('still lists another order of a drug the basket holds for some other action', () => {
    const earlierAspirin = { ...aspirin, uuid: 'earlier-aspirin' } as Order;
    ordersAre({ activeOrders: [aspirin], pastOrders: [earlierAspirin] });
    inBasket(buildMedicationOrder(aspirin, 'DISCONTINUE'));

    expect(idsFor('')).toEqual(['earlier-aspirin']);
  });

  it('doesn’t list upcoming medications, which the medication lists don’t offer Renew on', () => {
    ordersAre({ futureOrders: [aspirin] });

    expect(idsFor('')).toEqual(['no-medications-to-renew']);
  });

  it.each([
    ['the patient has no medications', () => ordersAre({}), '', 'No medications to renew'],
    [
      'every medication is in the basket',
      () => inBasket(...[aspirin, sulfacetamide, acetaminophen].map((order) => buildMedicationOrder(order, 'RENEW'))),
      '',
      'Every medication is already in the order basket',
    ],
    [
      'every match for what was typed is in the basket, as typed',
      () => inBasket(buildMedicationOrder(aspirin, 'RENEW')),
      'aspirin 162/5',
      'Every match for "aspirin 162/5" is already in the order basket',
    ],
    ['nothing matches what was typed', () => undefined, 'ibuprofen', 'No medication to renew matches "ibuprofen"'],
    [
      'the only medications have no coded drug, which Renew can’t renew',
      () => ordersAre({ activeOrders: [{ ...aspirin, drug: null, drugNonCoded: 'Herbal tea' } as unknown as Order] }),
      '',
      'No medications to renew',
    ],
  ])('says so, opening the Medications page, when %s', (_, arrange, query, title) => {
    arrange();

    expect(reportFor(query).results).toEqual([
      {
        id: 'no-medications-to-renew',
        title,
        subtitle: 'Open the Medications page',
        target: medicationsPage,
      },
    ]);
  });

  it('lists five medications and says how many more there are, opening the Medications page', () => {
    ordersAre({ pastOrders: Array.from({ length: 8 }, (_, i) => ({ ...aspirin, uuid: `order-${i}` })) });

    const { results } = reportFor('');

    expect(results.map(({ id }) => id)).toEqual([
      'order-0',
      'order-1',
      'order-2',
      'order-3',
      'order-4',
      'more-medications-to-renew',
    ]);
    expect(results[5]).toEqual({
      id: 'more-medications-to-renew',
      title: '3 more on the Medications page',
      subtitle: 'Type part of a drug name to narrow, or open the Medications page',
      target: medicationsPage,
    });
  });

  it('doesn’t ask to type a name to narrow once one is typed, and counts one more as one', () => {
    ordersAre({ pastOrders: Array.from({ length: 6 }, (_, i) => ({ ...aspirin, uuid: `order-${i}` })) });

    expect(reportFor('aspirin').results[5]).toMatchObject({
      title: '1 more on the Medications page',
      subtitle: 'Open the Medications page',
    });
  });

  it('counts only the matches not in the basket among the ones left out', () => {
    const orders = Array.from({ length: 7 }, (_, i) => ({ ...aspirin, uuid: `order-${i}` }));
    ordersAre({ pastOrders: orders });
    inBasket(buildMedicationOrder(orders[6], 'DISCONTINUE'));

    expect(reportFor('aspirin').results[5].title).toBe('1 more on the Medications page');
  });

  it('says nothing more when exactly five medications are listed', () => {
    ordersAre({ pastOrders: Array.from({ length: 5 }, (_, i) => ({ ...aspirin, uuid: `order-${i}` })) });

    expect(idsFor('')).toHaveLength(5);
  });

  it('stays idle, without fetching orders, for a plain drug name', () => {
    expect(reportFor('aspirin', chartContext)).toEqual({
      query: 'aspirin',
      title: 'Renew a medication',
      status: 'idle',
    });
    expect(mockUseMedicationOrders).toHaveBeenLastCalledWith(null);
  });

  it('answers "renew …" as plain text', () => {
    const report = reportFor('renew aspirin', chartContext);

    expect(mockUseMedicationOrders).toHaveBeenLastCalledWith(patientUuid);
    expect(report.results.map(({ id }) => id)).toEqual([aspirin.uuid]);
  });

  it('stays idle outside a chart', () => {
    expect(reportFor('', { scope: 'global', locale: 'en', command: { id: 'renew' } })).toMatchObject({
      status: 'idle',
    });
    expect(mockUseMedicationOrders).toHaveBeenLastCalledWith(null);
  });

  it('reports loading while the orders load', () => {
    ordersAre({ isLoading: true, isValidating: true });

    expect(reportFor('')).toEqual({ query: '', title: 'Renew a medication', status: 'loading' });
  });

  it('reports an error even while the orders are still loading', () => {
    ordersAre({ isLoading: true, error: new Error('failed') });

    expect(reportFor('')).toEqual({ query: '', title: 'Renew a medication', status: 'error' });
  });

  it('reports an unreachable server as unavailable, never with its message', () => {
    ordersAre({ error: Object.assign(new Error('upstream detail'), { response: { status: 503 } }) });

    expect(reportFor('')).toEqual({
      query: '',
      title: 'Renew a medication',
      status: 'error',
      detail: { state: 'unavailable' },
    });
  });
});
