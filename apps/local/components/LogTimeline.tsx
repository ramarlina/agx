"use client";

import { useState } from "react";

interface TaskComment {
  id: string;
  task_id: string;
  author_type?: "user" | "agent";
  author_id?: string;
  content: string;
  created_at: string;
}

interface LogTimelineProps {
  comments: TaskComment[];
  onAddComment: (content: string) => void;
  onDeleteComment?: (commentId: string) => Promise<void>;
}

export default function LogTimeline({ comments, onAddComment, onDeleteComment }: LogTimelineProps) {
  const [newComment, setNewComment] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newComment.trim() || isSubmitting) return;
    
    setIsSubmitting(true);
    try {
      await onAddComment(newComment);
      setNewComment("");
      setIsAdding(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (!onDeleteComment || deletingId) return;
    if (!confirm("Are you sure you want to delete this comment?")) return;
    
    setDeletingId(commentId);
    try {
      await onDeleteComment(commentId);
    } catch (error) {
      console.error("Failed to delete comment:", error);
    } finally {
      setDeletingId(null);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div className="space-y-4">
      {/* Add log button/form */}
      {!isAdding ? (
        <button
          onClick={() => setIsAdding(true)}
          className="w-full py-3 border-2 border-dashed border-[var(--card-border)] rounded-xl 
            text-[var(--muted-foreground)] hover:text-[var(--foreground)] 
            hover:border-[var(--primary)] hover:bg-[var(--primary-muted)]
            transition-all duration-200 text-sm font-medium
            focus-visible:outline-2 focus-visible:outline-[var(--ring)] focus-visible:outline-offset-2"
        >
          <span className="flex items-center justify-center gap-2">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add comment
          </span>
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3 animate-fade-in-up">
          <textarea
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            placeholder="Add context, decisions, or guidance..."
            className="input resize-none h-24 focus:ring-2 focus:ring-[var(--primary)]/20"
            autoFocus
            disabled={isSubmitting}
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!newComment.trim() || isSubmitting}
              className="btn-primary px-4 py-2 flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <span className="spinner w-4 h-4 border-2 border-white/20 border-t-white" />
                  Adding...
                </>
              ) : (
                "Add Comment"
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsAdding(false);
                setNewComment("");
              }}
              disabled={isSubmitting}
              className="btn-ghost px-4 py-2"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Log entries */}
      {comments.length === 0 ? (
        <div className="text-center py-12 animate-fade-in">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[var(--background)] border border-[var(--card-border)] mb-3">
            <span className="text-xl opacity-50">📝</span>
          </div>
          <p className="text-[var(--muted-foreground)] text-sm">
            No comments yet
          </p>
          <p className="text-[var(--muted-foreground)] text-xs mt-1">
            Add context and guidance for this task
          </p>
        </div>
      ) : (
        <div className="relative">
          {/* Timeline line */}
          <div className="timeline-line" />

          <div className="space-y-4">
            {comments.map((comment, index) => (
              <div 
                key={comment.id} 
                className="timeline-item relative pl-7 animate-fade-in-up"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                {/* Timeline dot */}
                <div className="timeline-dot" />

                <div className="card p-4 hover:border-[var(--primary)]/30 group">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-[var(--muted-foreground)] tabular-nums">
                        {formatDate(comment.created_at)}
                      </span>
                      {comment.author_type && (
                        <span className="text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                          {comment.author_type}
                        </span>
                      )}
                    </div>
                    {onDeleteComment && comment.author_type === "user" && (
                      <button
                        onClick={() => handleDelete(comment.id)}
                        disabled={deletingId === comment.id}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-[var(--muted-foreground)] hover:text-[var(--destructive)] p-1 rounded"
                        title="Delete comment"
                      >
                        {deletingId === comment.id ? (
                          <span className="spinner w-3 h-3 border-2 border-current border-t-transparent" />
                        ) : (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        )}
                      </button>
                    )}
                  </div>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{comment.content}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
