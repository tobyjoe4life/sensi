
export type LanguageOption = {
    label: string;
    code: string; // Internal key (e.g. 'russian')
    bcp47: string; // For Google, Azure (e.g. 'ru-RU')
    iso639: string; // For OpenAI, Groq (e.g. 'ru')
    group: string; // For UI grouping
};

export type EnglishVariant = LanguageOption & {
    primary: string;
    alternates: string[];
};

export const ENGLISH_VARIANTS: Record<string, EnglishVariant> = {
    'english-us': {
        label: 'United States',
        code: 'english-us',
        bcp47: 'en-US',
        iso639: 'en',
        group: 'English',
        primary: 'en-US',
        alternates: ['en-GB', 'en-IN', 'en-AU', 'en-CA'],
    },
    'english-uk': {
        label: 'United Kingdom',
        code: 'english-uk',
        bcp47: 'en-GB',
        iso639: 'en',
        group: 'English',
        primary: 'en-GB',
        alternates: ['en-US', 'en-IN', 'en-AU', 'en-CA'],
    },
    'english-in': {
        label: 'India',
        code: 'english-in',
        bcp47: 'en-IN',
        iso639: 'en',
        group: 'English',
        primary: 'en-IN',
        alternates: ['en-US', 'en-GB', 'en-AU', 'en-CA'],
    },
    'english-au': {
        label: 'Australia',
        code: 'english-au',
        bcp47: 'en-AU',
        iso639: 'en',
        group: 'English',
        primary: 'en-AU',
        alternates: ['en-US', 'en-GB', 'en-IN', 'en-CA'],
    },
    'english-ca': {
        label: 'Canada',
        code: 'english-ca',
        bcp47: 'en-CA',
        iso639: 'en',
        group: 'English',
        primary: 'en-CA',
        alternates: ['en-US', 'en-GB', 'en-IN', 'en-AU'],
    },
};

export const RECOGNITION_LANGUAGES: Record<string, LanguageOption> = {
    'auto': { label: 'Auto Detect', code: 'auto', bcp47: 'auto', iso639: 'auto', group: 'Auto' },
    ...ENGLISH_VARIANTS,
    // European
    'spanish':     { label: 'Spanish',     code: 'spanish',     bcp47: 'es-ES', iso639: 'es', group: 'Spanish' },
    'french':      { label: 'French',      code: 'french',      bcp47: 'fr-FR', iso639: 'fr', group: 'French' },
    'german':      { label: 'German',      code: 'german',      bcp47: 'de-DE', iso639: 'de', group: 'German' },
    'italian':     { label: 'Italian',     code: 'italian',     bcp47: 'it-IT', iso639: 'it', group: 'Italian' },
    'portuguese':  { label: 'Portuguese',  code: 'portuguese',  bcp47: 'pt-PT', iso639: 'pt', group: 'Portuguese' },
    'dutch':       { label: 'Dutch',       code: 'dutch',       bcp47: 'nl-NL', iso639: 'nl', group: 'Dutch' },
    'polish':      { label: 'Polish',      code: 'polish',      bcp47: 'pl-PL', iso639: 'pl', group: 'Polish' },
    'czech':       { label: 'Czech',       code: 'czech',       bcp47: 'cs-CZ', iso639: 'cs', group: 'Czech' },
    'swedish':     { label: 'Swedish',     code: 'swedish',     bcp47: 'sv-SE', iso639: 'sv', group: 'Swedish' },
    'norwegian':   { label: 'Norwegian',   code: 'norwegian',   bcp47: 'nb-NO', iso639: 'no', group: 'Norwegian' },
    'danish':      { label: 'Danish',      code: 'danish',      bcp47: 'da-DK', iso639: 'da', group: 'Danish' },
    'finnish':     { label: 'Finnish',     code: 'finnish',     bcp47: 'fi-FI', iso639: 'fi', group: 'Finnish' },
    'greek':       { label: 'Greek',       code: 'greek',       bcp47: 'el-GR', iso639: 'el', group: 'Greek' },
    'romanian':    { label: 'Romanian',    code: 'romanian',    bcp47: 'ro-RO', iso639: 'ro', group: 'Romanian' },
    'russian':     { label: 'Russian',     code: 'russian',     bcp47: 'ru-RU', iso639: 'ru', group: 'Russian' },
    'ukrainian':   { label: 'Ukrainian',   code: 'ukrainian',   bcp47: 'uk-UA', iso639: 'uk', group: 'Ukrainian' },
    'turkish':     { label: 'Turkish',     code: 'turkish',     bcp47: 'tr-TR', iso639: 'tr', group: 'Turkish' },
    // Asian
    'japanese':    { label: 'Japanese',    code: 'japanese',    bcp47: 'ja-JP', iso639: 'ja', group: 'Japanese' },
    'korean':      { label: 'Korean',      code: 'korean',      bcp47: 'ko-KR', iso639: 'ko', group: 'Korean' },
    'chinese':     { label: 'Chinese (Simplified)', code: 'chinese', bcp47: 'zh-CN', iso639: 'zh', group: 'Chinese' },
    'hindi':       { label: 'Hindi',       code: 'hindi',       bcp47: 'hi-IN', iso639: 'hi', group: 'Hindi' },
    'vietnamese':  { label: 'Vietnamese',  code: 'vietnamese',  bcp47: 'vi-VN', iso639: 'vi', group: 'Vietnamese' },
    'thai':        { label: 'Thai',        code: 'thai',        bcp47: 'th-TH', iso639: 'th', group: 'Thai' },
    'indonesian':  { label: 'Indonesian',  code: 'indonesian',  bcp47: 'id-ID', iso639: 'id', group: 'Indonesian' },
    'malay':       { label: 'Malay',       code: 'malay',       bcp47: 'ms-MY', iso639: 'ms', group: 'Malay' },
    'filipino':    { label: 'Filipino (Tagalog)', code: 'filipino', bcp47: 'fil-PH', iso639: 'fil', group: 'Filipino' },
    'tamil':       { label: 'Tamil',       code: 'tamil',       bcp47: 'ta-IN', iso639: 'ta', group: 'Tamil' },
    'bengali':     { label: 'Bengali',     code: 'bengali',     bcp47: 'bn-IN', iso639: 'bn', group: 'Bengali' },
    'urdu':        { label: 'Urdu',        code: 'urdu',        bcp47: 'ur-PK', iso639: 'ur', group: 'Urdu' },
    // Middle-Eastern
    'arabic':      { label: 'Arabic',      code: 'arabic',      bcp47: 'ar-SA', iso639: 'ar', group: 'Arabic' },
    'hebrew':      { label: 'Hebrew',      code: 'hebrew',      bcp47: 'he-IL', iso639: 'he', group: 'Hebrew' },
    'persian':     { label: 'Persian',     code: 'persian',     bcp47: 'fa-IR', iso639: 'fa', group: 'Persian' },
    // African — best transcribed via Google Cloud Speech or ElevenLabs Scribe
    // Deepgram / Whisper coverage is limited. A hint is surfaced in the UI.
    'yoruba':      { label: 'Yoruba',      code: 'yoruba',      bcp47: 'yo-NG', iso639: 'yo', group: 'Yoruba' },
    'hausa':       { label: 'Hausa',       code: 'hausa',       bcp47: 'ha-NG', iso639: 'ha', group: 'Hausa' },
    'igbo':        { label: 'Igbo',        code: 'igbo',        bcp47: 'ig-NG', iso639: 'ig', group: 'Igbo' },
    'swahili':     { label: 'Swahili',     code: 'swahili',     bcp47: 'sw-KE', iso639: 'sw', group: 'Swahili' },
    'zulu':        { label: 'Zulu',        code: 'zulu',        bcp47: 'zu-ZA', iso639: 'zu', group: 'Zulu' },
    'xhosa':       { label: 'Xhosa',       code: 'xhosa',       bcp47: 'xh-ZA', iso639: 'xh', group: 'Xhosa' },
    'afrikaans':   { label: 'Afrikaans',   code: 'afrikaans',   bcp47: 'af-ZA', iso639: 'af', group: 'Afrikaans' },
    'amharic':     { label: 'Amharic',     code: 'amharic',     bcp47: 'am-ET', iso639: 'am', group: 'Amharic' },
};

/**
 * v2.5.5: STT language support matrix. Each provider supports a different
 * subset. The Settings UI uses this to show a ⚠ hint when the selected
 * STT doesn't support the chosen recognition language.
 *
 * Source of truth:
 *   - Deepgram nova-3: https://developers.deepgram.com/docs/models-languages-overview
 *   - Google Cloud Speech v2: https://cloud.google.com/speech-to-text/v2/docs/speech-to-text-supported-languages
 *   - Azure Speech: https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support
 *   - OpenAI / Groq Whisper: large-v3 supports ~99 languages; quality varies
 *   - ElevenLabs Scribe v2: 99 languages
 */
export const STT_PROVIDER_LANGUAGE_SUPPORT: Record<string, Set<string>> = {
    deepgram: new Set([
        'auto', 'english-us', 'english-uk', 'english-in', 'english-au', 'english-ca',
        'spanish', 'french', 'german', 'italian', 'portuguese', 'dutch', 'polish',
        'russian', 'ukrainian', 'turkish', 'japanese', 'korean', 'chinese', 'hindi',
        'indonesian', 'swedish', 'norwegian', 'danish', 'finnish', 'greek', 'czech',
        'romanian', 'vietnamese', 'thai',
    ]),
    google: new Set(Object.keys(RECOGNITION_LANGUAGES)), // Google covers all incl. African langs
    azure: new Set([
        'auto', 'english-us', 'english-uk', 'english-in', 'english-au', 'english-ca',
        'spanish', 'french', 'german', 'italian', 'portuguese', 'dutch', 'polish',
        'russian', 'ukrainian', 'turkish', 'japanese', 'korean', 'chinese', 'hindi',
        'indonesian', 'swedish', 'norwegian', 'danish', 'finnish', 'greek', 'czech',
        'romanian', 'vietnamese', 'thai', 'malay', 'filipino', 'tamil', 'bengali',
        'arabic', 'hebrew', 'persian', 'urdu',
        'yoruba', 'hausa', 'swahili', 'zulu', 'afrikaans', 'amharic',
    ]),
    openai: new Set(Object.keys(RECOGNITION_LANGUAGES)), // Whisper supports ~99; quality variable for African
    groq: new Set(Object.keys(RECOGNITION_LANGUAGES)),   // same Whisper base
    elevenlabs: new Set(Object.keys(RECOGNITION_LANGUAGES)), // Scribe v2: 99 langs
    ibmwatson: new Set([
        'auto', 'english-us', 'english-uk', 'spanish', 'french', 'german',
        'italian', 'portuguese', 'japanese', 'korean', 'chinese', 'arabic',
    ]),
    soniox: new Set([
        'auto', 'english-us', 'spanish', 'french', 'german', 'italian',
        'portuguese', 'russian', 'ukrainian', 'turkish', 'japanese', 'korean',
        'chinese', 'hindi', 'arabic',
    ]),
};

export function isLanguageSupportedBy(provider: string | undefined, languageCode: string): boolean {
    if (!provider) return true;
    const set = STT_PROVIDER_LANGUAGE_SUPPORT[provider];
    if (!set) return true;
    return set.has(languageCode);
}

export const AI_RESPONSE_LANGUAGES = [
    { label: 'Auto (Match Interviewer)', code: 'auto' },
    { label: 'English', code: 'English' },
    { label: 'Spanish', code: 'Spanish' },
    { label: 'French', code: 'French' },
    { label: 'German', code: 'German' },
    { label: 'Italian', code: 'Italian' },
    { label: 'Portuguese', code: 'Portuguese' },
    { label: 'Dutch', code: 'Dutch' },
    { label: 'Russian', code: 'Russian' },
    { label: 'Ukrainian', code: 'Ukrainian' },
    { label: 'Turkish', code: 'Turkish' },
    { label: 'Japanese', code: 'Japanese' },
    { label: 'Korean', code: 'Korean' },
    { label: 'Chinese', code: 'Chinese' },
    { label: 'Hindi', code: 'Hindi' },
    { label: 'Arabic', code: 'Arabic' },
    { label: 'Indonesian', code: 'Indonesian' },
    { label: 'Vietnamese', code: 'Vietnamese' },
    { label: 'Thai', code: 'Thai' },
    { label: 'Yoruba', code: 'Yoruba' },
    { label: 'Hausa', code: 'Hausa' },
    { label: 'Igbo', code: 'Igbo' },
    { label: 'Swahili', code: 'Swahili' },
    { label: 'Zulu', code: 'Zulu' },
    { label: 'Afrikaans', code: 'Afrikaans' },
    { label: 'Amharic', code: 'Amharic' },
];
