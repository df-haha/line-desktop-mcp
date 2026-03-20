// src/automation/windows-line-automation.js
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import iconv from 'iconv-lite';
import chardet from 'chardet';

const execAsync = promisify(exec);

export class WindowsLineAutomation {
  constructor() {
    this.lineAppName = 'LINE';
    this.lineWinTitle = 'LINE';
    this.delayShort = 200; // for key stroke, mouse click simulation human-like
    this.delayMid = 600; // for short data loading
    this.delayMidLong = 1200; // for mid data loading
    this.delayLong = 3000; // for long data loading
    this.ahkPath = 'autohotkey'; // Assume AutoHotkey v2 is in PATH
  }

  /**
   * Executes an AutoHotkey v2 script.
   * @param {string} script The AHK script content.
   * @returns {Promise<string>} The stdout from the script execution.
   */
  async runAhk(script) {
    const scriptPath = path.join(os.tmpdir(), `line-automation-${Date.now()}.ahk`);
    // Prepend necessary AHK settings
    const fullScript = `#SingleInstance force
#Requires AutoHotkey v2.0
SendMode "Input"
SetWorkingDir A_ScriptDir
CoordMode "Pixel", "Screen"
SetTitleMatchMode 2
${script}
`;
    await fs.writeFile(scriptPath, fullScript);

    try {
      // Use buffer encoding to handle raw bytes
      const { stdout, stderr } = await execAsync(`"${this.ahkPath}" "${scriptPath}"`, {
        encoding: 'buffer'
      });
      
      if (stderr && stderr.length > 0) {
        // Detect and convert stderr encoding
        const stderrEncoding = chardet.detect(stderr);
        const stderrText = stderrEncoding ? iconv.decode(stderr, stderrEncoding) : stderr.toString('utf8');
        console.error(`AHK Script Error: ${stderrText}`);
      }
      
      if (!stdout || stdout.length === 0) {
        return '';
      }
      
      // Detect encoding of stdout
      const detectedEncoding = chardet.detect(stdout);
      console.error(`AHK stdout detected encoding: ${detectedEncoding}`);
      
      // Convert to UTF-8 string
      let result;
      if (detectedEncoding && detectedEncoding.toLowerCase() !== 'utf-8' && detectedEncoding.toLowerCase() !== 'utf8') {
        try {
          result = iconv.decode(stdout, detectedEncoding);
          console.error(`AHK stdout converted from ${detectedEncoding} to UTF-8`);
        } catch (conversionError) {
          console.warn(`Failed to convert AHK stdout from ${detectedEncoding}:`, conversionError.message);
          result = stdout.toString('utf8');
        }
      } else {
        result = stdout.toString('utf8');
        console.error('AHK stdout already in UTF-8 or ASCII');
      }
      
      return result.trim();
    } catch (error) {
      console.error(`Failed to execute AHK script: ${error.message}`);
      throw new Error(`AHK execution failed. Is AutoHotkey v2 installed and in your PATH?`);
    } finally {
      await fs.unlink(scriptPath); // Clean up the temp file
    }
  }

  async isLineRunning() {
    try {
      const result = execSync('tasklist /FI "IMAGENAME eq LINE.exe"', { encoding: 'utf8' });
      return result.toLowerCase().includes('line.exe');
    } catch (error) {
      // tasklist throws an error if no process is found
      return false;
    }
  }

  async activateLine() {
    const script = `
      SetTitleMatchMode 3
      If WinExist("${this.lineWinTitle}") {
        WinActivate "${this.lineWinTitle}"
        WinWaitActive "${this.lineWinTitle}",, 2
        ExitApp(0) ; Success
      } else {
        ExitApp(1) ; Failure
      }
    `;
    try {
      await this.runAhk(script);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async selectChat(chatName) {
    const script = `
      SetTitleMatchMode 3 
      WinActivate "${this.lineWinTitle}"
      Sleep ${this.delayShort}
      ; Get window position and size
      WinGetPos &winX, &winY, &winW, &winH, "${this.lineWinTitle}"
      ; Click at position (w-20, h/2) within the window
      CoordMode "Mouse", "Screen"
      scale := A_ScreenDPI / 96
      clickX := winX + 30 * scale
      clickY := winY + 110 * scale
      Click clickX, clickY
      Sleep ${this.delayMid}
      Send "^+f" ; Ctrl+Shift+F to focus search bar
      Sleep ${this.delayShort}
      A_Clipboard := "${chatName}"
      Send "^a" ; Select all
      Send "{Delete}"
      Sleep ${this.delayShort}
      Send "^v" ; Paste chat name
      Sleep ${this.delayMid}
      Send "{Enter}"
      Sleep ${this.delayShort}
      clickX := winX + 200 * scale
      clickY := winY + 140 * scale
      Click clickX, clickY
      Sleep ${this.delayMid}
      Return
    `;
    try {
      await this.runAhk(script);
      return true;
    } catch (e) {
      console.error('selectChat failed', e);
      return false;
    }
  }

  async copyAllChatToClipboard() {
    const script = `
      SetTitleMatchMode 3
      WinActivate "${this.lineWinTitle}"
      Sleep ${this.delayShort}
      ; Get window position and size
      WinGetPos &winX, &winY, &winW, &winH, "${this.lineWinTitle}"
      ; Click at position (w-20, h/2) within the window
      CoordMode "Mouse", "Screen"
      scale := A_ScreenDPI / 96
      clickX := winX + winW - 20 * scale
      clickY := winY + winH / 2
      Click clickX, clickY
      Sleep ${this.delayShort}
      Send "^a" ; Ctrl+A to select all
      Sleep ${this.delayMid}
      A_Clipboard := "" ; Clear clipboard
      Send "^c" ; Ctrl+C to copy
      ClipWait 2 ; Wait up to 2 seconds for clipboard to contain data
      if (A_Clipboard != "") {
        FileAppend A_Clipboard, "*" ; Write clipboard to stdout
      } else {
        FileAppend "ERROR: Clipboard is empty", "*"
      }
    `;
    try {
      const result = await this.runAhk(script);
      
      if (!result || result.startsWith('ERROR:')) {
        console.error('copyAllChatToClipboard result', result);
        return result;
      }

      return result;
    } catch (e) {
      console.error('copyAllChatToClipboard failed', e);
      return null;
    }
  }

  async pageUp(times = 2) {
    const script = `
      SetTitleMatchMode 3
      WinActivate "${this.lineWinTitle}"
      ; Get window position and size
      WinGetPos &winX, &winY, &winW, &winH, "${this.lineWinTitle}"
      ; Click at position (w-20, h/2) within the window
      CoordMode "Mouse", "Screen"
      scale := A_ScreenDPI / 96
      clickX := winX + 400 * scale
      clickY := winY + winH - 100 * scale
      Click clickX, clickY
      Sleep ${this.delayShort}
      Send "{Tab}"
      Sleep ${this.delayShort}
      Send "{End}"
      Sleep ${this.delayShort}
      Loop ${times} {
        Send "{PgUp}"
        Sleep ${this.delayShort}
      }
    `;
    await this.runAhk(script);
  }
  
  async switchToEnglish() {
    console.warn("Switching to English on Windows is not reliably implemented. Assuming correct input method is active.");
    return;
  }

  async sendMessage(chatName, message, autoSend = false) {
    const messageParts = [];
    let currentPart = '';

    const parts = message.split(/(@\S+\s)/g);

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.match(/^@\S+\s$/)) {
        if (currentPart) {
          messageParts.push(currentPart);
          currentPart = '';
        }
        messageParts.push(part);
      } else {
        currentPart += part;
      }
    }

    if (currentPart) {
      messageParts.push(currentPart);
    }

    let result = await this._sendSingleMessageInit(chatName);

    for (const part of messageParts) {
      if (part.match(/^@\S+\s$/)) {
        result = await this._sendSingleMessage(chatName, ' ');
        result = await this._sendSingleMessage(chatName, part.trim() );
        result = await this._sendSingleMessage(chatName, 'k');
        result = await this._sendSingleMessageBackspace();
        result = await this._sendShiftEnter();
        
      } else {
        const lines = part.split(/\r\n|\n|\r/);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line) {
            result = await this._sendSingleMessage(chatName, line);
          }

          if (i < lines.length - 1) {
            result = await this._sendShiftEnter();
          }
        }
      }
    }

    if (autoSend) {
      result = await this._sendSingleMessageEnter();
    }

    if (result.success)
      return { success: true, error: null };
    else
      return { success: false, error: result.error };
  }

  async _sendShiftEnter() {
    const script = `
      WinActivate "${this.lineWinTitle}"
      Send "+{Enter}"
    `;
    try {
      await this.runAhk(script);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async _sendSingleMessageInit(chatName) {
    const script = `
      SetTitleMatchMode 3
      WinActivate "${this.lineWinTitle}"
      WinGetPos &winX, &winY, &winW, &winH, "${this.lineWinTitle}"
      CoordMode "Mouse", "Screen"
      scale := A_ScreenDPI / 96
      clickX := winX + winW * (3/4)
      clickY := winY + winH - 100 * scale
      Click clickX, clickY
      Sleep ${this.delayShort}
      Send "^a"
      Send "{Delete}"
      Sleep ${this.delayLong}
    `;
    try {
      await this.runAhk(script);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async _sendSingleMessage(chatName, message) {
    const script = `
      SetTitleMatchMode 3
      WinActivate "${this.lineWinTitle}"
      A_Clipboard := "${message.replace(/"/g, '**')}"
      Send "^v"
      Sleep ${this.delayShort}
    `;
    try {
      await this.runAhk(script);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async _sendSingleMessageEnter() {
    const script = `
      SetTitleMatchMode 3
      WinActivate "${this.lineWinTitle}"
      Send "{Enter}"
    `;
    try {
      await this.runAhk(script);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async _sendSingleMessageBackspace() {
    const script = `
      Sleep ${this.delayMid}
      SetTitleMatchMode 3
      WinActivate "${this.lineWinTitle}"
      Send "{Backspace}"
      Sleep ${this.delayMidLong}
    `;
    try {
      await this.runAhk(script);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async _sendSingleMessageClickMention() {
    const script = `
      SetTitleMatchMode 3
      Sleep ${this.delayLong}
      WinGetPos &winX, &winY, &winW, &winH, "${this.lineWinTitle}"
      CoordMode "Mouse", "Screen"
      scale := A_ScreenDPI / 96
      clickX := winX + winW * (3/4)
      clickY := winY + winH - 130 * scale
      Click clickX, clickY
      Sleep ${this.delayShort}
      WinGetPos &winX, &winY, &winW, &winH, "${this.lineWinTitle}"
      CoordMode "Mouse", "Screen"
      clickX := winX + winW - 20 * scale
      clickY := winY + winH - 50 * scale
      Click clickX, clickY
    `;
    try {
      await this.runAhk(script);
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Save chat history using LINE Desktop's native export via the \u22ee (three-dot) menu.
   * Flow: Click \u22ee at top-right \u2192 click \"\u5132\u5b58\u804a\u5929\" \u2192 handle Save As dialog with keyboard.
   * Coordinates measured from actual LINE window screenshot on 1920x1080 @ 100% DPI.
   * @param {string} savePath The full file path to save the chat history to.
   * @returns {Promise<{success: boolean, path?: string, error?: string}>}
   */
  async saveChatHistoryViaMenu(savePath) {
    // AHK v2 uses backtick (`) as escape char
    const escapedPath = savePath.replace(/`/g, '``').replace(/"/g, '`"');
    const script = `
      SetTitleMatchMode 3
      WinActivate "${this.lineWinTitle}"
      Sleep ${this.delayMid}
      WinGetPos &winX, &winY, &winW, &winH, "${this.lineWinTitle}"
      CoordMode "Mouse", "Screen"
      scale := A_ScreenDPI / 96

      ; Step 1: Click the \u22ee (three-dot menu) at top-right of chat header
      ; Measured from screenshot: x = winW - 20, y = 52 from window top
      dotMenuX := winX + winW - 20 * scale
      dotMenuY := winY + 52 * scale
      Click dotMenuX, dotMenuY
      Sleep ${this.delayMidLong}

      ; Step 2: Click \"\u5132\u5b58\u804a\u5929\" in the dropdown menu
      ; Menu appears below \u22ee. \"\u5132\u5b58\u804a\u5929\" is the 8th item.
      ; Each menu item ~30px tall, menu starts ~15px below \u22ee.
      menuX := dotMenuX - 50 * scale
      menuY := dotMenuY + 15 * scale + 7.5 * 30 * scale
      Click menuX, menuY
      Sleep ${this.delayLong}

      ; Step 3: Handle the Save As dialog \u2014 entirely keyboard-driven
      SetTitleMatchMode 2
      dialogTitle := ""
      try {
        WinWait("\u53e6\u5b58\u65b0\u6a94",, 8)
        dialogTitle := "\u53e6\u5b58\u65b0\u6a94"
      } catch {
        try {
          WinWait("Save As",, 3)
          dialogTitle := "Save As"
        } catch {
          FileAppend "ERROR: Save dialog did not appear. The \u22ee menu or \u5132\u5b58\u804a\u5929 click may have missed.", "*"
          ExitApp
        }
      }

      ; Activate the dialog using its title explicitly
      WinActivate dialogTitle
      WinWaitActive dialogTitle,, 3
      Sleep ${this.delayShort}

      ; Focus filename field (Alt+N) and set the save path
      Send "!n"
      Sleep ${this.delayShort}
      Send "^a"
      Sleep 100
      A_Clipboard := "${escapedPath}"
      Send "^v"
      Sleep ${this.delayShort}

      ; Click Save (Alt+S)
      Send "!s"
      Sleep ${this.delayMid}

      ; Handle potential overwrite confirmation dialog
      try {
        WinWait("\u78ba\u8a8d",, 2)
        Send "!y"
      } catch {
      }

      Sleep ${this.delayShort}
      FileAppend "SUCCESS", "*"
    `;

    try {
      const result = await this.runAhk(script);
      if (result.includes('SUCCESS')) {
        return { success: true, path: savePath };
      }
      return { success: false, error: result };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}
