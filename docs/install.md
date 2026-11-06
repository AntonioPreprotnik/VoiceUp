# Installing VoiceUp

VoiceUp isn't signed with a paid certificate yet (see `docs/decisions/S6.7-code-signing.md`), so Windows warns the first time you run the installer. The steps below get past the warning safely.

## 1. Download
From the GitHub Releases page, download `VoiceUp Setup <version>.exe` and `SHA256SUMS.txt`. If your browser says the file "isn't commonly downloaded", choose **Keep**. In Edge it's under **…** → **Keep**.

## 2. Check that it's the real file (optional, 30 seconds)
In PowerShell, in your Downloads folder:

```powershell
Get-FileHash '.\VoiceUp Setup <version>.exe'
```

The `Hash` it prints must match the line for that file in `SHA256SUMS.txt`, ignoring upper or lower case. If it doesn't match, don't run it, and tell Antonio.

## 3. Run it
Double-click the installer. A blue window says **Windows protected your PC**.

1. Click **More info**.
2. Check that the app is `VoiceUp Setup <version>.exe` and the publisher is **Unknown publisher**.
3. Click **Run anyway**.

Windows remembers this for that file. Updates come through the app itself, so you won't do this again for each new version.

## If there's no "Run anyway"
Your PC probably has **Smart App Control** turned on, which blocks every app without a signature. It exists only on some Windows 11 PCs. To check, open **Windows Security** → **App & browser control** → **Smart App Control settings**.

- **Evaluation:** it isn't blocking yet. Try again.
- **On:** it blocks VoiceUp. The only way past it is to switch it **Off**, and Windows can't switch it back on without a reset. Ask Antonio before doing that.
