import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfig } from '@openmrs/esm-framework';
import { isServerUnreachable, type OmnibarProviderProps, type OmnibarResult } from '../omnibar-contract';
import { type ConfigObject } from '../config-schema';
import { createEmptyLabOrder } from '../test-orders/add-test-order/test-order';
import { useTestTypes } from '../test-orders/add-test-order/useTestTypes';

/* The omnibar reads the /order command's texts from this module's translations, merged with the
 * medications app's, which declares the same command for drugs:
 * t('omnibarCommand.order.label', 'Order')
 * t('omnibarCommand.order.description', 'Order a drug or lab test for this patient')
 * t('omnibarCommand.order.aliases', 'order, rx, prescribe')
 */

const orderWords = ['order', 'rx', 'prescribe'];
const maxTests = 5;

/**
 * The test a query asks to order, or null. Under `/order` it is the whole query; as plain text the query
 * must start with an order word ("order cbc"), so a bare test name stays with chart lookup.
 */
export function readTestTerm(query: string, underOrderCommand: boolean): string | null {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!underOrderCommand) {
    if (!orderWords.includes(words[0]?.toLowerCase())) {
      return null;
    }
    words.shift();
  }
  const term = words.join(' ');
  return term.length >= 2 ? term : null;
}

/**
 * Omnibar provider (see `omnibar-contract`) that finds lab tests to order for the chart's patient, beside
 * the medications app's drugs under the same `/order` command. A row opens the lab order form with the
 * test chosen, as picking it in the order basket's lab search does; saving puts it in the basket, and
 * nothing is ordered until the basket is signed. Without a visit, the form asks for one as the chart's
 * order buttons do.
 */
const LabOrderOmnibarProvider: React.FC<OmnibarProviderProps> = ({ query, context, report }) => {
  const { t } = useTranslation();
  const { patientUuid } = context;
  const { orders } = useConfig<ConfigObject>();
  const term = patientUuid ? readTestTerm(query, context.command?.id === 'order') : null;
  // The basket's own search over the lab's orderable concepts, fetched only once a query asks for an order
  const { testTypes, isLoading, error } = useTestTypes(term ?? '', term ? orders.labOrderableConcepts : []);
  const title = t('omnibarLabOrderGroup', 'Order a lab test');

  useEffect(() => {
    if (!term) {
      report({ query, title, status: 'idle' });
      return;
    }
    if (error) {
      report({
        query,
        title,
        status: 'error',
        ...(isServerUnreachable(error) && { detail: { state: 'unavailable' as const } }),
      });
      return;
    }
    if (isLoading) {
      report({ query, title, status: 'loading' });
      return;
    }
    const results: Array<OmnibarResult> = testTypes.slice(0, maxTests).map((testType) => ({
      id: testType.conceptUuid,
      title: testType.label,
      subtitle: t('omnibarLabOrderSubtitle', 'Lab test · Open the lab order form'),
      target: {
        type: 'workspace',
        workspaceName: 'add-lab-order',
        // No visit on the order: the form takes the chart's, as for a test picked in the basket's lab search
        workspaceProps: {
          order: createEmptyLabOrder(testType, undefined, null),
          orderTypeUuid: orders.labOrderTypeUuid,
        },
        requiresOpenGroup: { workspaceName: 'add-lab-order', patientUuid },
      },
    }));
    report({ query, title, status: 'ready', results });
  }, [term, query, title, report, t, testTypes, isLoading, error, orders.labOrderTypeUuid, patientUuid]);

  return null;
};

export default LabOrderOmnibarProvider;
