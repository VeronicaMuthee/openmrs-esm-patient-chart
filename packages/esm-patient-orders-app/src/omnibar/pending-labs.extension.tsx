import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate, parseDate } from '@openmrs/esm-framework';
import { type Order, usePatientOrders } from '@openmrs/esm-patient-common-lib';
import { isServerUnreachable, type OmnibarProviderProps, type OmnibarResult } from '../omnibar-contract';
import { ORDER_TYPES } from '../constants/order-types';

/* The omnibar reads the /pending command's texts from this module's translations:
 * t('omnibarCommand.pending.label', 'Pending')
 * t('omnibarCommand.pending.description', 'Lab orders not yet completed for this patient')
 * t('omnibarCommand.pending.aliases', 'pending, unfilled')
 */

const pendingWords = ['pending', 'unfilled', 'outstanding'];
const labWords = ['lab', 'labs', 'test', 'tests', 'order', 'orders'];
const doneStatuses = ['COMPLETED', 'DECLINED'];

/**
 * Whether a query asks for pending lab orders. Under `/pending`, an empty query or lab words do; as plain
 * text it needs a pending word and a lab word ("pending labs", "unfilled lab orders").
 */
export function asksForPendingLabs(query: string, underPendingCommand: boolean) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (underPendingCommand) {
    return words.every((word) => labWords.includes(word));
  }
  return words.some((word) => pendingWords.includes(word)) && words.some((word) => labWords.includes(word));
}

/** The active lab orders the lab hasn't completed or declined, STAT first, then oldest first. */
export function pendingLabOrders(orders: Array<Order> | null): Array<Order> {
  return (orders ?? [])
    .filter((order) => order.type === ORDER_TYPES.TEST_ORDER && !doneStatuses.includes(order.fulfillerStatus))
    .sort(
      (a, b) =>
        Number(b.urgency === 'STAT') - Number(a.urgency === 'STAT') ||
        new Date(a.dateActivated).getTime() - new Date(b.dateActivated).getTime(),
    );
}

/**
 * Omnibar provider (see `omnibar-contract`) that lists the chart patient's lab orders the lab hasn't
 * completed or declined. A row opens the chart's Orders page, where each order's status and actions are.
 */
const PendingLabsOmnibarProvider: React.FC<OmnibarProviderProps> = ({ query, context, report }) => {
  const { t } = useTranslation();
  const { patientUuid } = context;
  const wanted = Boolean(patientUuid) && asksForPendingLabs(query, context.command?.id === 'pending');
  const { data: orders, isLoading, error } = usePatientOrders(wanted ? patientUuid : null, 'ACTIVE');
  const title = t('omnibarPendingLabsGroup', 'Pending lab orders');

  useEffect(() => {
    if (!wanted) {
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

    // No status yet means the lab hasn't received the order
    const statusLabels: Record<string, string> = {
      RECEIVED: t('omnibarLabStatusReceived', 'Received'),
      IN_PROGRESS: t('omnibarLabStatusInProgress', 'In progress'),
      ON_HOLD: t('omnibarLabStatusOnHold', 'On hold'),
      EXCEPTION: t('omnibarLabStatusException', 'Exception'),
    };
    const ordersPage = { type: 'navigate' as const, to: `\${openmrsSpaBase}/patient/${patientUuid}/chart/orders` };
    const pending = pendingLabOrders(orders);
    const results: Array<OmnibarResult> = pending.length
      ? pending.map((order) => ({
          id: order.uuid,
          title: order.concept?.display ?? order.display,
          subtitle: [
            // The omnibar draws row text as plain text, so HTML-escaping would show "&#x2F;" for a "/"
            t('omnibarOrderedOn', 'Ordered {{date}}', {
              date: formatDate(parseDate(order.dateActivated)),
              interpolation: { escapeValue: false },
            }),
            order.fulfillerStatus
              ? statusLabels[order.fulfillerStatus] ?? order.fulfillerStatus
              : t('omnibarLabStatusNotReceived', 'Not yet received'),
            order.urgency === 'STAT' ? t('omnibarStat', 'STAT') : null,
          ]
            .filter(Boolean)
            .join(' · '),
          target: ordersPage,
        }))
      : [
          {
            id: 'no-pending-labs',
            title: t('omnibarNoPendingLabs', 'No pending lab orders'),
            subtitle: t('omnibarOpenOrdersPage', 'Open the Orders page'),
            target: ordersPage,
          },
        ];
    report({ query, title, status: 'ready', results });
  }, [wanted, query, title, report, t, orders, isLoading, error, patientUuid]);

  return null;
};

export default PendingLabsOmnibarProvider;
