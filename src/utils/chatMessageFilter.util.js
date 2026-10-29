const MASK_CHAR = "*";

// A run of 5+ digits (allowing spaces, dashes, brackets, dots between them)
// is treated as a phone number or other contact number.
const MIN_CONTACT_DIGITS = 5;

const NUMBER_WORDS = new Map([
  ["zero", 1],
  ["oh", 1],
  ["one", 1],
  ["two", 1],
  ["three", 1],
  ["four", 1],
  ["five", 1],
  ["six", 1],
  ["seven", 1],
  ["eight", 1],
  ["nine", 1],
  ["double", 0],
  ["triple", 0],
]);

// Words that are bad whenever they appear inside a longer word.
const BAD_WORD_ROOTS = [
  "fuck",
  "fuk",
  "fck",
  "phuck",
  "shit",
  "bitch",
  "biatch",
  "motherfuck",
  "asshole",
  "bastard",
  "whore",
  "slut",
  "pussy",
  "nigger",
  "nigga",
  // Hindi (Roman)
  "madarchod",
  "maderchod",
  "madarjat",
  "behenchod",
  "bhenchod",
  "benchod",
  "bhosdi",
  "bhosda",
  "bhosad",
  "chutiya",
  "chutiye",
  "chutia",
  "chootiya",
  "gandu",
  "gaandu",
  "harami",
  "haramkhor",
  "haramzad",
  "kutiya",
  "kuttiya",
  "bhadwa",
  "bhadwe",
  "chinal",
  "chhinal",
  "jhaatu",
  "jhatu",
  "bakchod",
  "chudai",
  "randwa",
  // Tamil / Thanglish (Roman)
  "thevidiya",
  "thevdiya",
  "thevudiya",
  "thevadiya",
  "pundai",
  "pundamavan",
  "thayoli",
  "thaayoli",
  "koothi",
  "ommala",
  "oombu",
  "sunniya",
  "kenapunda",
  "kandaroli",
  "porukki",
  "olutha",
  // Malayalam (Roman)
  "poorimon",
  "pulayadi",
  "kazhuveri",
  "koothichi",
  "myran",
  "oombikko",
  // Telugu (Roman)
  "lanjakodaka",
  "lanja",
  "nakodaka",
  "dengutha",
  "denguta",
];

// Short words that are only bad as a whole word.
const BAD_WORDS_EXACT = [
  "ass",
  "arse",
  "cunt",
  "dick",
  "cock",
  "porn",
  "sex",
  "nude",
  "nudes",
  "boobs",
  "tits",
  "wtf",
  "stfu",
  // Hindi (Roman)
  "bkl",
  "mkc",
  "bsdk",
  "chod",
  "chodu",
  "choot",
  "chut",
  "gaand",
  "gand",
  "lund",
  "lavda",
  "lavde",
  "lauda",
  "laude",
  "lodu",
  "loda",
  "randi",
  "raand",
  "kamina",
  "kamine",
  "kamini",
  "kutta",
  "kutte",
  "tatti",
  "jhaat",
  // Tamil / Thanglish (Roman)
  "otha",
  "ootha",
  "oththa",
  "punda",
  "sunni",
  "poolu",
  "baadu",
  "mayir",
  "mayiru",
  "myir",
  "soothu",
  "sootha",
  "okkala",
  "naaye",
  "pottai",
  "oombi",
  // Malayalam (Roman)
  "myre",
  "myru",
  "mairu",
  "kunna",
  "kunne",
  "kundi",
  "kundan",
  "pooru",
  "thendi",
  // Telugu (Roman)
  "dengu",
  "puku",
  "modda",
];

// Native-script bad words, matched anywhere inside a word.
const NATIVE_BAD_ROOTS = [
  // Hindi (Devanagari)
  "मादरचोद",
  "मादरजात",
  "भेनचोद",
  "बहनचोद",
  "बहेनचोद",
  "भोसड",
  "भोसडी",
  "चूतिया",
  "चुतिया",
  "चूत",
  "गांडू",
  "गांड",
  "गाँड",
  "हरामी",
  "हरामजाद",
  "हरामखोर",
  "कमीना",
  "कमीनी",
  "कुतिया",
  "रंडी",
  "लंड",
  "लौडा",
  "लौड़ा",
  "लोडा",
  "झाट",
  "भडवा",
  "छिनाल",
  "चोद",
  "चुदाई",
  "टट्टी",
  // Tamil
  "ஓத்தா",
  "ஒத்தா",
  "ஓம்மால",
  "ஒம்மால",
  "புண்ட",
  "தேவடி",
  "தேவிடி",
  "தேவுடி",
  "தாயோளி",
  "கூதி",
  "சுன்னி",
  "ஊம்பு",
  "மயிர",
  "மயிறு",
  "பூல்",
  "சூத்து",
  "பொட்டை",
  "நாயே",
  // Malayalam
  "മൈര",
  "മൈരേ",
  "കുണ്ണ",
  "കുണ്ടി",
  "പൂറ",
  "പൂറി",
  "തായോളി",
  "പുലയാടി",
  "കഴുവേറി",
  "ഊമ്പ",
  "കൂതിച്ചി",
];

const LEET_MAP = {
  "0": "o",
  "1": "i",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "@": "a",
  "$": "s",
  "!": "i",
};

const collapseRepeats = (value) => value.replace(/(.)\1+/g, "$1");

const normalizeLetters = (value) =>
  String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[0134578@$!]/g, (char) => LEET_MAP[char] ?? char)
    .replace(/[^a-z]/g, "");

const ROOT_FORMS = BAD_WORD_ROOTS.map(collapseRepeats);
const EXACT_FORMS = new Set(BAD_WORDS_EXACT);
// Collapsed matching ("fuuuck" -> "fuck") is only safe for exact words with
// no double letters; collapsing "ass" would also match the word "as".
const EXACT_COLLAPSED_FORMS = new Set(
  BAD_WORDS_EXACT.filter((word) => collapseRepeats(word) === word)
);

// Devanagari nukta and zero-width joiners vary between keyboards, so they are
// removed before comparing native-script words.
const nativeForm = (value) =>
  String(value)
    .normalize("NFD")
    .replace(/[\u093C\u200B-\u200D\s]/g, "")
    .normalize("NFC")
    .toLowerCase();

const NATIVE_BAD_FORMS = NATIVE_BAD_ROOTS.map(nativeForm);

const isNativeBadWord = (value) => {
  const form = nativeForm(value);

  return Boolean(form) && NATIVE_BAD_FORMS.some((root) => form.includes(root));
};

const isBadWord = (value) => {
  if (isNativeBadWord(value)) {
    return true;
  }

  const letters = normalizeLetters(value);

  if (!letters) {
    return false;
  }

  const collapsed = collapseRepeats(letters);

  if (EXACT_FORMS.has(letters) || EXACT_COLLAPSED_FORMS.has(collapsed)) {
    return true;
  }

  return ROOT_FORMS.some((root) => collapsed.includes(root));
};

// Threat / harassment words that are dangerous on their own.
// "rape" is matched as whole words only so "grape" and "therapist" pass.
const DANGER_WORD_ROOTS = [
  "molest",
  "kidnap",
  "murder",
  "blackmail",
  "terrorist",
  "tezaab",
  "tejab",
];

const DANGER_WORDS_EXACT = [
  "rape",
  "raped",
  "rapes",
  "raping",
  "rapist",
  "rapists",
  "kys",
  // Violence and weapons
  "kill",
  "kills",
  "killed",
  "killing",
  "killer",
  "killers",
  "knife",
  "knives",
  "gun",
  "guns",
  "pistol",
  "revolver",
  "bullet",
  "bullets",
  "bomb",
  "bombs",
  "grenade",
  "explosive",
  "explosives",
  "dagger",
  "sword",
  "poison",
  "acid",
  "suicide",
  "weapon",
  "weapons",
  "stab",
  "stabbed",
  "stabbing",
  // Hindi (Roman)
  "chaku",
  "chaaku",
  "chakku",
  "bandook",
  "banduk",
  "talwar",
  "khoon",
  // Tamil / Thanglish (Roman)
  "kathi",
  "kolluven",
  "kolluvan",
  "kolren",
  "konnuduven",
  "konnuruven",
  "vettuven",
  // Malayalam (Roman)
  "konnu",
  "kollum",
  "konnukalayum",
  // Telugu (Roman)
  "champestha",
  "champesta",
  "champuthaa",
];

// Native-script violence words, matched anywhere inside a word.
const NATIVE_DANGER_ROOTS = [
  // Hindi (Devanagari)
  "चाकू",
  "बंदूक",
  "बन्दूक",
  "तेजाब",
  "तेज़ाब",
  "हत्या",
  "बलात्कार",
  "अपहरण",
  "मार डाल",
  "मारडाल",
  // Tamil
  "கொல்லுவேன்",
  "கொன்னுடுவேன்",
  "கொல்வேன்",
  "கத்தி",
  "வெட்டுவேன்",
  // Malayalam
  "കൊല്ലും",
  "കൊന്നു",
  "കത്തി",
];

// Native-script violence words that are only dangerous as a whole word.
const NATIVE_DANGER_EXACT = ["बम", "खून"];

const YOU = "you|u|ya|yu|yourself|urself|yourselves";
const YOUR = "your|ur|yr";
const MEDIA =
  "photo|photos|pic|pics|picture|pictures|video|videos|vid|vids|nude|nudes|image|images|chat|chats|number|address";
const PRIVATE_MEDIA =
  "nude|nudes|naked|boobs|body|breast|breasts|private|privates";
const HARM_VERB =
  "kill|murder|stab|shoot|beat|slap|cut|burn|choke|strangle|attack|kidnap|rape|destroy|ruin";
const STRONG_HARM_VERB = "kill|murder|rape|stab|kidnap|strangle";
const WILL = "will|wil|ll|gonna|shall|going|gona";

// Each phrase is a list of word positions; "a|b" means either word.
// "?" before a position makes it optional.
const DANGER_PHRASES = [
  [HARM_VERB, YOU],
  ["i", `?${WILL}`, "?to", STRONG_HARM_VERB],
  ["go", "die"],
  ["die", "bitch|slut|whore|you|u"],
  ["i", "?will|know", "find|know", "where", YOU, "live|stay|work"],
  ["i", `?${WILL}`, "?to", "find", YOU],
  ["leak|viral|expose", `?${YOUR}`, MEDIA],
  ["send|show|share|post|upload", "?me", `?${YOUR}`, PRIVATE_MEDIA],
  ["remove|take|takeoff", "?off", `?${YOUR}`, "clothes|dress|top|bra|shirt"],
  ["strip", "?for", "?me"],
  ["throw|pour", "acid"],
  ["acid", "attack"],
  ["come", "to", YOUR, "house|home|place"],
  [WILL, "regret"],
  ["maar|mar", "dunga|dalunga|daalunga|denge|dalenge"],
  ["jaan", "se", "maar|mar"],
  ["uthwa|utha", "lunga|lenge|dunga"],
];

const parsePhrase = (phrase) =>
  phrase.map((position) => {
    const optional = position.startsWith("?");
    const words = (optional ? position.slice(1) : position)
      .split("|")
      .map((word) => word.trim())
      .filter(Boolean);

    return { optional, words: new Set(words) };
  });

const PARSED_DANGER_PHRASES = DANGER_PHRASES.map(parsePhrase);
const DANGER_ROOT_FORMS = DANGER_WORD_ROOTS.map(collapseRepeats);
const DANGER_EXACT_FORMS = new Set(DANGER_WORDS_EXACT);
const NATIVE_DANGER_FORMS = NATIVE_DANGER_ROOTS.map(nativeForm);
const NATIVE_DANGER_EXACT_FORMS = new Set(NATIVE_DANGER_EXACT.map(nativeForm));

const isNativeDangerWord = (value) => {
  const form = nativeForm(value);

  if (!form) {
    return false;
  }

  return (
    NATIVE_DANGER_EXACT_FORMS.has(form) ||
    NATIVE_DANGER_FORMS.some((root) => form.includes(root))
  );
};

const isDangerWord = (value) => {
  if (isNativeDangerWord(value)) {
    return true;
  }

  const letters = normalizeLetters(value);

  if (!letters) {
    return false;
  }

  if (DANGER_EXACT_FORMS.has(letters)) {
    return true;
  }

  const collapsed = collapseRepeats(letters);

  return DANGER_ROOT_FORMS.some((root) => collapsed.includes(root));
};

// Returns the index of the last matched token, or -1.
const matchPhraseAt = (words, startIndex, parts, partIndex = 0) => {
  if (partIndex === parts.length) {
    return startIndex - 1;
  }

  const part = parts[partIndex];
  const word = words[startIndex];

  if (
    word &&
    (part.words.has(word.letters) || part.words.has(word.collapsed))
  ) {
    const end = matchPhraseAt(words, startIndex + 1, parts, partIndex + 1);

    if (end >= 0) {
      return end;
    }
  }

  if (part.optional) {
    return matchPhraseAt(words, startIndex, parts, partIndex + 1);
  }

  return -1;
};

const countDigits = (value) =>
  (String(value).match(/\p{Nd}/gu) ?? []).length;

const numberWordValue = (value) =>
  NUMBER_WORDS.get(String(value).toLowerCase());

const isNumberToken = (token) =>
  countDigits(token.text) > 0 || numberWordValue(token.text) !== undefined;

const tokenize = (text) => {
  const tokens = [];
  // Zero-width joiners are part of words in Malayalam and other Indic scripts.
  const pattern = /[\p{L}\p{M}\p{N}@$!\u200C\u200D]+/gu;
  let match;

  while ((match = pattern.exec(text)) !== null) {
    tokens.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  return tokens;
};

const isNumberGap = (gap) => /^[\s\-.,()+_*#]{0,4}$/.test(gap);

const isLetterGap = (gap) => /^[\s\-.,_*]{1,3}$/.test(gap);

const maskSpan = (chars, start, end, onlyDigits = false) => {
  for (let index = start; index < end; index += 1) {
    if (!onlyDigits || /\p{Nd}/u.test(chars[index])) {
      chars[index] = MASK_CHAR;
    }
  }
};

export const maskChatMessage = (input) => {
  const text = String(input ?? "");
  const chars = Array.from(text);
  const reasons = new Set();

  // Array.from splits by code point; rebuild indexes against that array.
  const codePointText = chars.join("");
  const tokens = tokenize(codePointText).map((token) => {
    const start = Array.from(codePointText.slice(0, token.start)).length;
    const length = Array.from(token.text).length;

    return { ...token, start, end: start + length };
  });

  let index = 0;

  while (index < tokens.length) {
    if (!isNumberToken(tokens[index])) {
      index += 1;
      continue;
    }

    let runEnd = index;
    let digits =
      countDigits(tokens[index].text) +
      (numberWordValue(tokens[index].text) ?? 0);

    while (runEnd + 1 < tokens.length) {
      const next = tokens[runEnd + 1];
      const gap = chars
        .slice(tokens[runEnd].end, next.start)
        .join("");

      if (!isNumberGap(gap) || !isNumberToken(next)) {
        break;
      }

      digits +=
        countDigits(next.text) + (numberWordValue(next.text) ?? 0);
      runEnd += 1;
    }

    if (digits >= MIN_CONTACT_DIGITS) {
      for (let item = index; item <= runEnd; item += 1) {
        const token = tokens[item];
        const isWord = numberWordValue(token.text) !== undefined;
        maskSpan(chars, token.start, token.end, !isWord);
      }

      reasons.add("contact_number");
    }

    index = runEnd + 1;
  }

  for (const token of tokens) {
    if (isBadWord(token.text)) {
      maskSpan(chars, token.start, token.end);
      reasons.add("bad_word");
    }

    if (isDangerWord(token.text)) {
      maskSpan(chars, token.start, token.end);
      reasons.add("harassment");
    }
  }

  // Native-script threats written as two words, such as "मार डालूंगा".
  for (let item = 0; item + 1 < tokens.length; item += 1) {
    const first = tokens[item];
    const second = tokens[item + 1];
    const gap = chars.slice(first.end, second.start).join("");

    if (
      /^\s{1,2}$/.test(gap) &&
      !isNativeDangerWord(first.text) &&
      !isNativeDangerWord(second.text) &&
      isNativeDangerWord(`${first.text}${second.text}`)
    ) {
      maskSpan(chars, first.start, second.end);
      reasons.add("harassment");
    }
  }

  const words = tokens.map((token) => {
    const letters = normalizeLetters(token.text);

    return { letters, collapsed: collapseRepeats(letters) };
  });

  for (let start = 0; start < tokens.length; start += 1) {
    for (const phrase of PARSED_DANGER_PHRASES) {
      const end = matchPhraseAt(words, start, phrase);

      if (end >= start) {
        maskSpan(chars, tokens[start].start, tokens[end].end);
        reasons.add("harassment");
      }
    }
  }

  // Catch spaced-out words such as "f u c k" or "s.h.i.t".
  index = 0;

  while (index < tokens.length) {
    if (Array.from(tokens[index].text).length !== 1) {
      index += 1;
      continue;
    }

    let runEnd = index;

    while (
      runEnd + 1 < tokens.length &&
      Array.from(tokens[runEnd + 1].text).length === 1 &&
      isLetterGap(chars.slice(tokens[runEnd].end, tokens[runEnd + 1].start).join(""))
    ) {
      runEnd += 1;
    }

    if (runEnd > index) {
      const joined = tokens
        .slice(index, runEnd + 1)
        .map((token) => token.text)
        .join("");

      if (isBadWord(joined)) {
        maskSpan(chars, tokens[index].start, tokens[runEnd].end);
        reasons.add("bad_word");
      }
    }

    index = runEnd + 1;
  }

  const masked = chars.join("");

  return {
    text: masked,
    masked: masked !== text,
    reasons: [...reasons],
  };
};
