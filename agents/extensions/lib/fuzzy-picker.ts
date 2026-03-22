/**
 * Shared fuzzy file/item picker components.
 *
 * Provides reusable UI for fuzzy-filtering and selecting items,
 * built on Input + SelectList + fuzzyFilter from pi-tui.
 */

import type {
  ExtensionAPI,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import {
  Container,
  fuzzyFilter,
  getKeybindings,
  Input,
  matchesKey,
  type SelectItem,
  SelectList,
  Spacer,
  Text,
} from "@mariozechner/pi-tui";
import path from "node:path";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const selectListTheme = (theme: any) => ({
  selectedPrefix: (text: string) => theme.fg("accent", text),
  selectedText: (text: string) => theme.fg("accent", text),
  description: (text: string) => theme.fg("muted", text),
  scrollInfo: (text: string) => theme.fg("dim", text),
  noMatch: (text: string) => theme.fg("warning", text),
});

const isSelectKey = (data: string): boolean => {
  const kb = getKeybindings();
  return (
    kb.matches(data, "tui.select.up") ||
    kb.matches(data, "tui.select.down") ||
    kb.matches(data, "tui.select.pageUp") ||
    kb.matches(data, "tui.select.pageDown")
  );
};

const isConfirm = (data: string): boolean =>
  getKeybindings().matches(data, "tui.select.confirm");
const isCancel = (data: string): boolean =>
  getKeybindings().matches(data, "tui.select.cancel");

const filterItems = (items: SelectItem[], query: string): SelectItem[] =>
  query
    ? fuzzyFilter(
        items,
        query,
        (item) => `${item.label} ${item.value} ${item.description ?? ""}`,
      )
    : items;

// ---------------------------------------------------------------------------
// Single-select fuzzy picker
// ---------------------------------------------------------------------------

export type FuzzyPickerOptions = {
  title: string;
  items: SelectItem[];
  hint?: string;
  maxVisible?: number;
  initialSelection?: string;
  /** Handle a custom key press. Return a value to resolve the picker, or undefined to ignore. */
  extraKeyHandler?: (
    key: string,
    selectedItem: SelectItem | null,
  ) => string | undefined;
};

/**
 * Show a fuzzy-filterable single-select picker.
 * Returns the selected item's `value`, or `null` on cancel.
 */
export async function showFuzzyPicker(
  ctx: ExtensionContext,
  options: FuzzyPickerOptions,
): Promise<string | null> {
  const {
    title,
    items,
    hint = "Type to filter • enter to select • esc to cancel",
    maxVisible = 12,
    initialSelection,
    extraKeyHandler,
  } = options;

  return ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    container.addChild(
      new Text(theme.fg("accent", theme.bold(` ${title}`)), 0, 0),
    );

    const searchInput = new Input();
    container.addChild(searchInput);
    container.addChild(new Spacer(1));

    const listContainer = new Container();
    container.addChild(listContainer);
    container.addChild(new Text(theme.fg("dim", hint), 0, 0));
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

    let filteredItems = items;
    let selectList: SelectList | null = null;

    const updateList = () => {
      listContainer.clear();
      if (filteredItems.length === 0) {
        listContainer.addChild(
          new Text(theme.fg("warning", "  No matches"), 0, 0),
        );
        selectList = null;
        return;
      }

      selectList = new SelectList(
        filteredItems,
        Math.min(filteredItems.length, maxVisible),
        selectListTheme(theme),
      );

      if (initialSelection) {
        const index = filteredItems.findIndex(
          (item) => item.value === initialSelection,
        );
        if (index >= 0) selectList.setSelectedIndex(index);
      }

      selectList.onSelect = (item) => done(item.value);
      selectList.onCancel = () => done(null);
      listContainer.addChild(selectList);
    };

    const applyFilter = () => {
      filteredItems = filterItems(items, searchInput.getValue());
      updateList();
    };

    applyFilter();

    return {
      render: (w: number) => container.render(w),
      invalidate: () => container.invalidate(),
      handleInput(data: string) {
        if (extraKeyHandler) {
          const result = extraKeyHandler(
            data,
            selectList?.getSelectedItem() ?? null,
          );
          if (result !== undefined) {
            done(result);
            return;
          }
        }

        if (isSelectKey(data)) {
          selectList?.handleInput(data);
          tui.requestRender();
          return;
        }
        if (isConfirm(data)) {
          if (selectList) selectList.handleInput(data);
          else done(null);
          tui.requestRender();
          return;
        }
        if (isCancel(data)) {
          if (selectList) selectList.handleInput(data);
          else done(null);
          tui.requestRender();
          return;
        }

        searchInput.handleInput(data);
        applyFilter();
        tui.requestRender();
      },
    };
  });
}

// ---------------------------------------------------------------------------
// Multi-select fuzzy picker
// ---------------------------------------------------------------------------

export type FuzzyMultiPickerOptions = {
  title: string;
  items: SelectItem[];
  hint?: string;
  maxVisible?: number;
};

/**
 * Show a fuzzy-filterable multi-select picker.
 * Tab toggles selection on the highlighted item.
 * Enter confirms (if nothing was toggled, the highlighted item is returned).
 * Returns an array of selected `value` strings, or `[]` on cancel.
 */
export async function showFuzzyMultiPicker(
  ctx: ExtensionContext,
  options: FuzzyMultiPickerOptions,
): Promise<string[]> {
  const {
    title,
    items,
    hint = "Type to filter • tab to toggle • enter to confirm • esc to cancel",
    maxVisible = 12,
  } = options;

  const selected = new Set<string>();

  const result = await ctx.ui.custom<string[] | null>(
    (tui, theme, _kb, done) => {
      const container = new Container();
      container.addChild(
        new DynamicBorder((s: string) => theme.fg("accent", s)),
      );
      container.addChild(
        new Text(theme.fg("accent", theme.bold(` ${title}`)), 0, 0),
      );

      const searchInput = new Input();
      container.addChild(searchInput);

      const selectionInfo = new Text("", 0, 0);
      container.addChild(selectionInfo);
      container.addChild(new Spacer(1));

      const listContainer = new Container();
      container.addChild(listContainer);
      container.addChild(new Text(theme.fg("dim", hint), 0, 0));
      container.addChild(
        new DynamicBorder((s: string) => theme.fg("accent", s)),
      );

      let filteredItems = items;
      let selectList: SelectList | null = null;
      let currentIndex = 0;

      const updateSelectionInfo = () => {
        if (selected.size === 0) {
          selectionInfo.setText("");
        } else {
          const summary = [...selected].join(", ");
          const display =
            summary.length > 60 ? `${summary.slice(0, 57)}...` : summary;
          selectionInfo.setText(
            theme.fg("muted", ` Selected (${selected.size}): ${display}`),
          );
        }
      };

      const decorateItems = (): SelectItem[] =>
        filteredItems.map((item) => ({
          ...item,
          label: `${selected.has(item.value) ? "● " : "○ "}${item.label}`,
        }));

      const updateList = () => {
        listContainer.clear();
        updateSelectionInfo();

        const decorated = decorateItems();
        if (decorated.length === 0) {
          listContainer.addChild(
            new Text(theme.fg("warning", "  No matches"), 0, 0),
          );
          selectList = null;
          return;
        }

        selectList = new SelectList(
          decorated,
          Math.min(decorated.length, maxVisible),
          selectListTheme(theme),
        );
        selectList.setSelectedIndex(
          Math.min(currentIndex, decorated.length - 1),
        );
        selectList.onSelect = () => done([...selected]);
        selectList.onCancel = () => done(null);
        listContainer.addChild(selectList);
      };

      const applyFilter = () => {
        filteredItems = filterItems(items, searchInput.getValue());
        currentIndex = 0;
        updateList();
      };

      applyFilter();

      return {
        render: (w: number) => container.render(w),
        invalidate: () => container.invalidate(),
        handleInput(data: string) {
          // Tab toggles selection on the highlighted item
          if (matchesKey(data, "tab")) {
            const current = selectList?.getSelectedItem();
            if (current) {
              if (selected.has(current.value)) {
                selected.delete(current.value);
              } else {
                selected.add(current.value);
              }
              // Save position before rebuild
              const idx = filteredItems.findIndex(
                (i) => i.value === current.value,
              );
              if (idx >= 0) currentIndex = idx;
              updateList();
            }
            tui.requestRender();
            return;
          }

          if (isSelectKey(data)) {
            selectList?.handleInput(data);
            // Track cursor position
            const sel = selectList?.getSelectedItem();
            if (sel) {
              const idx = filteredItems.findIndex((i) => i.value === sel.value);
              if (idx >= 0) currentIndex = idx;
            }
            tui.requestRender();
            return;
          }

          if (isConfirm(data)) {
            if (selected.size === 0) {
              // Nothing toggled — use the highlighted item
              const current = selectList?.getSelectedItem();
              if (current) {
                done([current.value]);
                return;
              }
            }
            done([...selected]);
            return;
          }

          if (isCancel(data)) {
            done(null);
            return;
          }

          searchInput.handleInput(data);
          applyFilter();
          tui.requestRender();
        },
      };
    },
  );

  return result ?? [];
}

// ---------------------------------------------------------------------------
// Repository file listing
// ---------------------------------------------------------------------------

/**
 * List files and directories in a git repository as SelectItem[].
 * Falls back to an empty list for non-git directories.
 * Directories are listed first, labelled with [dir].
 */
export async function listRepoFiles(
  pi: ExtensionAPI,
  cwd: string,
): Promise<SelectItem[]> {
  const rootResult = await pi.exec("git", ["rev-parse", "--show-toplevel"], {
    cwd,
  });
  const gitRoot = rootResult.code === 0 ? rootResult.stdout.trim() : null;
  if (!gitRoot) return [];

  const allFiles = new Set<string>();
  const dirs = new Set<string>();

  const addFile = (relativePath: string) => {
    if (!relativePath) return;
    allFiles.add(relativePath);
    let dir = path.dirname(relativePath);
    while (dir && dir !== ".") {
      dirs.add(dir);
      dir = path.dirname(dir);
    }
  };

  const tracked = await pi.exec("git", ["ls-files", "-z"], { cwd: gitRoot });
  if (tracked.code === 0 && tracked.stdout) {
    for (const f of tracked.stdout.split("\0")) addFile(f);
  }

  const untracked = await pi.exec(
    "git",
    ["ls-files", "-z", "--others", "--exclude-standard"],
    { cwd: gitRoot },
  );
  if (untracked.code === 0 && untracked.stdout) {
    for (const f of untracked.stdout.split("\0")) addFile(f);
  }

  // Compute display paths relative to cwd (not git root)
  const relativeDisplay = (repoRelative: string): string => {
    const absolute = path.resolve(gitRoot, repoRelative);
    const rel = path.relative(cwd, absolute);
    return rel.startsWith("..") ? absolute : rel;
  };

  const items: SelectItem[] = [];

  for (const dir of [...dirs].sort()) {
    const display = relativeDisplay(dir);
    items.push({ value: display, label: display, description: "[dir]" });
  }

  for (const file of [...allFiles].sort()) {
    const display = relativeDisplay(file);
    items.push({ value: display, label: display });
  }

  return items;
}
