import axios from "axios";

import {
DEFAULT_NEWS_LANGUAGE,
getCategoryFallbackImage,
getNewsFeedUrl,
NEWS_CATEGORY_OPTIONS,
NEWS_LANGUAGE_OPTIONS,
resolveNewsLanguageCode
} from "../constants/newsFeeds.js";

const cache =
new Map();

const CACHE_TTL_MS =
5 *
60 *
1000;

const stripCdata =
(value)=>{

if(!value){
return "";
}

return value
.replace(
/<!\[CDATA\[([\s\S]*?)\]\]>/g,
"$1"
)
.replace(
/<[^>]+>/g,
""
)
.trim();

};

const decodeEntities =
(text)=>
text
.replace(
/&amp;/g,
"&"
)
.replace(
/&lt;/g,
"<"
)
.replace(
/&gt;/g,
">"
)
.replace(
/&quot;/g,
"\""
)
.replace(
/&#39;/g,
"'"
);

const extractTag =
(block,tag)=>{

const match =
block.match(
new RegExp(
`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
"i"
)
);

return match ?
match[1] :
"";

};

const extractRawTag =
(block,tag)=>{

const match =
block.match(
new RegExp(
`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`,
"i"
)
);

return match ?
match[1] :
"";

};

const extractImageFromBlock =
(block)=>{

const mediaContent =
block.match(
/<media:content[^>]+url=["']([^"']+)["']/i
);

if(
mediaContent?.[1]
){
return mediaContent[1];
}

const mediaThumbnail =
block.match(
/<media:thumbnail[^>]+url=["']([^"']+)["']/i
);

if(
mediaThumbnail?.[1]
){
return mediaThumbnail[1];
}

const description =
decodeEntities(
extractRawTag(
block,
"description"
)
);

const imgMatch =
description.match(
/src=["']([^"']+)["']/i
);

if(
imgMatch?.[1]
){
return imgMatch[1];
}

return "";

};

const extractDescriptionText =
(block)=>{

const description =
decodeEntities(
extractRawTag(
block,
"description"
)
);

return description
.replace(
/<[^>]+>/g,
" "
)
.replace(
/\s+/g,
" "
)
.trim()
.slice(
0,
280
);

};

export const parseNewsRss =
(xml,category = "news")=>{

const items = [];

const itemRegex =
/<item>([\s\S]*?)<\/item>/gi;

let match;

while(
(match = itemRegex.exec(xml)) !== null
){

const block =
match[1];

const title =
decodeEntities(
stripCdata(
extractTag(
block,
"title"
)
)
);

const link =
stripCdata(
extractTag(
block,
"link"
)
);

const pubDate =
stripCdata(
extractTag(
block,
"pubDate"
)
);

const source =
decodeEntities(
stripCdata(
extractTag(
block,
"source"
)
)
);

const description =
extractDescriptionText(block);

const imageUrl =
extractImageFromBlock(block) ||
getCategoryFallbackImage(
category,
title || link
);

if(
!title ||
!link
){
continue;
}

items.push({
title,
link,
pubDate,
description,
imageUrl,
category,
source:source || "Google News"
});

}

return items;

};

export const fetchNewsFeed =
async(languageInput,categoryInput = "news")=>{

const language =
resolveNewsLanguageCode(
languageInput
);

const category =
NEWS_CATEGORY_OPTIONS.some(
(item)=>
item.id === categoryInput
) ?
categoryInput :
"news";

const cacheKey =
`${language}:${category}`;

const cached =
cache.get(cacheKey);

if(
cached &&
Date.now() -
cached.timestamp <
CACHE_TTL_MS
){
return {
 language,
 category,
 source:"google-news-rss",
 cached:true,
 articles:cached.articles
};
}

const feedUrl =
getNewsFeedUrl(
language,
category
);

const response =
await axios.get(
feedUrl,
{
 timeout:12000,
 headers:{
  "User-Agent":"Mozilla/5.0 (compatible; DatingAppNewsBot/1.0)"
 },
 responseType:"text",
 maxRedirects:5
}
);

const articles =
parseNewsRss(
response.data,
category
).slice(
0,
25
);

cache.set(
cacheKey,
{
 timestamp:Date.now(),
 articles
}
);

return {
 language,
 category,
 source:"google-news-rss",
 cached:false,
 articles
};

};

export const getSupportedNewsLanguages =
()=>
NEWS_LANGUAGE_OPTIONS;

export const getSupportedNewsCategories =
()=>
NEWS_CATEGORY_OPTIONS;
