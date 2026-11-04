import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDatetime, parseDate, usePatient, useVisit } from '@openmrs/esm-framework';
import { isServerUnreachable, type OmnibarProviderProps, type OmnibarResult } from '../omnibar-contract';

/* The omnibar reads the /visit command's texts from this module's translations:
 * t('omnibarCommand.visit.label', 'Visit')
 * t('omnibarCommand.visit.description', 'Start or end a visit for this patient')
 * t('omnibarCommand.visit.aliases', 'visit')
 */

const startWords = ['start', 'new', 'begin', 'add', 'open'];
const endWords = ['end', 'stop', 'close', 'finish'];

export type VisitIntent = 'start' | 'end' | 'either';

/**
 * What a query asks of the visit. Under `/visit` an empty query asks for either; as plain text the
 * query must name a visit ("visit" alone asks for either), so "start" or "end" alone stays with
 * other providers.
 */
export function readVisitIntent(query: string, underVisitCommand: boolean): VisitIntent | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = (list: Array<string>) => words.some((word) => list.some((listWord) => listWord.startsWith(word)));
  if (!underVisitCommand) {
    const namesVisit = words.some((word) => word.length >= 3 && 'visit'.startsWith(word));
    if (!namesVisit) {
      return null;
    }
    if (words.length === 1) {
      return 'either';
    }
  } else if (words.length === 0) {
    return 'either';
  }
  const start = matches(startWords);
  const end = matches(endWords);
  return start && end ? 'either' : start ? 'start' : end ? 'end' : null;
}

/**
 * Omnibar provider (see `omnibar-contract`) that offers to start a visit for the chart's patient, or to
 * end the active one. Starting opens the same visit form, with the same props, as the patient banner's
 * "Add visit" (`launchStartVisitWorkspace`); ending opens the banner's own "End active visit" dialog.
 */
const VisitActionsOmnibarProvider: React.FC<OmnibarProviderProps> = ({ query, context, report }) => {
  const { t } = useTranslation();
  const { patientUuid } = context;
  const intent = patientUuid ? readVisitIntent(query, context.command?.id === 'visit') : null;
  const { patient, isLoading: isLoadingPatient, error: patientError } = usePatient(patientUuid);
  const { activeVisit, isLoading: isLoadingVisit, error: visitError } = useVisit(patientUuid);
  const title = t('omnibarVisitGroup', 'Visit');

  useEffect(() => {
    if (!intent) {
      report({ query, title, status: 'idle' });
      return;
    }
    const error = patientError ?? visitError;
    if (error) {
      report({
        query,
        title,
        status: 'error',
        ...(isServerUnreachable(error) && { detail: { state: 'unavailable' as const } }),
      });
      return;
    }
    if (isLoadingPatient || isLoadingVisit) {
      report({ query, title, status: 'loading' });
      return;
    }

    const results: Array<OmnibarResult> = [];
    // Same rules as the banner's "Add visit": not for a deceased patient, and the visit form refuses a
    // second active visit anyway.
    if (intent !== 'end' && !activeVisit && !patient?.deceasedDateTime) {
      const windowProps = { patient, patientUuid, visitContext: null };
      results.push({
        id: 'start-visit',
        title: t('startVisit', 'Start visit'),
        subtitle: t('omnibarStartVisitSubtitle', 'Open the visit form'),
        target: {
          type: 'workspace',
          workspaceName: 'start-visit-workspace-form',
          workspaceProps: { openedFrom: 'patient-chart-start-visit' },
          windowProps,
          // A visit-less group, as launchStartVisitWorkspace launches, so the chart's group relaunches
          groupProps: { ...windowProps, showPatientBanner: 'tabletOnly' },
          requiresOpenGroup: { workspaceName: 'start-visit-workspace-form', patientUuid },
        },
      });
    }
    if (intent !== 'start' && activeVisit) {
      results.push({
        id: 'end-visit',
        title: t('endActiveVisit', 'End active visit'),
        subtitle: t('omnibarActiveVisitSubtitle', '{{visitType}} · started {{startDate}}', {
          visitType: activeVisit.visitType?.display,
          startDate: formatDatetime(parseDate(activeVisit.startDatetime)),
          // The omnibar draws row text as plain text, so HTML-escaping would show "&#x2F;" for a "/"
          interpolation: { escapeValue: false },
        }),
        // The banner's own "End active visit" confirmation, opened as the banner opens it
        target: { type: 'modal', modalName: 'end-visit-dialog', modalProps: { patientUuid } },
      });
    }
    report({ query, title, status: 'ready', results });
  }, [
    intent,
    query,
    title,
    report,
    t,
    patient,
    patientUuid,
    activeVisit,
    isLoadingPatient,
    isLoadingVisit,
    patientError,
    visitError,
  ]);

  return null;
};

export default VisitActionsOmnibarProvider;
