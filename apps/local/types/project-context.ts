export interface ProjectRepo {
  id?: string;
  project_id?: string;
  name: string;
  path?: string | null;
  git_url?: string | null;
  notes?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Project {
  id: string;
  user_id?: string;
  name: string;
  slug: string;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
  ci_cd_info?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ProjectContext {
  project: Project | null;
  repos: ProjectRepo[];
  learnings: string[];
}
