export const NEWS_LANGUAGE_OPTIONS = [
  { label: "English", code: "en" },
  { label: "Tamil", code: "ta" },
  { label: "Hindi", code: "hi" },
  { label: "Telugu", code: "te" },
  { label: "Malayalam", code: "ml" },
  { label: "Kannada", code: "kn" },
  { label: "Marathi", code: "mr" },
  { label: "Bengali", code: "bn" },
  { label: "Gujarati", code: "gu" },
  { label: "Punjabi", code: "pa" },
  { label: "Urdu", code: "ur" },
  { label: "Arabic", code: "ar" },
  { label: "French", code: "fr" },
  { label: "German", code: "de" },
  { label: "Spanish", code: "es" }
];

export const LANGUAGE_NAME_TO_CODE = {
  English: "en",
  Tamil: "ta",
  Hindi: "hi",
  Telugu: "te",
  Malayalam: "ml",
  Kannada: "kn",
  Marathi: "mr",
  Bengali: "bn",
  Gujarati: "gu",
  Punjabi: "pa",
  Urdu: "ur",
  Arabic: "ar",
  French: "fr",
  German: "de",
  Spanish: "es",
  Japanese: "ja",
  Korean: "ko",
  Chinese: "zh"
};

export const DEFAULT_NEWS_LANGUAGE =
"en";

export const NEWS_CATEGORY_OPTIONS = [
  { id: "news", label: "News" },
  { id: "movies", label: "Movies" },
  { id: "entertainment", label: "Entertainment" },
  { id: "media", label: "Media" }
];

const CATEGORY_IMAGE_POOL = {
  news: [
    "https://images.unsplash.com/photo-1504711434969-e33886168f5c?w=800&h=450&fit=crop",
    "https://images.unsplash.com/photo-1495020689067-958852a7765e?w=800&h=450&fit=crop",
    "https://images.unsplash.com/photo-1586339949916-3e9457bef6d3?w=800&h=450&fit=crop"
  ],
  movies: [
    "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=800&h=450&fit=crop",
    "https://images.unsplash.com/photo-1440404653325-ab127d49abc1?w=800&h=450&fit=crop",
    "https://images.unsplash.com/photo-1478720568477-152d9b164e26?w=800&h=450&fit=crop"
  ],
  entertainment: [
    "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=800&h=450&fit=crop",
    "https://images.unsplash.com/photo-1429962714451-bb934ecdcbed?w=800&h=450&fit=crop",
    "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=800&h=450&fit=crop"
  ],
  media: [
    "https://images.unsplash.com/photo-1611162616475-46b635cb6868?w=800&h=450&fit=crop",
    "https://images.unsplash.com/photo-1611606063065-ee386d1f7630?w=800&h=450&fit=crop",
    "https://images.unsplash.com/photo-1522202176988-66273c2fd55f?w=800&h=450&fit=crop"
  ]
};

const hashString =
(value)=>{

let hash =
0;

for(
let index =
0;
index <
value.length;
index++
){

hash =
(
hash <<
5
) -
hash +
value.charCodeAt(index);

hash |=
0;

}

return Math.abs(hash);

};

export const getCategoryFallbackImage =
(category,seed)=>{

const pool =
CATEGORY_IMAGE_POOL[category] ??
CATEGORY_IMAGE_POOL.news;

return pool[
hashString(seed) %
pool.length
];

};

const getLocaleParams =
(code)=>{

const normalized =
String(code ?? DEFAULT_NEWS_LANGUAGE)
.toLowerCase();

const indianCodes = [
"en",
"hi",
"ta",
"te",
"ml",
"kn",
"mr",
"bn",
"gu",
"pa",
"ur"
];

if(
normalized === "en"
){
return {
 hl:"en-IN",
 gl:"IN",
 ceid:"IN:en"
};
}

if(
indianCodes.includes(normalized)
){
return {
 hl:normalized,
 gl:"IN",
 ceid:`IN:${normalized}`
};
}

return {
 hl:normalized,
 gl:"US",
 ceid:`US:${normalized}`
};

};

export const getNewsFeedUrl =
(code,category = "news")=>{

const locale =
getLocaleParams(code);

const query =
new URLSearchParams({
 hl:locale.hl,
 gl:locale.gl,
 ceid:locale.ceid
});

if(
category === "movies"
){
return `https://news.google.com/rss/search?q=${encodeURIComponent("latest movie release OR new film trailer")}&${query.toString()}`;
}

if(
category === "entertainment"
){
return `https://news.google.com/rss/search?q=${encodeURIComponent("entertainment celebrity showbiz")}&${query.toString()}`;
}

if(
category === "media"
){
return `https://news.google.com/rss/search?q=${encodeURIComponent("media industry streaming OTT television")}&${query.toString()}`;
}

return `https://news.google.com/rss?${query.toString()}`;

};

export const resolveNewsLanguageCode =
(input)=>{

if(!input){
return DEFAULT_NEWS_LANGUAGE;
}

const trimmed =
String(input).trim();

const byLabel =
NEWS_LANGUAGE_OPTIONS.find(
(item)=>
item.label.toLowerCase() ===
trimmed.toLowerCase()
);

if(byLabel){
return byLabel.code;
}

const byCode =
NEWS_LANGUAGE_OPTIONS.find(
(item)=>
item.code === trimmed.toLowerCase()
);

if(byCode){
return byCode.code;
}

const mapped =
LANGUAGE_NAME_TO_CODE[trimmed];

return mapped ?? DEFAULT_NEWS_LANGUAGE;

};
