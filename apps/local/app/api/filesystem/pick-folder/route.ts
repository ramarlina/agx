import { NextResponse } from "next/server";
import { execSync } from "node:child_process";
import os from "node:os";

export async function POST() {
  const platform = os.platform();

  try {
    let selected: string | null = null;

    if (platform === "darwin") {
      // macOS: use osascript to open native folder picker
      const result = execSync(
        `osascript -e 'set folderPath to POSIX path of (choose folder with prompt "Select a repository folder")' 2>/dev/null`,
        { encoding: "utf-8", timeout: 120_000 }
      ).trim();
      if (result) selected = result.replace(/\/$/, ""); // remove trailing slash
    } else if (platform === "linux") {
      // Linux: try zenity, then kdialog
      try {
        selected = execSync(
          `zenity --file-selection --directory --title="Select a repository folder" 2>/dev/null`,
          { encoding: "utf-8", timeout: 120_000 }
        ).trim();
      } catch {
        try {
          selected = execSync(
            `kdialog --getexistingdirectory ~ 2>/dev/null`,
            { encoding: "utf-8", timeout: 120_000 }
          ).trim();
        } catch {
          return NextResponse.json(
            { error: "No folder picker available. Install zenity or kdialog." },
            { status: 500 }
          );
        }
      }
    } else if (platform === "win32") {
      // Windows: PowerShell folder picker
      const ps = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select a repository folder'; if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath } else { '' }`;
      selected = execSync(`powershell -Command "${ps}"`, {
        encoding: "utf-8",
        timeout: 120_000,
      }).trim();
    }

    if (!selected) {
      return NextResponse.json({ cancelled: true }, { status: 200 });
    }

    return NextResponse.json({ path: selected });
  } catch {
    // User cancelled the dialog (osascript returns non-zero on cancel)
    return NextResponse.json({ cancelled: true }, { status: 200 });
  }
}
