import React, { useState } from "react";
import { UserPreferences } from "@/types/userPreferences";
import { WorkspaceRootsList } from "@/components/WorkspaceRootsList";

export interface PreferencesPanelProps {
  preferences: UserPreferences;
  onUpdate: (patch: Partial<UserPreferences>) => void;
}

export const PreferencesPanel: React.FC<PreferencesPanelProps> = ({
  preferences,
  onUpdate,
}) => {
  // homeSearchConsent confirmation state
  const [consentPending, setConsentPending] = useState(false);
  // fileIgnorePatterns input state
  const [patternInput, setPatternInput] = useState("");

  // WorkspaceRoots handlers
  const handleAddRoot = (path: string) => {
    onUpdate({ workspaceRoots: [...preferences.workspaceRoots, path] });
  };
  const handleRemoveRoot = (path: string) => {
    onUpdate({ workspaceRoots: preferences.workspaceRoots.filter((r) => r !== path) });
  };

  // homeSearchConsent toggle handler
  const handleConsentToggle = () => {
    if (!preferences.homeSearchConsent) {
      // Enabling: require confirmation
      setConsentPending(true);
    } else {
      // Disabling: apply immediately
      onUpdate({ homeSearchConsent: false });
    }
  };
  const handleConsentConfirm = () => {
    onUpdate({ homeSearchConsent: true });
    setConsentPending(false);
  };
  const handleConsentCancel = () => {
    setConsentPending(false);
  };

  // fileIgnorePatterns handlers
  const handleAddPattern = () => {
    const trimmed = patternInput.trim();
    if (trimmed && !preferences.fileIgnorePatterns.includes(trimmed)) {
      onUpdate({ fileIgnorePatterns: [...preferences.fileIgnorePatterns, trimmed] });
      setPatternInput("");
    }
  };
  const handleRemovePattern = (pattern: string) => {
    onUpdate({
      fileIgnorePatterns: preferences.fileIgnorePatterns.filter((p) => p !== pattern),
    });
  };

  return (
    <div className="preferences-panel flex flex-col gap-6 px-4 sm:px-6">
      {/* Workspace Roots */}
      <section className="preferences-section">
        <h3>Workspace Folders</h3>
        <WorkspaceRootsList
          roots={preferences.workspaceRoots}
          onAdd={handleAddRoot}
          onRemove={handleRemoveRoot}
        />
      </section>

      {/* Home Search Consent */}
      <section className="preferences-section">
        <h3 id="pref-home-search-heading">Home Directory Search</h3>
        <label className="preferences-toggle" htmlFor="pref-home-search-checkbox">
          <input
            id="pref-home-search-checkbox"
            type="checkbox"
            checked={preferences.homeSearchConsent}
            onChange={handleConsentToggle}
            aria-describedby="pref-home-search-desc"
          />
          Allow searching home directory
        </label>
        <p id="pref-home-search-desc" className="preferences-field-desc text-sm text-muted-foreground">
          When enabled, file suggestions may include files from your home directory.
        </p>
        {consentPending && (
          <div
            className="preferences-consent-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pref-consent-dialog-title"
          >
            <p id="pref-consent-dialog-title">
              Enabling this allows file suggestions from your home directory. This may
              expose personal files. Continue?
            </p>
            <button onClick={handleConsentConfirm}>Enable</button>
            <button onClick={handleConsentCancel}>Cancel</button>
          </div>
        )}
      </section>

      {/* File Ignore Patterns */}
      <section className="preferences-section">
        <h3>File Ignore Patterns</h3>
        {preferences.fileIgnorePatterns.length === 0 ? (
          <p className="preferences-empty">No custom ignore patterns. Add one below.</p>
        ) : (
          <ul>
            {preferences.fileIgnorePatterns.map((pattern) => (
              <li key={pattern} className="preferences-pattern-item">
                <code>{pattern}</code>
                <button
                  aria-label={`Remove pattern ${pattern}`}
                  onClick={() => handleRemovePattern(pattern)}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="preferences-pattern-input flex flex-col sm:flex-row gap-2">
          <label htmlFor="pref-pattern-input" className="sr-only">
            Add ignore pattern
          </label>
          <input
            id="pref-pattern-input"
            type="text"
            value={patternInput}
            onChange={(e) => setPatternInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAddPattern()}
            placeholder="e.g. *.log or node_modules"
            aria-label="Add ignore pattern"
          />
          <button onClick={handleAddPattern} aria-label="Add pattern">
            Add
          </button>
        </div>
      </section>
    </div>
  );
};

export default PreferencesPanel;
