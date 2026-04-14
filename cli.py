#!/usr/bin/env python3
"""CLI for todo-app. Manipulates todos.json and completed.json directly."""

import json
import sys
import os
import uuid
import copy
from datetime import datetime

DIR = os.path.dirname(os.path.abspath(__file__))
DATA_FILE = os.path.join(DIR, "todos.json")
COMPLETED_FILE = os.path.join(DIR, "completed.json")


def load():
    if not os.path.exists(DATA_FILE):
        return []
    with open(DATA_FILE) as f:
        return json.load(f)


def save(todos):
    with open(DATA_FILE, "w") as f:
        json.dump(todos, f, indent=2)


def load_completed():
    if not os.path.exists(COMPLETED_FILE):
        return []
    with open(COMPLETED_FILE) as f:
        return json.load(f)


def save_completed(completed):
    with open(COMPLETED_FILE, "w") as f:
        json.dump(completed, f, indent=2)


def make_todo(text):
    return {
        "id": str(uuid.uuid4())[:8],
        "text": text,
        "completed": False,
        "notes": "",
        "created": datetime.now().isoformat(),
        "children": [],
    }


def find_by_path(todos, path):
    """Find a todo by dot-separated index path like '0', '1.2', '0.1.3'."""
    parts = [int(p) for p in path.split(".")]
    current = todos
    node = None
    for i, idx in enumerate(parts):
        if idx < 0 or idx >= len(current):
            print(f"Error: index {path} out of range")
            sys.exit(1)
        node = current[idx]
        if i < len(parts) - 1:
            current = node["children"]
    return node, current, parts[-1]


def print_todos(todos, indent=0):
    for i, t in enumerate(todos):
        check = "x" if t["completed"] else " "
        prefix = "  " * indent
        idx = str(i)
        due_str = ""
        if t.get("due") and indent == 0:
            from datetime import date
            try:
                due = date.fromisoformat(t["due"])
                diff = (due - date.today()).days
                if diff < 0:
                    due_str = f" ({abs(diff)}d overdue)"
                elif diff == 0:
                    due_str = " (due today)"
                elif diff == 1:
                    due_str = " (due tomorrow)"
                else:
                    due_str = f" ({diff}d left)"
            except ValueError:
                due_str = f" (due: {t['due']})"
        print(f"{prefix}[{check}] {idx}. {t['text']}{due_str}")
        if t.get("notes"):
            for line in t["notes"].split("\n"):
                print(f"{prefix}     | {line}")
        if t["children"]:
            print_todos(t["children"], indent + 1)


def complete_all(t):
    t["completed"] = True
    for c in t["children"]:
        complete_all(c)


def cmd_add(args):
    todos = load()
    parent_path = None
    due_date = None
    text_parts = []
    for a in args:
        if a.startswith("--parent="):
            parent_path = a.split("=", 1)[1]
        elif a.startswith("--due="):
            due_date = a.split("=", 1)[1]
        else:
            text_parts.append(a)
    text = " ".join(text_parts)
    if not text:
        print("Error: provide todo text")
        sys.exit(1)
    new = make_todo(text)
    if due_date:
        new["due"] = due_date
    if parent_path:
        node, _, _ = find_by_path(todos, parent_path)
        node["children"].append(new)
    else:
        todos.append(new)
    save(todos)
    print(f"Added: {text}")


def cmd_complete(args):
    todos = load()
    completed = load_completed()
    path = args[0]
    is_top_level = "." not in path

    node, parent_list, idx = find_by_path(todos, path)
    complete_all(node)
    node["completed_at"] = datetime.now().isoformat()

    # Add to completed record
    completed.insert(0, copy.deepcopy(node))
    save_completed(completed)

    if is_top_level:
        # Top-level: remove from active
        parent_list.pop(idx)
    # Sub-todo: stays in active (already marked completed)

    save(todos)
    print(f"Completed: {node['text']}")


def cmd_uncomplete(args):
    todos = load()
    path = args[0]
    node, _, _ = find_by_path(todos, path)
    node["completed"] = False
    save(todos)
    print(f"Uncompleted: {node['text']}")


def cmd_note(args):
    todos = load()
    path = args[0]
    note_text = " ".join(args[1:])
    node, _, _ = find_by_path(todos, path)
    node["notes"] = note_text
    save(todos)
    print(f"Note set on: {node['text']}")


def cmd_remove(args):
    todos = load()
    path = args[0]
    node, parent_list, idx = find_by_path(todos, path)
    removed = parent_list.pop(idx)
    save(todos)
    print(f"Removed: {removed['text']}")


def cmd_edit(args):
    todos = load()
    path = args[0]
    new_text = " ".join(args[1:])
    node, _, _ = find_by_path(todos, path)
    node["text"] = new_text
    save(todos)
    print(f"Edited: {new_text}")


def cmd_due(args):
    todos = load()
    path = args[0]
    node, _, _ = find_by_path(todos, path)
    if len(args) < 2 or args[1] == "clear":
        node.pop("due", None)
        save(todos)
        print(f"Due date cleared on: {node['text']}")
    else:
        node["due"] = args[1]
        save(todos)
        print(f"Due date set on: {node['text']} → {args[1]}")


def cmd_list(args):
    todos = load()
    if not todos:
        print("No todos.")
        return
    print_todos(todos)


def cmd_completed(args):
    completed = load_completed()
    if not completed:
        print("No completed todos.")
        return
    print("=== Completed ===")
    print_todos(completed)


def cmd_clear(args):
    save([])
    print("Cleared all todos.")


COMMANDS = {
    "add": cmd_add,
    "complete": cmd_complete,
    "done": cmd_complete,
    "uncomplete": cmd_uncomplete,
    "note": cmd_note,
    "remove": cmd_remove,
    "rm": cmd_remove,
    "edit": cmd_edit,
    "due": cmd_due,
    "list": cmd_list,
    "ls": cmd_list,
    "completed": cmd_completed,
    "clear": cmd_clear,
}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print("Usage: python3 cli.py <command> [args]")
        print(f"Commands: {', '.join(COMMANDS.keys())}")
        sys.exit(1)
    COMMANDS[sys.argv[1]](sys.argv[2:])
