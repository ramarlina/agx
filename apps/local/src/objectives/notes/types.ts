export interface ObjectiveNoteFile {
  id: string;
  title: string;
  objectiveId: string;
  createdAt: string;
  updatedAt: string;
  body: string;
}

export interface ObjectiveNoteListOptions {
  page?: number;
  limit?: number;
}

export interface ObjectiveNotePage {
  notes: ObjectiveNoteFile[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}
