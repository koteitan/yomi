English | [Japanese](README-ja.md)

# yomi - Nostr TTS Reader
A Nostr client that reads out the posts using text-to-speech.

## for Users
### Usage
1. Open the app in your browser
2. Your pubkey will be loaded automatically if you have a NIP-07 extension
3. Or enter your pubkey (hex or npub format) manually
4. Click "Start" to begin reading posts from your follows
5. Use "Pause", "Skip", "Stop" buttons to control playback
6. Type a message and click "Post" to publish a note (requires NIP-07)

### Requirements
#### Windows/Mac/iOS/Android
- A modern browser (Chrome, Firefox, Safari, Edge)
- NIP-07 browser extension (e.g., nos2x, Alby) to read pubkey automatically and sign posts

#### Linux
- A modern browser with Web Speech API support
- NIP-07 browser extension
- Speech synthesis voices installed:

Ubuntu/Debian:
```bash
sudo apt install speech-dispatcher speech-dispatcher-espeak-ng espeak-ng
```

Arch:
```bash
sudo pacman -S speech-dispatcher espeak-ng
```

## for Developers
### Requirements
- Node.js 18+
- npm

### Build
```bash
npm install
npm run build
```

### Run
```bash
npm run dev
```
Open http://localhost:5173 in your browser.

## License
- This project: [MIT License](LICENSE)
- Third-party libraries: [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)
