#!/usr/bin/env python3
"""Menu bar companion for Todor. Shows the currently selected todo."""

import rumps
import json
import os

DIR = os.path.dirname(os.path.abspath(__file__))
SELECTION_FILE = os.path.join(DIR, "selection.json")


class TodorMenuBar(rumps.App):
    def __init__(self):
        super().__init__("Todor", quit_button="Quit")
        self.timer = rumps.Timer(self.refresh, 2)
        self.timer.start()
        self.refresh(None)

    def refresh(self, _):
        try:
            with open(SELECTION_FILE) as f:
                data = json.load(f)
            text = data.get("text")
            if text:
                display = text if len(text) <= 40 else text[:39] + "\u2026"
                self.title = "\u2713 " + display
            else:
                self.title = "Todor"
        except (FileNotFoundError, json.JSONDecodeError):
            self.title = "Todor"


if __name__ == "__main__":
    TodorMenuBar().run()
