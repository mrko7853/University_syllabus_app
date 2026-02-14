import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { fetchAvailableSemesters } from '@/src/services/courses';
import type { Semester } from '@/src/types/course';

interface SemesterContextValue {
  semesters: Semester[];
  selectedSemester: Semester | null;
  loading: boolean;
  refreshSemesters: () => Promise<void>;
  setSelectedSemester: (semester: Semester) => void;
}

const SemesterContext = createContext<SemesterContextValue | undefined>(undefined);

export function SemesterProvider({ children }: { children: ReactNode }) {
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [selectedSemester, setSelectedSemesterState] = useState<Semester | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshSemesters = async () => {
    setLoading(true);
    try {
      const rows = await fetchAvailableSemesters();
      setSemesters(rows);

      setSelectedSemesterState((current) => {
        if (!rows.length) return null;
        if (!current) return rows[0];

        const existing = rows.find((semester) => semester.term === current.term && semester.year === current.year);
        return existing ?? rows[0];
      });
    } catch (error) {
      console.error('Failed to fetch semesters', error);
      setSemesters([]);
      setSelectedSemesterState(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshSemesters();
  }, []);

  const value = useMemo<SemesterContextValue>(() => {
    return {
      semesters,
      selectedSemester,
      loading,
      refreshSemesters,
      setSelectedSemester: setSelectedSemesterState,
    };
  }, [loading, selectedSemester, semesters]);

  return <SemesterContext.Provider value={value}>{children}</SemesterContext.Provider>;
}

export function useSemester() {
  const context = useContext(SemesterContext);
  if (!context) throw new Error('useSemester must be used within SemesterProvider');
  return context;
}
