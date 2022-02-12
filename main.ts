import { App, Editor, MarkdownView, Modal, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

class HotKey {
    public meta: boolean;
    public shift: boolean;
    public ctrl: boolean;
    public alt: boolean;
    public key: string;

    public constructor (dict) {
	this.meta = dict.meta;
	this.shift = dict.shift;
	this.ctrl = dict.ctrl;
	this.alt = dict.alt;
	this.key = dict.key.toLowerCase();
    }
    
    public toString(): string {
	var name = "";
	if (this.alt == true) {
	    name += "A-";
	}
	if (this.ctrl == true) {
	    name += "C-";
	}
	if (this.meta == true) {
	    name += "M-";
	}
	if (this.shift == true) {
	    name += "S-";
	}
	return name + this.key;
    }
}

class Chord {
    public sequence: HotKey[];
    public command: string;

    public constructor (dict) {
	this.sequence = dict.sequence;
	this.command = dict.command;
    }
    
    // Check if other is a prefix of the current Chord
    // Returns: "NO", "YES", "FULL" when it is a complete match
    public checkPrefix(other: HotKey[]): string {
	for (const [index, hotkey] of this.sequence.entries()) {
	    let otherkey = other[index];
	    if (otherkey === undefined) {
		return "YES";
	    }
	    if ((hotkey.meta != otherkey.meta) ||
		(hotkey.shift != otherkey.shift) ||
		(hotkey.ctrl != otherkey.ctrl) ||
		(hotkey.alt != otherkey.alt) ||
		(hotkey.key != otherkey.key)) {
		return "NO";
	    }
	}
	return "FULL";
    }

    public chordToString(): string {
	return this.sequence.map(hk => hk.toString()).join(" ");
    }
}

interface Settings {
    hotkeys: Chord[];
}

const DEFAULT_SETTINGS: Settings = {
    hotkeys: [
	new Chord({ sequence: [
	    new HotKey({ key: 'x', meta: false, shift: false, ctrl: true, alt: false }),
	    new HotKey({ key: '3', meta: false, shift: false, ctrl: false, alt: false }),
	], command: "workspace:split-vertical" }),
	new Chord({ sequence: [
	    new HotKey({ key: 'x', meta: false, shift: false, ctrl: true, alt: false }),
	    new HotKey({ key: '2', meta: false, shift: false, ctrl: false, alt: false }),
	], command: "workspace:split-horizontal" }),
    ]
}

export default class HotkeysChordPlugin extends Plugin {
    public settings: Settings;

    private statusbar; // Points to our custom status bar
    private currentseq: HotKey[]; // List of currently pressed chords

    async onload() {
	// Convert each data to Chord and to HotKey
	let data = await this.loadData();
	data.hotkeys = data.hotkeys.map(chord => new Chord({
	    command: chord.command,
	    sequence: chord.sequence.map(hotkey => new HotKey(hotkey)),
	}));
	this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
	this.statusbar = this.addStatusBarItem();
	this.currentseq = [];

	this.updateStatusBar();
	this.registerEditorExtension(
	    Prec.highest(
		EditorView.domEventHandlers({
		    "keydown": this.handleKeyDown,
		})
	    )
	);
	this.addSettingTab(new HotkeysChordPluginSettingsTab(this.app, this));
    }

    async saveSettings() {
	await this.saveData(this.settings);
    }

    private updateStatusBar(): void {
	var chord = "None";
	if (this.currentseq.length > 0) {
	    chord = this.currentseq.map(hk => hk.toString()).join(" ");
	}
	this.statusbar.setText("Chord: " + chord);
    }
    
    private readonly handleKeyDown = (
	event: KeyboardEvent,
	cm: CodeMirror.Editor,
    ) => {
	if (event.key === 'Shift' || event.key === 'Meta' || event.key === 'Control' || event.key == 'Alt') {
	    console.debug("Skipping meta key: " + event.key);
	    return;
	}
	// Add the pressed keys to the current sequence and update on-screen
	let hotkey = new HotKey ({
	    key: event.key,
	    shift: event.shiftKey,
	    meta: event.metaKey,
	    ctrl: event.ctrlKey,
	    alt: event.altKey,
	});
	this.currentseq.push(hotkey);
	// We check whether the current sequence can be found in the hotkey database
	var partialMatch = false;
	for (let chord of this.settings.hotkeys) {
	    let result = chord.checkPrefix(this.currentseq);
	    if (result == "FULL") {
		(this.app as any).commands.executeCommandById(chord.command);
		event.preventDefault();
		event.stopPropagation();
		// new Notice(`Chord triggered ${chord.command}`);
		partialMatch = false;
		break;
	    } else if (result == "YES") {
		partialMatch = true;
	    }
	}
	// We also want to prevent default if this is a key inside a previous sequence or a partial match
	if ((this.currentseq.length > 1) || partialMatch) {
	    event.preventDefault();
	    event.stopPropagation();
	}
	if (!partialMatch) {
	    // No patial match, we get back to zero sequence
	    this.currentseq = [];
	}
	this.updateStatusBar();
    }
}

class HotkeysChordPluginSettingsTab extends PluginSettingTab {
    private readonly plugin: HotkeysChordPlugin;

    constructor(app: App, plugin: HotkeysChordPlugin) {
	super(app, plugin);
	this.plugin = plugin;
    }

    // Returns { name, id } for each of the application commands
    private readonly generateCommandList = (app: App): Command[] => {
	const commands: Command[] = [];
	for (const [key, value] of Object.entries((app as any).commands.commands)) {
	    commands.push({ name: value.name, id: value.id });
	}
	return commands;
    };

    public display(): void {
	const commands = this.generateCommandList(this.app);
	const {containerEl} = this;
	containerEl.empty();
	containerEl.createEl('h2', { text: 'Hotkeys Chord Plugin - Settings' });
	containerEl.createEl('p', { text: "Click on the buttons to change chords. Click again to end chord composition." });
	containerEl.createEl('h3', { text: 'Existing Hotkeys Chords' });
	// We do want to create a thing for each chord...
	this.plugin.settings.hotkeys.forEach((chord, index) => {
	    new ChordSetting(containerEl, "existing", chord, commands, async state => {
		if (state === undefined) {
		    this.plugin.settings.hotkeys.splice(index, 1); // Remove the element at index
		    await this.plugin.saveSettings();
		} else {
		    this.plugin.settings.hotkeys[index] = state;
		    await this.plugin.saveSettings();
		}
		this.display();
	    });
	});
	containerEl.createEl('h3', { text: 'Create new Chord' });
	// Important that it is a variable that is persisted across
	var newchord;
	if (newchord == undefined)
	    newchord = new Chord({ sequence: [], command: "invalid-placeholder" });
	new ChordSetting(containerEl, "new", newchord, commands, async state => {
	    this.plugin.settings.hotkeys.push(state);
	    await this.plugin.saveSettings();
	    newchord = new Chord({ sequence: [], command: "invalid-placeholder" });
	    this.display();
	});
    }
}

class ChordSetting extends Setting {
    private ctype;
    private chord;
    private commands;
    private cb;
    
    constructor (container, ctype, chord: Chord, commands, cb) {
	super(container);
	this.ctype = ctype;
	this.chord = chord;
	this.cb = cb;
	this.commands = commands;
	this.display();
    }

    public display(): void {
	// Do a search on the given command
	let cmdname = `${this.chord.command}`;
	for (let command of this.commands) {
	    if (command.id == this.chord.command)
		cmdname = command.name;
	}
	this.clear()
	    .addButton(btn => {
		var state = "inactive";
		var stopper = undefined;
		var text = "";
		if (this.chord.sequence.length > 0) {
		    text = this.chord.chordToString();
		} else {
		    text = "Choose a Chord";
		}
		btn.setButtonText(text)
		    .setTooltip("Change the Chord")
		    .onClick(() => {
			if (state === "inactive") {
			    state = "active";
			    btn.setButtonText("Type the Chord");
			    stopper = new ChordCapture((sequence, final) => {
				if (final) {
				    this.chord.sequence = sequence;
				    if (this.ctype == "existing")
					this.cb(this.chord);
				    else
					this.display();
				} else {
				    btn.setButtonText("*** " + sequence.map(hk => hk.toString()).join(" ") + " ***");
				}
			    });
			} else {
			    stopper();
			    state = "inactive";
			}
		    });
	    })
	    .addDropdown(dropdown => {
		dropdown.addOption("invalid-placeholder", "Select a Command");
		this.commands.forEach(cmd => dropdown.addOption(cmd.id, cmd.name));
		dropdown.onChange(newcmd => {
		    this.chord.command = newcmd;
		    if (this.ctype == "existing")
			this.cb(this.chord);
		    else
			this.display();
		});
		dropdown.setValue(this.chord.command);
	    })
	    .addExtraButton(btn => {
		if (this.ctype == "existing") {
		    btn.setIcon("cross")
			.setTooltip("Delete shortcut")
			.onClick(() => {
			    this.cb(undefined);
			});
		} else {
		    btn.setIcon("enter")
			.setTooltip("Add shortcut")
			.onClick(() => {
			    if ((this.chord.command === "invalid-placeholder") ||
				(this.chord.sequence.length == 0)) {
				new Notice("Please choose both a command and a chord!!!");
			    } else {
				this.cb(this.chord);
			    }
			});
		}
	    });
    }
}

class ChordCapture {
    constructor (cb) {
	var sequence = [];
	var keydownhandler = event => {
	    if (["Shift", "Meta", "Alt", "Control"].contains(event.key))
		return;
	    // We always want to remove further things for such events
	    event.preventDefault();
	    event.stopPropagation();
	    if (event.key === "Escape") {
		document.removeEventListener("keydown", keydownhandler);
		cb(sequence, true);
	    } else {
		let hotkey = new HotKey({
		    key: event.key,
		    meta: event.metaKey,
		    ctrl: event.ctrlKey,
		    alt: event.altKey,
		    shift: event.shiftKey,
		});
		sequence.push(hotkey);
		cb(sequence, false);
	    };
	};
	// Stop when this method is called
	var stopper = () => {
	    cb(sequence, true);
	    document.removeEventListener("keydown", keydownhandler);
	};
	document.addEventListener("keydown", keydownhandler);
	return stopper;
    }
}
