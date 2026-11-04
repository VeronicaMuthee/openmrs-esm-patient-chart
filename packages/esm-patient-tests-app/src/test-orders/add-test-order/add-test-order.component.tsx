import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ExtensionSlot,
  launchWorkspace2,
  useLayoutType,
  useConfig,
  Workspace2,
  type Visit,
  type Workspace2DefinitionProps,
} from '@openmrs/esm-framework';
import {
  getPatientChartWindowProps,
  useOrderType,
  type OrderBasketItem,
  type TestOrderBasketItem,
  usePatientChartStore,
  useStartVisitIfNeeded,
  useSystemVisitSetting,
  WorkspaceBackButton,
} from '@openmrs/esm-patient-common-lib';
import { type ConfigObject } from '../../config-schema';
import { LabOrderForm } from './test-order-form.component';
import { TestTypeSearch } from './test-type-search.component';
import styles from './add-test-order.scss';

export interface AddLabOrderProps {
  initialOrder?: OrderBasketItem;

  /**
   * This field should only be supplied for an existing order saved to the backend
   */
  orderToEditOrdererUuid?: string;
  orderTypeUuid?: string;
  patient: fhir.Patient;
  patientUuid?: string;
  visitContext: Visit;
  closeWorkspace: Workspace2DefinitionProps['closeWorkspace'];
  showPatientBanner?: boolean;
}

const AddLabOrder: React.FC<AddLabOrderProps> = ({
  patient,
  patientUuid,
  orderToEditOrdererUuid,
  visitContext,
  initialOrder,
  orderTypeUuid,
  closeWorkspace,
  showPatientBanner: showPatientBannerProp,
}) => {
  const { t } = useTranslation();
  const isTablet = useLayoutType() === 'tablet';
  const showPatientBanner = showPatientBannerProp ?? isTablet;
  const bannerPatientUuid = patientUuid ?? patient?.id;
  const [currentLabOrder, setCurrentLabOrder] = useState(initialOrder as TestOrderBasketItem);
  const [searchTerm, setSearchTerm] = useState('');
  const { additionalTestOrderTypes, orders } = useConfig<ConfigObject>();
  const resolvedOrderTypeUuid = orderTypeUuid ?? orders.labOrderTypeUuid;
  const { orderType } = useOrderType(resolvedOrderTypeUuid);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const isEditingExistingOrder = currentLabOrder?.action === 'REVISE' || initialOrder != null;

  // Ordering needs a visit. The chart's own order buttons ask for one before opening this form; a launcher
  // that can't (the omnibar) opens it directly, so the form asks itself, with the same prompt. The chart
  // store answers only for the patient the chart has open, so outside the chart (the ward, which supplies
  // its own visit) it never asks. Starting a visit relaunches the chart's workspace group, which closes
  // this form, so the form is opened again as it was once the group has the visit.
  const startVisitIfNeeded = useStartVisitIfNeeded(patientUuid);
  const { systemVisitEnabled } = useSystemVisitSetting();
  const { patientUuid: chartPatientUuid } = usePatientChartStore(patientUuid);
  const needsVisit =
    systemVisitEnabled &&
    Boolean(patientUuid) &&
    chartPatientUuid === patientUuid &&
    !visitContext &&
    initialOrder?.action !== 'REVISE';
  const askedForVisit = useRef(false);

  useEffect(() => {
    if (!needsVisit || askedForVisit.current) {
      return;
    }
    askedForVisit.current = true;
    const orderToReopen = currentLabOrder ? { ...currentLabOrder, visit: null } : undefined;
    startVisitIfNeeded().then((hasVisit) => {
      if (hasVisit) {
        launchWorkspace2(
          'add-lab-order',
          { order: orderToReopen, orderTypeUuid },
          getPatientChartWindowProps(patientUuid),
        );
      } else {
        closeWorkspace({ discardUnsavedChanges: true });
      }
    });
  }, [needsVisit, currentLabOrder, startVisitIfNeeded, patientUuid, orderTypeUuid, closeWorkspace]);

  const title = useMemo(() => {
    if (orderType) {
      if (initialOrder?.action === 'REVISE') {
        return t(`editOrderableForOrderType`, 'Edit {{orderTypeDisplay}}', {
          orderTypeDisplay: orderType.display.toLocaleLowerCase(),
        });
      } else {
        return t(`addOrderableForOrderType`, 'Add {{orderTypeDisplay}}', {
          orderTypeDisplay: orderType.display.toLocaleLowerCase(),
        });
      }
    } else {
      return '';
    }
  }, [orderType, t, initialOrder?.action]);

  const orderableConceptSets = useMemo(() => {
    const allOrderTypes: ConfigObject['additionalTestOrderTypes'] = [
      {
        label: t('labOrders', 'Lab orders'),
        orderTypeUuid: orders.labOrderTypeUuid,
        orderableConceptSets: orders.labOrderableConcepts,
      },
      ...additionalTestOrderTypes,
    ];
    return (
      allOrderTypes.find((orderType) => orderType.orderTypeUuid === resolvedOrderTypeUuid)?.orderableConceptSets ?? []
    );
  }, [additionalTestOrderTypes, resolvedOrderTypeUuid, orders.labOrderTypeUuid, orders.labOrderableConcepts, t]);

  return (
    <Workspace2 title={title} hasUnsavedChanges={hasUnsavedChanges}>
      {showPatientBanner && patient && bannerPatientUuid && (
        <ExtensionSlot
          name="patient-header-slot"
          state={{ patient, patientUuid: bannerPatientUuid, hideActionsOverflow: true }}
        />
      )}
      <div className={styles.container}>
        {!isTablet && (
          <WorkspaceBackButton
            label={t('backToOrderBasket', 'Back to order basket')}
            onClick={() => closeWorkspace()}
          />
        )}
        {currentLabOrder ? (
          <LabOrderForm
            initialOrder={currentLabOrder}
            orderToEditOrdererUuid={orderToEditOrdererUuid}
            closeWorkspace={closeWorkspace}
            onCancel={
              isEditingExistingOrder
                ? closeWorkspace
                : () => {
                    setCurrentLabOrder(undefined);
                    setHasUnsavedChanges(false);
                  }
            }
            setHasUnsavedChanges={setHasUnsavedChanges}
            orderTypeUuid={resolvedOrderTypeUuid}
            orderableConceptSets={orderableConceptSets}
            patient={patient}
          />
        ) : (
          <TestTypeSearch
            orderTypeUuid={resolvedOrderTypeUuid}
            orderableConceptSets={orderableConceptSets}
            openLabForm={setCurrentLabOrder}
            closeWorkspace={closeWorkspace}
            patient={patient}
            visit={visitContext}
            searchTerm={searchTerm}
            onSearchTermChange={setSearchTerm}
          />
        )}
      </div>
    </Workspace2>
  );
};

export default AddLabOrder;
