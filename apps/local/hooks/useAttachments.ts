"use client";

import { useState, useCallback, useRef } from "react";
import { validateFile, validateMessageAttachments } from "@/lib/attachments";
import { normalizeAttachmentFiles } from "@/lib/chat/paste-attachments";
import type { Attachment } from "@/lib/types";

export type { Attachment };

export interface StagedAttachment {
  id: string;
  file: File;
  filename: string;
  mimeType: string;
  size: number;
  previewUrl: string | null;
  progress: number;
  status: "uploading" | "uploaded" | "failed";
  error?: string;
  serverId?: string; // server-side attachment ID after upload
}

export function useAttachments() {
  const [staged, setStaged] = useState<StagedAttachment[]>([]);
  const xhrRefs = useRef<Map<string, XMLHttpRequest>>(new Map());

  const uploadFile = useCallback((sa: StagedAttachment) => {
    const xhr = new XMLHttpRequest();
    xhrRefs.current.set(sa.id, xhr);

    const formData = new FormData();
    formData.append("file", sa.file);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const progress = Math.round((e.loaded / e.total) * 100);
        setStaged((prev) =>
          prev.map((s) => (s.id === sa.id ? { ...s, progress } : s))
        );
      }
    };

    xhr.onload = () => {
      xhrRefs.current.delete(sa.id);
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const data = JSON.parse(xhr.responseText);
          const serverAtt = data.attachments?.[0];
          if (serverAtt) {
            setStaged((prev) =>
              prev.map((s) =>
                s.id === sa.id
                  ? { ...s, status: "uploaded", progress: 100, serverId: serverAtt.id }
                  : s
              )
            );
            return;
          }
        } catch { /* fall through */ }
      }
      const errorMsg = (() => {
        try {
          return JSON.parse(xhr.responseText)?.error || "Upload failed";
        } catch {
          return "Upload failed";
        }
      })();
      setStaged((prev) =>
        prev.map((s) =>
          s.id === sa.id ? { ...s, status: "failed", error: errorMsg } : s
        )
      );
    };

    xhr.onerror = () => {
      xhrRefs.current.delete(sa.id);
      setStaged((prev) =>
        prev.map((s) =>
          s.id === sa.id ? { ...s, status: "failed", error: "Network error" } : s
        )
      );
    };

    xhr.open("POST", "/api/upload");
    xhr.send(formData);
  }, []);

  const stageFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = normalizeAttachmentFiles(Array.from(files));

      // Validate total message size including already staged
      const allFiles = [
        ...staged.map((s) => ({ name: s.filename, size: s.size, type: s.mimeType })),
        ...fileArray.map((f) => ({ name: f.name, size: f.size, type: f.type })),
      ];
      const totalError = validateMessageAttachments(allFiles);
      if (totalError) {
        alert(totalError.reason);
        return;
      }

      const newStaged: StagedAttachment[] = [];

      for (const file of fileArray) {
        const error = validateFile({ name: file.name, size: file.size, type: file.type });
        if (error) {
          newStaged.push({
            id: crypto.randomUUID(),
            file,
            filename: file.name,
            mimeType: file.type,
            size: file.size,
            previewUrl: null,
            progress: 0,
            status: "failed",
            error: error.reason,
          });
          continue;
        }

        const previewUrl = file.type.startsWith("image/")
          ? URL.createObjectURL(file)
          : null;

        const sa: StagedAttachment = {
          id: crypto.randomUUID(),
          file,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
          size: file.size,
          previewUrl,
          progress: 0,
          status: "uploading",
        };

        newStaged.push(sa);
      }

      setStaged((prev) => [...prev, ...newStaged]);

      // Start uploads
      for (const sa of newStaged) {
        if (sa.status === "uploading") {
          uploadFile(sa);
        }
      }
    },
    [staged, uploadFile]
  );

  const remove = useCallback((id: string) => {
    setStaged((prev) => {
      const item = prev.find((s) => s.id === id);
      if (item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
      // Abort in-flight upload
      const xhr = xhrRefs.current.get(id);
      if (xhr) {
        xhr.abort();
        xhrRefs.current.delete(id);
      }
      // Delete from server if uploaded
      if (item?.serverId) {
        fetch(`/api/upload/${item.serverId}`, { method: "DELETE" }).catch(() => {});
      }
      return prev.filter((s) => s.id !== id);
    });
  }, []);

  const retry = useCallback(
    (id: string) => {
      setStaged((prev) => {
        const item = prev.find((s) => s.id === id);
        if (!item || item.status !== "failed") return prev;
        const updated = prev.map((s) =>
          s.id === id ? { ...s, status: "uploading" as const, error: undefined, progress: 0 } : s
        );
        // Schedule upload after state update
        const sa = updated.find((s) => s.id === id)!;
        setTimeout(() => uploadFile(sa), 0);
        return updated;
      });
    },
    [uploadFile]
  );

  const clear = useCallback(() => {
    setStaged((prev) => {
      for (const s of prev) {
        if (s.previewUrl) URL.revokeObjectURL(s.previewUrl);
        const xhr = xhrRefs.current.get(s.id);
        if (xhr) xhr.abort();
      }
      xhrRefs.current.clear();
      return [];
    });
  }, []);

  const canSend = staged.length === 0 || staged.every((s) => s.status === "uploaded" || s.status === "failed");
  const hasUploaded = staged.some((s) => s.status === "uploaded");
  const uploadedItems = staged.filter((s) => s.status === "uploaded" && s.serverId);
  const attachmentIds = uploadedItems.map((s) => s.serverId!);

  /** Build Attachment[] metadata for optimistic display in sent messages */
  const getAttachmentMetas = useCallback((): Attachment[] => {
    return uploadedItems.map((s) => ({
      id: s.serverId!,
      filename: s.filename,
      mimeType: s.mimeType,
      size: s.size,
      status: "uploaded" as const,
      url: `/api/attachments/${s.serverId}`,
    }));
  }, [uploadedItems]);

  return { staged, stageFiles, remove, retry, clear, canSend, hasUploaded, attachmentIds, getAttachmentMetas };
}
