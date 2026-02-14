export type AssignmentStatus = 'not_started' | 'ongoing' | 'completed';

export interface Assignment {
  id: string;
  user_id: string;
  title: string;
  due_date: string | null;
  status: AssignmentStatus;
  instructions: string | null;
  course_code: string | null;
  course_tag_name: string | null;
  course_tag_color: string | null;
  course_year: string | null;
  course_term: string | null;
  assignment_icon: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}

export interface AssignmentWritePayload {
  title: string;
  due_date: string | null;
  status: AssignmentStatus;
  instructions: string;
  course_code: string | null;
  course_tag_name: string | null;
  course_tag_color: string;
  course_year: string | null;
  course_term: string | null;
  assignment_icon: string | null;
}
