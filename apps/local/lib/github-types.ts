export type GithubPrState = "open" | "closed" | "merged";
export type GithubCiStatus = "success" | "failure" | "pending" | null;
export type GithubReviewDecision =
  | "approved"
  | "changes_requested"
  | "review_required"
  | null;

export interface GithubRepo {
  id: string; // "owner/repo"
  owner: string;
  name: string;
  defaultBranch: string | null;
  private: boolean;
  accessRevoked: boolean;
  addedAt: number;
  lastSyncedAt: number | null;
}

export interface GithubReviewer {
  login: string;
  state:
    | "pending"
    | "approved"
    | "changes_requested"
    | "commented"
    | "dismissed";
}

export interface GithubPr {
  id: string; // "owner/repo#123"
  repoId: string; // "owner/repo"
  number: number;
  title: string;
  body: string;
  state: GithubPrState;
  draft: boolean;
  authorLogin: string;
  headRef: string;
  headSha: string;
  baseRef: string;
  url: string;
  ciStatus: GithubCiStatus;
  reviewDecision: GithubReviewDecision;
  assignees: string[];
  reviewers: GithubReviewer[];
  labels: string[];
  createdAt: number;
  updatedAt: number;
  mergedAt: number | null;
  closedAt: number | null;
  lastSyncedAt: number;
}

export type GithubIssueState = "open" | "closed";

export interface GithubIssue {
  id: string; // "owner/repo!123" (! distinguishes from PR "#")
  repoId: string;
  number: number;
  title: string;
  body: string;
  state: GithubIssueState;
  authorLogin: string;
  url: string;
  assignees: string[];
  labels: string[];
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
  lastSyncedAt: number;
}

export type PrLinkSource = "branch" | "title" | "body" | "manual";
export type TrackerTargetType = "agx_task" | "linear_issue" | "jira_issue";

export interface PrLink {
  prId: string;
  targetType: TrackerTargetType;
  targetId: string;
  linkSource: PrLinkSource;
  createdAt: number;
}

export type GithubPrCommentKind = "issue_comment" | "review" | "review_comment";

export interface GithubPrComment {
  id: string;
  prId: string;
  kind: GithubPrCommentKind;
  authorLogin: string;
  body: string;
  path: string | null;
  line: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface GithubTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  login: string;
  scopes: string[];
}
