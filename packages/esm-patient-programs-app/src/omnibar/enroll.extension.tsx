import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDate, parseDate } from '@openmrs/esm-framework';
import { isServerUnreachable, type OmnibarProviderProps, type OmnibarResult } from '../omnibar-contract';
import { useAvailablePrograms, useEnrollments } from '../programs/programs.resource';
import { type Program } from '../types';

/* The omnibar reads the /enroll command's texts from this module's translations:
 * t('omnibarCommand.enroll.label', 'Enroll')
 * t('omnibarCommand.enroll.description', 'Enroll this patient in a program')
 * t('omnibarCommand.enroll.aliases', 'enroll, enrol')
 */

const enrollWords = ['enroll', 'enrol'];
const fillerWords = ['in', 'into', 'the', 'program', 'programme'];

/**
 * The words naming a program, or null. Under `/enroll` it is the whole query; as plain text the query must
 * start with "enroll" ("enroll in HIV"), so a bare program name stays with other providers.
 */
export function readProgramWords(query: string, underEnrollCommand: boolean): Array<string> | null {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!underEnrollCommand) {
    if (!enrollWords.includes(words[0])) {
      return null;
    }
    words.shift();
  }
  return words.filter((word) => !fillerWords.includes(word));
}

/** Whether every word starts a word of the program's name or of its concept's name. */
export function programMatches(program: Program, words: Array<string>) {
  const nameWords = `${program.display} ${program.concept?.display ?? ''}`.toLowerCase().split(/[^a-z0-9]+/);
  return words.every((word) => nameWords.some((nameWord) => nameWord.startsWith(word)));
}

/**
 * Omnibar provider (see `omnibar-contract`) that finds programs for the chart's patient. A program the
 * patient isn't in opens the enrollment form with it selected; one they're actively enrolled in opens that
 * enrollment, as the Programs widget's Edit does.
 */
const EnrollOmnibarProvider: React.FC<OmnibarProviderProps> = ({ query, context, report }) => {
  const { t } = useTranslation();
  const { patientUuid } = context;
  const underEnrollCommand = context.command?.id === 'enroll';
  const words = useMemo(
    () => (patientUuid ? readProgramWords(query, underEnrollCommand) : null),
    [patientUuid, query, underEnrollCommand],
  );
  const { data: programs, isLoading: isLoadingPrograms, error: programsError } = useAvailablePrograms();
  const {
    activeEnrollments,
    isLoading: isLoadingEnrollments,
    error: enrollmentsError,
  } = useEnrollments(words ? patientUuid : null);
  const title = t('omnibarEnrollGroup', 'Programs');

  useEffect(() => {
    if (!words) {
      report({ query, title, status: 'idle' });
      return;
    }
    const error = programsError ?? enrollmentsError;
    if (error) {
      report({
        query,
        title,
        status: 'error',
        ...(isServerUnreachable(error) && { detail: { state: 'unavailable' as const } }),
      });
      return;
    }
    if (isLoadingPrograms || isLoadingEnrollments) {
      report({ query, title, status: 'loading' });
      return;
    }

    const form = (workspaceProps: object) => ({
      type: 'workspace' as const,
      workspaceName: 'programs-form-workspace',
      workspaceProps,
      requiresOpenGroup: { workspaceName: 'programs-form-workspace', patientUuid },
    });
    const results: Array<OmnibarResult> = (programs ?? [])
      .filter((program) => programMatches(program, words))
      .map((program) => {
        const enrollment = activeEnrollments?.find((e) => e.program.uuid === program.uuid);
        return enrollment
          ? {
              id: program.uuid,
              title: program.display,
              subtitle: t('omnibarEnrolledSince', 'Enrolled since {{date}}', {
                date: formatDate(parseDate(enrollment.dateEnrolled)),
              }),
              target: form({ programEnrollmentId: enrollment.uuid }),
            }
          : {
              id: program.uuid,
              title: t('omnibarEnrollIn', 'Enroll in {{program}}', { program: program.display }),
              subtitle: t('omnibarOpenEnrollmentForm', 'Open the program enrollment form'),
              target: form({ programUuid: program.uuid }),
            };
      });
    report({ query, title, status: 'ready', results });
  }, [
    words,
    query,
    title,
    report,
    t,
    programs,
    activeEnrollments,
    isLoadingPrograms,
    isLoadingEnrollments,
    programsError,
    enrollmentsError,
    patientUuid,
  ]);

  return null;
};

export default EnrollOmnibarProvider;
