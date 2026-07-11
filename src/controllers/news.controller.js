import {
fetchNewsFeed,
getSupportedNewsCategories,
getSupportedNewsLanguages
} from "../services/newsFeed.service.js";

export const getNewsArticles =
async(req,res)=>{

try{

const {
language,
category
}=req.query;

const data =
await fetchNewsFeed(
language,
category
);

return res.json({
 success:true,
 ...data
});

}catch(error){

console.log(
"GET NEWS FEED ERROR",
error.message
);

return res.status(500).json({
 success:false,
 message:"Unable to load news feed right now"
});

}

};

export const getNewsLanguages =
async(req,res)=>{

try{

const languages =
await getSupportedNewsLanguages();

return res.json({
 success:true,
 languages
});

}catch(error){

return res.status(500).json({
 message:error.message
});

}

};

export const getNewsCategories =
async(req,res)=>{

try{

const categories =
getSupportedNewsCategories();

return res.json({
 success:true,
 categories
});

}catch(error){

return res.status(500).json({
 message:error.message
});

}

};
