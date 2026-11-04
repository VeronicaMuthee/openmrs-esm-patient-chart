import React from 'react';
import { vi, describe, expect, it, beforeEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { getDefaultsFromConfigSchema, launchWorkspace2, useConfig, type Visit } from '@openmrs/esm-framework';
import { mockDrugSearchResultApiData } from '__mocks__';
import { mockPatient } from 'tools';
import { configSchema, type ConfigObject } from '../config-schema';
import { getTemplateOrderBasketItem } from './drug-search/drug-search.resource';
import AddDrugOrder from './add-drug-order.component';

const mockStartVisitIfNeeded = vi.fn<() => Promise<boolean>>();
const mockUsePatientChartStore = vi.fn();
const mockUseSystemVisitSetting = vi.fn();
const mockCloseWorkspace = vi.fn();
const mockLaunchWorkspace2 = vi.mocked(launchWorkspace2);

vi.mocked(useConfig<ConfigObject>).mockReturnValue(getDefaultsFromConfigSchema(configSchema) as ConfigObject);

vi.mock('@openmrs/esm-patient-common-lib', async (importOriginal) => ({
  ...(await importOriginal()),
  useStartVisitIfNeeded: () => mockStartVisitIfNeeded,
  usePatientChartStore: (patientUuid: string) => mockUsePatientChartStore(patientUuid),
  useSystemVisitSetting: () => mockUseSystemVisitSetting(),
  getPatientChartWindowProps: (patientUuid: string) => ({ patientUuid, patient: null, visitContext: { uuid: 'new' } }),
}));

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal()),
  useMedicationOrders: () => ({ activeOrders: [], futureOrders: [], isLoading: false, error: null }),
}));

const order = getTemplateOrderBasketItem(mockDrugSearchResultApiData[0], null);

function renderForm(props: Partial<React.ComponentProps<typeof AddDrugOrder>> = {}) {
  return render(
    <AddDrugOrder
      initialOrder={order}
      patient={mockPatient}
      patientUuid={mockPatient.id}
      visitContext={null}
      closeWorkspace={mockCloseWorkspace}
      {...props}
    />,
  );
}

describe('AddDrugOrder without a visit', () => {
  beforeEach(() => {
    mockUsePatientChartStore.mockReturnValue({ patientUuid: mockPatient.id });
    mockUseSystemVisitSetting.mockReturnValue({ systemVisitEnabled: true });
  });

  it('asks for a visit, then opens the form again with the same drug once the chart has one', async () => {
    mockStartVisitIfNeeded.mockResolvedValue(true);

    renderForm();

    await waitFor(() =>
      expect(mockLaunchWorkspace2).toHaveBeenCalledWith(
        'add-drug-order',
        { order: { ...order, visit: null } },
        { patientUuid: mockPatient.id, patient: null, visitContext: { uuid: 'new' } },
      ),
    );
    expect(mockStartVisitIfNeeded).toHaveBeenCalledOnce();
    expect(mockCloseWorkspace).not.toHaveBeenCalled();
  });

  it('closes the form when the clinician cancels the visit prompt', async () => {
    mockStartVisitIfNeeded.mockResolvedValue(false);

    renderForm();

    await waitFor(() => expect(mockCloseWorkspace).toHaveBeenCalledWith({ discardUnsavedChanges: true }));
    expect(mockLaunchWorkspace2).not.toHaveBeenCalled();
  });

  it.each([
    ['the form has a visit', { visitContext: { uuid: 'visit' } as Visit }, true, mockPatient.id],
    ['visits are not required', {}, false, mockPatient.id],
    ['the chart has another patient open (the ward)', {}, true, null],
    ['a signed order is being edited', { initialOrder: { ...order, action: 'REVISE' as const } }, true, mockPatient.id],
  ])('does not ask when %s', (_, props, systemVisitEnabled, chartPatientUuid) => {
    mockUseSystemVisitSetting.mockReturnValue({ systemVisitEnabled });
    mockUsePatientChartStore.mockReturnValue({ patientUuid: chartPatientUuid });

    renderForm(props);

    expect(mockStartVisitIfNeeded).not.toHaveBeenCalled();
  });
});
