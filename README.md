English | [Japanese](README-ja.md)

# yomi - Nostr TTS Reader
A Nostr client that reads out posts using text-to-speech.

## For Users
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

### Supported Languages
Available languages for text-to-speech depend on your browser and OS. Below are commonly supported languages:

| Code | Language | Windows | Mac | Android | iOS |
|------|----------|:-------:|:---:|:-------:|:---:|
| en | English | ✓ | ✓ | ✓ | ✓ |
| ja | 日本語 | ✓ | ✓ | ✓ | ✓ |
| zh | 中文 | ✓ | ✓ | ✓ | ✓ |
| ko | 한국어 | ✓ | ✓ | ✓ | ✓ |
| es | Español | ✓ | ✓ | ✓ | ✓ |
| fr | Français | ✓ | ✓ | ✓ | ✓ |
| de | Deutsch | ✓ | ✓ | ✓ | ✓ |
| it | Italiano | ✓ | ✓ | ✓ | ✓ |
| pt | Português | ✓ | ✓ | ✓ | ✓ |
| ru | Русский | ✓ | ✓ | ✓ | ✓ |
| ar | العربية | ✓ | ✓ | ✓ | ✓ |
| hi | हिन्दी | ✓ | ✓ | ✓ | ✓ |
| th | ไทย | ✓ | ✓ | ✓ | ✓ |
| vi | Tiếng Việt | ✓ | | ✓ | |
| nl | Nederlands | ✓ | ✓ | ✓ | ✓ |
| pl | Polski | ✓ | ✓ | ✓ | ✓ |
| tr | Türkçe | ✓ | ✓ | ✓ | ✓ |
| uk | Українська | ✓ | | ✓ | |

**Note**: On Linux, available languages depend on what `espeak-ng` supports. You can install additional language packs to extend support.

### Auto Language Detection
The "Auto detect by author" and "Auto detect by note" features use [franc-min](https://github.com/wooorm/franc) for language detection. franc-min supports the following 82 languages:

| Code | Language | Code | Language | Code | Language |
|------|----------|------|----------|------|----------|
| amh | አማርኛ | arb | العربية | azj | Azərbaycan |
| bel | Беларуская | ben | বাংলা | bho | भोजपुरी |
| bos | Bosanski | bul | Български | ceb | Cebuano |
| ces | Čeština | ckb | کوردی | cmn | 中文 |
| deu | Deutsch | ell | Ελληνικά | eng | English |
| fra | Français | fuv | Fulfulde | guj | ગુજરાતી |
| hau | Hausa | hin | हिन्दी | hms | 苗语 |
| hnj | Hmong | hrv | Hrvatski | hun | Magyar |
| ibo | Igbo | ilo | Ilokano | ind | Indonesia |
| ita | Italiano | jav | Jawa | jpn | 日本語 |
| kan | ಕನ್ನಡ | kaz | Қазақ | kin | Kinyarwanda |
| koi | Коми | kor | 한국어 | lin | Lingála |
| mad | Madura | mag | मगही | mai | मैथिली |
| mal | മലയാളം | mar | मराठी | mya | မြန်မာ |
| nld | Nederlands | npi | नेपाली | nya | Chichewa |
| pan | ਪੰਜਾਬੀ | pbu | پښتو | pes | فارسی |
| plt | Malagasy | pol | Polski | por | Português |
| qug | Kichwa | ron | Română | run | Kirundi |
| rus | Русский | sin | සිංහල | skr | سرائیکی |
| som | Soomaali | spa | Español | srp | Српски |
| sun | Sunda | swe | Svenska | swh | Kiswahili |
| tam | தமிழ் | tel | తెలుగు | tgl | Tagalog |
| tha | ไทย | tur | Türkçe | ukr | Українська |
| urd | اردو | uzn | Oʻzbek | vie | Tiếng Việt |
| yor | Yorùbá | zlm | Melayu | zul | isiZulu |
| zyb | 壮语 | | | | |

**Note**: For auto language detection to work correctly, the detected language must also be supported by TTS.

### Tested Environments

| OS | Browser | Foreground Playback | Background Playback | Bluetooth Playback | Bluetooth Speech Recognition |
| --- | --- | :---: | :---: | :---: | :---: |
| Windows 11 25H2 | Chrome 143.0.7499.194 | ✔ | ✔ | ✔ | ✔ |
| iOS 26.2 | Safari 26.6 | ✔ | | | |
| Android 13 | Chrome 143.0.7499.194 | ✔ | | ✔ | ✔ |

## For Developers
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
