export type ObjectiveActivityType = "metric-check" | "status-update" | "milestone" | "note";

export interface ObjectiveActivityFile {
  id: string;
  source: string;
  objectiveLabel: string;
  createdAt: string;
  type: ObjectiveActivityType;
  body: string;
}

export interface ObjectiveActivityListOptions {
  type?: ObjectiveActivityType;
  source?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}

export interface ObjectiveActivityPage {
  activities: ObjectiveActivityFile[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}
