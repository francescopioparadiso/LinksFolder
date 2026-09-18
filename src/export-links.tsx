import { useState, useEffect } from "react";
import {
  ActionPanel,
  Action,
  Form,
  Icon,
  showToast,
  Toast,
  environment,
  getPreferenceValues,
  showInFinder,
  LocalStorage,
  popToRoot,
} from "@raycast/api";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { fileURLToPath } from "url";

function getPreferencePath(): string | undefined {
  try {
    const prefs = getPreferenceValues<Preferences>();
    return prefs.linksPath?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function getExportSourcePath(): string | undefined {
  const prefPath = getPreferencePath();
  const candidates = [
    prefPath,
    path.join(environment.supportPath, "links.json"),
    path.join(environment.assetsPath, "links.json"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  return candidates.find((candidate) => fs.existsSync(candidate));
}

// Helper to format date as YYYY-MM-DDTHH.MM.SS
function getFormattedDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}.${minutes}.${seconds}`;
}

type Location = { path: string; title: string };

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function displayPath(dir: string): string {
  const home = os.homedir();
  return dir.startsWith(home + path.sep) ? `~${dir.slice(home.length)}` : dir;
}

// Accepts what people actually paste: ~/Documents, "/quoted/path", file:///Users/me/Folder/, trailing slashes
function resolveTypedPath(input: string): string {
  let value = input.trim().replace(/^["']|["']$/g, "");
  if (value.startsWith("file://")) {
    try {
      value = fileURLToPath(value);
    } catch {
      // keep the raw text, the folder check below reports it
    }
  }
  if (value === "~" || value.startsWith("~/")) value = path.join(os.homedir(), value.slice(1));
  return path.resolve(value);
}

// The native folder dialog of Form.FilePicker makes Raycast hide its window, so the extension never receives the
// chosen folder. Locations are picked from a dropdown, or typed/pasted into a text field, instead.
function getLocations(remembered?: string): Location[] {
  const home = os.homedir();
  const standard: Location[] = [
    { path: path.join(home, "Downloads"), title: "Downloads" },
    { path: path.join(home, "Desktop"), title: "Desktop" },
    { path: path.join(home, "Documents"), title: "Documents" },
    ...(process.platform === "darwin"
      ? [{ path: path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs"), title: "iCloud Drive" }]
      : []),
    { path: home, title: "Home" },
  ].filter((location) => isDirectory(location.path));

  if (!remembered) return standard;

  // The last used folder goes first so it is preselected, without duplicating a standard location
  const known = standard.find((location) => location.path === remembered);
  return [known ?? { path: remembered, title: displayPath(remembered) }, ...standard.filter((l) => l !== known)];
}

export default function ExportCommand() {
  const [locations, setLocations] = useState<Location[]>([]);
  const [selected, setSelected] = useState("");
  const [customPath, setCustomPath] = useState("");
  const [customPathError, setCustomPathError] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(true);

  // Load the last used folder from LocalStorage on mount and preselect it
  useEffect(() => {
    (async () => {
      let remembered: string | undefined;
      try {
        const stored = await LocalStorage.getItem<string>("lastExportFolder");
        if (stored && isDirectory(stored)) remembered = stored;
      } catch {
        // fall back to the default locations
      }
      const list = getLocations(remembered);
      setLocations(list);
      setSelected(list[0]?.path ?? os.homedir());
      setIsLoading(false);
    })();
  }, []);

  async function handleSubmit() {
    const typed = customPath.trim();
    const destFolder = typed ? resolveTypedPath(typed) : selected;

    if (!destFolder || !isDirectory(destFolder)) {
      setCustomPathError("This folder doesn't exist");
      await showToast({ style: Toast.Style.Failure, title: "Folder not found", message: destFolder });
      return;
    }

    const sourcePath = getExportSourcePath();

    if (!sourcePath) {
      await showToast({
        style: Toast.Style.Failure,
        title: "No links found",
        message: "You haven't saved any links yet.",
      });
      return;
    }

    try {
      const fileName = `LinksFolder_JsonFile_${getFormattedDateString()}.json`;
      const exportPath = path.join(destFolder, fileName);

      // Copy the JSON to the chosen directory
      fs.copyFileSync(sourcePath, exportPath);

      // Save this folder choice for the next time
      await LocalStorage.setItem("lastExportFolder", destFolder);

      await showToast({
        style: Toast.Style.Success,
        title: "Exported Successfully",
        message: `Saved as ${fileName}`,
        primaryAction: {
          title: "Show in Finder",
          onAction: () => showInFinder(exportPath),
        },
      });

      popToRoot();
    } catch (error) {
      console.error("Export failed:", error);
      await showToast({
        style: Toast.Style.Failure,
        title: "Export Failed",
        message: String(error),
      });
    }
  }

  if (isLoading) {
    return <Form isLoading={true} />;
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Export Links" icon={Icon.Download} onSubmit={handleSubmit} />
        </ActionPanel>
      }
    >
      <Form.Description text="Choose a destination to export your links.json file. Raycast will remember this location for your next export." />

      <Form.Dropdown id="destination" title="Save Location" value={selected} onChange={setSelected}>
        {locations.map((location) => (
          <Form.Dropdown.Item key={location.path} value={location.path} title={location.title} icon={Icon.Folder} />
        ))}
      </Form.Dropdown>

      <Form.TextField
        id="customPath"
        title="Other Folder"
        placeholder="Optional: paste a folder path"
        info="Overrides Save Location. In Finder, select a folder and press ⌥⌘C to copy its path, then paste it here. ~ works too."
        value={customPath}
        onChange={(value) => {
          setCustomPath(value);
          setCustomPathError(undefined);
        }}
        error={customPathError}
      />
    </Form>
  );
}
