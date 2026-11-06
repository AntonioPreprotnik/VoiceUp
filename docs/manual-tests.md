# Manual tests

The checks automation can't reach: the real installer, a real first login, a real microphone, the hotkey over a fullscreen app and the uninstaller. Run the whole list on a clean VM before every friend release (`/release` asks for it), and copy the results table at the end into the release notes.

Each check says what to do and what must happen. If something else happens, it fails: write down what you saw and open an issue. Leave the logs out unless they're at the default level (Help > Open logs folder).

## 0. Set up the VM (once)

Windows Home has no Windows Sandbox, so use VirtualBox.

1. Install VirtualBox, and download the **Windows 11 Enterprise evaluation** ISO (Microsoft Evaluation Center, 90 days).
2. Create a VM: 4 CPUs, 8 GB RAM, 64 GB disk, the ISO as its disc. Under **Audio**, tick **Enable Audio Input**, or the VM has no microphone.
3. Install Windows with a local account. Don't install Git, Node, Claude Code, Chrome or Brave.
4. Install the VirtualBox Guest Additions, restart, and take a snapshot named **Clean**.

Before each run: restore **Clean**, start the VM, and allow it to use your microphone if the host asks. You also need your Claude Pro or Max login and the release's `VoiceUp Setup <version>.exe` with `SHA256SUMS.txt`.

Never run the real-named installer or uninstaller on your own Windows account: it shares `%APPDATA%\VoiceUp` with your daily copy, and the uninstaller can delete that folder.

## 1. Install

From a browser download, as a friend would (S6.1, S6.7).

- [ ] **1.1** In the VM, download the installer and `SHA256SUMS.txt` from the GitHub release with Edge. The steps in `docs/install.md` match what Edge shows ("Keep").
- [ ] **1.2** `Get-FileHash '.\VoiceUp Setup <version>.exe'` matches its line in `SHA256SUMS.txt`.
- [ ] **1.3** Run it. **Windows protected your PC** appears; **More info** shows the file name and **Unknown publisher**, and **Run anyway** starts the installer, as `docs/install.md` says.
- [ ] **1.4** No administrator prompt (UAC) appears: it installs per user.
- [ ] **1.5** Afterwards, VoiceUp is in the Start menu, and the installer is at most 150 MB (TECH_SPEC §1), because no model is inside it.

## 2. First-run wizard

Start VoiceUp from the Start menu. The wizard opens (S6.2).

- [ ] **2.1 Claude Code.** The step says Claude Code is missing, shows the exact command it will run (`irm https://claude.ai/install.ps1 | iex`) and waits for your consent. It notes that Git for Windows is optional. On consent its output is visible, and the step then finds Claude without restarting VoiceUp and shows its version (S6.3).
- [ ] **2.2 Project folder.** Continue stays off until you choose a folder. Choose a new empty one (S6.11).
- [ ] **2.3 Quit and resume.** Quit with the window's X during the next step, then start VoiceUp again. The wizard comes back at that step, with the earlier steps still done.
- [ ] **2.4 Sign in.** Claude starts in the terminal beside the wizard. Its own workspace trust prompt appears for the new folder, and the wizard explains it. Before you accept it, the status bar says **Starting**, and the hotkey sends nothing.
- [ ] **2.5** Accept the trust prompt and log in through Claude's own flow, which opens Edge. VoiceUp never asks for your password. Write down whether the session continued after login or needed a restart, because S6.4 needs to know.
- [ ] **2.6** Press the sign-in test. It passes when Claude answers. If it goes to "unknown" instead, write down what the terminal showed (S6.4 open question).
- [ ] **2.7 Speech model.** The download shows its progress, in the wizard and in the title bar. Disconnect the VM's network halfway (VirtualBox: Devices > Network > untick Connect Network Adapter): it says **Speech model download failed**. Reconnect and retry: it resumes rather than starting over (S6.5).
- [ ] **2.8 Claude in Chrome.** With no Chrome or Brave, the step says to install one. Install Chrome, check again, and open the store page from the step. Add the extension and sign into it with the same Claude account. The step detects it (S6.8).
- [ ] **2.9** Run the browser test with Chrome closed. VoiceUp opens Chrome, and the test passes only after Claude opens the page (S6.9).
- [ ] **2.10 Microphone and hotkey.** Press Ctrl+Shift+Space and say "hello Claude". The transcript shows in the wizard and isn't sent to Claude.
- [ ] **2.11** Finish. The terminal opens with Claude ready.

## 3. The M4 goal

- [ ] **3.1** With the wizard finished, click into another app, press the hotkey and say "open example.com in the browser and tell me its title". Claude receives it, Chrome opens the page, and Claude answers with the title. This is the M4 goal: from the `.exe` to a working voice session with Chrome on a clean machine.

## 4. Voice from a fullscreen app

Exclusive fullscreen works poorly in a VM. Run 4.2 and 4.3 on a real PC with a test copy if the VM can't show them.

- [ ] **4.1** Open Edge fullscreen with F11, press the hotkey and say a short command. The overlay shows over the page without taking focus, and Claude receives the text.
- [ ] **4.2** In a game running in **borderless** fullscreen, do the same. The game keeps focus and keeps your keys.
- [ ] **4.3** In a game running in **exclusive** fullscreen, do the same. Write down whether the hotkey fires and whether the overlay shows. This answers TECH_SPEC §11, "Does `globalShortcut` fire while a fullscreen exclusive game has focus?"

## 5. A permission prompt never receives text

The most important safety check: spoken text must never answer one of Claude's questions.

- [ ] **5.1** Say "create a file called test.txt containing hello". Claude asks for permission. The status bar and tray say **Needs permission**.
- [ ] **5.2** While the prompt is showing, press the hotkey and say "yes, do it". The overlay says it's waiting for you, with "Not sent yet", and nothing appears in Claude's prompt. Claude is still asking.
- [ ] **5.3** Press the hotkey once more to try again: still nothing is sent. Press Esc to discard it.
- [ ] **5.4** Answer the prompt by hand with **No**. The status bar says **Paused**, because Claude sends no hook after a No, and the hotkey sends nothing. Choosing **Re-arm voice** from the tray makes voice work again.
- [ ] **5.5** The queue is on by default. Say "create five files called one.txt to five.txt, one at a time", and while Claude works, say a second command: it shows as queued in the status bar. When a permission prompt appears, the queued text stays queued and isn't typed. Answer **Yes** by hand each time: once Claude has finished, the queued command is sent.

## 6. Failures that need real hardware

TECH_SPEC §6.6 lists every failure and its automated test. These need the real thing.

- [ ] **6.1 Microphone blocked.** In Windows Settings > Privacy > Microphone, turn off **Let desktop apps access your microphone**. Press the hotkey: VoiceUp says **Windows is blocking the microphone**, and names that setting. It may say **The microphone could not start** instead, which gives the same setting. Write down which one showed: S3.6 never saw this for real. Turn it back on.
- [ ] **6.2 Microphone unplugged.** During a recording, untick **Audio Input** in VirtualBox (Devices > Audio), or unplug a USB mic. VoiceUp says **No microphone found**, and the recording stops.
- [ ] **6.3 Offline turn.** Disconnect the network and say a command. VoiceUp says **Claude couldn't answer**, and Claude's own error shows in the terminal. Reconnect: the next command works. Write down Claude's error text: S7.2 has not recorded it.
- [ ] **6.4 Extension off.** In Chrome, turn off the Claude extension and ask Claude to open a page. VoiceUp says **Claude can't reach your browser**, with the `/chrome` fix. Turn it back on.
- [ ] **6.5 API key.** Restore **Clean**, set a user environment variable `ANTHROPIC_API_KEY=not-a-real-key`, install, and reach Sign in. The wizard warns that an API key bills the API, and still lets you continue. Remove the variable afterwards.

## 7. Tray and startup

- [ ] **7.1** Close the terminal with X. A notice says **VoiceUp is still running**, the tray icon stays, and the hotkey still works. Clicking the tray icon brings the window back (S7.1).
- [ ] **7.2** Tick **Pause listening** in the tray menu: the hotkey does nothing, and the tooltip says listening is paused. Untick it: the hotkey works again.
- [ ] **7.3** Turn on **Start with Windows** in Settings, sign out and back in. VoiceUp starts in the tray, with no window, and the hotkey works.

## 8. Uninstall

- [ ] **8.1** Quit VoiceUp from the tray. In Settings > Apps, uninstall VoiceUp. It asks whether to also delete your settings, speech models and logs. Answer **No**: `%APPDATA%\VoiceUp` is still there.
- [ ] **8.2** Reinstall and start it: it skips the wizard and keeps your folder and model.
- [ ] **8.3** Uninstall again and answer **Yes**: `%APPDATA%\VoiceUp` is gone. The Start menu entry is gone too, and so is the `app.voiceup.desktop` value under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` if Start with Windows was on.
- [ ] **8.4** Claude Code, Chrome and the extension are still installed. VoiceUp never removes what it didn't install itself.

## Results

Copy this into the release notes.

| | |
| --- | --- |
| VoiceUp version | |
| Date | |
| VM: Windows edition and build | |
| Claude Code version | |
| Failed checks, with what happened | |
| 2.5: session continued after login? | |
| 4.3: hotkey in exclusive fullscreen? | |
| 6.1: message for a blocked microphone | |
| 6.3: Claude's error when offline | |
