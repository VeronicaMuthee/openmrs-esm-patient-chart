import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate, parseDate } from '@openmrs/esm-framework';
import { type DrugOrderBasketItem, type Order, useOrderBasket } from '@openmrs/esm-patient-common-lib';
import { isServerUnreachable, type OmnibarProviderProps, type OmnibarResult } from '../omnibar-contract';
import { buildMedicationOrder, useMedicationOrders } from '../api';
import { ordersEqual } from '../add-drug-order/drug-search/helpers';

/* The omnibar reads the /renew command's texts from this module's translations:
 * t('omnibarCommand.renew.label', 'Renew')
 * t('omnibarCommand.renew.description', 'Renew one of this patient\'s medications')
 * t('omnibarCommand.renew.aliases', 'renew')
 * t('omnibarCommand.renew.examples', 'metformin')
 */

const renewWord = 'renew';
const maxOrders = 5;
const maxFreeTextDosing = 60;
// The omnibar draws row text as plain text, so HTML-escaping would show "&#x2F;" for a "/"
const asWritten = { interpolation: { escapeValue: false } };

/**
 * What a query asks to renew: the text to match as typed, '' for every medication (also when it has no
 * letter or digit, such as "-"), or null when it isn't asking. Under `/renew` it is the whole query; as
 * plain text it must start with "renew" ("renew amlodipine"), so a bare drug name stays with chart lookup.
 */
export function readRenewTerm(query: string, underRenewCommand: boolean): string | null {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!underRenewCommand) {
    if (words[0]?.toLowerCase() !== renewWord) {
      return null;
    }
    words.shift();
  }
  const text = words.join(' ');
  return /[\p{L}\p{N}]/u.test(text) ? text : '';
}

/**
 * Omnibar provider (see `omnibar-contract`) for the chart's Renew action: it lists the patient's active and
 * past medications, as the medication lists offer Renew on, and a row opens the drug order form filled from
 * that order. Saving puts the renewal in the basket, and nothing is ordered until the basket is signed.
 * Without a visit, the form asks for one as the chart's order buttons do.
 */
const RenewOrderOmnibarProvider: React.FC<OmnibarProviderProps> = ({ query, context, report }) => {
  const { t } = useTranslation();
  const { patientUuid } = context;
  const term = patientUuid ? readRenewTerm(query, context.command?.id === 'renew') : null;
  const { activeOrders, pastOrders, isLoading, error } = useMedicationOrders(term === null ? null : patientUuid);
  const title = t('omnibarRenewGroup', 'Renew a medication');
  // The basket keeps a patient's items under the patient's id, which is all the hook reads
  const basketPatient = useMemo<fhir.Patient>(() => ({ resourceType: 'Patient', id: patientUuid }), [patientUuid]);
  const { orders: basket } = useOrderBasket<DrugOrderBasketItem>(basketPatient, 'medications');

  // Active first, then past, each most recent first, as the medication lists show them. An order without a
  // coded drug can't be renewed there either: buildMedicationOrder needs the drug.
  const listed = useMemo(
    () =>
      [
        ...activeOrders.map((order) => ({ order, active: true })),
        ...pastOrders.map((order) => ({ order, active: false })),
      ]
        .filter(({ order }) => order.drug?.display)
        .map((entry) => ({ ...entry, inBasket: isInBasket(entry.order, basket) })),
    [activeOrders, pastOrders, basket],
  );

  useEffect(() => {
    if (term === null) {
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
    const medicationsPage = {
      type: 'navigate' as const,
      to: `\${openmrsSpaBase}/patient/${patientUuid}/chart/medications`,
    };
    const named = listed.filter(({ order }) => namesDrug(term, order.drug.display));
    const matching = named.filter(({ inBasket }) => !inBasket);
    const rows: Array<OmnibarResult> = matching.slice(0, maxOrders).map(({ order, active }) => {
      // With the dosing, the start tells two orders of the same drug apart
      const date = startOf(order);
      const status = active
        ? date
          ? t('omnibarRenewActive', 'Active, started {{date}}', { date, ...asWritten })
          : t('omnibarRenewActiveUndated', 'Active')
        : date
          ? t('omnibarRenewPast', 'Past, started {{date}}', { date, ...asWritten })
          : t('omnibarRenewPastUndated', 'Past');
      return {
        id: order.uuid,
        title: order.drug.display,
        subtitle: [status, dosing(order, t), t('omnibarRenewSubtitle', 'Open the drug order form to renew')]
          .filter(Boolean)
          .join(' · '),
        target: {
          type: 'workspace',
          workspaceName: 'add-drug-order',
          workspaceProps: { order: renewalOf(order) },
          requiresOpenGroup: { workspaceName: 'add-drug-order', patientUuid },
        },
      };
    });
    // Say why nothing is listed, or how many more there are, as /pending says when nothing is pending
    const results: Array<OmnibarResult> = !rows.length
      ? [
          {
            id: 'no-medications-to-renew',
            title: named.length
              ? term
                ? t('omnibarRenewMatchesInBasket', 'Every match for "{{term}}" is already in the order basket', {
                    term,
                    ...asWritten,
                  })
                : t('omnibarRenewAllInBasket', 'Every medication is already in the order basket')
              : term
                ? t('omnibarRenewNoMatch', 'No medication to renew matches "{{term}}"', { term, ...asWritten })
                : t('omnibarRenewNone', 'No medications to renew'),
            subtitle: t('omnibarOpenMedicationsPage', 'Open the Medications page'),
            target: medicationsPage,
          },
        ]
      : matching.length > rows.length
        ? [
            ...rows,
            {
              id: 'more-medications-to-renew',
              title: t('omnibarRenewMore', '{{count}} more on the Medications page', {
                count: matching.length - rows.length,
              }),
              subtitle: term
                ? t('omnibarOpenMedicationsPage', 'Open the Medications page')
                : t('omnibarRenewMoreHint', 'Type part of a drug name to narrow, or open the Medications page'),
              target: medicationsPage,
            },
          ]
        : rows;
    report({ query, title, status: 'ready', results });
  }, [term, query, title, report, t, listed, isLoading, error, patientUuid]);

  return null;
};

/**
 * Whether the basket holds this order, as the medication lists grey its Renew out, or holds a renewal the
 * form would save this one over: it counts two items as one by action and drug name (`ordersEqual`).
 */
function isInBasket(order: Order, basket: Array<DrugOrderBasketItem>) {
  return basket.some(
    (item) =>
      item.uuid === order.uuid || ordersEqual(item, { action: 'RENEW', commonMedicationName: order.drug.display }),
  );
}

/** Lower-case words without accents, split at anything but a letter or digit: "(500mg)" gives "500mg". */
function wordsOf(text: string) {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Scripts written without spaces between words, where a drug's whole name reads as one word. */
const unspacedScript =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/**
 * Whether each word typed starts a word of the drug's name: "amlo", "aspirin 162" and "clav" for
 * Amoxicillin/Clavulanate do, "acet" for Sulfacetamide doesn't. In a script without spaces, such as
 * Chinese, it may come anywhere in the name: "西林" for 阿莫西林.
 */
function namesDrug(term: string, drugName: string) {
  const nameWords = wordsOf(drugName);
  return wordsOf(term).every((typed) =>
    nameWords.some((word) => word.startsWith(typed) || (unspacedScript.test(typed) && word.includes(typed))),
  );
}

/** The start the medication lists show, or null for an order without a readable one. */
function startOf(order: Order) {
  const start = order.scheduledDate || order.dateActivated;
  const date = start ? parseDate(start) : null;
  return date && !Number.isNaN(date.getTime()) ? formatDate(date) : null;
}

/**
 * "1 tablet, Once daily", or a free-text order's own instructions, cut to 60 characters: with the start,
 * enough to tell two orders of the same drug apart.
 */
function dosing(order: Order, t: ReturnType<typeof useTranslation>['t']) {
  if (order.dosingType === 'org.openmrs.FreeTextDosingInstructions') {
    // Cut between characters as drawn, so an accented letter or an emoji isn't split
    const characters = Array.from(
      new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(order.dosingInstructions?.trim() ?? ''),
      ({ segment }) => segment,
    );
    return characters.length > maxFreeTextDosing
      ? `${characters.slice(0, maxFreeTextDosing - 1).join('')}…`
      : characters.join('');
  }
  // As the medication lists write it: "1 tablet", and a dose of 0 too
  const dose =
    order.dose != null
      ? [order.dose, order.doseUnits?.display?.toLowerCase()].filter((part) => part != null).join(' ')
      : null;
  const frequency = order.frequency?.display;
  return dose && frequency
    ? t('omnibarRenewDosing', '{{dose}}, {{frequency}}', { dose, frequency, ...asWritten })
    : dose || frequency;
}

/**
 * The order the Renew action would put in the basket. Its start is left for the form to set when it opens,
 * unless the old order starts in the future, so a renewal opened after a visit was just started can't
 * start before that visit. Its visit is left for the form too, which takes the chart's current one.
 */
function renewalOf(order: Order) {
  const renewal = buildMedicationOrder(order, 'RENEW');
  const startsLater = renewal.scheduledDate && renewal.scheduledDate.getTime() > Date.now();
  return { ...renewal, scheduledDate: startsLater ? renewal.scheduledDate : undefined, visit: null };
}

export default RenewOrderOmnibarProvider;
