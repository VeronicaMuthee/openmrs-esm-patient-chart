import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useConfig } from '@openmrs/esm-framework';
import { isServerUnreachable, type OmnibarProviderProps, type OmnibarResult } from '../omnibar-contract';
import { getTemplateOrderBasketItem, useDrugSearch } from '../add-drug-order/drug-search/drug-search.resource';
import { type ConfigObject } from '../config-schema';

/* The omnibar reads the /order command's texts from this module's translations:
 * t('omnibarCommand.order.label', 'Order')
 * t('omnibarCommand.order.description', 'Order a drug or lab test for this patient')
 * t('omnibarCommand.order.aliases', 'order, rx, prescribe')
 * t('omnibarCommand.order.examples', 'amox')
 */

const orderWords = ['order', 'rx', 'prescribe'];
const maxDrugs = 5;

/**
 * The drug a query asks to order, or null. Under `/order` it is the whole query; as plain text the query
 * must start with an order word ("order amoxicillin"), so a bare drug name stays with chart lookup.
 */
export function readDrugTerm(query: string, underOrderCommand: boolean): string | null {
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
 * Omnibar provider (see `omnibar-contract`) that finds drugs to order for the chart's patient. A row opens
 * the drug order form with the drug chosen, as picking it in the order basket's search does; saving puts
 * it in the basket, and nothing is ordered until the basket is signed. Without a visit, the form asks for
 * one as the chart's order buttons do.
 */
const DrugOrderOmnibarProvider: React.FC<OmnibarProviderProps> = ({ query, context, report }) => {
  const { t } = useTranslation();
  const { patientUuid } = context;
  const term = patientUuid ? readDrugTerm(query, context.command?.id === 'order') : null;
  const { drugs, isLoading, error } = useDrugSearch(term);
  const { daysDurationUnit } = useConfig<ConfigObject>();
  const title = t('omnibarDrugOrderGroup', 'Order a drug');

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
    const results: Array<OmnibarResult> = (drugs ?? []).slice(0, maxDrugs).map((drug) => ({
      id: drug.uuid,
      title: drug.display,
      subtitle: [drug.dosageForm?.display, t('omnibarDrugOrderSubtitle', 'Open the drug order form')]
        .filter(Boolean)
        .join(' · '),
      target: {
        type: 'workspace',
        workspaceName: 'add-drug-order',
        // No visit on the order: the form takes the chart's, as it does for an order from the basket's search
        workspaceProps: { order: getTemplateOrderBasketItem(drug, null, daysDurationUnit) },
        requiresOpenGroup: { workspaceName: 'add-drug-order', patientUuid },
      },
    }));
    report({ query, title, status: 'ready', results });
  }, [term, query, title, report, t, drugs, isLoading, error, daysDurationUnit, patientUuid]);

  return null;
};

export default DrugOrderOmnibarProvider;
