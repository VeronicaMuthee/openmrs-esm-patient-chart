import { defineConfigSchema, getAsyncLifecycle, getSyncLifecycle } from '@openmrs/esm-framework';
import { createDashboardLink } from '@openmrs/esm-patient-common-lib';
import { configSchema } from './config-schema';
import { dashboardMeta, moduleName } from './dashboard.meta';
import medicationsSummaryComponent from './medications-summary/medications-summary.component';
import futureMedicationsComponent from './future-medications/future-medications.component';
import activeMedicationsComponent from './active-medications/active-medications.component';
import pastMedicationsComponent from './past-medications/past-medications.component';
import { withProviderBoundary } from './omnibar-contract';

export const importTranslation = require.context('../translations', false, /.json$/, 'lazy');

const options = {
  featureName: 'patient-medications',
  moduleName,
};

export function startupApp() {
  defineConfigSchema(moduleName, configSchema);
}

export const medicationsSummary = getSyncLifecycle(medicationsSummaryComponent, options);

export const activeMedications = getSyncLifecycle(activeMedicationsComponent, options);

export const pastMedications = getSyncLifecycle(pastMedicationsComponent, options);

export const futureMedications = getSyncLifecycle(futureMedicationsComponent, options);

export const drugOrderPanel = getAsyncLifecycle(
  () => import('./drug-order-basket-panel/drug-order-basket-panel.extension'),
  options,
);

export const medicationsDashboardLink =
  // t('Medications', 'Medications')
  getSyncLifecycle(
    createDashboardLink({
      ...dashboardMeta,
    }),
    options,
  );

export const addDrugOrderWorkspace = getAsyncLifecycle(
  () => import('./add-drug-order/add-drug-order.workspace'),
  options,
);

export const exportedAddDrugOrderWorkspace = getAsyncLifecycle(
  () => import('./add-drug-order/add-drug-order.workspace'),
  options,
);

// Loaded only when the omnibar mounts its providers, and wrapped so a failure stays in its own group
export const drugOrderOmnibarProvider = getAsyncLifecycle(
  () =>
    import('./omnibar/drug-order.extension').then(({ default: Provider }) => ({
      default: withProviderBoundary(Provider, 'drug-order-omnibar-provider'),
    })),
  { featureName: 'drug-order-omnibar-provider', moduleName },
);
