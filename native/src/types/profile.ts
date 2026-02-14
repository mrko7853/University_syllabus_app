import type { CourseSelection } from './course';

export interface Profile {
  id: string;
  courses_selection: CourseSelection[];
}
