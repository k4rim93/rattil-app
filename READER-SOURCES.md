# Reader sources

The Quran page artwork remains the pinned source already credited in README.md. No Quran text is retyped by this change.

Ayah audio streams from Al Quran Cloud / Islamic Network. The current first-party terms explicitly allow streaming, embedding and downloading recitations for personal and educational use, with rights remaining with reciters and possible removal at their request. Sources: https://alquran.cloud/terms-and-conditions (last updated 14 June 2026, checked 23 Nov 2026), https://islamic.network/terms-and-conditions . Recordings are free to listeners, not monetized, proxied, rehosted or persistently stored by this app. Reciter and source credit appear in the player. This app makes no claim of owning the recordings and no guarantee of availability.

Catalogue: https://api.alquran.cloud/v1/edition/format/audio . The chosen editions are ar.alafasy, ar.husary and ar.minshawi, all verse-by-verse Hafs recordings. On playback, the exact verse endpoint supplies its audio URL; surah, verse and edition identifiers are checked before playback, and only the edition-specific HTTPS Islamic Network CDN path is accepted. Example checked: https://api.alquran.cloud/v1/ayah/2:255/ar.alafasy . There is no Quran Foundation API/CDN fallback. No recording is sent to the recognition model.

The app displays unchanged Al-Tafsir Al-Muyassar by the King Fahd Complex via QuranEnc.com, version 1.0.1 as listed at https://quranenc.com/en/home on 23 Nov 2026. Each tafsir is fetched when requested with no persistent copy. Provider: https://quranenc.com/en/browse/arabic_moyassar . API: https://quranenc.com/en/home/api/ . QuranEnc's Terms and Policies permit download and republication subject to no additions/deletions/modification, publisher/source and version credit, preservation of document information, correction feedback, updating to current editions, and no inappropriate ads. Publisher, source, version and source link accompany the content. No tafsir corpus is bundled in this repository. Reading notes remain private on this device, never sent to QuranEnc.

Streaming audio and tafsir require internet. Physical iPhone testing is still needed for Safari user-activation and interruption behaviour. This change does not claim parity with any native app or a general improvement in recitation accuracy.

## Preview: Yasser ad-Dossari timed playback
- MP3Quran v3 lists Yasser (read92), Hafs, with timings for114surahs: https://mp3quran.net/api/v3/ayat_timing/reads .
- Per-surah timing endpoint: https://mp3quran.net/api/v3/ayat_timing?surah=2&read=92 . The app checks exactly one matching ayah and a valid bounded millisecond interval, streams the matching full-surah recording, seeks to that interval and stops/repeats inside it. No inferred alignment or audio editing.
- MP3Quran's first-party copyright section permits visitor/developer use of its material or links: https://www.mp3quran.net/eng/privacy . Source credit/rights link stays in the player.
- The2:255 public source page corroborates the same start offset and recording: https://www.mp3quran.net/ar/yasser/2/255 .
- Badr al-Turki is available whole-surah, but no timings were returned for read254 on23Nov2026. Not advertised as verse-capable.
- Timings are source-provided navigation boundaries, not a guarantee of word-level precision. Streaming/seeking, background behavior and Safari may vary. The existing physical iPhone verification caveat remains.
