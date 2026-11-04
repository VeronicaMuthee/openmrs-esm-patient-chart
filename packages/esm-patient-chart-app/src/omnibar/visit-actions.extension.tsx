import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { usePatient, useVisit } from '@openmrs/esm-framework';
import { isServerUnreachable, type OmnibarProviderProps, type OmnibarResult } from '../omnibar-contract';

/* The omnibar reads the /visit command's texts from this module's translations:
 * t('omnibarCommand.visit.label', 'Visit')
 * t('omnibarCommand.visit.description', 'Start a visit for this patient')
 * t('omnibarCommand.visit.aliases', 'visit')
 */

const startWords = ['start', 'new', 'begin', 'add', 'open'];

/**
 * Whether the query asks to start a visit. Under `/visit`, an empty query or a start word does;
 * as plain text the query must also name a visit, so "start" alone stays with other providers.
 */
export function asksToStartVisit(query: string, underVisitCommand: boolean) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hasStartWord = words.some((word) => startWords.some((start) => start.startsWith(word)));
  if (underVisitCommand) {
    return words.length === 0 || hasStartWord;
  }
  const namesVisit = words.some((word) => word.length >= 3 && 'visit'.startsWith(word));
  return namesVisit && (words.length === 1 || hasStartWord);
}

/**
 * Omnibar provider (see `omnibar-contract`) that offers to start a visit for the chart's patient. It opens
 * the same visit form, with the same props, as the patient banner's "Add visit" (`launchStartVisitWorkspace`).
 */
const VisitActionsOmnibarProvider: React.FC<OmnibarProviderProps> = ({ query, context, report }) => {
  const { t } = useTranslation();
  const { patientUuid } = context;
  const wanted = Boolean(patientUuid) && asksToStartVisit(query, context.command?.id === 'visit');
  const { patient, isLoading: isLoadingPatient, error: patientError } = usePatient(patientUuid);
  const { activeVisit, isLoading: isLoadingVisit, error: visitError } = useVisit(patientUuid);
  const title = t('omnibarVisitGroup', 'Visit');

  useEffect(() => {
    if (!wanted) {
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

    // Same rules as the banner's "Add visit": not for a deceased patient, and the visit form refuses a
    // second active visit anyway.
    const results: Array<OmnibarResult> = [];
    if (!activeVisit && !patient?.deceasedDateTime) {
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
    report({ query, title, status: 'ready', results });
  }, [
    wanted,
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
